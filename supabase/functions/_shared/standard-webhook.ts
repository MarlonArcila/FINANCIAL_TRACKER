export class StandardWebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StandardWebhookVerificationError";
  }
}

export interface StandardWebhookVerifyOptions {
  nowMs?: number;
  toleranceSeconds?: number;
}

const DEFAULT_TOLERANCE_SECONDS = 300;
const encoder = new TextEncoder();

export async function verifyWhopStandardWebhookJson<T>(
  rawBody: string,
  headers: Headers | Record<string, string>,
  rawWebhookSecret: string,
  options: StandardWebhookVerifyOptions = {},
): Promise<T> {
  if (!rawWebhookSecret) throw new StandardWebhookVerificationError("Missing webhook secret");

  const messageId = readHeader(headers, "webhook-id");
  const timestampRaw = readHeader(headers, "webhook-timestamp");
  const signaturesRaw = readHeader(headers, "webhook-signature");
  if (!messageId || !timestampRaw || !signaturesRaw) {
    throw new StandardWebhookVerificationError("Missing required webhook headers");
  }
  if (messageId.includes(".")) throw new StandardWebhookVerificationError("Invalid webhook id");
  if (!/^\d+$/u.test(timestampRaw)) throw new StandardWebhookVerificationError("Invalid webhook timestamp");

  const timestampSeconds = Number(timestampRaw);
  if (!Number.isSafeInteger(timestampSeconds)) throw new StandardWebhookVerificationError("Invalid webhook timestamp");
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new StandardWebhookVerificationError("Invalid timestamp tolerance");
  if (Math.abs(nowSeconds - timestampSeconds) > tolerance) {
    throw new StandardWebhookVerificationError("Webhook timestamp outside tolerance");
  }

  // Whop's documented SDK setup passes btoa(WHOP_WEBHOOK_SECRET) as webhookKey.
  // The Standard Webhooks verifier decodes that base64 value back to these raw UTF-8 bytes.
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(rawWebhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signedPayload = encoder.encode(`${messageId}.${timestampRaw}.${rawBody}`);

  let matched = false;
  for (const token of signaturesRaw.trim().split(/\s+/u)) {
    const comma = token.indexOf(",");
    if (comma <= 0) continue;
    const version = token.slice(0, comma);
    if (version !== "v1") continue;
    const encodedSignature = token.slice(comma + 1);
    try {
      const signature = decodeStandardBase64(encodedSignature);
      if (await crypto.subtle.verify("HMAC", key, signature, signedPayload)) {
        matched = true;
        break;
      }
    } catch {
      // Ignore malformed/unsupported entries so key rotation can include other versions.
    }
  }
  if (!matched) throw new StandardWebhookVerificationError("No matching webhook signature");

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new StandardWebhookVerificationError("Webhook payload is not valid JSON");
  }
}

function readHeader(headers: Headers | Record<string, string>, name: string): string | null {
  if (headers instanceof Headers) return headers.get(name);
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && typeof value === "string") return value;
  }
  return null;
}

function decodeStandardBase64(value: string): Uint8Array {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    throw new StandardWebhookVerificationError("Invalid base64 signature");
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
