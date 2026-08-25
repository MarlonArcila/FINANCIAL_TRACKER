export type EnvReader = (name: string) => string | undefined;

const readDenoEnv: EnvReader = (name) => Deno.env.get(name);

export function requiredEnv(name: string, read: EnvReader = readDenoEnv): string {
  const value = optionalEnv(name, read);
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function optionalEnv(name: string, read: EnvReader = readDenoEnv): string | null {
  return read(name)?.trim() || null;
}

/**
 * Resolves a named key from Supabase's hosted JSON key maps. A configured map
 * must be valid and contain the requested non-empty key; silently falling back
 * could accidentally select a stale local or legacy credential in production.
 */
export function keyFromSupabaseMap(
  name: string,
  read: EnvReader = readDenoEnv,
  keyName = "default",
): string | null {
  const raw = optionalEnv(name, read);
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in environment variable ${name}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Environment variable ${name} must be a JSON object`);
  }

  const value = (parsed as Record<string, unknown>)[keyName];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Environment variable ${name} must contain a non-empty ${keyName} key`);
  }
  return value.trim();
}

function resolveSupabaseKey(mapName: string, localName: string, legacyName: string, read: EnvReader): string {
  return keyFromSupabaseMap(mapName, read)
    ?? optionalEnv(localName, read)
    ?? requiredEnv(legacyName, read);
}

/** Hosted named key map -> local CLI single key -> legacy service_role key. */
export function serviceKey(read: EnvReader = readDenoEnv): string {
  const keyName = optionalEnv("CAPITALFLOW_SUPABASE_SECRET_KEY_NAME", read) ?? "default";
  return keyFromSupabaseMap("SUPABASE_SECRET_KEYS", read, keyName)
    ?? optionalEnv("SUPABASE_SECRET_KEY", read)
    ?? requiredEnv("SUPABASE_SERVICE_ROLE_KEY", read);
}

/** Hosted current key map -> local CLI single key -> legacy anon key. */
export function publishableKey(read: EnvReader = readDenoEnv): string {
  return resolveSupabaseKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", read);
}
