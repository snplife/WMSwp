import { useMemo, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { getMesEventDurationMs, getMesEventQuantity } from "../../modules/mes/analytics";
import "./mesAnalyticsExports.css";

const DETAIL_COLUMNS = [
  ["Číslo zákazky", 18], ["Operácia", 14], ["Stroj", 20], ["Operátor", 24], ["Kód položky", 18], ["Popis operácie", 34],
  ["IST kusy", 12], ["Dátum ukončenia", 16], ["Čas ukončenia", 14], ["Plánovaný čas / ks", 18], ["Skutočný čas / ks", 18],
  ["Skutočný čas spolu", 20], ["Rozdiel v min", 16], ["Nastavenie", 12]
];

const numberFormatter = new Intl.NumberFormat("sk-SK", { maximumFractionDigits: 2 });

function toDateInputValue(date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 10);
}

function getRangeWindow(rangeKey, customStart, customEnd) {
  const now = new Date();
  let start = new Date(now);
  let end = new Date(now);
  let label = "Aktuálna zmena";

  if (rangeKey === "current_shift") {
    start.setHours(6, 0, 0, 0);
    if (now < start) start.setDate(start.getDate() - 1);
  } else if (rangeKey === "today") {
    start.setHours(0, 0, 0, 0);
    label = "Dnes";
  } else if (rangeKey === "yesterday") {
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setHours(23, 59, 59, 999);
    label = "Včera";
  } else if (rangeKey === "last_7_days") {
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    label = "Posledných 7 dní";
  } else if (rangeKey === "custom") {
    start = customStart ? new Date(`${customStart}T00:00:00`) : new Date(0);
    end = customEnd ? new Date(`${customEnd}T23:59:59.999`) : now;
    label = `${customStart || "od začiatku"} – ${customEnd || "dnes"}`;
  }

  return { startMs: start.getTime(), endMs: end.getTime(), label };
}

function machineKey(row) {
  return String(row?.machine_id || row?.workstation_id || "");
}

function operatorLabel(row) {
  return String(row?.operator_name || row?.payload?.operator_name || row?.operator_id || row?.operator_user_id || "").trim();
}

