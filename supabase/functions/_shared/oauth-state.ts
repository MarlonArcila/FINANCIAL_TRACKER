import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { pkceChallenge, randomBase64Url, sha256Base64Url } from "./crypto.ts";
import { HttpError } from "./http.ts";

type StoredOAuthState = { provider: "gmail"; expires_at: string; used_at: string | null };

export function requireOAuthCallbackState(state: string | null): string {
  if (!state || !/^[A-Za-z0-9_-]{43}$/u.test(state)) throw new HttpError(400, "invalid_or_expired_oauth_state");
  return state;
}

export function canConsumeOAuthState(state: StoredOAuthState | null, provider: "gmail", now = Date.now()): boolean {
  return Boolean(state && state.provider === provider && !state.used_at && Number.isFinite(Date.parse(state.expires_at)) && Date.parse(state.expires_at) > now);
}

export async function createOAuthState(
  service: SupabaseClient,
  input: { userId: string; provider: "gmail"; returnUrl: string },
): Promise<{ state: string; codeVerifier: string; codeChallenge: string }> {
  const state = randomBase64Url(32);
  const codeVerifier = randomBase64Url(48);
  const [stateHash, codeChallenge] = await Promise.all([sha256Base64Url(state), pkceChallenge(codeVerifier)]);
  const { error } = await service.schema("private").from("oauth_states").insert({
    state_hash: stateHash,
    user_id: input.userId,
    provider: input.provider,
    code_verifier: codeVerifier,
    return_url: input.returnUrl,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (error) throw error;
  return { state, codeVerifier, codeChallenge };
}

export async function consumeOAuthState(
  service: SupabaseClient,
  state: string,
  provider: "gmail",
): Promise<{ userId: string; codeVerifier: string; returnUrl: string }> {
  state = requireOAuthCallbackState(state);
  const stateHash = await sha256Base64Url(state);
  const { data, error } = await service.rpc("consume_oauth_state", { p_state_hash: stateHash, p_provider: provider }).maybeSingle();
  if (error) throw new HttpError(503, "oauth_state_service_unavailable");
  if (!data) throw new HttpError(400, "invalid_or_expired_oauth_state");
  return { userId: data.user_id, codeVerifier: data.code_verifier, returnUrl: data.return_url };
}
