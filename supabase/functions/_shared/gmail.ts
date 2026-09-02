import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { optionalEnv, requiredEnv } from "./env.ts";
import { parseMailMessage } from "./financial-parser.ts";
import { ingestCandidate } from "./ingestion.ts";
import { loadTokens, saveTokens, type OAuthTokenSet } from "./tokens.ts";

export interface MailConnection {
  id: string;
  user_id: string;
  provider: "gmail";
  email_address: string | null;
  cursor: string | null;
  watch_resource_id: string | null;
  watch_expires_at: string | null;
  last_sync_at?: string | null;
}

export async function exchangeGoogleCode(code: string, codeVerifier: string): Promise<OAuthTokenSet> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: requiredEnv("GOOGLE_REDIRECT_URI"),
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") throw new Error(`google_token_exchange_${response.status}`);
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : null,
    expiresAt: typeof payload.expires_in === "number" ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : null,
  };
}

export async function googleProfile(accessToken: string): Promise<{ emailAddress: string; historyId: string }> {
  const response = await googleFetch(accessToken, "https://gmail.googleapis.com/gmail/v1/users/me/profile");
  return await response.json() as { emailAddress: string; historyId: string };
}

export async function getGoogleAccessToken(service: SupabaseClient, connectionId: string): Promise<string> {
  const tokens = await loadTokens(service, connectionId);
  if (!tokens.expiresAt || Date.parse(tokens.expiresAt) > Date.now() + 60_000) return tokens.accessToken;
  if (!tokens.refreshToken) throw new Error("Google refresh token missing; reconnect Gmail");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      refresh_token: tokens.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") throw new Error(`google_token_refresh_${response.status}`);
  await saveTokens(service, connectionId, {
    accessToken: payload.access_token,
    refreshToken: tokens.refreshToken,
    expiresAt: typeof payload.expires_in === "number" ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : null,
  });
  return payload.access_token;
}

export async function configureGmailWatch(
  service: SupabaseClient,
  connection: MailConnection,
  accessToken?: string,
): Promise<void> {
  const topicName = optionalEnv("GMAIL_PUBSUB_TOPIC");
  if (!topicName) throw new Error("gmail_pubsub_topic_not_configured");
  const token = accessToken ?? await getGoogleAccessToken(service, connection.id);
  const response = await googleFetch(token, "https://gmail.googleapis.com/gmail/v1/users/me/watch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topicName, labelIds: ["INBOX"], labelFilterBehavior: "include" }),
  });
  const payload = await response.json() as { historyId?: string; expiration?: string };
  const { error: watchUpdateError } = await service.from("source_connections").update({
    cursor: payload.historyId ?? connection.cursor,
    watch_resource_id: topicName,
    watch_expires_at: payload.expiration ? new Date(Number(payload.expiration)).toISOString() : null,
    status: "active",
    last_error: null,
  }).eq("id", connection.id);

  if (watchUpdateError) throw watchUpdateError;
}

export async function syncGmailConnection(
  service: SupabaseClient,
  connection: MailConnection,
  baseCurrency: string,
): Promise<{ scanned: number; inserted: number; duplicates: number; autoPosted: number; needsReview: number; autoIgnored: number }> {
  const accessToken = await getGoogleAccessToken(service, connection.id);
  let messageIds: string[] = [];
  let newestHistoryId = connection.cursor;
  let historyUnavailable = false;
  const needsInitialBackfill = !connection.last_sync_at;

  if (connection.cursor && !needsInitialBackfill) {
    try {
      const historyUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/history");
      historyUrl.searchParams.set("startHistoryId", connection.cursor);
      historyUrl.searchParams.set("historyTypes", "messageAdded");
      historyUrl.searchParams.set("labelId", "INBOX");
      historyUrl.searchParams.set("maxResults", "100");
      const response = await googleFetch(accessToken, historyUrl.toString());
      const payload = await response.json() as {
        history?: Array<{ messagesAdded?: Array<{ message?: { id?: string } }> }>;
        historyId?: string;
      };
      messageIds = [...new Set((payload.history ?? []).flatMap((item) => item.messagesAdded ?? []).map((item) => item.message?.id).filter((id): id is string => Boolean(id)))];
      newestHistoryId = payload.historyId ?? newestHistoryId;
    } catch (error) {
      console.warn("Gmail history fallback");
      historyUnavailable = true;
      messageIds = [];
    }
  }

  if (!connection.cursor || needsInitialBackfill || historyUnavailable) {
    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("maxResults", optionalEnv("GMAIL_MAX_RESULTS") ?? "100");
    listUrl.searchParams.set("labelIds", "INBOX");
    listUrl.searchParams.set("q", optionalEnv("GMAIL_QUERY") ?? "newer_than:30d {compra pago abono transferencia debitado debito retiro pagaste recibiste consignacion deposito charged purchase withdrawal credited received transaction}");
    const response = await googleFetch(accessToken, listUrl.toString());
    const payload = await response.json() as { messages?: Array<{ id: string }> };
    messageIds = (payload.messages ?? []).map((message) => message.id);
  }

  let inserted = 0;
  let duplicates = 0;
  let autoPosted = 0;
  let needsReview = 0;
  let autoIgnored = 0;
  let scanned = 0;
  for (const id of messageIds.slice(0, 100)) {
    const messageUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`);
    messageUrl.searchParams.set("format", "metadata");
    for (const header of ["From", "Subject", "Date"]) messageUrl.searchParams.append("metadataHeaders", header);
    const response = await googleFetch(accessToken, messageUrl.toString());
    const message = await response.json() as {
      id: string;
      internalDate?: string;
      historyId?: string;
      snippet?: string;
      payload?: { headers?: Array<{ name: string; value: string }> };
    };
    scanned += 1;
    newestHistoryId = maxNumericString(newestHistoryId, message.historyId ?? null);
    const headers = new Map((message.payload?.headers ?? []).map((header) => [header.name.toLowerCase(), header.value]));
    const parsed = await parseMailMessage({
      provider: "gmail",
      externalId: message.id,
      occurredAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : headers.get("date") ?? new Date().toISOString(),
      sender: headers.get("from") ?? null,
      title: headers.get("subject") ?? null,
      text: message.snippet ?? "",
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

  if (!newestHistoryId) {
    const profile = await googleProfile(accessToken);
    newestHistoryId = profile.historyId;
  }
  await service.from("source_connections").update({
    cursor: newestHistoryId,
    last_sync_at: new Date().toISOString(),
    last_error: null,
    status: "active",
  }).eq("id", connection.id);
  return { scanned, inserted, duplicates, autoPosted, needsReview, autoIgnored };
}

async function googleFetch(accessToken: string, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) throw new Error(`gmail_api_${response.status}`);
  return response;
}

function maxNumericString(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  try { return BigInt(left) >= BigInt(right) ? left : right; } catch { return right; }
}
