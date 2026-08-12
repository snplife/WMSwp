import { requireAuthenticatedUser } from "../../../api/_lib/userAuth.js";
import { sendJson, sendMethodNotAllowed } from "../../../api/_lib/http.js";

const PAGE_SIZE = 1000;
const MAX_RUNS = 100_000;
const RUN_SELECT = "id,workstation_id,machine_id,terminal_id,operator_name,job_number,good_quantity,scrap_quantity,started_at,ended_at";
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

function summarizeRuns(runs) {
  const grouped = new Map();
  runs.forEach((run) => {
    const shift = getShiftBucket(run.ended_at);
    if (!shift) return;
    const operator = String(run.operator_name || "Neurčený operátor").trim() || "Neurčený operátor";
    const machineId = String(run.machine_id || "");
    const workstationId = String(run.workstation_id || "");
    const terminalId = String(run.terminal_id || "");
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
      runtime_minutes: 0,
      job_numbers: new Set()
    });
    const group = grouped.get(key);
    group.good += Math.max(0, Number(run.good_quantity || 0));
    group.scrap += Math.max(0, Number(run.scrap_quantity || 0));
    const startedAt = parseDate(run.started_at);
    const endedAt = parseDate(run.ended_at);
    if (startedAt && endedAt && endedAt > startedAt) {
      group.runtime_minutes += (endedAt.getTime() - startedAt.getTime()) / 60_000;
    }
    const jobNumber = String(run.job_number || "").trim();
    if (jobNumber) group.job_numbers.add(jobNumber);
  });
  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      runtime_minutes: Number(group.runtime_minutes.toFixed(2)),
      job_numbers: Array.from(group.job_numbers)
    }))
    .sort((left, right) => left.date.localeCompare(right.date) || left.shift_order - right.shift_order || left.operator.localeCompare(right.operator, "sk-SK"));
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
    if (!start || !end || start > end) return sendJson(res, 400, { ok: false, error: "Neplatné obdobie exportu." });
    if (end.getTime() - start.getTime() > 366 * 24 * 60 * 60 * 1000) {
      return sendJson(res, 400, { ok: false, error: "Jednorazový export môže obsahovať najviac 366 dní." });
    }

    const runs = [];
    for (let from = 0; from < MAX_RUNS; from += PAGE_SIZE) {
      const { data, error } = await auth.supabase.from("mes_job_runs")
        .select(RUN_SELECT)
        .eq("company_id", companyId)
        .gte("ended_at", start.toISOString())
        .lte("ended_at", end.toISOString())
        .order("ended_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`MES run query failed: ${error.message}`);
      const page = data || [];
      runs.push(...page);
      if (page.length < PAGE_SIZE) break;
      if (runs.length >= MAX_RUNS) throw new Error(`Obdobie obsahuje viac ako ${MAX_RUNS} výrobných behov.`);
    }

    return sendJson(res, 200, { ok: true, summary_rows: summarizeRuns(runs), run_count: runs.length });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
