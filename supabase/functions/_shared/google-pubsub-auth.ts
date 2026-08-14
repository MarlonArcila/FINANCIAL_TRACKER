import { createRemoteJWKSet, jwtVerify } from "npm:jose@6";

import { optionalEnv, requiredEnv } from "./env.ts";
import { HttpError } from "./http.ts";

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

/**
 * Prefer Pub/Sub authenticated push (OIDC). A high-entropy URL token remains
 * available only for local/sandbox setups that cannot mint Google OIDC tokens.
 */
export async function requireGooglePubSubAuth(request: Request): Promise<void> {
  const audience = optionalEnv("GMAIL_PUBSUB_AUDIENCE");
  if (!audience) {
    requireFallbackToken(request);
    return;
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new HttpError(401, "missing_pubsub_bearer_token");
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) throw new HttpError(401, "missing_pubsub_bearer_token");

  try {
    const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
      audience,
      issuer: ["https://accounts.google.com", "accounts.google.com"],
    });
    const expectedEmail = optionalEnv("GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL");
    if (expectedEmail && payload.email !== expectedEmail) {
      throw new HttpError(401, "unexpected_pubsub_service_account");
    }
    if (payload.email && payload.email_verified !== true) {
      throw new HttpError(401, "unverified_pubsub_service_account");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.warn("Invalid Google Pub/Sub OIDC token", error);
    throw new HttpError(401, "invalid_pubsub_oidc_token");
  }
}

function requireFallbackToken(request: Request): void {
  const supplied = new URL(request.url).searchParams.get("token") ?? "";
  const expected = requiredEnv("GMAIL_PUBSUB_TOKEN");
  if (!constantTimeEquals(supplied, expected)) throw new HttpError(401, "invalid_pubsub_token");
}

function constantTimeEquals(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
