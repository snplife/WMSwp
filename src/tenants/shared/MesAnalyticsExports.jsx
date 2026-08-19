import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { supabase } from "../../supabaseClient";
import "./mesAnalyticsExports.css";

const DETAIL_COLUMNS = [
  ["Dátum", 14], ["Zmena", 22], ["Operátor", 24], ["Stroj", 20],
  ["Vyrobené kusy", 16], ["Výrobný čas (min)", 20]
];

const numberFormatter = new Intl.NumberFormat("sk-SK", { maximumFractionDigits: 2 });
const clientReportCache = new Map();
const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;

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


function downloadFile(buffer, fileName) {
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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


async function fetchMesShiftSummary(companyId, startIso, endIso) {
  const cacheKey = `${companyId}|${startIso}|${endIso}`;
  const cached = clientReportCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CLIENT_CACHE_TTL_MS) return cached.promise;
  const promise = fetchMesShiftSummaryUncached(companyId, startIso, endIso);
  clientReportCache.set(cacheKey, { createdAt: Date.now(), promise });
  promise.catch(() => clientReportCache.delete(cacheKey));
  return promise;
}

async function fetchMesShiftSummaryUncached(companyId, startIso, endIso) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData?.session?.access_token) {
    throw new Error(sessionError?.message || "Prihlásenie vypršalo. Obnov stránku a prihlás sa znova.");
  }
  const params = new URLSearchParams({ company_id: companyId, start: startIso, end: endIso });
  const response = await fetch(`/api/v1/public/mes-analytics-events?${params}`, {
    headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || `MES prepočet zlyhal (${response.status}).`);
  return { rows: payload.summary_rows || [], cycleCount: Number(payload.cycle_count || 0) };
}

