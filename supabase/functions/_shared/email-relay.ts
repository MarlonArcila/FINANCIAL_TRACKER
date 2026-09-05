import { HttpError } from "./http.ts";

function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export const EMAIL_RELAY_SIGNATURE_TOLERANCE_SECONDS = 300;
export const EMAIL_RELAY_MAX_RAW_BYTES = 524_288;

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", toOwnedArrayBuffer(bytes));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqualHex(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/iu.test(left) || !/^[0-9a-f]{64}$/iu.test(right)) return false;
  const a = left.toLowerCase(); const b = right.toLowerCase();
  let diff = 0;
  for (let i = 0; i < 64; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyRelaySignature(input: {
  secret: string; timestamp: string; nonce: string; signature: string; body: string; nowMs?: number;
}): Promise<void> {
  if (!/^\d{10}$/u.test(input.timestamp)) throw new HttpError(401, "invalid_relay_timestamp");
  if (!/^[0-9a-f-]{36}$/iu.test(input.nonce)) throw new HttpError(401, "invalid_relay_nonce");
  const seconds = Number(input.timestamp);
  const now = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(now - seconds) > EMAIL_RELAY_SIGNATURE_TOLERANCE_SECONDS) throw new HttpError(401, "relay_timestamp_out_of_window");
  const expected = await hmacHex(input.secret, `${input.timestamp}.${input.nonce}.${input.body}`);
  if (!constantTimeEqualHex(expected, input.signature)) throw new HttpError(401, "invalid_relay_signature");
}

export function extractAliasToken(recipient: string, domain: string): string {
  const [local, host, ...extra] = recipient.trim().split("@");
  if (extra.length || !local || !host || host.toLowerCase() !== domain.toLowerCase()) throw new HttpError(404, "relay_alias_not_found");
  const match = /^cf\+([A-Za-z0-9_-]{40,80})$/u.exec(local);
  if (!match) throw new HttpError(404, "relay_alias_not_found");
  return match[1];
}

export function sanitizeRelayHeader(value: unknown, max = 998): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function decodeQuotedPrintable(value: string): string {
  const source=value.replace(/=\r?\n/gu, ""); const bytes:number[]=[]; const encoder=new TextEncoder();
  for (let i=0;i<source.length;i+=1) {
    if (source[i]==="=" && /^[0-9A-F]{2}$/iu.test(source.slice(i+1,i+3))) { bytes.push(Number.parseInt(source.slice(i+1,i+3),16)); i+=2; continue; }
    const encoded=encoder.encode(source[i]); for (const byte of encoded) bytes.push(byte);
  }
  return new TextDecoder("utf-8",{fatal:false}).decode(new Uint8Array(bytes));
}

function decodePart(body: string, encoding: string | null): string {
  const enc=(encoding ?? "").toLowerCase();
  if (enc.includes("base64")) {
    try { const binary=atob(body.replace(/\s+/gu, "")); const bytes=new Uint8Array(binary.length); for(let i=0;i<binary.length;i+=1) bytes[i]=binary.charCodeAt(i); return new TextDecoder("utf-8",{fatal:false}).decode(bytes); } catch { return ""; }
  }
  if (enc.includes("quoted-printable")) return decodeQuotedPrintable(body);
  return body;
}

function htmlToText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/giu," ").replace(/<style[\s\S]*?<\/style>/giu," ")
    .replace(/<br\s*\/?>/giu,"\n").replace(/<\/p>/giu,"\n").replace(/<[^>]+>/gu," ")
    .replace(/&nbsp;/giu," ").replace(/&amp;/giu,"&").replace(/&lt;/giu,"<").replace(/&gt;/giu,">")
    .replace(/[ \t]+/gu," ").replace(/\n{3,}/gu,"\n\n").trim();
}

