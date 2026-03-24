import { createClient } from "@supabase/supabase-js";

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing backend env vars. Check .env.local file.");
}

export const noStoreFetch = (input, init = {}) => {
  const headers = new Headers(init.headers || {});
  headers.set("Cache-Control", "no-cache, no-store, max-age=0, must-revalidate");
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");

  return fetch(input, {
    ...init,
    headers,
    cache: "no-store"
  });
};

function makeAuthStorageKey(url) {
  const normalized = String(url || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `wms-auth-${normalized || "default"}`;
}

function makeLegacySupabaseStorageKey(url) {
  try {
    const hostname = new URL(String(url || "")).hostname || "";
    const projectRef = hostname.split(".")[0] || "";
    return projectRef ? `sb-${projectRef}-auth-token` : "";
  } catch {
    return "";
  }
}

export const authStorageKey = makeAuthStorageKey(supabaseUrl);
export const legacyAuthStorageKey = makeLegacySupabaseStorageKey(supabaseUrl);

export function clearSupabaseAuthStorage() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const keysToClear = [
      authStorageKey,
      `${authStorageKey}-code-verifier`,
      legacyAuthStorageKey,
      legacyAuthStorageKey ? `${legacyAuthStorageKey}-code-verifier` : ""
    ].filter(Boolean);

    for (const key of keysToClear) {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore storage cleanup failures.
  }
}

export const tableName = import.meta.env.VITE_SUPABASE_TABLE || "events";
export const tableNames = (
  import.meta.env.VITE_SUPABASE_TABLES || import.meta.env.VITE_SUPABASE_TABLE || "events"
)
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: authStorageKey,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  },
  global: {
    fetch: noStoreFetch
  }
});
