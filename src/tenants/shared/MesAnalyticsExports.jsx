import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { supabase } from "../../supabaseClient";
import "./mesAnalyticsExports.css";

const DETAIL_COLUMNS = [
  ["Číslo zákazky", 18], ["Operácia", 14], ["Typ udalosti", 18], ["Stroj", 20], ["Operátor", 24], ["Kód položky", 18], ["Popis operácie", 34],
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

function eventTypeOf(row) {
  return String(row?.event_type || row?.event_code || "").trim().toLowerCase();
}

function eventTimeMs(row) {
  return new Date(row?.happened_at || row?.time_to || row?.created_at || 0).getTime();
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

const JOB_RUN_SELECT = "id,workstation_id,machine_id,terminal_id,operator_user_id,job_number,item_code,item_name,operator_name,status,planned_quantity,good_quantity,scrap_quantity,setup_started_at,started_at,ended_at,note,created_at,updated_at";
const COMPACT_EVENT_SELECT = "id,terminal_id,workstation_id,job_run_id,terminal_event_id,event_code,job_number,duration_seconds,time_from,time_to,operator_id,downtime_reason_code,downtime_reason_name,payload,created_at";
const DURABLE_EVENT_SELECT = "id,job_run_id,workstation_id,machine_id,downtime_reason_id,event_type,quantity,source,note,payload,happened_at,created_at";

function isMissingTableError(error, tableName) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes(String(tableName || "").toLowerCase()) && (
    message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find")
  );
}

async function fetchAllSqlRows(makeQuery, maxRows = 100_000) {
  const pageSize = 1_000;
  const rows = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) return { data: [], error };
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
  return { data: [], error: new Error(`SQL výber prekročil bezpečnostný limit ${maxRows} riadkov. Zvoľ kratšie obdobie.`) };
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
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState("");
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
    ...rangeMesEvents.map((event) => operatorLabel(runById.get(String(event.job_run_id || ""))) || operatorLabel(event))
  ].filter(Boolean))).sort((left, right) => left.localeCompare(right, "sk-SK", { sensitivity: "base" })), [rangeJobRuns, rangeMesEvents, runById]);

  useEffect(() => {
    if (!companyId) {
      setRangeJobRuns(jobRuns);
      setRangeMesEvents(mesEvents);
      return undefined;
    }
    if (!Number.isFinite(rangeWindow.startMs) || !Number.isFinite(rangeWindow.endMs) || rangeWindow.startMs > rangeWindow.endMs) {
      setRangeJobRuns([]);
      setRangeMesEvents([]);
      setRangeError("Dátum od musí byť skorší alebo rovnaký ako dátum do.");
      return undefined;
    }

    const requestId = ++rangeRequestIdRef.current;
    setRangeLoading(true);
    setRangeError("");
    setRangeJobRuns([]);
    setRangeMesEvents([]);
    const timeoutId = window.setTimeout(async () => {
      try {
        const startIso = new Date(rangeWindow.startMs).toISOString();
        const endIso = new Date(rangeWindow.endMs).toISOString();
        const [runsResult, compactEventsResult] = await Promise.all([
          fetchAllSqlRows(() => supabase.from("mes_job_runs")
            .select(JOB_RUN_SELECT)
            .eq("company_id", companyId)
            .lte("created_at", endIso)
            .or(`ended_at.gte.${startIso},ended_at.is.null,updated_at.gte.${startIso}`)
            .order("created_at", { ascending: false })),
          fetchAllSqlRows(() => supabase.from("mes_event_log")
            .select(COMPACT_EVENT_SELECT)
            .eq("company_id", companyId)
            .or(`and(time_to.gte.${startIso},time_to.lte.${endIso}),and(time_to.is.null,created_at.gte.${startIso},created_at.lte.${endIso})`)
            .order("created_at", { ascending: false }))
        ]);
        if (runsResult.error) throw runsResult.error;
        if (compactEventsResult.error && !isMissingTableError(compactEventsResult.error, "mes_event_log")) throw compactEventsResult.error;

        const runs = [...(runsResult.data || [])];
        const loadedRunIds = new Set(runs.map((run) => String(run.id || "")));
        const missingRunIds = Array.from(new Set((compactEventsResult.data || [])
          .map((event) => String(event.job_run_id || ""))
          .filter((id) => id && !loadedRunIds.has(id))));
        for (let index = 0; index < missingRunIds.length; index += 100) {
          const missingRunsResult = await supabase.from("mes_job_runs")
            .select(JOB_RUN_SELECT)
            .eq("company_id", companyId)
            .in("id", missingRunIds.slice(index, index + 100));
          if (missingRunsResult.error) throw missingRunsResult.error;
          runs.push(...(missingRunsResult.data || []));
        }
        const runByLoadedId = new Map(runs.map((run) => [String(run.id || ""), run]));
        const compactSourceEvents = [...(compactEventsResult.data || [])];
        const runIds = runs.map((run) => run.id).filter(Boolean);
        for (let index = 0; index < runIds.length; index += 100) {
          const predecessorResult = await supabase.from("mes_event_log")
            .select(COMPACT_EVENT_SELECT)
            .eq("company_id", companyId)
            .in("job_run_id", runIds.slice(index, index + 100))
            .lt("created_at", startIso)
            .order("created_at", { ascending: false })
            .limit(10_000);
          if (predecessorResult.error) {
            if (isMissingTableError(predecessorResult.error, "mes_event_log")) break;
            throw predecessorResult.error;
          }
          const latestTransitionByRun = new Map();
          (predecessorResult.data || []).forEach((event) => {
            const runId = String(event.job_run_id || "");
            if (runId && productionStateAfterEvent({ ...event, event_type: event.event_code }) && !latestTransitionByRun.has(runId)) {
              latestTransitionByRun.set(runId, event);
            }
          });
          compactSourceEvents.push(...latestTransitionByRun.values());
        }
        const compactEvents = compactSourceEvents.map((event) => {
          const run = runByLoadedId.get(String(event.job_run_id || "")) || null;
          return {
            ...event,
            event_type: event.event_code,
            happened_at: event.time_to || event.created_at,
            operator_name: event.payload?.operator_name || run?.operator_name || "",
            machine_id: run?.machine_id || "",
            workstation_id: event.workstation_id || run?.workstation_id || "",
            terminal_id: event.terminal_id || run?.terminal_id || ""
          };
        });

        const durableEvents = [];
        for (let index = 0; index < runIds.length; index += 100) {
          const batchIds = runIds.slice(index, index + 100);
          const [result, predecessorResult] = await Promise.all([
            fetchAllSqlRows(() => supabase.from("mes_job_run_events")
              .select(DURABLE_EVENT_SELECT)
              .in("job_run_id", batchIds)
              .gte("happened_at", startIso)
              .lte("happened_at", endIso)
              .order("happened_at", { ascending: false })),
            supabase.from("mes_job_run_events")
              .select(DURABLE_EVENT_SELECT)
              .in("job_run_id", batchIds)
              .lt("happened_at", startIso)
              .order("happened_at", { ascending: false })
              .limit(10_000)
          ]);
          if (result.error || predecessorResult.error) {
            const error = result.error || predecessorResult.error;
            if (isMissingTableError(error, "mes_job_run_events")) break;
            throw error;
          }
          const latestTransitionByRun = new Map();
          (predecessorResult.data || []).forEach((event) => {
            const runId = String(event.job_run_id || "");
            if (runId && productionStateAfterEvent(event) && !latestTransitionByRun.has(runId)) {
              latestTransitionByRun.set(runId, event);
            }
          });
          durableEvents.push(...[...(result.data || []), ...latestTransitionByRun.values()].map((event) => {
            const run = runByLoadedId.get(String(event.job_run_id || "")) || null;
            return {
              ...event,
              event_code: event.event_type,
              happened_at: event.happened_at || event.created_at,
              duration_seconds: Number(event.payload?.duration_seconds || 0),
              time_from: event.payload?.time_from || "",
              time_to: event.payload?.time_to || event.happened_at || event.created_at,
              operator_name: event.payload?.operator_name || run?.operator_name || "",
              machine_id: event.machine_id || run?.machine_id || "",
              workstation_id: event.workstation_id || run?.workstation_id || "",
              terminal_id: run?.terminal_id || ""
            };
          }));
        }

        if (requestId !== rangeRequestIdRef.current) return;
        const eventByKey = new Map();
        [...compactEvents, ...durableEvents].forEach((event) => {
          const key = String(
            event.terminal_event_id || event.payload?.terminal_event_id ||
            `${event.job_run_id}-${event.event_type}-${event.happened_at}-${event.quantity || event.payload?.quantity || ""}`
          );
          if (!eventByKey.has(key)) eventByKey.set(key, event);
        });
        setRangeJobRuns(runs);
        setRangeMesEvents(Array.from(eventByKey.values()));
      } catch (error) {
        if (requestId !== rangeRequestIdRef.current) return;
        setRangeJobRuns([]);
        setRangeMesEvents([]);
        setRangeError(error?.message || "Dáta pre zvolené obdobie sa nepodarilo načítať zo SQL.");
      } finally {
        if (requestId === rangeRequestIdRef.current) setRangeLoading(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
      rangeRequestIdRef.current += 1;
    };
  }, [companyId, rangeWindow.startMs, rangeWindow.endMs]);

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
        "Typ udalosti": event ? (eventTypeOf(event) || "neuvedené") : "výrobný_beh",
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
        quantity: eventType === "good_count"
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
    return rows.sort((left, right) => new Date(left["Dátum ukončenia"] || 0) - new Date(right["Dátum ukončenia"] || 0));
  }, [rangeJobRuns, rangeMesEvents, overviewRows, rangeWindow, runById, selectedMachineKey, selectedOperator, workstationById]);

  const summary = useMemo(() => ({
    quantity: exportRows.reduce((sum, row) => sum + Number(row["IST kusy"] || 0), 0),
    duration: exportRows.reduce((sum, row) => sum + Number(row["Skutočný čas spolu"] || 0), 0),
    setups: exportRows.filter((row) => row["Nastavenie"] === "Áno").length,
    jobs: new Set(exportRows.map((row) => row["Číslo zákazky"]).filter(Boolean)).size
  }), [exportRows]);

  const exportBasicWorkbook = async (fileName) => {
    const module = await import("xlsx");
    const XLSX = module.default || module;
    const workbook = XLSX.utils.book_new();
    const summaryRows = [
      ["MES report", companyName || "Firma"],
      ["Obdobie", rangeWindow.label],
      ["Vyrobené kusy", summary.quantity],
      ["Zákazky", summary.jobs],
      ["Skutočný čas (min)", summary.duration],
      ["Nastavenia", summary.setups]
    ];
    const detailRows = exportRows.map((row) => ({
      ...row,
      "Dátum ukončenia": row["Dátum ukončenia"] instanceof Date
        ? row["Dátum ukončenia"].toLocaleDateString("sk-SK")
        : row["Dátum ukončenia"]
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), "Súhrn");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(detailRows, { header: DETAIL_COLUMNS.map(([header]) => header) }), "Detailné dáta");
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
      detailSheet.autoFilter = { from: "A1", to: "O1" };
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
        <div><p className="workflow-section-kicker">Analytika</p><h2>Analytika a exporty</h2><p className="panel-meta">Samostatný Excel report v rovnakom formáte ako v hlavnej aplikácii.</p></div>
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
        <article><span>Riadky</span><strong>{numberFormatter.format(exportRows.length)}</strong></article>
        <article><span>IST kusy</span><strong>{numberFormatter.format(summary.quantity)}</strong></article>
        <article><span>Zákazky</span><strong>{numberFormatter.format(summary.jobs)}</strong></article>
        <article><span>Nastavenia</span><strong>{numberFormatter.format(summary.setups)}</strong></article>
      </section>
      {rangeLoading ? <p className="hint">Načítavam dáta zo SQL pre zvolené obdobie…</p> : null}
      {rangeError ? <p className="error">{rangeError}</p> : null}
      {exportError ? <p className="error">{exportError}</p> : null}
      <div className="factory-mes-export-preview-head"><div><FileSpreadsheet size={19} /><strong>Náhľad detailných dát</strong></div><span>{rangeWindow.label} · {exportRows.length} riadkov</span></div>
      <div className="table-wrap factory-mes-export-table"><table><thead><tr>{DETAIL_COLUMNS.slice(0, 9).map(([column]) => <th key={column}>{column}</th>)}</tr></thead><tbody>{exportRows.slice(0, 100).map((row, index) => <tr key={`${row["Číslo zákazky"]}-${index}`}>{DETAIL_COLUMNS.slice(0, 9).map(([column]) => <td key={column}>{column === "Dátum ukončenia" && row[column] instanceof Date ? row[column].toLocaleDateString("sk-SK") : row[column] || "-"}</td>)}</tr>)}</tbody></table></div>
      {!exportRows.length ? <p className="hint">Pre vybrané filtre nie sú dostupné dáta na export.</p> : null}
    </article>
  );
}
