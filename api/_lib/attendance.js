import crypto from "node:crypto";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

const ATTENDANCE_EVENT_TYPES = new Set(["clock_in", "clock_out", "break_start", "break_end"]);

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function normalizeTerminalCode(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeIdentifier(value) {
  return String(value || "").trim();
}

function normalizeRequestedAction(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "toggle") {
    return "toggle";
  }
  return ATTENDANCE_EVENT_TYPES.has(normalized) ? normalized : "";
}

function normalizeClientEventId(value) {
  return String(value || "").trim();
}

export async function requireAttendanceTerminal(req, payload = {}) {
  const terminalCode = normalizeTerminalCode(req.headers["x-terminal-code"] || payload.terminal_code);
  const terminalToken = normalizeIdentifier(req.headers["x-terminal-token"] || payload.terminal_token);

  if (!terminalCode || !terminalToken) {
    return {
      ok: false,
      status: 401,
      error: "Missing terminal credentials. Use X-Terminal-Code and X-Terminal-Token."
    };
  }

  const supabase = getSupabaseAdmin();
  const { data: terminal, error } = await supabase
    .from("attendance_terminals")
    .select("id,company_id,terminal_code,name,is_active")
    .eq("terminal_code", terminalCode)
    .eq("api_token_hash", sha256(terminalToken))
    .maybeSingle();

  if (error) {
    throw new Error(`attendance terminal lookup failed: ${error.message}`);
  }

  if (!terminal || !terminal.is_active) {
    return {
      ok: false,
      status: 401,
      error: "Attendance terminal is not valid or is disabled."
    };
  }

  await supabase
    .from("attendance_terminals")
    .update({ last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", terminal.id);

  return {
    ok: true,
    supabase,
    terminal
  };
}

export async function findAttendanceProfileByIdentifier(supabase, companyId, identifier) {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  if (!normalizedIdentifier) {
    throw new Error("Missing attendance identifier.");
  }

  const escapedIdentifier = normalizedIdentifier.replace(/,/g, "\\,");
  const { data, error } = await supabase
    .from("attendance_profiles")
    .select("id,company_id,employee_code,full_name,pin_code,badge_code,is_active")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .or(`employee_code.eq.${escapedIdentifier},pin_code.eq.${escapedIdentifier},badge_code.eq.${escapedIdentifier}`)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`attendance profile lookup failed: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return data;
}

export async function getLatestAttendanceEvent(supabase, profileId) {
  const { data, error } = await supabase
    .from("attendance_events")
    .select("id,event_type,happened_at")
    .eq("profile_id", profileId)
    .order("happened_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`attendance latest event lookup failed: ${error.message}`);
  }

  return data || null;
}

export async function getAttendanceEventByClientEventId(supabase, companyId, terminalId, clientEventId) {
  const normalizedClientEventId = normalizeClientEventId(clientEventId);
  if (!normalizedClientEventId) {
    return null;
  }

  const { data, error } = await supabase
    .from("attendance_events")
    .select("id,profile_id,terminal_id,event_type,happened_at,note,client_event_id")
    .eq("company_id", companyId)
    .eq("terminal_id", terminalId)
    .eq("client_event_id", normalizedClientEventId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`attendance client event lookup failed: ${error.message}`);
  }

  return data || null;
}

export async function getAttendanceProfileById(supabase, profileId) {
  const { data, error } = await supabase
    .from("attendance_profiles")
    .select("id,company_id,employee_code,full_name,pin_code,badge_code,is_active")
    .eq("id", profileId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`attendance profile by id lookup failed: ${error.message}`);
  }

  return data || null;
}

export function resolveAttendanceEventType(requestedAction, latestEventType = "") {
  const normalizedAction = normalizeRequestedAction(requestedAction);
  const latest = String(latestEventType || "").trim().toLowerCase();

  if (!normalizedAction) {
    throw new Error("Unsupported attendance action.");
  }

  if (normalizedAction !== "toggle") {
    return normalizedAction;
  }

  if (!latest || latest === "clock_out" || latest === "break_end") {
    return "clock_in";
  }

  if (latest === "clock_in" || latest === "break_start") {
    return "clock_out";
  }

  return "clock_in";
}

export function buildAttendancePresenceState(eventType) {
  const normalized = String(eventType || "").trim().toLowerCase();
  if (normalized === "clock_in" || normalized === "break_end") {
    return "in";
  }
  if (normalized === "break_start") {
    return "break";
  }
  return "out";
}
