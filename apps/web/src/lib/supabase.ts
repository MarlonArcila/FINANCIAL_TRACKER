import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env, hasSupabaseConfig } from "./env";

export const supabase: SupabaseClient | null = hasSupabaseConfig
  ? createClient(env.supabaseUrl!, env.supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      "Supabase no está configurado. Defina VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.",
    );
  }
  return supabase;
}
