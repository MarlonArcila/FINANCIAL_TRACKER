import { requireSupabase } from "./supabase";

const PREFIX = "capitalflow.cache.v1";
const LAST_SYNC_KEY = "capitalflow.last-sync.v1";
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

interface CacheEnvelope<T> {
  ownerId: string;
  scope: string;
  savedAt: string;
  value: T;
}

export interface CacheFallbackDetail {
  scope: string;
  savedAt: string;
}

/**
 * Runs a user-scoped read online first and falls back to a recent local snapshot.
 * Subscription entitlement is intentionally never routed through this helper.
 */
export async function cachedUserQuery<T>(
  scope: string,
  loader: () => Promise<T>,
  explicitOwnerId?: string,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
): Promise<T> {
  const ownerId = explicitOwnerId ?? await currentOwnerId();
  try {
    const value = await loader();
    const savedAt = new Date().toISOString();
    writeEnvelope({ ownerId, scope, savedAt, value });
    localStorage.setItem(LAST_SYNC_KEY, savedAt);
    window.dispatchEvent(new CustomEvent("capitalflow:cache-refreshed", { detail: { scope, savedAt } }));
    return value;
  } catch (error) {
    const cached = readEnvelope<T>(ownerId, scope, maxAgeMs);
    if (!cached) throw error;
    window.dispatchEvent(new CustomEvent<CacheFallbackDetail>("capitalflow:cache-fallback", {
      detail: { scope, savedAt: cached.savedAt },
    }));
    return cached.value;
  }
}

export function getLastSuccessfulSync(): string | null {
  return localStorage.getItem(LAST_SYNC_KEY);
}

export function clearFinancialCache(): void {
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(`${PREFIX}:`) || key === LAST_SYNC_KEY) localStorage.removeItem(key);
  }
}

function writeEnvelope<T>(envelope: CacheEnvelope<T>): void {
  try {
    localStorage.setItem(cacheKey(envelope.ownerId, envelope.scope), JSON.stringify(envelope));
  } catch {
    // Storage quotas or privacy modes must not break the live application.
  }
}

function readEnvelope<T>(ownerId: string, scope: string, maxAgeMs: number): CacheEnvelope<T> | null {
  try {
    const raw = localStorage.getItem(cacheKey(ownerId, scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CacheEnvelope<T>>;
    if (parsed.ownerId !== ownerId || parsed.scope !== scope || typeof parsed.savedAt !== "string") return null;
    const age = Date.now() - Date.parse(parsed.savedAt);
    if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return null;
    return parsed as CacheEnvelope<T>;
  } catch {
    return null;
  }
}

async function currentOwnerId(): Promise<string> {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) throw error;
  const ownerId = data.session?.user.id;
  if (!ownerId) throw new Error("Sesión requerida.");
  return ownerId;
}

function cacheKey(ownerId: string, scope: string): string {
  return `${PREFIX}:${ownerId}:${scope}`;
}
