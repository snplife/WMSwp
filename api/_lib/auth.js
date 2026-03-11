import crypto from "node:crypto";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

const STOCK_READ_SCOPE = "stock:read";

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function readApiKey(req) {
  const xApiKey = String(req.headers["x-api-key"] || "").trim();
  if (xApiKey) {
    return xApiKey;
  }

  const authorization = String(req.headers.authorization || "").trim();
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }

  return "";
}

function hasScope(scopes, requiredScope) {
  if (!Array.isArray(scopes)) {
    return false;
  }

  return scopes.includes("*") || scopes.includes(requiredScope);
}

export async function requireCompanyApiKey(req, requiredScope = STOCK_READ_SCOPE) {
  const rawApiKey = readApiKey(req);
  if (!rawApiKey) {
    return {
      ok: false,
      status: 401,
      error: "Missing API key. Use X-API-Key or Authorization: Bearer <key>."
    };
  }

  const supabase = getSupabaseAdmin();
  const keyHash = sha256(rawApiKey);
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("company_api_keys")
    .select("id,company_id,label,scopes,is_active,expires_at")
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(`company_api_keys lookup failed: ${error.message}`);
  }

  if (!data) {
    return {
      ok: false,
      status: 401,
      error: "Invalid API key."
    };
  }

  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    return {
      ok: false,
      status: 401,
      error: "API key expired."
    };
  }

  if (!hasScope(data.scopes, requiredScope)) {
    return {
      ok: false,
      status: 403,
      error: `Missing required scope: ${requiredScope}`
    };
  }

  const { error: updateError } = await supabase
    .from("company_api_keys")
    .update({ last_used_at: nowIso })
    .eq("id", data.id);

  if (updateError) {
    throw new Error(`company_api_keys last_used_at update failed: ${updateError.message}`);
  }

  return {
    ok: true,
    companyId: data.company_id,
    apiKey: {
      id: data.id,
      label: data.label || "",
      scopes: Array.isArray(data.scopes) ? data.scopes : []
    }
  };
}

export { STOCK_READ_SCOPE };
