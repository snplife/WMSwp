import { sendJson, sendMethodNotAllowed } from "../../_lib/http.js";
import { requireAuthenticatedUser } from "../../_lib/userAuth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res, ["GET"]);
  }

  try {
    const authResult = await requireAuthenticatedUser(req);
    if (!authResult.ok) {
      return sendJson(res, authResult.status, {
        ok: false,
        error: authResult.error
      });
    }

    const { supabase, user, appUser } = authResult;
    const email = String(user?.email || appUser?.email || "").trim().toLowerCase();

    if (!email) {
      return sendJson(res, 200, {
        ok: true,
        invites: []
      });
    }

    const { data: inviteRows, error: inviteError } = await supabase
      .from("company_invites")
      .select("id,company_id,email,token,status,expires_at,can_manage_orders,can_access_mes,created_at")
      .eq("status", "pending")
      .eq("email", email)
      .order("created_at", { ascending: false });

    if (inviteError) {
      throw new Error(`incoming invite lookup failed: ${inviteError.message}`);
    }

    const companyIds = Array.from(new Set((inviteRows || []).map((row) => String(row.company_id || "").trim()).filter(Boolean)));
    let companyNameById = {};

    if (companyIds.length > 0) {
      const { data: companyRows, error: companyError } = await supabase.from("companies").select("id,name").in("id", companyIds);
      if (companyError) {
        throw new Error(`incoming invite company lookup failed: ${companyError.message}`);
      }
      companyNameById = Object.fromEntries((companyRows || []).map((row) => [String(row.id || "").trim(), String(row.name || "").trim()]));
    }

    const invites = (inviteRows || []).map((row) => ({
      id: row.id,
      company_id: row.company_id,
      company_name: companyNameById[String(row.company_id || "").trim()] || "Firma",
      email: row.email,
      token: row.token,
      status: row.status,
      expires_at: row.expires_at,
      can_manage_orders: Boolean(row.can_manage_orders),
      can_access_mes: Boolean(row.can_access_mes),
      created_at: row.created_at
    }));

    return sendJson(res, 200, {
      ok: true,
      invites
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
