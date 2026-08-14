import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

import { optionalEnv, requiredEnv, serviceKey } from "./env.ts";
import { HttpError } from "./http.ts";

export function createServiceClient(): SupabaseClient {
  return createClient(requiredEnv("SUPABASE_URL"), serviceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createRequestClient(request: Request): SupabaseClient {
  const publishableKey = optionalEnv("SUPABASE_PUBLISHABLE_KEY") ?? requiredEnv("SUPABASE_ANON_KEY");
  return createClient(requiredEnv("SUPABASE_URL"), publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { authorization: request.headers.get("authorization") ?? "" } },
  });
}

export async function requireUser(request: Request): Promise<{ user: User; client: SupabaseClient }> {
  const client = createRequestClient(request);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "authentication_required");
  return { user: data.user, client };
}

export async function assertEntitled(service: SupabaseClient, userId: string): Promise<void> {
  const { data, error } = await service
    .from("subscriptions")
    .select("id,status,current_period_end")
    .eq("user_id", userId)
    .in("status", ["active", "trialing"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const notExpired = !data?.current_period_end || Date.parse(data.current_period_end) > Date.now();
  if (!data || !notExpired) throw new HttpError(402, "active_subscription_required");
}

export async function assertAnnualEntitled(service: SupabaseClient, userId: string): Promise<void> {
  const { data, error } = await service
    .from("subscriptions")
    .select("id,status,interval,current_period_end")
    .eq("user_id", userId)
    .eq("interval", "annual")
    .in("status", ["active", "trialing"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const notExpired = !data?.current_period_end || Date.parse(data.current_period_end) > Date.now();
  if (!data || !notExpired) throw new HttpError(402, "annual_subscription_required");
}