function downloadFile(buffer, fileName) {
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function buildChartDataUrl(title, rows) {
  if (!rows.length || typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 480;
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#17324a";
  context.font = "bold 28px Arial";
  context.fillText(title, 48, 48);
  const visibleRows = rows.slice(0, 12);
  const maxValue = Math.max(1, ...visibleRows.map((row) => Number(row.value || 0)));
  const chartTop = 82;
  const chartBottom = 390;
  const chartHeight = chartBottom - chartTop;
  const slotWidth = 1100 / Math.max(1, visibleRows.length);
  visibleRows.forEach((row, index) => {
    const height = (Number(row.value || 0) / maxValue) * chartHeight;
    const x = 54 + index * slotWidth;
    context.fillStyle = "#2d729c";
    context.fillRect(x, chartBottom - height, Math.max(22, slotWidth - 24), height);
    context.fillStyle = "#17324a";
    context.font = "bold 17px Arial";
    context.fillText(numberFormatter.format(row.value), x, Math.max(chartTop, chartBottom - height - 8));
    context.save();
    context.translate(x + 4, 420);
    context.rotate(-0.35);
    context.font = "15px Arial";
    context.fillText(String(row.label || "-").slice(0, 18), 0, 0);
    context.restore();
  });
  return canvas.toDataURL("image/png");
}

export default function MesAnalyticsExports({ companyName, overviewRows, jobRuns, mesEvents, workstations }) {
  const today = toDateInputValue(new Date());
  const [reportType, setReportType] = useState("overview");
  const [rangeKey, setRangeKey] = useState("last_7_days");
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [selectedMachineKey, setSelectedMachineKey] = useState("all");
  const [selectedOperator, setSelectedOperator] = useState("all");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  const rangeWindow = useMemo(() => getRangeWindow(rangeKey, customStart, customEnd), [rangeKey, customStart, customEnd]);
  const runById = useMemo(() => new Map(jobRuns.map((run) => [String(run.id || ""), run])), [jobRuns]);
  const workstationById = useMemo(() => new Map(workstations.map((row) => [String(row.id || ""), row])), [workstations]);
  const machineOptions = useMemo(() => overviewRows.map((row) => ({
    key: machineKey(row),
    label: row.machine_name || row.workstation_name || row.machine_code || row.workstation_code || "Stroj"
  })).filter((row) => row.key), [overviewRows]);
  const operatorOptions = useMemo(() => Array.from(new Set([
    ...jobRuns.map(operatorLabel),
    ...mesEvents.map((event) => operatorLabel(runById.get(String(event.job_run_id || ""))) || operatorLabel(event))
  ].filter(Boolean))).sort((left, right) => left.localeCompare(right, "sk-SK", { sensitivity: "base" })), [jobRuns, mesEvents, runById]);

  const exportRows = useMemo(() => {
    const resolveMachine = (row) => overviewRows.find((machine) =>
      (row?.machine_id && String(machine.machine_id || "") === String(row.machine_id)) ||
      (row?.workstation_id && String(machine.workstation_id || "") === String(row.workstation_id)) ||
      (row?.terminal_id && String(machine.terminal_id || "") === String(row.terminal_id))
    ) || null;
    const matchesFilters = (row) => {
      const machine = resolveMachine(row);
      const rowMachineKey = machineKey(machine || row);
      const rowOperator = operatorLabel(runById.get(String(row?.job_run_id || ""))) || operatorLabel(row);
      return (selectedMachineKey === "all" || rowMachineKey === selectedMachineKey) &&
        (selectedOperator === "all" || rowOperator === selectedOperator);
    };
    const makeRow = ({ source, event = null, happenedAt, quantity, durationMs, isSetup }) => {
      const run = event?.job_run_id ? runById.get(String(event.job_run_id)) || source : source;
      const machine = resolveMachine(event || source) || {};
      const workstation = workstationById.get(String(machine.workstation_id || source?.workstation_id || "")) || {};
      const targetCycleSeconds = Number(workstation.target_cycle_seconds || 0) > 0
        ? Number(workstation.target_cycle_seconds)
        : Number(workstation.ideal_units_per_hour || 0) > 0 ? 3600 / Number(workstation.ideal_units_per_hour) : 0;
      const completedAt = new Date(happenedAt || 0);
      const validDate = Number.isFinite(completedAt.getTime());
      const resolvedQuantity = Math.max(0, Number(quantity || 0));
      const durationMinutes = Number(durationMs || 0) > 0 ? Number(durationMs) / 60_000 : 0;
      const plannedPerPiece = targetCycleSeconds > 0 ? targetCycleSeconds / 60 : "";
      const actualPerPiece = resolvedQuantity > 0 && durationMinutes > 0 ? durationMinutes / resolvedQuantity : "";
      const plannedTotal = Number(plannedPerPiece || 0) * (resolvedQuantity || 1);
      const operationCode = String(event?.payload?.operation_code || event?.payload?.operation_number || run?.payload?.operation_code || "").trim();
      return {
        "Číslo zákazky": String(run?.job_number || event?.job_number || "").trim(),
        "Operácia": operationCode,
        "Stroj": String(machine.machine_code || machine.machine_name || machine.workstation_name || source?.machine_id || source?.workstation_id || "").trim(),
        "Operátor": operatorLabel(run) || operatorLabel(event),
        "Kód položky": String(run?.item_code || event?.payload?.item_code || "").trim(),
        "Popis operácie": String(run?.item_name || event?.payload?.operation_text || run?.note || event?.downtime_reason_name || "").trim(),
        "IST kusy": resolvedQuantity,
        "Dátum ukončenia": validDate ? completedAt : "",
        "Čas ukončenia": validDate ? completedAt.toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "",
        "Plánovaný čas / ks": plannedPerPiece === "" ? "" : Number(plannedPerPiece.toFixed(2)),
        "Skutočný čas / ks": actualPerPiece === "" ? "" : Number(actualPerPiece.toFixed(2)),
        "Skutočný čas spolu": durationMinutes > 0 ? Number(durationMinutes.toFixed(2)) : "",
        "Rozdiel v min": durationMinutes > 0 && plannedTotal > 0 ? Number((durationMinutes - plannedTotal).toFixed(2)) : "",
        "Nastavenie": isSetup ? "Áno" : "Nie"
      };
    };

    const allowedEventTypes = new Set(["good_count", "scrap_count", "ml", "setup_start", "setup_end", "start", "complete"]);
    const rows = mesEvents.flatMap((event) => {
      const eventType = String(event.event_type || event.event_code || "").toLowerCase();
      const happenedAt = event.happened_at || event.created_at;
      const happenedMs = new Date(happenedAt || 0).getTime();
      if (!allowedEventTypes.has(eventType) || happenedMs < rangeWindow.startMs || happenedMs > rangeWindow.endMs || !matchesFilters(event)) return [];
      return [makeRow({
        source: runById.get(String(event.job_run_id || "")) || event,
        event,
        happenedAt,
        quantity: ["good_count", "scrap_count", "ml"].includes(eventType) ? getMesEventQuantity(event) : 0,
        durationMs: getMesEventDurationMs(event),
        isSetup: eventType === "setup_start" || event.payload?.is_setup === true
      })];
    });

    if (!rows.length) {
      jobRuns.forEach((run) => {
        const happenedAt = run.ended_at || run.updated_at || run.created_at;
        const happenedMs = new Date(happenedAt || 0).getTime();
        if (happenedMs < rangeWindow.startMs || happenedMs > rangeWindow.endMs || !matchesFilters(run)) return;
        const startedMs = new Date(run.started_at || run.created_at || 0).getTime();
        rows.push(makeRow({
          source: run,
          happenedAt,
          quantity: Number(run.good_quantity || 0) + Number(run.scrap_quantity || 0),
          durationMs: Number.isFinite(startedMs) && happenedMs > startedMs ? happenedMs - startedMs : 0,
          isSetup: false
        }));
      });
    }
    return rows.sort((left, right) => new Date(left["Dátum ukončenia"] || 0) - new Date(right["Dátum ukončenia"] || 0));
  }, [jobRuns, mesEvents, overviewRows, rangeWindow, runById, selectedMachineKey, selectedOperator, workstationById]);

  const summary = useMemo(() => ({
    quantity: exportRows.reduce((sum, row) => sum + Number(row["IST kusy"] || 0), 0),
    duration: exportRows.reduce((sum, row) => sum + Number(row["Skutočný čas spolu"] || 0), 0),
    setups: exportRows.filter((row) => row["Nastavenie"] === "Áno").length,
    jobs: new Set(exportRows.map((row) => row["Číslo zákazky"]).filter(Boolean)).size
  }), [exportRows]);

  const handleExport = async () => {
    if (exporting || !exportRows.length) return;
    setExporting(true);
    setExportError("");
    try {
      const module = await import("exceljs");
      const ExcelJS = module.default || module;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "MES LULA";
      workbook.created = new Date();
      workbook.modified = new Date();
      const aggregate = (key) => {
        const values = new Map();
        exportRows.forEach((row) => {
          const label = String(key(row) || "Neurčené");
          values.set(label, Number(values.get(label) || 0) + Number(row["IST kusy"] || 0));
        });
        return Array.from(values, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
      };
      const dailyRows = aggregate((row) => row["Dátum ukončenia"] instanceof Date ? row["Dátum ukončenia"].toLocaleDateString("sk-SK") : "Bez dátumu");
      const machineRows = aggregate((row) => row["Stroj"]);
      const operatorRows = aggregate((row) => row["Operátor"]);
      const reportConfig = {
        overview: ["Súhrnný report", "Výroba podľa strojov", machineRows],
        machines: ["Report podľa strojov", "Výroba podľa strojov", machineRows],
        operators: ["Report podľa operátorov", "Výroba podľa operátorov", operatorRows]
      }[reportType];

      const summarySheet = workbook.addWorksheet("Súhrn", { views: [{ showGridLines: false }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
      summarySheet.columns = Array.from({ length: 8 }, () => ({ width: 18 }));
      summarySheet.mergeCells("A1:H2");
      const titleCell = summarySheet.getCell("A1");
      titleCell.value = `MES report | ${companyName || "Firma"}`;
      titleCell.font = { name: "Arial", size: 22, bold: true, color: { argb: "FFFFFFFF" } };
      titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17324A" } };
      titleCell.alignment = { vertical: "middle", horizontal: "left" };
      const selectedMachine = machineOptions.find((row) => row.key === selectedMachineKey)?.label || "Všetky stroje";
      [["Typ reportu", reportConfig[0], "Obdobie", rangeWindow.label], ["Stroj", selectedMachine, "Operátor", selectedOperator === "all" ? "Všetci operátori" : selectedOperator]].forEach((values, index) => {
        const row = summarySheet.getRow(4 + index);
        row.values = values;
        row.height = 24;
        [1, 3].forEach((column) => { row.getCell(column).font = { bold: true, color: { argb: "FF63788B" } }; });
        [2, 4].forEach((column) => { row.getCell(column).font = { bold: true, color: { argb: "FF17324A" } }; });
      });
      [
        ["A7:B8", "Vyrobené kusy", numberFormatter.format(summary.quantity)],
        ["C7:D8", "Zákazky", numberFormatter.format(summary.jobs)],
        ["E7:F8", "Skutočný čas", `${numberFormatter.format(summary.duration)} min`],
        ["G7:H8", "Nastavenia", numberFormatter.format(summary.setups)]
      ].forEach(([range, label, value]) => {
        summarySheet.mergeCells(range);
        const cell = summarySheet.getCell(range.split(":")[0]);
        cell.value = `${label}\n${value}`;
        cell.font = { name: "Arial", size: 15, bold: true, color: { argb: "FF17324A" } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF1F4" } };
        cell.border = { top: { style: "thin", color: { argb: "FFCAD7DF" } }, left: { style: "thin", color: { argb: "FFCAD7DF" } }, bottom: { style: "thin", color: { argb: "FFCAD7DF" } }, right: { style: "thin", color: { argb: "FFCAD7DF" } } };
      });
      [["Výroba v čase", dailyRows, "A10:H25"], [reportConfig[1], reportConfig[2], "A27:H42"]].forEach(([title, rows, range]) => {
        const dataUrl = buildChartDataUrl(title, rows);
        if (dataUrl) summarySheet.addImage(workbook.addImage({ base64: dataUrl, extension: "png" }), range);
      });

      const detailSheet = workbook.addWorksheet("Detailné dáta", { views: [{ state: "frozen", ySplit: 1 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
      detailSheet.columns = DETAIL_COLUMNS.map(([header, width]) => ({ header, key: header, width }));
      exportRows.forEach((row) => detailSheet.addRow(row));
      detailSheet.autoFilter = { from: "A1", to: "N1" };
      const header = detailSheet.getRow(1);
      header.height = 28;
      header.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17324A" } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      });
      detailSheet.getColumn("Dátum ukončenia").numFmt = "dd.mm.yyyy";
      ["IST kusy", "Plánovaný čas / ks", "Skutočný čas / ks", "Skutočný čas spolu", "Rozdiel v min"].forEach((name) => { detailSheet.getColumn(name).numFmt = "0.00"; });
      detailSheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1 && rowNumber % 2 === 1) row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F7F8" } }; });
      });
      const slug = String(companyName || "firma").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "firma";
      downloadFile(await workbook.xlsx.writeBuffer(), `mes-report-${slug}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (error) {
      setExportError(error?.message || "Excel report sa nepodarilo vytvoriť.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <article className="orders-panel-card workflow-card workflow-card-list factory-os-mes-panel factory-mes-export-panel">
      <div className="panel-head workflow-section-head">
        <div><p className="workflow-section-kicker">Analytika</p><h2>Analytika a exporty</h2><p className="panel-meta">Samostatný Excel report v rovnakom formáte ako v hlavnej aplikácii.</p></div>
        <button type="button" className="settings-btn factory-mes-export-button" onClick={handleExport} disabled={exporting || exportRows.length === 0}><Download size={16} />{exporting ? "Vytváram Excel..." : "Exportovať Excel"}</button>
      </div>
      <section className="factory-mes-export-filters">
        <label><span>Typ reportu</span><select value={reportType} onChange={(event) => setReportType(event.target.value)}><option value="overview">Súhrnný report</option><option value="machines">Podľa strojov</option><option value="operators">Podľa operátorov</option></select></label>
        <label><span>Obdobie</span><select value={rangeKey} onChange={(event) => setRangeKey(event.target.value)}><option value="current_shift">Aktuálna zmena</option><option value="today">Dnes</option><option value="yesterday">Včera</option><option value="last_7_days">Posledných 7 dní</option><option value="custom">Vlastné obdobie</option></select></label>
        <label><span>Stroj</span><select value={selectedMachineKey} onChange={(event) => setSelectedMachineKey(event.target.value)}><option value="all">Všetky stroje</option>{machineOptions.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}</select></label>
        <label><span>Operátor</span><select value={selectedOperator} onChange={(event) => setSelectedOperator(event.target.value)}><option value="all">Všetci operátori</option>{operatorOptions.map((operator) => <option key={operator} value={operator}>{operator}</option>)}</select></label>
        {rangeKey === "custom" ? <><label><span>Dátum od</span><input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label><label><span>Dátum do</span><input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label></> : null}
      </section>
      <section className="factory-mes-export-summary">
        <article><span>Riadky</span><strong>{numberFormatter.format(exportRows.length)}</strong></article>
        <article><span>IST kusy</span><strong>{numberFormatter.format(summary.quantity)}</strong></article>
        <article><span>Zákazky</span><strong>{numberFormatter.format(summary.jobs)}</strong></article>
        <article><span>Nastavenia</span><strong>{numberFormatter.format(summary.setups)}</strong></article>
      </section>
      {exportError ? <p className="error">{exportError}</p> : null}
      <div className="factory-mes-export-preview-head"><div><FileSpreadsheet size={19} /><strong>Náhľad detailných dát</strong></div><span>{rangeWindow.label} · {exportRows.length} riadkov</span></div>
      <div className="table-wrap factory-mes-export-table"><table><thead><tr>{DETAIL_COLUMNS.slice(0, 8).map(([column]) => <th key={column}>{column}</th>)}</tr></thead><tbody>{exportRows.slice(0, 100).map((row, index) => <tr key={`${row["Číslo zákazky"]}-${index}`}>{DETAIL_COLUMNS.slice(0, 8).map(([column]) => <td key={column}>{column === "Dátum ukončenia" && row[column] instanceof Date ? row[column].toLocaleDateString("sk-SK") : row[column] || "-"}</td>)}</tr>)}</tbody></table></div>
      {!exportRows.length ? <p className="hint">Pre vybrané filtre nie sú dostupné dáta na export.</p> : null}
    </article>
  );
}
