import { createClient } from "@supabase/supabase-js";

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const supabaseConfigError = !supabaseUrl || !supabaseAnonKey;

export const supabase = createClient(
  supabaseUrl ?? "https://supabase-not-configured.invalid",
  supabaseAnonKey ?? "supabase-not-configured"
);
