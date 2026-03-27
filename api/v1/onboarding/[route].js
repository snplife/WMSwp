import { sendJson } from "../../_lib/http.js";
import registerCompanyHandler from "../../../server/v1/onboarding/register-company.js";
import submitInterestHandler from "../../../server/v1/onboarding/submit-interest.js";

const ROUTE_HANDLERS = {
  "register-company": registerCompanyHandler,
  "submit-interest": submitInterestHandler
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
