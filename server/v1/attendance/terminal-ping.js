import { requireAttendanceTerminal } from "../../../api/_lib/attendance.js";
import { sendJson, sendMethodNotAllowed } from "../../../api/_lib/http.js";

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

    return sendJson(res, 200, {
      ok: true,
      terminal: {
        id: auth.terminal.id,
        code: auth.terminal.terminal_code,
        name: auth.terminal.name,
        company_id: auth.terminal.company_id
      },
      server_time: new Date().toISOString()
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
