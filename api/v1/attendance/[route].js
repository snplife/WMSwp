import { sendJson, sendMethodNotAllowed } from "../../_lib/http.js";
import terminalEventHandler from "../../../server/v1/attendance/terminal-event.js";
import terminalPingHandler from "../../../server/v1/attendance/terminal-ping.js";

const ROUTE_HANDLERS = {
  "terminal-event": terminalEventHandler,
  "terminal-ping": terminalPingHandler
};

export default async function handler(req, res) {
  const route = String(req.query.route || "").trim();
  const routeHandler = ROUTE_HANDLERS[route];

  if (!routeHandler) {
    return sendJson(res, 404, {
      ok: false,
      error: "API route was not found."
    });
  }

  if (req.method === "OPTIONS") {
    return sendMethodNotAllowed(res, [req.method]);
  }

  return routeHandler(req, res);
}
