import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { supabase } from "../../supabaseClient";
import "./mesAnalyticsExports.css";

const DETAIL_COLUMNS = [
  ["Dátum", 14], ["Zmena", 22], ["Operátor", 24], ["Stroj", 20], ["OK kusy", 12],
  ["NOK kusy", 12], ["Spolu kusy", 14], ["Zákazky", 12], ["Nastavenia", 14]
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

function eventTypeOf(row) {
  return String(row?.event_type || row?.event_code || "").trim().toLowerCase();
}

function eventTimeMs(row) {
  return new Date(row?.happened_at || row?.time_to || row?.created_at || 0).getTime();
}

function getShiftBucket(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return null;
  const hour = date.getHours();
  let key = "night";
  let label = "Nočná 22:00 – 06:00";
  const shiftDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (hour >= 6 && hour < 14) {
    key = "morning";
    label = "Ranná 06:00 – 14:00";
  } else if (hour >= 14 && hour < 22) {
    key = "afternoon";
    label = "Poobedná 14:00 – 22:00";
  } else if (hour < 6) {
    shiftDate.setDate(shiftDate.getDate() - 1);
  }
  return { key, label, date: shiftDate, dateKey: toDateInputValue(shiftDate) };
}

function aggregateShiftRows(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    const shift = getShiftBucket(row["Dátum ukončenia"]);
    if (!shift) return;
    const operator = String(row["Operátor"] || "Neurčený operátor").trim() || "Neurčený operátor";
    const machine = String(row["Stroj"] || "Neurčený stroj").trim() || "Neurčený stroj";
    const key = `${shift.dateKey}|${shift.key}|${operator}|${machine}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        date: shift.date,
        shift: shift.label,
        shiftOrder: { morning: 1, afternoon: 2, night: 3 }[shift.key],
        operator,
        machine,
        good: 0,
        scrap: 0,
        duration: 0,
        setups: 0,
        jobs: new Set()
      });
    }
    const group = grouped.get(key);
    const eventType = String(row["Typ udalosti"] || "").toLowerCase();
    const quantity = Number(row["IST kusy"] || 0);
    if (eventType === "scrap_count") group.scrap += quantity;
    else group.good += quantity;
    group.duration += Number(row["Skutočný čas spolu"] || 0);
    group.setups += row["Nastavenie"] === "Áno" ? 1 : 0;
    if (row["Číslo zákazky"]) group.jobs.add(String(row["Číslo zákazky"]));
  });
  return Array.from(grouped.values())
    .map((group) => ({
      "Dátum": group.date,
      "Zmena": group.shift,
      "Operátor": group.operator,
      "Stroj": group.machine,
      "OK kusy": group.good,
      "NOK kusy": group.scrap,
      "Spolu kusy": group.good + group.scrap,
      "Zákazky": group.jobs.size,
      "Výrobný čas (min)": Number(group.duration.toFixed(2)),
      "Nastavenia": group.setups,
      __shiftOrder: group.shiftOrder,
      __jobNumbers: Array.from(group.jobs)
    }))
    .filter((row) => row["Spolu kusy"] > 0 || row["Výrobný čas (min)"] > 0 || row["Nastavenia"] > 0)
    .sort((left, right) => left["Dátum"] - right["Dátum"] || left.__shiftOrder - right.__shiftOrder || left["Operátor"].localeCompare(right["Operátor"], "sk-SK"));
}

function countEventQuantity(row) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  const eventType = eventTypeOf(row);
  const candidates = eventType === "good_count"
    ? [row?.quantity, payload.good_quantity, payload.ok_qty, payload.quantity, payload.qty, payload.count]
    : [row?.quantity, payload.scrap_quantity, payload.nok_qty, payload.quantity, payload.qty, payload.count];
  const value = Number(candidates.find((candidate) => Number.isFinite(Number(candidate)) && Number(candidate) > 0) || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function productionStateAfterEvent(row) {
  const eventType = eventTypeOf(row);
  if (["start", "resume", "setup_end", "downtime_end"].includes(eventType)) return "running";
  if (["pause", "stop", "ml", "downtime_start", "setup_start", "complete", "cancel"].includes(eventType)) return "stopped";
  return "";
}

function calculateRunProductionMs(run, runEvents, rangeWindow) {
  const transitions = (runEvents || [])
    .map((event) => ({ event, timestamp: eventTimeMs(event), state: productionStateAfterEvent(event) }))
    .filter((row) => row.state && Number.isFinite(row.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp);
  const firstRunningEvent = transitions.find((row) => row.state === "running")?.timestamp;
  const storedStartMs = new Date(run?.started_at || 0).getTime();
  const runStartMs = Number.isFinite(storedStartMs) && storedStartMs > 0
    ? storedStartMs
    : Number.isFinite(firstRunningEvent) ? firstRunningEvent : 0;
  if (!Number.isFinite(runStartMs) || runStartMs <= 0) return 0;

  const storedEndMs = new Date(run?.ended_at || 0).getTime();
  const updatedMs = new Date(run?.updated_at || 0).getTime();
  const latestEventMs = (runEvents || []).reduce((latest, event) => {
    const timestamp = eventTimeMs(event);
    return Number.isFinite(timestamp) && timestamp <= rangeWindow.endMs ? Math.max(latest, timestamp) : latest;
  }, 0);
  const status = String(run?.status || "").toLowerCase();
  let runEndMs;
  if (Number.isFinite(storedEndMs) && storedEndMs > runStartMs) {
    runEndMs = storedEndMs;
  } else if (["completed", "cancelled"].includes(status) && Number.isFinite(updatedMs) && updatedMs > runStartMs && updatedMs <= rangeWindow.endMs) {
    runEndMs = updatedMs;
  } else {
    // An unfinished stale run must not count as production until the end of the selected month.
    const updatedInsideRangeMs = Number.isFinite(updatedMs) && updatedMs <= rangeWindow.endMs ? updatedMs : 0;
    const latestActivityMs = Math.max(runStartMs, updatedInsideRangeMs, latestEventMs);
    runEndMs = Math.min(rangeWindow.endMs, Date.now(), latestActivityMs + 10 * 60_000);
  }

  const clippedStartMs = Math.max(runStartMs, rangeWindow.startMs);
  const clippedEndMs = Math.min(runEndMs, rangeWindow.endMs, Date.now());
  if (!Number.isFinite(clippedEndMs) || clippedEndMs <= clippedStartMs) return 0;

  const transitionsBeforeStart = transitions.filter((row) => row.timestamp <= clippedStartMs);
  let state = transitionsBeforeStart.at(-1)?.state || "running";
  if (transitionsBeforeStart.length === 0 && runStartMs < clippedStartMs) {
    const firstTransitionInRange = transitions.find((row) => row.timestamp > clippedStartMs && row.timestamp < clippedEndMs);
    // A resume/start as the first known transition means the machine was stopped before it.
    if (firstTransitionInRange?.state === "running") state = "stopped";
  }

  let cursorMs = clippedStartMs;
  let productionMs = 0;
  transitions.forEach((transition) => {
    if (transition.timestamp <= clippedStartMs || transition.timestamp >= clippedEndMs) return;
    if (state === "running") productionMs += Math.max(0, transition.timestamp - cursorMs);
    cursorMs = transition.timestamp;
    state = transition.state;
  });
  if (state === "running") productionMs += Math.max(0, clippedEndMs - cursorMs);
  return productionMs;
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


async function fetchMesShiftSummary(companyId, startIso, endIso, onProgress) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData?.session?.access_token) {
    throw new Error(sessionError?.message || "Prihlásenie vypršalo. Obnov stránku a prihlás sa znova.");
  }
  const grouped = new Map();
  let cursor = null;
  let scannedCount = 0;
  do {
    const params = new URLSearchParams({ company_id: companyId, start: startIso, end: endIso, mode: "shift_summary" });
    if (cursor) {
      params.set("cursor_created_at", cursor.created_at);
      params.set("cursor_id", cursor.id);
    }
    const response = await fetch(`/api/v1/public/mes-analytics-events?${params}`, {
      headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
      cache: "no-store"
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || `MES export API zlyhalo (${response.status}).`);
    (payload.summary_rows || []).forEach((row) => {
      if (!grouped.has(row.key)) grouped.set(row.key, { ...row, good: 0, scrap: 0, setups: 0, job_numbers: new Set() });
      const group = grouped.get(row.key);
      group.good += Number(row.good || 0);
      group.scrap += Number(row.scrap || 0);
      group.setups += Number(row.setups || 0);
      (row.job_numbers || []).forEach((jobNumber) => group.job_numbers.add(String(jobNumber)));
    });
    scannedCount += Number(payload.scanned_count || 0);
    onProgress?.(scannedCount);
    cursor = payload.next_cursor || null;
    if (scannedCount > 500_000) throw new Error("Export prekročil limit 500 000 udalostí. Zvoľ kratšie obdobie.");
  } while (cursor);
  return Array.from(grouped.values()).map((row) => ({ ...row, job_numbers: Array.from(row.job_numbers) }));
}

export default function MesAnalyticsExports({ companyId, companyName, overviewRows, jobRuns, mesEvents, workstations }) {
  const today = toDateInputValue(new Date());
  const [reportType, setReportType] = useState("overview");
  const [rangeKey, setRangeKey] = useState("last_7_days");
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [selectedMachineKey, setSelectedMachineKey] = useState("all");
  const [selectedOperator, setSelectedOperator] = useState("all");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [rangeJobRuns, setRangeJobRuns] = useState(jobRuns);
  const [rangeMesEvents, setRangeMesEvents] = useState(mesEvents);
  const [rangeShiftRows, setRangeShiftRows] = useState(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState("");
  const [loadedEventCount, setLoadedEventCount] = useState(0);
  const rangeRequestIdRef = useRef(0);

  const rangeWindow = useMemo(() => getRangeWindow(rangeKey, customStart, customEnd), [rangeKey, customStart, customEnd]);
  const runById = useMemo(() => new Map(rangeJobRuns.map((run) => [String(run.id || ""), run])), [rangeJobRuns]);
  const workstationById = useMemo(() => new Map(workstations.map((row) => [String(row.id || ""), row])), [workstations]);
  const machineOptions = useMemo(() => overviewRows.map((row) => ({
    key: machineKey(row),
    label: row.machine_name || row.workstation_name || row.machine_code || row.workstation_code || "Stroj"
  })).filter((row) => row.key), [overviewRows]);
  const operatorOptions = useMemo(() => Array.from(new Set([
    ...rangeJobRuns.map(operatorLabel),
    ...rangeMesEvents.map((event) => operatorLabel(runById.get(String(event.job_run_id || ""))) || operatorLabel(event)),
    ...(rangeShiftRows || []).map((row) => row.operator)
  ].filter(Boolean))).sort((left, right) => left.localeCompare(right, "sk-SK", { sensitivity: "base" })), [rangeJobRuns, rangeMesEvents, rangeShiftRows, runById]);

  useEffect(() => {
    if (!companyId) {
      setRangeJobRuns(jobRuns);
      setRangeMesEvents(mesEvents);
      setRangeShiftRows(null);
      return undefined;
    }
    if (!Number.isFinite(rangeWindow.startMs) || !Number.isFinite(rangeWindow.endMs) || rangeWindow.startMs > rangeWindow.endMs) {
      setRangeJobRuns([]);
      setRangeMesEvents([]);
      setRangeShiftRows([]);
      setRangeError("Dátum od musí byť skorší alebo rovnaký ako dátum do.");
      return undefined;
    }

    {
      const requestId = ++rangeRequestIdRef.current;
      setRangeLoading(true);
      setRangeError("");
      setRangeJobRuns([]);
      setRangeMesEvents([]);
      setRangeShiftRows([]);
      setLoadedEventCount(0);
      const timeoutId = window.setTimeout(async () => {
        try {
          const rows = await fetchMesShiftSummary(
            companyId,
            new Date(rangeWindow.startMs).toISOString(),
            new Date(rangeWindow.endMs).toISOString(),
            setLoadedEventCount
          );
          if (requestId !== rangeRequestIdRef.current) return;
          setRangeShiftRows(rows);
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
    if (Array.isArray(rangeShiftRows)) {
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
            "OK kusy": Number(row.good || 0),
            "NOK kusy": Number(row.scrap || 0),
            "Spolu kusy": Number(row.good || 0) + Number(row.scrap || 0),
            "Zákazky": (row.job_numbers || []).length,
            "Výrobný čas (min)": 0,
            "Nastavenia": Number(row.setups || 0),
            __shiftOrder: Number(row.shift_order || 0),
            __jobNumbers: row.job_numbers || []
          };
        })
        .filter((row) => row["Spolu kusy"] > 0 || row["Nastavenia"] > 0)
        .sort((left, right) => left["Dátum"] - right["Dátum"] || left.__shiftOrder - right.__shiftOrder || left["Operátor"].localeCompare(right["Operátor"], "sk-SK"));
    }
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
        "Typ udalosti": event ? (eventTypeOf(event) || "neuvedené") : "výrobný_beh",
        "Stroj": String(machine.machine_code || machine.machine_name || machine.workstation_name || source?.machine_id || source?.workstation_id || "").trim(),
        "Operátor": operatorLabel(event) || operatorLabel(run),
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

    const eventsByRunId = new Map();
    rangeMesEvents.forEach((event) => {
      const runId = String(event.job_run_id || "");
      if (!runId) return;
      if (!eventsByRunId.has(runId)) eventsByRunId.set(runId, []);
      eventsByRunId.get(runId).push(event);
    });

    const rows = [];
    const lastEventByRunId = new Map();
    const eligibleEvents = rangeMesEvents
      .filter((event) => {
        const timestamp = eventTimeMs(event);
        return Number.isFinite(timestamp) &&
          timestamp >= rangeWindow.startMs && timestamp <= rangeWindow.endMs && matchesFilters(event);
      })
      .sort((left, right) => eventTimeMs(left) - eventTimeMs(right));
    eligibleEvents.forEach((event) => {
      const runId = String(event.job_run_id || "");
      if (runId) lastEventByRunId.set(runId, event);
    });

    const durationByRunId = new Map();
    const fallbackQuantityByRunId = new Map();
    rangeJobRuns.forEach((run) => {
      const runId = String(run.id || "");
      const runEvents = eventsByRunId.get(String(run.id || "")) || [];
      const runStartMs = new Date(run.started_at || run.created_at || 0).getTime();
      const runEndMs = new Date(run.ended_at || run.updated_at || 0).getTime();
      const overlapsRange = Number.isFinite(runStartMs) && runStartMs <= rangeWindow.endMs &&
        (!Number.isFinite(runEndMs) || runEndMs >= rangeWindow.startMs);
      if (!overlapsRange || !matchesFilters(run)) return;

      const countEvents = runEvents.filter((event) => {
        const timestamp = eventTimeMs(event);
        return Number.isFinite(timestamp) && timestamp >= rangeWindow.startMs && timestamp <= rangeWindow.endMs;
      });
      const goodEvents = countEvents.filter((event) => eventTypeOf(event) === "good_count");
      const scrapEvents = countEvents.filter((event) => eventTypeOf(event) === "scrap_count");
      const hasCountEvents = goodEvents.length > 0 || scrapEvents.length > 0;
      const runFullyInsideRange = runStartMs >= rangeWindow.startMs && Number.isFinite(runEndMs) && runEndMs <= rangeWindow.endMs;
      const goodQuantity = hasCountEvents
        ? goodEvents.reduce((sum, event) => sum + countEventQuantity(event), 0)
        : runFullyInsideRange ? Number(run.good_quantity || 0) : 0;
      const durationMs = calculateRunProductionMs(run, runEvents, rangeWindow);
      const hasSetup = countEvents.some((event) => eventTypeOf(event) === "setup_start" || event.payload?.is_setup === true);
      if (durationMs <= 0 && goodQuantity <= 0 && !hasSetup) return;
      durationByRunId.set(runId, durationMs);
      if (!hasCountEvents && goodQuantity > 0) fallbackQuantityByRunId.set(runId, goodQuantity);
    });

    eligibleEvents.forEach((event) => {
      const runId = String(event.job_run_id || "");
      const isLastRunEvent = Boolean(runId) && lastEventByRunId.get(runId) === event;
      const eventType = eventTypeOf(event);
      rows.push(makeRow({
        source: runById.get(runId) || event,
        event,
        happenedAt: event.happened_at || event.time_to || event.created_at,
        quantity: ["good_count", "scrap_count"].includes(eventType)
          ? countEventQuantity(event)
          : isLastRunEvent ? Number(fallbackQuantityByRunId.get(runId) || 0) : 0,
        // Store the consolidated run duration once, on its last detail event, so the detail sum equals the report summary.
        durationMs: isLastRunEvent ? Number(durationByRunId.get(runId) || 0) : 0,
        isSetup: eventType === "setup_start" || event.payload?.is_setup === true
      }));
    });

    // A run without any event inside the selected interval still needs one detail row for its measured duration.
    rangeJobRuns.forEach((run) => {
      const runId = String(run.id || "");
      if (lastEventByRunId.has(runId) || !durationByRunId.has(runId)) return;
      const completedAt = Math.min(
        rangeWindow.endMs,
        new Date(run.ended_at || run.updated_at || Date.now()).getTime(),
        Date.now()
      );
      rows.push(makeRow({
        source: run,
        happenedAt: Number.isFinite(completedAt) ? completedAt : run.updated_at || run.created_at,
        quantity: Number(fallbackQuantityByRunId.get(runId) || 0),
        durationMs: Number(durationByRunId.get(runId) || 0),
        isSetup: false
      }));
    });

    if (!rows.length) {
      overviewRows.forEach((row) => {
        if (!matchesFilters(row)) return;
        const happenedAt = row.latest_event_at || row.started_at || new Date().toISOString();
        const happenedMs = new Date(happenedAt).getTime();
        if (happenedMs < rangeWindow.startMs || happenedMs > rangeWindow.endMs) return;
        const startedMs = new Date(row.started_at || 0).getTime();
        rows.push(makeRow({
          source: row,
          happenedAt,
          quantity: Number(row.good_quantity || 0),
          durationMs: Number.isFinite(startedMs) && happenedMs > startedMs ? happenedMs - startedMs : 0,
          isSetup: String(row.machine_state || row.job_status || "").toLowerCase() === "setup"
        }));
      });
    }
    return aggregateShiftRows(rows);
  }, [rangeJobRuns, rangeMesEvents, rangeShiftRows, overviewRows, rangeWindow, runById, selectedMachineKey, selectedOperator, workstationById]);

  const summary = useMemo(() => ({
    quantity: exportRows.reduce((sum, row) => sum + Number(row["Spolu kusy"] || 0), 0),
    good: exportRows.reduce((sum, row) => sum + Number(row["OK kusy"] || 0), 0),
    scrap: exportRows.reduce((sum, row) => sum + Number(row["NOK kusy"] || 0), 0),
    setups: exportRows.reduce((sum, row) => sum + Number(row["Nastavenia"] || 0), 0),
    jobs: new Set(exportRows.flatMap((row) => row.__jobNumbers || [])).size
  }), [exportRows]);

  const exportBasicWorkbook = async (fileName) => {
    const module = await import("xlsx");
    const XLSX = module.default || module;
    const workbook = XLSX.utils.book_new();
    const summaryRows = [
      ["MES report", companyName || "Firma"],
      ["Obdobie", rangeWindow.label],
      ["Vyrobené spolu", summary.quantity],
      ["OK kusy", summary.good],
      ["NOK kusy", summary.scrap],
      ["Zákazky", summary.jobs],
      ["Nastavenia", summary.setups]
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
          values.set(label, Number(values.get(label) || 0) + Number(row["Spolu kusy"] || 0));
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
        ["A7:B8", "Vyrobené spolu", numberFormatter.format(summary.quantity)],
        ["C7:D8", "OK kusy", numberFormatter.format(summary.good)],
        ["E7:F8", "NOK kusy", numberFormatter.format(summary.scrap)],
        ["G7:H8", "Operátori", numberFormatter.format(new Set(exportRows.map((row) => row["Operátor"])).size)]
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
      detailSheet.autoFilter = { from: "A1", to: "I1" };
      const header = detailSheet.getRow(1);
      header.height = 28;
      header.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17324A" } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      });
      detailSheet.getColumn("Dátum").numFmt = "dd.mm.yyyy";
      ["OK kusy", "NOK kusy", "Spolu kusy", "Zákazky", "Nastavenia"].forEach((name) => { detailSheet.getColumn(name).numFmt = "0.00"; });
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
        <div><p className="workflow-section-kicker">Analytika</p><h2>Výroba po zmenách</h2><p className="panel-meta">Spracovaný Excel s grafmi a súhrnmi podľa zmeny, operátora a stroja. Surové udalosti sa neexportujú.</p></div>
        <button type="button" className="settings-btn factory-mes-export-button" onClick={handleExport} disabled={rangeLoading || exporting || exportRows.length === 0}><Download size={16} />{rangeLoading ? "Načítavam dáta..." : exporting ? "Vytváram Excel..." : "Exportovať Excel"}</button>
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
        <article><span>Vyrobené spolu</span><strong>{numberFormatter.format(summary.quantity)}</strong></article>
        <article><span>OK kusy</span><strong>{numberFormatter.format(summary.good)}</strong></article>
        <article><span>NOK kusy</span><strong>{numberFormatter.format(summary.scrap)}</strong></article>
      </section>
      {rangeLoading ? <p className="hint">Server spracúva SQL záznamy pre zvolené obdobie… {loadedEventCount ? `${numberFormatter.format(loadedEventCount)} zohľadnených udalostí` : ""}</p> : null}
      {rangeError ? <p className="error">{rangeError}</p> : null}
      {exportError ? <p className="error">{exportError}</p> : null}
      <div className="factory-mes-export-preview-head"><div><FileSpreadsheet size={19} /><strong>Náhľad výroby po zmenách</strong></div><span>{rangeWindow.label} · {exportRows.length} súhrnných riadkov</span></div>
      <div className="table-wrap factory-mes-export-table"><table><thead><tr>{DETAIL_COLUMNS.map(([column]) => <th key={column}>{column}</th>)}</tr></thead><tbody>{exportRows.slice(0, 100).map((row, index) => <tr key={`${row["Dátum"]}-${row["Zmena"]}-${row["Operátor"]}-${index}`}>{DETAIL_COLUMNS.map(([column]) => <td key={column}>{column === "Dátum" && row[column] instanceof Date ? row[column].toLocaleDateString("sk-SK") : row[column] ?? "-"}</td>)}</tr>)}</tbody></table></div>
      {!exportRows.length ? <p className="hint">Pre vybrané filtre nie sú dostupné dáta na export.</p> : null}
    </article>
  );
}
