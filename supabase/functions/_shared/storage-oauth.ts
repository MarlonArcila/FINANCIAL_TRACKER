import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import {
  decryptSecret,
  encryptSecret,
  pkceChallenge,
  randomBase64Url,
  sha256Base64Url,
} from "./crypto.ts";
import { requiredEnv } from "./env.ts";
import { HttpError } from "./http.ts";
import { requireOAuthCallbackState } from "./oauth-state.ts";

export type StorageProvider = "google_drive";

export interface StorageTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
}

export async function createStorageOAuthState(
  service: SupabaseClient,
  input: {
    userId: string;
    provider: StorageProvider;
    returnUrl: string;
  },
): Promise<{ state: string; codeChallenge: string }> {
  requireGoogleDriveProvider(input.provider);

  const state = randomBase64Url(32);
  const codeVerifier = randomBase64Url(48);
  const [stateHash, codeChallenge] = await Promise.all([
    sha256Base64Url(state),
    pkceChallenge(codeVerifier),
  ]);

  const { error } = await service
    .schema("private")
    .from("storage_oauth_states")
    .insert({
      state_hash: stateHash,
      user_id: input.userId,
      provider: "google_drive",
      code_verifier: codeVerifier,
      return_url: input.returnUrl,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });

  if (error) throw error;

  return { state, codeChallenge };
}

export async function consumeStorageOAuthState(
  service: SupabaseClient,
  state: string,
): Promise<{
  userId: string;
  provider: StorageProvider;
  codeVerifier: string;
  returnUrl: string;
}> {
  state = requireOAuthCallbackState(state);
  const hash = await sha256Base64Url(state);

  const { data, error } = await service
    .rpc("consume_storage_oauth_state", {
      p_state_hash: hash,
    })
    .maybeSingle();

  if (error) {
    throw new HttpError(503, "oauth_state_service_unavailable");
  }

  if (!data) {
    throw new HttpError(400, "invalid_or_expired_oauth_state");
  }

  return {
    userId: data.user_id,
    provider: requireGoogleDriveProvider(data.provider),
    codeVerifier: data.code_verifier,
    returnUrl: data.return_url,
  };
}

export function storageAuthorizationUrl(
  provider: StorageProvider,
  state: string,
  challenge: string,
): string {
  requireGoogleDriveProvider(provider);

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  url.searchParams.set("client_id", requiredEnv("GOOGLE_CLIENT_ID"));
  url.searchParams.set("redirect_uri", storageRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "scope",
    "openid email https://www.googleapis.com/auth/drive.appdata",
  );
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  return url.toString();
}

export async function exchangeStorageCode(
  provider: StorageProvider,
  code: string,
  codeVerifier: string,
): Promise<StorageTokenSet> {
  requireGoogleDriveProvider(provider);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: storageRedirectUri(),
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
  });

  return await parseTokenResponse(response);
}

export async function storageProfile(
  provider: StorageProvider,
  accessToken: string,
): Promise<{ subject: string; label: string | null }> {
  requireGoogleDriveProvider(provider);

  const response = await authorizedFetch(
    accessToken,
    "https://openidconnect.googleapis.com/v1/userinfo",
  );

  const data = await response.json() as {
    sub?: string;
    email?: string;
  };

  if (!data.sub) {
    throw new Error("Google user profile missing subject");
  }

  return {
    subject: data.sub,
    label: data.email ?? null,
  };
}

export async function saveStorageTokens(
  service: SupabaseClient,
  connectionId: string,
  tokens: StorageTokenSet,
): Promise<void> {
  const { data: current, error: currentError } = await service
    .schema("private")
    .from("storage_oauth_credentials")
    .select("encrypted_refresh_token")
    .eq("connection_id", connectionId)
    .maybeSingle();

  if (currentError) throw currentError;

  const { error } = await service
    .schema("private")
    .from("storage_oauth_credentials")
    .upsert({
      connection_id: connectionId,
      encrypted_access_token: await encryptSecret(tokens.accessToken),
      encrypted_refresh_token: tokens.refreshToken
        ? await encryptSecret(tokens.refreshToken)
        : current?.encrypted_refresh_token ?? null,
      token_expires_at: tokens.expiresAt,
    }, {
      onConflict: "connection_id",
    });

  if (error) throw error;
}

export async function getStorageAccessToken(
  service: SupabaseClient,
  connection: {
    id: string;
    provider: StorageProvider;
  },
): Promise<string> {
  requireGoogleDriveProvider(connection.provider);

  const { data, error } = await service
    .schema("private")
    .from("storage_oauth_credentials")
    .select(
      "encrypted_access_token,encrypted_refresh_token,token_expires_at",
    )
    .eq("connection_id", connection.id)
    .single();

  if (error) throw error;

  const accessToken = await decryptSecret(data.encrypted_access_token);
  const refreshToken = await decryptSecret(data.encrypted_refresh_token);

  if (!accessToken) {
    throw new Error("Storage OAuth access token missing");
  }

  if (
    !data.token_expires_at ||
    Date.parse(data.token_expires_at) > Date.now() + 60_000
  ) {
    return accessToken;
  }

  if (!refreshToken) {
    throw new HttpError(401, "storage_reconnect_required");
  }

  const refreshed = await refreshGoogleStorageToken(refreshToken);

  await saveStorageTokens(service, connection.id, {
    ...refreshed,
    refreshToken: refreshed.refreshToken ?? refreshToken,
  });

  return refreshed.accessToken;
}

export function storageScopes(
  provider: StorageProvider,
): string[] {
  requireGoogleDriveProvider(provider);

  return [
    "openid",
    "email",
    "drive.appdata",
  ];
}

function storageRedirectUri(): string {
  return requiredEnv("STORAGE_OAUTH_REDIRECT_URI");
}

async function refreshGoogleStorageToken(
  refreshToken: string,
): Promise<StorageTokenSet> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  return await parseTokenResponse(response);
}

async function parseTokenResponse(
  response: Response,
): Promise<StorageTokenSet> {
  const payload = await response.json() as Record<string, unknown>;

  if (!response.ok || typeof payload.access_token !== "string") {
    throw new Error("storage_token_exchange_failed");
  }

  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string"
      ? payload.refresh_token
      : null,
    expiresAt: typeof payload.expires_in === "number"
      ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
      : null,
  };
}

async function authorizedFetch(
  accessToken: string,
  url: string,
): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("storage_profile_request_failed");
  }

  return response;
}

function requireGoogleDriveProvider(
  provider: unknown,
): StorageProvider {
  if (provider !== "google_drive") {
    throw new HttpError(422, "invalid_storage_provider");
  }

  return "google_drive";
}
