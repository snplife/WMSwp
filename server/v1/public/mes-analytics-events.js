import { requireAuthenticatedUser } from "../../../api/_lib/userAuth.js";
import { sendJson, sendMethodNotAllowed } from "../../../api/_lib/http.js";

const PAGE_SIZE = 1000;
const EVENT_SELECT = "id,terminal_id,workstation_id,job_run_id,terminal_event_id,event_code,job_number,duration_seconds,time_from,time_to,operator_id,downtime_reason_code,downtime_reason_name,payload,created_at";
const SUMMARY_EVENT_SELECT = "id,terminal_id,workstation_id,job_run_id,event_code,job_number,time_to,operator_id,payload,created_at";
const RUN_SELECT = "id,workstation_id,machine_id,terminal_id,operator_name,job_number";
const SHIFT_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Bratislava",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23"
});

function parseDate(value) {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date : null;
}

function previousDateKey(dateKey) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function getShiftBucket(value) {
  const date = parseDate(value);
  if (!date) return null;
  const parts = Object.fromEntries(SHIFT_TIME_FORMATTER.formatToParts(date)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
  const hour = Number(parts.hour);
  let dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  if (hour >= 6 && hour < 14) return { date: dateKey, key: "morning", label: "Ranná 06:00 – 14:00", order: 1 };
  if (hour >= 14 && hour < 22) return { date: dateKey, key: "afternoon", label: "Poobedná 14:00 – 22:00", order: 2 };
  if (hour < 6) dateKey = previousDateKey(dateKey);
  return { date: dateKey, key: "night", label: "Nočná 22:00 – 06:00", order: 3 };
}

function eventQuantity(event) {
  const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
  const eventType = String(event?.event_code || "").toLowerCase();
  const candidates = eventType === "good_count"
    ? [payload.good_quantity, payload.ok_qty, payload.quantity, payload.qty, payload.count]
    : [payload.scrap_quantity, payload.nok_qty, payload.quantity, payload.qty, payload.count];
  const value = Number(candidates.find((candidate) => Number.isFinite(Number(candidate)) && Number(candidate) > 0) || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function summarizeEvents(supabase, companyId, events) {
  const runIds = Array.from(new Set(events.map((event) => String(event.job_run_id || "")).filter(Boolean)));
  const runs = [];
  for (let index = 0; index < runIds.length; index += 100) {
    const { data, error } = await supabase.from("mes_job_runs")
      .select(RUN_SELECT)
      .eq("company_id", companyId)
      .in("id", runIds.slice(index, index + 100));
    if (error) throw new Error(`MES run query failed: ${error.message}`);
    runs.push(...(data || []));
  }
  const runById = new Map(runs.map((run) => [String(run.id), run]));
  const grouped = new Map();
  events.forEach((event) => {
    const eventType = String(event.event_code || "").toLowerCase();
    if (!["good_count", "scrap_count", "setup_start"].includes(eventType)) return;
    const shift = getShiftBucket(event.time_to || event.created_at);
    if (!shift) return;
    const run = runById.get(String(event.job_run_id || "")) || {};
    const operator = String(event.payload?.operator_name || event.payload?.operator_name_text || run.operator_name || event.operator_id || "Neurčený operátor").trim() || "Neurčený operátor";
    const machineId = String(run.machine_id || "");
    const workstationId = String(event.workstation_id || run.workstation_id || "");
    const terminalId = String(event.terminal_id || run.terminal_id || "");
    const key = `${shift.date}|${shift.key}|${operator}|${machineId}|${workstationId}|${terminalId}`;
    if (!grouped.has(key)) grouped.set(key, {
      key,
      date: shift.date,
      shift: shift.label,
      shift_order: shift.order,
      operator,
      machine_id: machineId,
      workstation_id: workstationId,
      terminal_id: terminalId,
      good: 0,
      scrap: 0,
      setups: 0,
      job_numbers: new Set()
    });
    const group = grouped.get(key);
    const quantity = eventQuantity(event);
    if (eventType === "good_count") group.good += quantity;
    if (eventType === "scrap_count") group.scrap += quantity;
    if (eventType === "setup_start") group.setups += 1;
    const jobNumber = String(event.job_number || run.job_number || "").trim();
    if (jobNumber) group.job_numbers.add(jobNumber);
  });
  return Array.from(grouped.values()).map((group) => ({ ...group, job_numbers: Array.from(group.job_numbers) }));
}

export default async function handler(req, res) {
  if (req.method !== "GET") return sendMethodNotAllowed(res, ["GET"]);

  try {
    const auth = await requireAuthenticatedUser(req);
    if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.error });

    const appUser = auth.appUser;
    const isMaster = String(appUser?.role || "").toLowerCase() === "master";
    const requestedCompanyId = String(req.query.company_id || "").trim();
    const companyId = requestedCompanyId || String(appUser?.company_id || "").trim();
    if (!appUser || !companyId || (!isMaster && String(appUser.company_id || "") !== companyId)) {
      return sendJson(res, 403, { ok: false, error: "Firma v requeste nesedí s prihláseným používateľom." });
    }
    if (!isMaster && !appUser.can_access_mes) {
      return sendJson(res, 403, { ok: false, error: "Používateľ nemá povolený prístup do MES." });
    }

    const start = parseDate(req.query.start);
    const end = parseDate(req.query.end);
    if (!start || !end || start > end) {
      return sendJson(res, 400, { ok: false, error: "Neplatné obdobie exportu." });
    }
    if (end.getTime() - start.getTime() > 366 * 24 * 60 * 60 * 1000) {
      return sendJson(res, 400, { ok: false, error: "Jednorazový export môže obsahovať najviac 366 dní." });
    }
    const summaryMode = String(req.query.mode || "").toLowerCase() === "shift_summary";

    let query = auth.supabase
      .from("mes_event_log")
      .select(summaryMode ? SUMMARY_EVENT_SELECT : EVENT_SELECT)
      .eq("company_id", companyId)
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString())
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);

    const cursorCreatedAt = String(req.query.cursor_created_at || "").trim();
    const cursorId = String(req.query.cursor_id || "").trim();
    if (cursorCreatedAt && cursorId) {
      const cursorDate = parseDate(cursorCreatedAt);
      if (!cursorDate) return sendJson(res, 400, { ok: false, error: "Neplatný kurzor exportu." });
      query = query.or(`created_at.gt.${cursorDate.toISOString()},and(created_at.eq.${cursorDate.toISOString()},id.gt.${cursorId})`);
    }

    const { data, error } = await query;
    if (error) throw new Error(`MES export query failed: ${error.message}`);
    const events = data || [];
    const last = events.at(-1) || null;
    const summaryRows = summaryMode ? await summarizeEvents(auth.supabase, companyId, events) : null;
    return sendJson(res, 200, {
      ok: true,
      ...(summaryMode ? { summary_rows: summaryRows, scanned_count: events.length } : { events }),
      next_cursor: events.length === PAGE_SIZE && last ? { created_at: last.created_at, id: last.id } : null
    });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