export default function MesAnalyticsExports({ companyId, companyName, overviewRows, workstations }) {
  const today = toDateInputValue(new Date());
  const [reportType, setReportType] = useState("overview");
  const [rangeKey, setRangeKey] = useState("last_7_days");
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [selectedMachineKey, setSelectedMachineKey] = useState("all");
  const [selectedOperator, setSelectedOperator] = useState("all");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [rangeShiftRows, setRangeShiftRows] = useState([]);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState("");
  const [processedCycleCount, setProcessedCycleCount] = useState(0);
  const rangeRequestIdRef = useRef(0);

  const rangeWindow = useMemo(() => getRangeWindow(rangeKey, customStart, customEnd), [rangeKey, customStart, customEnd]);
  const workstationById = useMemo(() => new Map(workstations.map((row) => [String(row.id || ""), row])), [workstations]);
  const machineOptions = useMemo(() => overviewRows.map((row) => ({
    key: machineKey(row),
    label: row.machine_name || row.workstation_name || row.machine_code || row.workstation_code || "Stroj"
  })).filter((row) => row.key), [overviewRows]);
  const operatorOptions = useMemo(() => Array.from(new Set(rangeShiftRows.map((row) => row.operator).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right, "sk-SK", { sensitivity: "base" })), [rangeShiftRows]);

  useEffect(() => {
    if (!companyId) {
      setRangeShiftRows([]);
      return undefined;
    }
    if (!Number.isFinite(rangeWindow.startMs) || !Number.isFinite(rangeWindow.endMs) || rangeWindow.startMs > rangeWindow.endMs) {
      setRangeShiftRows([]);
      setRangeError("Dátum od musí byť skorší alebo rovnaký ako dátum do.");
      return undefined;
    }

    {
      const requestId = ++rangeRequestIdRef.current;
      setRangeLoading(true);
      setRangeError("");
      setRangeShiftRows([]);
      setProcessedCycleCount(0);
      const timeoutId = window.setTimeout(async () => {
        try {
          const result = await fetchMesShiftSummary(
            companyId,
            new Date(rangeWindow.startMs).toISOString(),
            new Date(rangeWindow.endMs).toISOString()
          );
          if (requestId !== rangeRequestIdRef.current) return;
          setRangeShiftRows(result.rows);
          setProcessedCycleCount(result.cycleCount);
        } catch (error) {
          if (requestId !== rangeRequestIdRef.current) return;
          setRangeShiftRows([]);
          setRangeError(error?.message || "Súhrn pre zvolené obdobie sa nepodarilo spracovať zo SQL.");
        } finally {
          if (requestId === rangeRequestIdRef.current) setRangeLoading(false);
        }
      }, 300);
      return () => {
        window.clearTimeout(timeoutId);
        rangeRequestIdRef.current += 1;
      };
    }

  }, [companyId, rangeWindow.startMs, rangeWindow.endMs]);

  const exportRows = useMemo(() => {
    const resolveMachine = (row) => overviewRows.find((machine) =>
      (row?.machine_id && String(machine.machine_id || "") === String(row.machine_id)) ||
      (row?.workstation_id && String(machine.workstation_id || "") === String(row.workstation_id)) ||
      (row?.terminal_id && String(machine.terminal_id || "") === String(row.terminal_id))
    ) || null;
    return rangeShiftRows
      .filter((row) => {
        const rowMachineKey = machineKey(resolveMachine(row) || row);
        return (selectedMachineKey === "all" || rowMachineKey === selectedMachineKey) &&
          (selectedOperator === "all" || row.operator === selectedOperator);
      })
      .map((row) => {
        const machine = resolveMachine(row) || {};
        const workstation = workstationById.get(String(row.workstation_id || "")) || {};
        return {
          "Dátum": new Date(`${row.date}T12:00:00`),
          "Zmena": row.shift,
          "Operátor": row.operator,
          "Stroj": machine.machine_name || machine.machine_code || machine.workstation_name || machine.workstation_code || workstation.name || workstation.code || row.machine_id || row.workstation_id || "Neurčený stroj",
          "Vyrobené kusy": Number(row.pieces || 0),
          "Výrobný čas (min)": Number(row.runtime_minutes || 0),
          __shiftOrder: Number(row.shift_order || 0)
        };
      })
      .filter((row) => row["Vyrobené kusy"] > 0)
      .sort((left, right) => left["Dátum"] - right["Dátum"] || left.__shiftOrder - right.__shiftOrder || left["Operátor"].localeCompare(right["Operátor"], "sk-SK"));
  }, [rangeShiftRows, overviewRows, selectedMachineKey, selectedOperator, workstationById]);

  const summary = useMemo(() => ({
    quantity: exportRows.reduce((sum, row) => sum + Number(row["Vyrobené kusy"] || 0), 0),
    duration: exportRows.reduce((sum, row) => sum + Number(row["Výrobný čas (min)"] || 0), 0)
  }), [exportRows]);

  const exportBasicWorkbook = async (fileName) => {
    const module = await import("xlsx");
    const XLSX = module.default || module;
    const workbook = XLSX.utils.book_new();
    const summaryRows = [
      ["MES report", companyName || "Firma"],
      ["Obdobie", rangeWindow.label],
      ["Vyrobené kusy", summary.quantity],
      ["Výrobný čas (min)", summary.duration]
    ];
    const detailRows = exportRows.map((row) => ({
      ...row,
      "Dátum": row["Dátum"] instanceof Date ? row["Dátum"].toLocaleDateString("sk-SK") : row["Dátum"]
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), "Súhrn");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(detailRows, { header: DETAIL_COLUMNS.map(([header]) => header) }), "Výroba po zmenách");
    XLSX.writeFile(workbook, fileName);
  };

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
          values.set(label, Number(values.get(label) || 0) + Number(row["Vyrobené kusy"] || 0));
        });
        return Array.from(values, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
      };
      const dailyRows = aggregate((row) => row["Dátum"] instanceof Date ? row["Dátum"].toLocaleDateString("sk-SK") : "Bez dátumu");
      const shiftRows = aggregate((row) => row["Zmena"]);
      const machineRows = aggregate((row) => row["Stroj"]);
      const operatorRows = aggregate((row) => row["Operátor"]);
      const reportConfig = {
        overview: ["Súhrnný report", "Výroba podľa zmien", shiftRows],
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
        ["C7:D8", "Výrobný čas", `${numberFormatter.format(summary.duration)} min`],
        ["E7:F8", "Operátori", numberFormatter.format(new Set(exportRows.map((row) => row["Operátor"])).size)],
        ["G7:H8", "Zmeny", numberFormatter.format(new Set(exportRows.map((row) => `${row["Dátum"]}-${row["Zmena"]}`)).size)]
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

      const detailSheet = workbook.addWorksheet("Výroba po zmenách", { views: [{ state: "frozen", ySplit: 1 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
      detailSheet.columns = DETAIL_COLUMNS.map(([header, width]) => ({ header, key: header, width }));
      exportRows.forEach((row) => detailSheet.addRow(row));
      detailSheet.autoFilter = { from: "A1", to: "F1" };
      const header = detailSheet.getRow(1);
      header.height = 28;
      header.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17324A" } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      });
      detailSheet.getColumn("Dátum").numFmt = "dd.mm.yyyy";
      ["Vyrobené kusy", "Výrobný čas (min)"].forEach((name) => { detailSheet.getColumn(name).numFmt = "0.00"; });
      detailSheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1 && rowNumber % 2 === 1) row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F7F8" } }; });
      });
      const slug = String(companyName || "firma").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "firma";
      downloadFile(await workbook.xlsx.writeBuffer(), `mes-report-${slug}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (error) {
      try {
        const slug = String(companyName || "firma").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "firma";
        await exportBasicWorkbook(`mes-report-${slug}-${new Date().toISOString().slice(0, 10)}.xlsx`);
      } catch (fallbackError) {
        setExportError(fallbackError?.message || error?.message || "Excel report sa nepodarilo vytvoriť.");
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <article className="orders-panel-card workflow-card workflow-card-list factory-os-mes-panel factory-mes-export-panel">
      <div className="panel-head workflow-section-head">
        <div><p className="workflow-section-kicker">Analytika</p><h2>Výroba po zmenách</h2><p className="panel-meta">Kusy a výrobný čas z reálnych strojových cyklov, zoskupené podľa dňa, zmeny a operátora.</p></div>
        <button type="button" className="settings-btn factory-mes-export-button" onClick={handleExport} disabled={rangeLoading || exporting || exportRows.length === 0}><Download size={16} />{rangeLoading ? "Pripravujem report..." : exporting ? "Vytváram Excel..." : "Exportovať Excel"}</button>
      </div>
      <section className="factory-mes-export-filters">
        <label><span>Typ reportu</span><select value={reportType} onChange={(event) => setReportType(event.target.value)}><option value="overview">Súhrnný report</option><option value="machines">Podľa strojov</option><option value="operators">Podľa operátorov</option></select></label>
        <label><span>Obdobie</span><select value={rangeKey} onChange={(event) => setRangeKey(event.target.value)}><option value="current_shift">Aktuálna zmena</option><option value="today">Dnes</option><option value="yesterday">Včera</option><option value="last_7_days">Posledných 7 dní</option><option value="custom">Vlastné obdobie</option></select></label>
        <label><span>Stroj</span><select value={selectedMachineKey} onChange={(event) => setSelectedMachineKey(event.target.value)}><option value="all">Všetky stroje</option>{machineOptions.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}</select></label>
        <label><span>Operátor</span><select value={selectedOperator} onChange={(event) => setSelectedOperator(event.target.value)}><option value="all">Všetci operátori</option>{operatorOptions.map((operator) => <option key={operator} value={operator}>{operator}</option>)}</select></label>
        {rangeKey === "custom" ? <><label><span>Dátum od</span><input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label><label><span>Dátum do</span><input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label></> : null}
      </section>
      <section className="factory-mes-export-summary">
        <article><span>Súhrnné riadky</span><strong>{numberFormatter.format(exportRows.length)}</strong></article>
        <article><span>Vyrobené kusy</span><strong>{numberFormatter.format(summary.quantity)}</strong></article>
        <article><span>Výrobný čas</span><strong>{numberFormatter.format(summary.duration)} min</strong></article>
        <article><span>Operátori</span><strong>{numberFormatter.format(new Set(exportRows.map((row) => row["Operátor"])).size)}</strong></article>
      </section>
      {!rangeLoading && processedCycleCount > 0 ? <p className="hint">Report zohľadňuje {numberFormatter.format(processedCycleCount)} výrobných cyklov. Do prehliadača prišli iba súhrnné riadky.</p> : null}
      {rangeError ? <p className="error">{rangeError}</p> : null}
      {exportError ? <p className="error">{exportError}</p> : null}
      <div className="factory-mes-export-preview-head"><div><FileSpreadsheet size={19} /><strong>Náhľad výroby po zmenách</strong></div><span>{rangeWindow.label} · {exportRows.length} súhrnných riadkov</span></div>
      <div className="table-wrap factory-mes-export-table"><table><thead><tr>{DETAIL_COLUMNS.map(([column]) => <th key={column}>{column}</th>)}</tr></thead><tbody>{exportRows.slice(0, 100).map((row, index) => <tr key={`${row["Dátum"]}-${row["Zmena"]}-${row["Operátor"]}-${index}`}>{DETAIL_COLUMNS.map(([column]) => <td key={column}>{column === "Dátum" && row[column] instanceof Date ? row[column].toLocaleDateString("sk-SK") : row[column] ?? "-"}</td>)}</tr>)}</tbody></table></div>
      {!exportRows.length ? <p className="hint">Pre vybrané filtre nie sú dostupné dáta na export.</p> : null}
    </article>
  );
}
