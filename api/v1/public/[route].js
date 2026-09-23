import { sendJson } from "../../_lib/http.js";
import platformStatsHandler from "../../../server/v1/public/platform-stats.js";
import registrationCheckHandler from "../../../server/v1/public/registration-check.js";
import mesAnalyticsEventsHandler from "../../../server/v1/public/mes-analytics-events.js";

const ROUTE_HANDLERS = {
  "platform-stats": platformStatsHandler,
  "registration-check": registrationCheckHandler,
  "mes-analytics-events": mesAnalyticsEventsHandler
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

  return routeHandler(req, res);
}
