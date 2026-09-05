import { requiredEnv } from "./env.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function randomBase64Url(bytes = 32): string {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes));
  return toBase64Url(buffer);
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toBase64Url(new Uint8Array(digest));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return sha256Base64Url(verifier);
}

export async function encryptSecret(plainText: string): Promise<string> {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plainText));
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(sealed: string | null): Promise<string | null> {
  if (!sealed) return null;
  const [version, ivRaw, dataRaw] = sealed.split(".");
  if (version !== "v1" || !ivRaw || !dataRaw) throw new Error("Unsupported encrypted secret format");
  const key = await encryptionKey();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toOwnedArrayBuffer(fromBase64Url(ivRaw)) },
    key,
    toOwnedArrayBuffer(fromBase64Url(dataRaw)),
  );
  return decoder.decode(plain);
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function encryptionKey(): Promise<CryptoKey> {
  const raw = fromBase64Url(requiredEnv("OAUTH_TOKEN_ENCRYPTION_KEY_B64"));
  if (raw.byteLength !== 32) throw new Error("OAUTH_TOKEN_ENCRYPTION_KEY_B64 must decode to 32 bytes");
  return crypto.subtle.importKey("raw", toOwnedArrayBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}
