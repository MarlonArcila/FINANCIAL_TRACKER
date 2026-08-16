import { HttpError } from "./http.ts";

export function canUseGmailPubSubTokenFallback(environment: string | null): boolean {
  return environment === "local" || environment === "test";
}

export function requireWhopWebhookSecret(secret: string | null): string {
  if (!secret) throw new HttpError(503, "webhook_not_configured");
  return secret;
}

export function verifyConfiguredWhopSignature<T>(configured: boolean, verify: () => T): T {
  if (!configured) throw new HttpError(503, "webhook_not_configured");
  try { return verify(); } catch { throw new HttpError(401, "invalid_webhook_signature"); }
}

export function validateGooglePubSubClaims(payload: { email?: unknown; email_verified?: unknown }, expectedEmail: string | null): void {
  if (!expectedEmail) throw new HttpError(500, "missing_pubsub_service_account_config");
  if (payload.email !== expectedEmail) throw new HttpError(401, "unexpected_pubsub_service_account");
  if (payload.email_verified !== true) throw new HttpError(401, "unverified_pubsub_service_account");
}

export function canConsumeStorageOAuthState(state: { expires_at: string; used_at: string | null }, now = Date.now()): boolean {
  return !state.used_at && Number.isFinite(Date.parse(state.expires_at)) && Date.parse(state.expires_at) > now;
}
