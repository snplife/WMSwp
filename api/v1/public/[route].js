import { sendJson } from "../../_lib/http.js";
import platformStatsHandler from "../../../server/v1/public/platform-stats.js";
import registrationCheckHandler from "../../../server/v1/public/registration-check.js";

const ROUTE_HANDLERS = {
  "platform-stats": platformStatsHandler,
  "registration-check": registrationCheckHandler
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
