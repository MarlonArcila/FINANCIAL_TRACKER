import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

import { publishableKey, requiredEnv, serviceKey } from "./env.ts";
import { HttpError } from "./http.ts";

export function createServiceClient(): SupabaseClient {
  return createClient(requiredEnv("SUPABASE_URL"), serviceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createRequestClient(request: Request): SupabaseClient {
  const key = publishableKey();
  return createClient(requiredEnv("SUPABASE_URL"), key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { authorization: request.headers.get("authorization") ?? "" } },
  });
}

export async function requireUser(
  request: Request,
): Promise<{ user: User; client: SupabaseClient }> {
  const authorization =
    request.headers.get("authorization")?.trim() ?? "";

  const bearerMatch =
    /^Bearer\s+([^\s]+)$/i.exec(authorization);

  const accessToken = bearerMatch?.[1];

  if (!accessToken) {
    console.warn(JSON.stringify({
      event: "authentication_rejected",
      stage: "bearer_extraction",
      authorization_present: authorization.length > 0,
    }));

    throw new HttpError(
      401,
      "authentication_required",
    );
  }

  /*
   * Stateless Edge Function authentication:
   *
   * - verify the user's JWT explicitly against Supabase Auth;
   * - use the server-side credential only as the API credential
   *   for that verification request;
   * - never trust claims obtained merely by decoding the JWT;
   * - return a separate request-scoped client so RLS continues
   *   to execute as the authenticated user.
   */
  const verifier = createServiceClient();

  const { data, error } =
    await verifier.auth.getUser(accessToken);

  if (error || !data.user) {
    console.warn(JSON.stringify({
      event: "authentication_rejected",
      stage: "service_auth_get_user",
      error_name: error?.name ?? null,
    }));

    throw new HttpError(
      401,
      "authentication_required",
    );
  }

  return {
    user: data.user,
    client: createRequestClient(request),
  };
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
