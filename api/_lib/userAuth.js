import { getSupabaseAdmin } from "./supabaseAdmin.js";

const ROLE_TABLE = String(process.env.VITE_USER_ROLES_TABLE || "app_users").trim() || "app_users";

function readBearerToken(req) {
  const authorization = String(req.headers.authorization || "").trim();
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return "";
  }

  return authorization.slice(7).trim();
}

export async function requireAuthenticatedUser(req) {
  const accessToken = readBearerToken(req);
  if (!accessToken) {
    return {
      ok: false,
      status: 401,
      error: "Missing Authorization: Bearer <token> header."
    };
  }

  const supabase = getSupabaseAdmin();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser(accessToken);

  if (userError || !user) {
    return {
      ok: false,
      status: 401,
      error: userError?.message || "Session is not valid."
    };
  }

  const { data: appUser, error: appUserError } = await supabase
    .from(ROLE_TABLE)
    .select("user_id,company_id,role,can_manage_orders,email,username")
    .eq("user_id", user.id)
    .maybeSingle();

  if (appUserError) {
    throw new Error(`app user lookup failed: ${appUserError.message}`);
  }

  return {
    ok: true,
    supabase,
    user,
    appUser: appUser || null,
    accessToken
  };
}

export async function requireAuthenticatedCompanyManager(req, requestedCompanyId = "") {
  const authResult = await requireAuthenticatedUser(req);
  if (!authResult.ok) {
    return authResult;
  }

  const { supabase, user, appUser } = authResult;

  if (!appUser) {
    return {
      ok: false,
      status: 403,
      error: "Pouzivatel nema vytvoreny firemny profil."
    };
  }

  const isMaster = String(appUser.role || "").toLowerCase() === "master";
  const canManageOrders = Boolean(appUser.can_manage_orders);
  const normalizedRequestedCompanyId = String(requestedCompanyId || "").trim();

  if (!isMaster && !canManageOrders) {
    return {
      ok: false,
      status: 403,
      error: "Billing moze spravovat len firemny admin."
    };
  }

  if (!isMaster && normalizedRequestedCompanyId && normalizedRequestedCompanyId !== String(appUser.company_id || "")) {
    return {
      ok: false,
      status: 403,
      error: "Firma v requeste nesedi s prihlasenym pouzivatelom."
    };
  }

  const effectiveCompanyId = normalizedRequestedCompanyId || String(appUser.company_id || "").trim();
  if (!effectiveCompanyId) {
    return {
      ok: false,
      status: 400,
      error: "Nepodarilo sa urcit firmu pre billing."
    };
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("*")
    .eq("id", effectiveCompanyId)
    .maybeSingle();

  if (companyError) {
    throw new Error(`company lookup failed: ${companyError.message}`);
  }

  if (!company) {
    return {
      ok: false,
      status: 404,
      error: "Firma neexistuje."
    };
  }

  return {
    ok: true,
    supabase,
    user,
    appUser,
    company,
    companyId: effectiveCompanyId,
    isMaster
  };
}