export function extractTextFromMime(raw: string): string {
  const split = /\r?\n\r?\n/u.exec(raw);
  if (!split || split.index === undefined) return raw.slice(0, 100_000);
  const head=raw.slice(0,split.index); const body=raw.slice(split.index+split[0].length);
  const contentType=/^content-type:\s*([^\r\n]+)/imu.exec(head)?.[1] ?? "text/plain";
  const encoding=/^content-transfer-encoding:\s*([^\r\n]+)/imu.exec(head)?.[1] ?? null;
  const boundary=/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/iu.exec(contentType);
  if (boundary) {
    const marker=`--${boundary[1] ?? boundary[2]}`;
    const parts=body.split(marker).slice(1).map((x)=>x.replace(/^\r?\n/u,"").replace(/\r?\n--\s*$/u,"").trim()).filter(Boolean);
    const texts:string[]=[]; const htmls:string[]=[];
    for (const part of parts) {
      const ps=/\r?\n\r?\n/u.exec(part); if (!ps || ps.index===undefined) continue;
      const ph=part.slice(0,ps.index); const pb=part.slice(ps.index+ps[0].length);
      const ct=/^content-type:\s*([^\r\n]+)/imu.exec(ph)?.[1]?.toLowerCase() ?? "text/plain";
      if (/attachment/iu.test(ph) || /name\s*=/iu.test(ct)) continue;
      const pe=/^content-transfer-encoding:\s*([^\r\n]+)/imu.exec(ph)?.[1] ?? null;
      const decoded=decodePart(pb,pe);
      if (ct.startsWith("text/plain")) texts.push(decoded);
      else if (ct.startsWith("text/html")) htmls.push(htmlToText(decoded));
    }
    return (texts.length ? texts : htmls).join("\n\n").replace(/\u0000/gu,"").slice(0,100_000).trim();
  }
  const decoded=decodePart(body,encoding);
  return (contentType.toLowerCase().startsWith("text/html") ? htmlToText(decoded) : decoded).replace(/\u0000/gu,"").slice(0,100_000).trim();
}

export function detectGmailForwardingConfirmation(subject: string | null, text: string): { url: string | null; code: string | null } | null {
  const combined=`${subject ?? ""}\n${text}`;
  if (!/(gmail.{0,30}forwarding|forwarding.{0,30}confirmation|confirmaci[oó]n.{0,30}reenv[ií]o|reenv[ií]o.{0,30}gmail)/iu.test(combined)) return null;
  const urls=combined.match(/https:\/\/[^\s<>"']+/giu) ?? [];
  let safeUrl:string|null=null;
  for (const raw of urls) {
    try {
      const u=new URL(raw.replace(/[),.;]+$/u,""));
      if (u.protocol==="https:" && (u.hostname==="google.com" || u.hostname.endsWith(".google.com"))) { safeUrl=u.toString(); break; }
    } catch { /* ignore malformed candidates */ }
  }
  const codeMatch=/(?:confirmation|confirmaci[oó]n|verification|verificaci[oó]n|code|c[oó]digo)[^A-Za-z0-9]{0,20}([A-Za-z0-9-]{6,32})/iu.exec(combined);
  return { url:safeUrl, code:codeMatch?.[1] ?? null };
}

export type RelaySourceIdentity = {
  aliasId: string | null;
  sourceId: string | null;
  providerHint: string | null;
};

export function isDifferentRelaySource(left: RelaySourceIdentity, right: RelaySourceIdentity): boolean {
  if (!left.aliasId || !right.aliasId || left.aliasId !== right.aliasId) return false;
  if (left.sourceId && right.sourceId) return left.sourceId !== right.sourceId;
  const a=(left.providerHint ?? "").trim().toLowerCase();
  const b=(right.providerHint ?? "").trim().toLowerCase();
  if (!a || !b || a === "other" || b === "other") return false;
  return a !== b;
}

export function decodeBase64Bytes(value: string): Uint8Array {
  const binary=atob(value); const out=new Uint8Array(binary.length);
  for (let i=0;i<binary.length;i+=1) out[i]=binary.charCodeAt(i);
  return out;
}
