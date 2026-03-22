import { createClient } from "@supabase/supabase-js";

let cachedClient = null;

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function requiredEnvAny(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) {
      return value;
    }
  }
  throw new Error(`Missing required env: ${names[0]}`);
}

export function getSupabaseAdmin() {
  if (cachedClient) {
    return cachedClient;
  }

  const supabaseUrl = requiredEnvAny("SUPABASE_URL", "VITE_SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  cachedClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  return cachedClient;
}
