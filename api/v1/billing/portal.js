import { createBillingPortalSession } from "../../_lib/billing.js";
import { sendJson, sendMethodNotAllowed } from "../../_lib/http.js";
import { requireAuthenticatedCompanyManager } from "../../_lib/userAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendMethodNotAllowed(res, ["POST"]);
  }

  try {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const auth = await requireAuthenticatedCompanyManager(req, payload.companyId);
    if (!auth.ok) {
      return sendJson(res, auth.status, {
        ok: false,
        error: auth.error
      });
    }

    const session = await createBillingPortalSession({
      company: auth.company,
      req
    });

    return sendJson(res, 200, {
      ok: true,
      url: session.url
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
