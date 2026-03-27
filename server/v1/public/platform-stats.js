import { sendJson, sendMethodNotAllowed } from "../../../api/_lib/http.js";
import { getSupabaseAdmin } from "../../../api/_lib/supabaseAdmin.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res, ["GET"]);
  }

  try {
    const { count, error } = await getSupabaseAdmin().from("companies").select("id", { count: "exact", head: true });

    if (error) {
      throw new Error(`companies count failed: ${error.message}`);
    }

    return sendJson(res, 200, {
      ok: true,
      registered_companies_count: Number.isFinite(count) ? count : 0
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
