import { requireAuthenticatedUser } from "../../../api/_lib/userAuth.js";
import { sendJson, sendMethodNotAllowed } from "../../../api/_lib/http.js";

const PAGE_SIZE = 1000;
const EVENT_SELECT = "id,terminal_id,workstation_id,job_run_id,terminal_event_id,event_code,job_number,duration_seconds,time_from,time_to,operator_id,downtime_reason_code,downtime_reason_name,payload,created_at";

function parseDate(value) {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date : null;
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

    let query = auth.supabase
      .from("mes_event_log")
      .select(EVENT_SELECT)
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
    return sendJson(res, 200, {
      ok: true,
      events,
      next_cursor: events.length === PAGE_SIZE && last ? { created_at: last.created_at, id: last.id } : null
    });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

