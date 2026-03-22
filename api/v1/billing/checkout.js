import { createCheckoutSession } from "../../_lib/billing.js";
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

    const session = await createCheckoutSession({
      company: auth.company,
      user: auth.user,
      appUser: auth.appUser,
      billingCycle: payload.billingCycle,
      pricingInput: payload.pricing || {},
      onboardingSetup: payload.onboardingSetup || {},
      req
    });

    return sendJson(res, 200, {
      ok: true,
      url: session.url,
      session_id: session.sessionId,
      cycle: session.cycle,
      includes_setup_fee: session.includesSetupFee,
      estimate: session.estimate
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.toLowerCase().includes("aktivne predplatne") ? 409 : 500;

    return sendJson(res, status, {
      ok: false,
      error: message
    });
  }
}
