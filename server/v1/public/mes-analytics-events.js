import { requireAuthenticatedUser } from "../../../api/_lib/userAuth.js";
import { sendJson, sendMethodNotAllowed } from "../../../api/_lib/http.js";

const PAGE_SIZE = 1000;
const MAX_EVENTS = 500_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SHORT_RANGE_LIMIT_MS = 31 * DAY_MS;
const EVENT_SELECT = "workstation_id,terminal_id,operator_id,duration_seconds,payload,created_at";
const CACHE_TTL_MS = 5 * 60 * 1000;
const reportCache = new Map();
const SHIFT_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Bratislava",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
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
  const minute = Number(parts.minute);
  const minutesOfDay = hour * 60 + minute;
  let dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  if (minutesOfDay >= 6 * 60 + 30 && minutesOfDay < 14 * 60 + 30) {
    return { date: dateKey, key: "morning", label: "Ranná 06:30 – 14:30", order: 1 };
  }
  if (minutesOfDay >= 14 * 60 + 30 && minutesOfDay < 22 * 60 + 30) {
    return { date: dateKey, key: "afternoon", label: "Poobedná 14:30 – 22:30", order: 2 };
  }
  if (minutesOfDay < 6 * 60 + 30) dateKey = previousDateKey(dateKey);
  return { date: dateKey, key: "night", label: "Nočná 22:30 – 06:30", order: 3 };
}

function eventQuantity(event) {
  const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
  const candidates = [payload.quantity, payload.qty, payload.count];
  const quantity = Number(candidates.find((value) => Number.isFinite(Number(value)) && Number(value) > 0) || 1);
  return Math.max(1, quantity);
}

function getShiftStartMs(value, shift) {
  const date = parseDate(value);
  if (!date || !shift) return null;
  const parts = Object.fromEntries(SHIFT_TIME_FORMATTER.formatToParts(date)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
  const minutesOfDay = Number(parts.hour) * 60 + Number(parts.minute);
  const shiftStartMinutes = shift.order === 1 ? 6 * 60 + 30 : shift.order === 2 ? 14 * 60 + 30 : 22 * 60 + 30;
  const elapsedMinutes = shift.order === 3 && minutesOfDay < 6 * 60 + 30
    ? minutesOfDay + 24 * 60 - shiftStartMinutes
    : minutesOfDay - shiftStartMinutes;
  return date.getTime() - elapsedMinutes * 60_000 - date.getUTCSeconds() * 1000 - date.getUTCMilliseconds();
}

function getRuntimeSegment(event) {
  const end = parseDate(event.payload?.time_to || event.created_at);
  if (!end) return null;
  const durationSeconds = Math.max(0, Number(event.duration_seconds || event.payload?.duration_seconds || 0));
  if (durationSeconds <= 0) return null;
  const payloadStart = parseDate(event.payload?.time_from);
  const startMs = payloadStart?.getTime() ?? end.getTime() - durationSeconds * 1000;
  return startMs < end.getTime() ? { startMs, endMs: end.getTime() } : null;
}

export function summarizeProductionCycles(events, rangeStart = null, rangeEnd = null) {
  const grouped = new Map();
  const rangeStartMs = parseDate(rangeStart)?.getTime() ?? Number.NEGATIVE_INFINITY;
  const rangeEndMs = parseDate(rangeEnd)?.getTime() ?? Number.POSITIVE_INFINITY;

  const getGroup = (event, shift) => {
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
    return grouped.get(key);
  };

  events.forEach((event) => {
    const shift = getShiftBucket(event.created_at);
    if (!shift) return;
    getGroup(event, shift).pieces += eventQuantity(event);

    const segment = getRuntimeSegment(event);
    if (!segment) return;
    const clippedStartMs = Math.max(segment.startMs, rangeStartMs);
    const clippedEndMs = Math.min(segment.endMs, rangeEndMs);
    if (clippedEndMs <= clippedStartMs) return;

    let windowShift = getShiftBucket(new Date(clippedEndMs - 1));
    let windowStartMs = getShiftStartMs(new Date(clippedEndMs - 1), windowShift);
    let iterations = 0;
    while (windowShift && Number.isFinite(windowStartMs) && windowStartMs + 8 * 60 * 60 * 1000 > clippedStartMs && iterations < 1200) {
      const windowEndMs = windowStartMs + 8 * 60 * 60 * 1000;
      const overlapStartMs = Math.max(clippedStartMs, windowStartMs);
      const overlapEndMs = Math.min(clippedEndMs, windowEndMs);
      if (overlapEndMs > overlapStartMs) {
        getGroup(event, windowShift).runtime_minutes += (overlapEndMs - overlapStartMs) / 60_000;
      }
      const previousMoment = new Date(windowStartMs - 1);
      windowShift = getShiftBucket(previousMoment);
      windowStartMs = getShiftStartMs(previousMoment, windowShift);
      iterations += 1;
    }
  });
  return Array.from(grouped.values())
    .map((group) => ({ ...group, runtime_minutes: Number(group.runtime_minutes.toFixed(2)) }))
    .sort((left, right) => left.date.localeCompare(right.date) || left.shift_order - right.shift_order || left.operator.localeCompare(right.operator, "sk-SK"));
}

export async function loadProductionCycles(supabase, companyId, start, end) {
  const events = [];
  const endExclusiveMs = end.getTime() + 1;
  const chunkMs = endExclusiveMs - start.getTime() <= SHORT_RANGE_LIMIT_MS ? DAY_MS : 7 * DAY_MS;

  for (let chunkStartMs = start.getTime(); chunkStartMs < endExclusiveMs; chunkStartMs += chunkMs) {
    const chunkEndMs = Math.min(endExclusiveMs, chunkStartMs + chunkMs);
    let from = 0;
    while (events.length <= MAX_EVENTS) {
      const result = await supabase.from("mes_event_log")
        .select(EVENT_SELECT)
        .eq("company_id", companyId)
        .eq("event_code", "ml")
        .gte("created_at", new Date(chunkStartMs).toISOString())
        .lt("created_at", new Date(chunkEndMs).toISOString())
        .order("created_at", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (result.error) throw new Error(`MES production query failed: ${result.error.message}`);
      const page = result.data || [];
      events.push(...page);
      if (events.length > MAX_EVENTS) {
        throw new Error(`Obdobie obsahuje viac ako ${MAX_EVENTS} výrobných cyklov.`);
      }
      if (page.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }
  return { events, total: events.length };
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
    const summaryRows = summarizeProductionCycles(events, start, end);
    const runtimeMinutes = summaryRows.reduce((sum, row) => sum + Number(row.runtime_minutes || 0), 0);
    const payload = {
      ok: true,
      summary_rows: summaryRows,
      cycle_count: total,
      runtime_minutes: Number(runtimeMinutes.toFixed(2)),
      quality: { good: 0, scrap: 0 }
    };
    reportCache.set(cacheKey, { createdAt: Date.now(), payload });
    return sendJson(res, 200, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("MES shift analytics failed", {
      message,
      start: String(req.query.start || ""),
      end: String(req.query.end || "")
    });
    return sendJson(res, 500, { ok: false, error: message });
  }
}
