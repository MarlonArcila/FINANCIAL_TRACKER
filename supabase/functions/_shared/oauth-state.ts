import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { pkceChallenge, randomBase64Url, sha256Base64Url } from "./crypto.ts";
import { HttpError } from "./http.ts";

export async function createOAuthState(
  service: SupabaseClient,
  input: { userId: string; provider: "gmail" | "outlook"; returnUrl: string },
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
  provider: "gmail" | "outlook",
): Promise<{ userId: string; codeVerifier: string; returnUrl: string }> {
  const stateHash = await sha256Base64Url(state);
  const { data, error } = await service
    .schema("private")
    .from("oauth_states")
    .select("id,user_id,provider,code_verifier,return_url,expires_at,used_at")
    .eq("state_hash", stateHash)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.provider !== provider || data.used_at || Date.parse(data.expires_at) <= Date.now()) {
    throw new HttpError(400, "invalid_or_expired_oauth_state");
  }
  const { data: consumed, error: updateError } = await service
    .schema("private")
    .from("oauth_states")
    .update({ used_at: new Date().toISOString() })
    .eq("id", data.id)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id")
    .maybeSingle();
  if (updateError) throw updateError;
  if (!consumed) throw new HttpError(400, "oauth_state_already_consumed");
  return { userId: data.user_id, codeVerifier: data.code_verifier, returnUrl: data.return_url };
}
