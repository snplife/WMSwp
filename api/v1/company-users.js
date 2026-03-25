import { sendJson, sendMethodNotAllowed } from "../_lib/http.js";
import { requireAuthenticatedCompanyManager } from "../_lib/userAuth.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";

const ROLE_TABLE = String(process.env.VITE_USER_ROLES_TABLE || "app_users").trim() || "app_users";

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
  if (req.method !== "GET" && req.method !== "DELETE") {
    return sendMethodNotAllowed(res, ["GET", "DELETE"]);
  }

  try {
    const payload = req.method === "DELETE" ? parseJsonBody(req) : req.query || {};
    const requestedCompanyId = String(payload?.companyId || "").trim();
    const auth = await requireAuthenticatedCompanyManager(req, requestedCompanyId);

    if (!auth.ok) {
      return sendJson(res, auth.status, {
        ok: false,
        error: auth.error
      });
    }

    const companyId = String(auth.companyId || requestedCompanyId || "").trim();
    const supabase = getSupabaseAdmin();

    if (req.method === "GET") {
      const { data, error } = await supabase
        .from(ROLE_TABLE)
        .select("user_id,company_id,role,can_manage_orders,can_access_mes,can_access_attendance,username,email,created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });

      if (error) {
        throw new Error(`company users load failed: ${error.message}`);
      }

      return sendJson(res, 200, {
        ok: true,
        users: data || []
      });
    }

    const targetUserId = String(payload?.userId || "").trim();
    if (!targetUserId) {
      return sendJson(res, 400, {
        ok: false,
        error: "Chýba userId na odobratie."
      });
    }

    if (targetUserId === String(auth.user?.id || "").trim()) {
      return sendJson(res, 400, {
        ok: false,
        error: "Aktuálne prihlásený admin nemôže odobrať sám seba."
      });
    }

    const { data: targetUser, error: targetUserError } = await supabase
      .from(ROLE_TABLE)
      .select("user_id,company_id,role,username,email")
      .eq("user_id", targetUserId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (targetUserError) {
      throw new Error(`company user lookup failed: ${targetUserError.message}`);
    }

    if (!targetUser) {
      return sendJson(res, 404, {
        ok: false,
        error: "Používateľ v tejto firme neexistuje."
      });
    }

    if (String(targetUser.role || "").trim().toLowerCase() === "master") {
      return sendJson(res, 400, {
        ok: false,
        error: "Master účet nie je možné odobrať cez firemné nastavenia."
      });
    }

    const { error: deleteError } = await supabase
      .from(ROLE_TABLE)
      .delete()
      .eq("user_id", targetUserId)
      .eq("company_id", companyId);

    if (deleteError) {
      throw new Error(`company user delete failed: ${deleteError.message}`);
    }

    return sendJson(res, 200, {
      ok: true,
      removed_user_id: targetUserId
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
