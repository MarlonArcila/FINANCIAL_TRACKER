import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { optionalEnv, requiredEnv } from "./env.ts";
import { parseMailMessage } from "./financial-parser.ts";
import { ingestCandidate } from "./ingestion.ts";
import { loadTokens, saveTokens, type OAuthTokenSet } from "./tokens.ts";
import type { MailConnection } from "./gmail.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";

export async function exchangeMicrosoftCode(code: string, codeVerifier: string): Promise<OAuthTokenSet> {
  const tenant = optionalEnv("MICROSOFT_TENANT") ?? "common";
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("MICROSOFT_CLIENT_ID"),
      client_secret: requiredEnv("MICROSOFT_CLIENT_SECRET"),
      redirect_uri: requiredEnv("MICROSOFT_REDIRECT_URI"),
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      scope: "openid offline_access User.Read Mail.Read",
    }),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") throw new Error(`Microsoft token exchange failed: ${JSON.stringify(payload)}`);
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : null,
    expiresAt: typeof payload.expires_in === "number" ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : null,
  };
}

export async function microsoftProfile(accessToken: string): Promise<{ id: string; mail?: string; userPrincipalName?: string }> {
  const response = await graphFetch(accessToken, `${GRAPH}/me?$select=id,mail,userPrincipalName`);
  return await response.json() as { id: string; mail?: string; userPrincipalName?: string };
}

export async function getMicrosoftAccessToken(service: SupabaseClient, connectionId: string): Promise<string> {
  const tokens = await loadTokens(service, connectionId);
  if (!tokens.expiresAt || Date.parse(tokens.expiresAt) > Date.now() + 60_000) return tokens.accessToken;
  if (!tokens.refreshToken) throw new Error("Microsoft refresh token missing; reconnect Outlook");
  const tenant = optionalEnv("MICROSOFT_TENANT") ?? "common";
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("MICROSOFT_CLIENT_ID"),
      client_secret: requiredEnv("MICROSOFT_CLIENT_SECRET"),
      refresh_token: tokens.refreshToken,
      grant_type: "refresh_token",
      scope: "openid offline_access User.Read Mail.Read",
    }),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") throw new Error(`Microsoft token refresh failed: ${JSON.stringify(payload)}`);
  await saveTokens(service, connectionId, {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : tokens.refreshToken,
    expiresAt: typeof payload.expires_in === "number" ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : null,
  });
  return payload.access_token;
}

export async function configureOutlookSubscription(
  service: SupabaseClient,
  connection: MailConnection,
  accessToken?: string,
): Promise<void> {
  const token = accessToken ?? await getMicrosoftAccessToken(service, connection.id);
  const expiration = new Date(Date.now() + 48 * 60 * 60_000).toISOString();
  const clientState = requiredEnv("OUTLOOK_CLIENT_STATE");
  const notificationUrl = requiredEnv("OUTLOOK_WEBHOOK_URL");

  if (connection.watch_resource_id) {
    const response = await graphRequest(token, `${GRAPH}/subscriptions/${encodeURIComponent(connection.watch_resource_id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expirationDateTime: expiration }),
    });
    if (response.status !== 404) {
      if (!response.ok) throw new Error(`Microsoft Graph ${response.status}: ${await response.text()}`);
      const payload = response.status === 204 ? null : (await response.json()) as { expirationDateTime?: string };
      await service.from("source_connections").update({
        watch_expires_at: payload?.expirationDateTime ?? expiration,
        status: "active",
        last_error: null,
      }).eq("id", connection.id);
      return;
    }
    await service.from("source_connections").update({ watch_resource_id: null, watch_expires_at: null }).eq("id", connection.id);
  }

  const response = await graphFetch(token, `${GRAPH}/subscriptions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      changeType: "created,updated",
      notificationUrl,
      resource: "me/mailFolders('Inbox')/messages",
      expirationDateTime: expiration,
      clientState,
      latestSupportedTlsVersion: "v1_2",
    }),
  });
  const payload = await response.json() as { id: string; expirationDateTime: string };
  await service.from("source_connections").update({
    watch_resource_id: payload.id,
    watch_expires_at: payload.expirationDateTime,
    status: "active",
    last_error: null,
  }).eq("id", connection.id);
}

export async function syncOutlookConnection(
  service: SupabaseClient,
  connection: MailConnection,
  baseCurrency: string,
): Promise<{ scanned: number; inserted: number; duplicates: number; autoPosted: number; needsReview: number; autoIgnored: number }> {
  const accessToken = await getMicrosoftAccessToken(service, connection.id);
  let nextUrl = connection.cursor ?? `${GRAPH}/me/mailFolders/inbox/messages/delta?$select=id,subject,from,receivedDateTime,bodyPreview,isDraft&$top=50`;
  let deltaLink: string | null = connection.cursor;
  let scanned = 0;
  let inserted = 0;
  let duplicates = 0;
  let autoPosted = 0;
  let needsReview = 0;
  let autoIgnored = 0;
  let pageCount = 0;

  while (nextUrl && pageCount < 5) {
    pageCount += 1;
    const response = await graphFetch(accessToken, nextUrl);
    const payload = await response.json() as {
      value?: Array<{
        id: string;
        subject?: string;
        from?: { emailAddress?: { name?: string; address?: string } };
        receivedDateTime?: string;
        bodyPreview?: string;
        isDraft?: boolean;
        "@removed"?: unknown;
      }>;
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    };
    for (const message of payload.value ?? []) {
      if (message.isDraft || message["@removed"]) continue;
      scanned += 1;
      const senderName = message.from?.emailAddress?.name?.trim() ?? "";
      const senderAddress = message.from?.emailAddress?.address?.trim() ?? "";
      const sender = senderName && senderAddress ? `${senderName} <${senderAddress}>` : senderName || senderAddress;
      const parsed = await parseMailMessage({
        provider: "outlook",
        externalId: message.id,
        occurredAt: message.receivedDateTime ?? new Date().toISOString(),
        sender: sender || null,
        title: message.subject ?? null,
        text: message.bodyPreview ?? "",
        defaultCurrency: baseCurrency,
      });
      if (!parsed) continue;
      const result = await ingestCandidate(service, connection.user_id, parsed, connection.id);
      if (result.inserted) inserted += 1;
      if (result.duplicate) duplicates += 1;
    if (result.automation?.outcome === "auto_posted") autoPosted += 1;
    if (result.automation?.outcome === "needs_review") needsReview += 1;
    if (result.automation?.outcome === "auto_ignored") autoIgnored += 1;
    }
    nextUrl = payload["@odata.nextLink"] ?? "";
    deltaLink = payload["@odata.deltaLink"] ?? deltaLink;
  }

  await service.from("source_connections").update({
    cursor: nextUrl || deltaLink,
    last_sync_at: new Date().toISOString(),
    last_error: null,
    status: "active",
  }).eq("id", connection.id);
  return { scanned, inserted, duplicates, autoPosted, needsReview, autoIgnored };
}

async function graphFetch(accessToken: string, url: string, init: RequestInit = {}): Promise<Response> {
  const response = await graphRequest(accessToken, url, init);
  if (!response.ok) throw new Error(`Microsoft Graph ${response.status}: ${await response.text()}`);
  return response;
}

async function graphRequest(accessToken: string, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  return await fetch(url, { ...init, headers });
}
