import { processStripeWebhookEvent, verifyStripeWebhookSignature } from "../../_lib/billing.js";
import { sendJson, sendMethodNotAllowed } from "../../_lib/http.js";

export const config = {
  api: {
    bodyParser: false
  }
};

async function readRawBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendMethodNotAllowed(res, ["POST"]);
  }

  try {
    const rawBody = await readRawBody(req);
    const event = verifyStripeWebhookSignature(rawBody, req.headers["stripe-signature"]);
    const result = await processStripeWebhookEvent(event);

    return sendJson(res, 200, {
      ok: true,
      ignored: Boolean(result?.ignored)
    });
  } catch (error) {
    return sendJson(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
