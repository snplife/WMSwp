import { requireCompanyApiKey, STOCK_READ_SCOPE } from "../_lib/auth.js";
import { sendJson, sendMethodNotAllowed, clampInteger } from "../_lib/http.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res, ["GET"]);
  }

  try {
    const auth = await requireCompanyApiKey(req, STOCK_READ_SCOPE);
    if (!auth.ok) {
      return sendJson(res, auth.status, {
        ok: false,
        error: auth.error
      });
    }

    const limit = clampInteger(req.query.limit, { fallback: 500, min: 1, max: 5000 });
    const offset = clampInteger(req.query.offset, { fallback: 0, min: 0, max: 1000000 });
    const materialCode = String(req.query.material_code || "").trim();
    const position = String(req.query.position || "").trim();

    let query = getSupabaseAdmin()
      .from("stock")
      .select("company_id,position,material_code,quantity", { count: "exact" })
      .eq("company_id", auth.companyId)
      .order("position", { ascending: true })
      .order("material_code", { ascending: true })
      .range(offset, offset + limit - 1);

    if (materialCode) {
      query = query.eq("material_code", materialCode);
    }

    if (position) {
      query = query.eq("position", position);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`stock query failed: ${error.message}`);
    }

    return sendJson(res, 200, {
      ok: true,
      company_id: auth.companyId,
      filters: {
        material_code: materialCode || null,
        position: position || null
      },
      pagination: {
        limit,
        offset,
        returned: Array.isArray(data) ? data.length : 0,
        total: Number.isFinite(count) ? count : null
      },
      items: data || []
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
