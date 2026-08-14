import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { decryptSecret, encryptSecret, pkceChallenge, randomBase64Url, sha256Base64Url } from "./crypto.ts";
import { optionalEnv, requiredEnv } from "./env.ts";
import { HttpError } from "./http.ts";

export type StorageProvider = "google_drive" | "onedrive";

export interface StorageTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
}

export async function createStorageOAuthState(
  service: SupabaseClient,
  input: { userId: string; provider: StorageProvider; returnUrl: string },
): Promise<{ state: string; codeChallenge: string }> {
  const state = randomBase64Url(32);
  const codeVerifier = randomBase64Url(48);
  const [stateHash, codeChallenge] = await Promise.all([sha256Base64Url(state), pkceChallenge(codeVerifier)]);
  const { error } = await service.schema("private").from("storage_oauth_states").insert({
    state_hash: stateHash,
    user_id: input.userId,
    provider: input.provider,
    code_verifier: codeVerifier,
    return_url: input.returnUrl,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (error) throw error;
  return { state, codeChallenge };
}

export async function consumeStorageOAuthState(service: SupabaseClient, state: string): Promise<{
  userId: string;
  provider: StorageProvider;
  codeVerifier: string;
  returnUrl: string;
}> {
  const hash = await sha256Base64Url(state);
  const { data, error } = await service.schema("private").from("storage_oauth_states")
    .select("id,user_id,provider,code_verifier,return_url,expires_at,used_at")
    .eq("state_hash", hash).maybeSingle();
  if (error) throw error;
  if (!data || data.used_at || Date.parse(data.expires_at) <= Date.now()) throw new HttpError(400, "invalid_or_expired_storage_oauth_state");
  const { data: consumed, error: consumeError } = await service.schema("private").from("storage_oauth_states")
    .update({ used_at: new Date().toISOString() }).eq("id", data.id).is("used_at", null).select("id").maybeSingle();
  if (consumeError) throw consumeError;
  if (!consumed) throw new HttpError(400, "storage_oauth_state_already_consumed");
  return { userId: data.user_id, provider: data.provider as StorageProvider, codeVerifier: data.code_verifier, returnUrl: data.return_url };
}

export function storageAuthorizationUrl(provider: StorageProvider, state: string, challenge: string): string {
  const redirectUri = storageRedirectUri();
  if (provider === "google_drive") {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", requiredEnv("GOOGLE_CLIENT_ID"));
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email https://www.googleapis.com/auth/drive.appdata");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }
  const tenant = optionalEnv("MICROSOFT_TENANT") ?? "common";
  const url = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", requiredEnv("MICROSOFT_CLIENT_ID"));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", "openid offline_access User.Read Files.ReadWrite.AppFolder");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeStorageCode(provider: StorageProvider, code: string, codeVerifier: string): Promise<StorageTokenSet> {
  if (provider === "google_drive") {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: requiredEnv("GOOGLE_CLIENT_ID"), client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
        redirect_uri: storageRedirectUri(), grant_type: "authorization_code", code_verifier: codeVerifier,
      }),
    });
    return await parseTokenResponse(response, "Google");
  }
  const tenant = optionalEnv("MICROSOFT_TENANT") ?? "common";
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: requiredEnv("MICROSOFT_CLIENT_ID"), client_secret: requiredEnv("MICROSOFT_CLIENT_SECRET"),
      redirect_uri: storageRedirectUri(), grant_type: "authorization_code", code_verifier: codeVerifier,
      scope: "openid offline_access User.Read Files.ReadWrite.AppFolder",
    }),
  });
  return await parseTokenResponse(response, "Microsoft");
}

