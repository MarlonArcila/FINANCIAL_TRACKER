import type {
  SupabaseClient,
} from "npm:@supabase/supabase-js@2";

import {
  decryptSecret,
  encryptSecret,
} from "./crypto.ts";

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
  const encryptedAccess =
    await encryptSecret(token.accessToken);

  const encryptedRefresh =
    token.refreshToken
      ? await encryptSecret(
          token.refreshToken,
        )
      : null;

  const { error } = await service.rpc(
    "service_save_oauth_credentials",
    {
      p_connection_id: connectionId,
      p_encrypted_access_token:
        encryptedAccess,
      p_encrypted_refresh_token:
        encryptedRefresh,
      p_token_expires_at:
        token.expiresAt,
    },
  );

  if (error) throw error;
}

export async function loadTokens(
  service: SupabaseClient,
  connectionId: string,
): Promise<OAuthTokenSet> {
  const { data, error } =
    await service
      .rpc(
        "service_get_oauth_credentials",
        {
          p_connection_id:
            connectionId,
        },
      )
      .maybeSingle();

  if (error) throw error;

  if (!data) {
    throw new Error(
      "Missing OAuth credentials",
    );
  }

  const [
    accessToken,
    refreshToken,
  ] = await Promise.all([
    decryptSecret(
      data.encrypted_access_token,
    ),
    decryptSecret(
      data.encrypted_refresh_token,
    ),
  ]);

  if (!accessToken) {
    throw new Error(
      "Missing OAuth access token",
    );
  }

  return {
    accessToken,
    refreshToken,
    expiresAt:
      data.token_expires_at,
  };
}
