import { requireAuthenticatedUser } from "../../../api/_lib/userAuth.js";
import { sendJson, sendMethodNotAllowed } from "../../../api/_lib/http.js";

const PAGE_SIZE = 1000;
const MAX_EVENTS = 500_000;
const EVENT_SELECT = "workstation_id,terminal_id,operator_id,duration_seconds,payload,created_at";
const CACHE_TTL_MS = 5 * 60 * 1000;
const reportCache = new Map();
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
  const candidates = [payload.quantity, payload.qty, payload.count];
  const quantity = Number(candidates.find((value) => Number.isFinite(Number(value)) && Number(value) > 0) || 1);
  return Math.max(1, quantity);
}

function summarizeProductionCycles(events) {
  const grouped = new Map();
  events.forEach((event) => {
    const shift = getShiftBucket(event.created_at);
    if (!shift) return;
    const operator = String(event.payload?.operator || event.payload?.operator_name || event.operator_id || "Neurčený operátor").trim() || "Neurčený operátor";
    const workstationId = String(event.workstation_id || event.payload?.workstation_id || "");
    const terminalId = String(event.terminal_id || "");
    const key = `${shift.date}|${shift.key}|${operator}|${workstationId}|${terminalId}`;
    if (!grouped.has(key)) grouped.set(key, {
      key,
      date: shift.date,
      shift: shift.label,
      shift_order: shift.order,
      operator,
      workstation_id: workstationId,
      terminal_id: terminalId,
      pieces: 0,
      runtime_minutes: 0
    });
    const group = grouped.get(key);
    group.pieces += eventQuantity(event);
    group.runtime_minutes += Math.max(0, Number(event.duration_seconds || event.payload?.duration_seconds || 0)) / 60;
  });
  return Array.from(grouped.values())
    .map((group) => ({ ...group, runtime_minutes: Number(group.runtime_minutes.toFixed(2)) }))
    .sort((left, right) => left.date.localeCompare(right.date) || left.shift_order - right.shift_order || left.operator.localeCompare(right.operator, "sk-SK"));
}

async function loadProductionCycles(supabase, companyId, start, end) {
  const baseQuery = () => supabase.from("mes_event_log")
    .select(EVENT_SELECT, { count: "exact" })
    .eq("company_id", companyId)
    .eq("event_code", "ml")
    .gte("created_at", start.toISOString())
    .lte("created_at", end.toISOString())
    .order("created_at", { ascending: true });
  const firstResult = await baseQuery().range(0, PAGE_SIZE - 1);
  if (firstResult.error) throw new Error(`MES production query failed: ${firstResult.error.message}`);
  const total = Number(firstResult.count || 0);
  if (total > MAX_EVENTS) throw new Error(`Obdobie obsahuje viac ako ${MAX_EVENTS} výrobných cyklov.`);
  const events = [...(firstResult.data || [])];
  for (let from = PAGE_SIZE; from < total; from += PAGE_SIZE * 8) {
    const batch = [];
    for (let pageFrom = from; pageFrom < Math.min(total, from + PAGE_SIZE * 8); pageFrom += PAGE_SIZE) {
      batch.push(baseQuery().range(pageFrom, pageFrom + PAGE_SIZE - 1));
    }
    const results = await Promise.all(batch);
    results.forEach((result) => {
      if (result.error) throw new Error(`MES production query failed: ${result.error.message}`);
      events.push(...(result.data || []));
    });
  }
  return { events, total };
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
    if (!isMaster && !appUser.can_access_mes) return sendJson(res, 403, { ok: false, error: "Používateľ nemá povolený prístup do MES." });

    const start = parseDate(req.query.start);
    const end = parseDate(req.query.end);
    if (!start || !end || start > end) return sendJson(res, 400, { ok: false, error: "Neplatné obdobie reportu." });
    if (end.getTime() - start.getTime() > 366 * 24 * 60 * 60 * 1000) return sendJson(res, 400, { ok: false, error: "Report môže obsahovať najviac 366 dní." });

    const cacheKey = `${companyId}|${start.toISOString()}|${end.toISOString()}`;
    const cached = reportCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) return sendJson(res, 200, { ...cached.payload, cached: true });

    const { events, total } = await loadProductionCycles(auth.supabase, companyId, start, end);
    const payload = { ok: true, summary_rows: summarizeProductionCycles(events), cycle_count: total };
    reportCache.set(cacheKey, { createdAt: Date.now(), payload });
    return sendJson(res, 200, payload);
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
