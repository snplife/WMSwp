import { sendJson, sendMethodNotAllowed } from "../../../api/_lib/http.js";
import { syncRegisteredCompanyToMasterSales } from "../../../api/_lib/billing.js";
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

    const result = await syncRegisteredCompanyToMasterSales({
      company: authResult.company,
      appUser: authResult.appUser,
      contactPhone: payload?.contactPhone || ""
    });

    return sendJson(res, 200, {
      ok: true,
      master_company_id: result?.masterCompanyId || null,
      customer_id: result?.customerId || null,
      crm_company_id: result?.crmCompanyId || null
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
