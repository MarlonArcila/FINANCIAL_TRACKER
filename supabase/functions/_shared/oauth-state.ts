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
  input: {
    userId: string;
    provider: "gmail";
    returnUrl: string;
  },
): Promise<{
  state: string;
  codeChallenge: string;
}> {
  const state = randomBase64Url(32);
  const codeVerifier = randomBase64Url(48);

  const [stateHash, codeChallenge] =
    await Promise.all([
      sha256Base64Url(state),
      pkceChallenge(codeVerifier),
    ]);

  const expiresAt =
    new Date(
      Date.now() + 10 * 60_000,
    ).toISOString();

  const { error } = await service.rpc(
    "create_mail_oauth_state",
    {
      p_state_hash: stateHash,
      p_user_id: input.userId,
      p_code_verifier: codeVerifier,
      p_return_url: input.returnUrl,
      p_expires_at: expiresAt,
    },
  );

  if (error) {
    console.error(JSON.stringify({
      event: "oauth_state_create_failed",
      provider: "gmail",
      error_code: error.code ?? null,
    }));

    throw new HttpError(
      503,
      "oauth_state_service_unavailable",
    );
  }

  return {
    state,
    codeChallenge,
  };
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
