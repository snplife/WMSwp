import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase env vars. Check .env.local file.");
}

export const tableName = import.meta.env.VITE_SUPABASE_TABLE || "events";
export const tableNames = (
  import.meta.env.VITE_SUPABASE_TABLES || import.meta.env.VITE_SUPABASE_TABLE || "events"
)
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