export async function storageProfile(provider: StorageProvider, accessToken: string): Promise<{ subject: string; label: string | null }> {
  if (provider === "google_drive") {
    const response = await authorizedFetch(accessToken, "https://openidconnect.googleapis.com/v1/userinfo");
    const data = await response.json() as { sub?: string; email?: string };
    if (!data.sub) throw new Error("Google user profile missing subject");
    return { subject: data.sub, label: data.email ?? null };
  }
  const response = await authorizedFetch(accessToken, "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName");
  const data = await response.json() as { id?: string; mail?: string; userPrincipalName?: string };
  if (!data.id) throw new Error("Microsoft user profile missing id");
  return { subject: data.id, label: data.mail ?? data.userPrincipalName ?? null };
}

export async function saveStorageTokens(service: SupabaseClient, connectionId: string, tokens: StorageTokenSet): Promise<void> {
  const { data: current, error: currentError } = await service.schema("private").from("storage_oauth_credentials")
    .select("encrypted_refresh_token").eq("connection_id", connectionId).maybeSingle();
  if (currentError) throw currentError;
  const { error } = await service.schema("private").from("storage_oauth_credentials").upsert({
    connection_id: connectionId,
    encrypted_access_token: await encryptSecret(tokens.accessToken),
    encrypted_refresh_token: tokens.refreshToken ? await encryptSecret(tokens.refreshToken) : current?.encrypted_refresh_token ?? null,
    token_expires_at: tokens.expiresAt,
  }, { onConflict: "connection_id" });
  if (error) throw error;
}

export async function getStorageAccessToken(service: SupabaseClient, connection: { id: string; provider: StorageProvider }): Promise<string> {
  const { data, error } = await service.schema("private").from("storage_oauth_credentials")
    .select("encrypted_access_token,encrypted_refresh_token,token_expires_at").eq("connection_id", connection.id).single();
  if (error) throw error;
  const accessToken = await decryptSecret(data.encrypted_access_token);
  const refreshToken = await decryptSecret(data.encrypted_refresh_token);
  if (!accessToken) throw new Error("Storage OAuth access token missing");
  if (!data.token_expires_at || Date.parse(data.token_expires_at) > Date.now() + 60_000) return accessToken;
  if (!refreshToken) throw new HttpError(401, "storage_reconnect_required");

  const refreshed = connection.provider === "google_drive"
    ? await refreshGoogleStorageToken(refreshToken)
    : await refreshMicrosoftStorageToken(refreshToken);
  await saveStorageTokens(service, connection.id, { ...refreshed, refreshToken: refreshed.refreshToken ?? refreshToken });
  return refreshed.accessToken;
}

export function storageScopes(provider: StorageProvider): string[] {
  return provider === "google_drive"
    ? ["openid", "email", "drive.appdata"]
    : ["openid", "offline_access", "User.Read", "Files.ReadWrite.AppFolder"];
}

function storageRedirectUri(): string {
  return requiredEnv("STORAGE_OAUTH_REDIRECT_URI");
}

async function refreshGoogleStorageToken(refreshToken: string): Promise<StorageTokenSet> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: requiredEnv("GOOGLE_CLIENT_ID"), client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"), refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  return await parseTokenResponse(response, "Google");
}

async function refreshMicrosoftStorageToken(refreshToken: string): Promise<StorageTokenSet> {
  const tenant = optionalEnv("MICROSOFT_TENANT") ?? "common";
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: requiredEnv("MICROSOFT_CLIENT_ID"), client_secret: requiredEnv("MICROSOFT_CLIENT_SECRET"), refresh_token: refreshToken, grant_type: "refresh_token", scope: "openid offline_access User.Read Files.ReadWrite.AppFolder" }),
  });
  return await parseTokenResponse(response, "Microsoft");
}

async function parseTokenResponse(response: Response, label: string): Promise<StorageTokenSet> {
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") throw new Error(`${label} storage token exchange failed: ${JSON.stringify(payload)}`);
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : null,
    expiresAt: typeof payload.expires_in === "number" ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : null,
  };
}

async function authorizedFetch(accessToken: string, url: string): Promise<Response> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Storage profile request ${response.status}: ${await response.text()}`);
  return response;
}
