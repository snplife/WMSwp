import { sendJson, sendMethodNotAllowed } from "../../../api/_lib/http.js";
import { submitCompanyInterest } from "../../../api/_lib/billing.js";
import { requireAuthenticatedCompanyManager } from "../../../api/_lib/userAuth.js";

function parseJsonBody(req) {
  if (!req?.body) {
    return {};
  }

  if (typeof req.body === "object") {
    return req.body;
  }

  try {
    return JSON.parse(String(req.body || "{}"));
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendMethodNotAllowed(res, ["POST"]);
  }

  try {
    const payload = parseJsonBody(req);
    const authResult = await requireAuthenticatedCompanyManager(req, payload?.companyId);
    if (!authResult.ok) {
      return sendJson(res, authResult.status, {
        ok: false,
        error: authResult.error
      });
    }

    const result = await submitCompanyInterest({
      company: authResult.company,
      appUser: authResult.appUser,
      onboardingSetup: payload?.onboardingSetup || {},
      req
    });

    return sendJson(res, 200, {
      ok: true,
      order_number: result?.orderNumber || null
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
