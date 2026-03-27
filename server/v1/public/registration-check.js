import { sendJson, sendMethodNotAllowed } from "../../../api/_lib/http.js";
import { getSupabaseAdmin } from "../../../api/_lib/supabaseAdmin.js";

const ROLE_TABLE = String(process.env.VITE_USER_ROLES_TABLE || "app_users").trim() || "app_users";

function sanitizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9._-]/g, "");
}

function sanitizeCompanyName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

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
    const email = sanitizeEmail(payload?.email);
    const username = sanitizeUsername(payload?.username);
    const companyName = sanitizeCompanyName(payload?.companyName);
    const inviteToken = String(payload?.inviteToken || "").trim();
    const supabase = getSupabaseAdmin();

    const [emailCheck, usernameCheck, companyCheck] = await Promise.all([
      email
        ? supabase.schema("auth").from("users").select("id,email", { head: false }).eq("email", email).limit(1)
        : Promise.resolve({ data: [], error: null }),
      username
        ? supabase.from(ROLE_TABLE).select("user_id,username", { head: false }).ilike("username", username).limit(1)
        : Promise.resolve({ data: [], error: null }),
      !inviteToken && companyName
        ? supabase.from("companies").select("id,name", { head: false }).ilike("name", companyName).limit(1)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (emailCheck.error) {
      throw new Error(`email check failed: ${emailCheck.error.message}`);
    }
    if (usernameCheck.error) {
      throw new Error(`username check failed: ${usernameCheck.error.message}`);
    }
    if (companyCheck.error) {
      throw new Error(`company check failed: ${companyCheck.error.message}`);
    }

    const emailExists = Array.isArray(emailCheck.data) && emailCheck.data.length > 0;
    const usernameExists = Array.isArray(usernameCheck.data) && usernameCheck.data.length > 0;
    const existingCompany = Array.isArray(companyCheck.data) && companyCheck.data.length > 0 ? companyCheck.data[0] : null;

    return sendJson(res, 200, {
      ok: true,
      email_exists: emailExists,
      username_exists: usernameExists,
      company_exists: Boolean(existingCompany),
      company_id: existingCompany?.id || null,
      company_name: existingCompany?.name || null
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
