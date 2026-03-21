import {
  buildAttendancePresenceState,
  findAttendanceProfileByIdentifier,
  getAttendanceEventByClientEventId,
  getAttendanceProfileById,
  getLatestAttendanceEvent,
  requireAttendanceTerminal,
  resolveAttendanceEventType
} from "../../_lib/attendance.js";
import { sendJson, sendMethodNotAllowed } from "../../_lib/http.js";

function buildSuccessResponse(auth, profile, eventRow, extra = {}) {
  return {
    ok: true,
    ...extra,
    profile: {
      id: profile.id,
      employee_code: profile.employee_code,
      full_name: profile.full_name
    },
    terminal: {
      id: auth.terminal.id,
      name: auth.terminal.name,
      code: auth.terminal.terminal_code
    },
    event: eventRow,
    state: buildAttendancePresenceState(eventRow?.event_type)
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendMethodNotAllowed(res, ["POST"]);
  }

  try {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const auth = await requireAttendanceTerminal(req, payload);
    if (!auth.ok) {
      return sendJson(res, auth.status, {
        ok: false,
        error: auth.error
      });
    }

    const identifier = String(payload.identifier || "").trim();
    if (!identifier) {
      return sendJson(res, 400, {
        ok: false,
        error: "Missing identifier."
      });
    }

    const clientEventId = String(payload.client_event_id || "").trim();
    if (clientEventId) {
      const existingEvent = await getAttendanceEventByClientEventId(auth.supabase, auth.terminal.company_id, auth.terminal.id, clientEventId);
      if (existingEvent) {
        const existingProfile = await getAttendanceProfileById(auth.supabase, existingEvent.profile_id);
        if (!existingProfile) {
          return sendJson(res, 409, {
            ok: false,
            error: "Attendance event exists, but its profile is no longer available."
          });
        }
        return sendJson(res, 200, buildSuccessResponse(auth, existingProfile, existingEvent, { duplicate: true }));
      }
    }

    const profile = await findAttendanceProfileByIdentifier(auth.supabase, auth.terminal.company_id, identifier);
    if (!profile) {
      return sendJson(res, 404, {
        ok: false,
        error: "Attendance profile was not found."
      });
    }

    const latestEvent = await getLatestAttendanceEvent(auth.supabase, profile.id);
    const eventType = resolveAttendanceEventType(payload.action, latestEvent?.event_type);
    const happenedAt = String(payload.happened_at || "").trim() || new Date().toISOString();

    const { data: eventRow, error: insertError } = await auth.supabase
      .from("attendance_events")
      .insert([
        {
          company_id: auth.terminal.company_id,
          profile_id: profile.id,
          terminal_id: auth.terminal.id,
          event_type: eventType,
          source: "terminal",
          happened_at: happenedAt,
          note: String(payload.note || "").trim(),
          client_event_id: clientEventId || null
        }
      ])
      .select("id,event_type,happened_at,note,client_event_id")
      .single();

    if (insertError) {
      if (clientEventId && String(insertError.code || "") === "23505") {
        const existingEvent = await getAttendanceEventByClientEventId(auth.supabase, auth.terminal.company_id, auth.terminal.id, clientEventId);
        if (existingEvent) {
          return sendJson(res, 200, buildSuccessResponse(auth, profile, existingEvent, { duplicate: true }));
        }
      }
      throw new Error(`attendance event insert failed: ${insertError.message}`);
    }

    return sendJson(res, 200, buildSuccessResponse(auth, profile, eventRow));
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
