const MAX_RAW_BYTES = 524_288;
const FETCH_TIMEOUT_MS = 12_000;

function sanitize(value, max = 4_000) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : null;
}
function hex(buffer) { return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
export async function sha256Hex(bytes) { return hex(await crypto.subtle.digest("SHA-256", bytes)); }
export async function sign(secret, timestamp, nonce, body) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + "." + nonce + "." + body)));
}
function bytesToBase64(bytes) { let output = ""; for (let index = 0; index < bytes.length; index += 0x8000) output += String.fromCharCode(...bytes.subarray(index, index + 0x8000)); return btoa(output); }
export function detectForwardingProvider(headers) {
  const received = (headers.get("received") ?? "").toLowerCase();
  const auth = ((headers.get("authentication-results") ?? "") + " " + (headers.get("arc-authentication-results") ?? "")).toLowerCase();
  if (headers.has("x-google-smtp-source") || headers.has("x-gm-message-state") || /(?:^|[.\s-])google\.com|gmail\.com/.test(received)) return "gmail";
  if (headers.has("x-ms-exchange-crosstenant-authsource") || /protection\.outlook\.com|outlook\.com|office365\.com/.test(received + " " + auth)) return "outlook";
  if (headers.has("x-pm-message-id") || /protonmail\.(?:com|ch)|proton\.me/.test(received + " " + auth)) return "proton";
  return "other";
}
export function validBackendUrl(value) { try { const url = new URL(value); return url.protocol === "https:" && url.hostname.endsWith(".supabase.co") && url.pathname === "/functions/v1/email-relay-ingest"; } catch { return false; } }
export async function buildRelayPayload(message) {
  if (message.rawSize > MAX_RAW_BYTES) throw new Error("relay_message_too_large");
  const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
  if (raw.byteLength > MAX_RAW_BYTES) throw new Error("relay_message_too_large");
  return { recipient: sanitize(message.to, 320), envelopeSender: sanitize(message.from, 320), from: sanitize(message.headers.get("from"), 998), messageId: sanitize(message.headers.get("message-id"), 998), date: sanitize(message.headers.get("date"), 998), subject: sanitize(message.headers.get("subject"), 998), forwardingProviderHint: detectForwardingProvider(message.headers), authentication: { authenticationResults: sanitize(message.headers.get("authentication-results")), arcAuthenticationResults: sanitize(message.headers.get("arc-authentication-results")), receivedSpf: sanitize(message.headers.get("received-spf"), 2000), arcSeal: sanitize(message.headers.get("arc-seal"), 2000), dkimSignature: sanitize(message.headers.get("dkim-signature"), 2000) }, receivedAt: new Date().toISOString(), rawSha256: await sha256Hex(raw), rawMimeBase64: bytesToBase64(raw) };
}
function safeFailure(code) { console.error(JSON.stringify({ event: "relay.worker.failure", code })); }
export default {
  async email(message, env) {
    if (message.rawSize > MAX_RAW_BYTES) { message.setReject("Message exceeds CapitalFlow relay size limit"); return; }
    const backend = env.CAPITALFLOW_EMAIL_RELAY_BACKEND_URL;
    if (!env.CAPITALFLOW_EMAIL_RELAY_HMAC_SECRET || !env.CAPITALFLOW_EMAIL_RELAY_DOMAIN || !validBackendUrl(backend)) { safeFailure("configuration_invalid"); message.setReject("CapitalFlow relay is unavailable"); return; }
    try {
      const payload = await buildRelayPayload(message);
      if (!payload.recipient || !payload.recipient.toLowerCase().endsWith("@" + env.CAPITALFLOW_EMAIL_RELAY_DOMAIN.toLowerCase())) { message.setReject("Invalid CapitalFlow relay domain"); return; }
      const body = JSON.stringify(payload); const timestamp = String(Math.floor(Date.now() / 1000)); const nonce = crypto.randomUUID();
      const signature = await sign(env.CAPITALFLOW_EMAIL_RELAY_HMAC_SECRET, timestamp, nonce, body);
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let response; try { response = await fetch(backend, { method: "POST", headers: { "content-type": "application/json", "x-capitalflow-timestamp": timestamp, "x-capitalflow-nonce": nonce, "x-capitalflow-signature": signature, "x-capitalflow-key-id": env.CAPITALFLOW_EMAIL_RELAY_KEY_ID || "current" }, body, signal: controller.signal }); } finally { clearTimeout(timeout); }
      if (!response.ok) { safeFailure("backend_" + response.status); message.setReject("CapitalFlow could not process this message"); }
    } catch (error) { safeFailure(error instanceof Error && error.name === "AbortError" ? "backend_timeout" : "processing_failed"); message.setReject("CapitalFlow could not process this message"); }
  },
};