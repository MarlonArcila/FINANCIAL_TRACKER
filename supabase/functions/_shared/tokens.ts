import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { decryptSecret, encryptSecret } from "./crypto.ts";

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
}

export async function saveTokens(
  service: SupabaseClient,
  connectionId: string,
  token: OAuthTokenSet,
): Promise<void> {
  const { data: current, error: currentError } = await service
    .schema("private")
    .from("oauth_credentials")
    .select("encrypted_refresh_token")
    .eq("connection_id", connectionId)
    .maybeSingle();
  if (currentError) throw currentError;

  const encryptedAccess = await encryptSecret(token.accessToken);
  const encryptedRefresh = token.refreshToken
    ? await encryptSecret(token.refreshToken)
    : current?.encrypted_refresh_token ?? null;
  const { error } = await service.schema("private").from("oauth_credentials").upsert({
    connection_id: connectionId,
    encrypted_access_token: encryptedAccess,
    encrypted_refresh_token: encryptedRefresh,
    token_expires_at: token.expiresAt,
  }, { onConflict: "connection_id" });
  if (error) throw error;
}

export async function loadTokens(service: SupabaseClient, connectionId: string): Promise<OAuthTokenSet> {
  const { data, error } = await service
    .schema("private")
    .from("oauth_credentials")
    .select("encrypted_access_token,encrypted_refresh_token,token_expires_at")
    .eq("connection_id", connectionId)
    .single();
  if (error) throw error;
  const [accessToken, refreshToken] = await Promise.all([
    decryptSecret(data.encrypted_access_token),
    decryptSecret(data.encrypted_refresh_token),
  ]);
  if (!accessToken) throw new Error("Missing OAuth access token");
  return { accessToken, refreshToken, expiresAt: data.token_expires_at };
}
