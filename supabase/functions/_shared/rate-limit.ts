import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { HttpError } from "./http.ts";

export type RateLimitPolicy = Readonly<{
  scope: string;
  limit: number;
  windowSeconds: number;
}>;

export const RATE_LIMIT_POLICIES = {
  GMAIL_OAUTH_START: { scope: "oauth.gmail.start", limit: 10, windowSeconds: 600 },
  STORAGE_OAUTH_START: { scope: "oauth.google_drive.start", limit: 10, windowSeconds: 600 },
  GMAIL_SYNC: { scope: "sync.gmail.manual", limit: 6, windowSeconds: 60 },
  AI_ADVISOR: { scope: "ai.advisor", limit: 10, windowSeconds: 600 },
  WHOP_CHECKOUT: { scope: "checkout.whop", limit: 5, windowSeconds: 600 },
} as const satisfies Record<string, RateLimitPolicy>;

type RateLimitRpcRow = {
  allowed: boolean;
  remaining: number;
  retry_after_seconds: number;
};

export async function enforceUserRateLimit(
  service: SupabaseClient,
  userId: string,
  policy: RateLimitPolicy,
): Promise<{ remaining: number; retryAfterSeconds: number }> {
  const { data, error } = await service.rpc("service_take_rate_limit", {
    p_scope: policy.scope,
    p_subject: userId,
    p_limit: policy.limit,
    p_window_seconds: policy.windowSeconds,
  }).single();

  if (error) {
    console.error(JSON.stringify({ event: "rate_limit_failure", scope: policy.scope }));
    throw new HttpError(503, "rate_limit_unavailable");
  }

  const row = normalizeRateLimitRow(data);
  if (!row) {
    console.error(JSON.stringify({ event: "rate_limit_invalid_response", scope: policy.scope }));
    throw new HttpError(503, "rate_limit_unavailable");
  }
  if (!row.allowed) {
    throw new HttpError(429, "rate_limited", { retryAfterSeconds: row.retry_after_seconds });
  }
  return { remaining: row.remaining, retryAfterSeconds: row.retry_after_seconds };
}

function normalizeRateLimitRow(value: unknown): RateLimitRpcRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.allowed !== "boolean") return null;
  if (!Number.isInteger(row.remaining) || Number(row.remaining) < 0) return null;
  if (!Number.isInteger(row.retry_after_seconds) || Number(row.retry_after_seconds) < 1) return null;
  return {
    allowed: row.allowed,
    remaining: Number(row.remaining),
    retry_after_seconds: Number(row.retry_after_seconds),
  };
}
