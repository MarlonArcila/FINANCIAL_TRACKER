import assert from "node:assert/strict";
import test from "node:test";

import { keyFromSupabaseMap, publishableKey, serviceKey, type EnvReader } from "./env.ts";

function from(values: Record<string, string | undefined>): EnvReader {
  return (name) => values[name];
}

test("prefers Supabase hosted secret and publishable key maps", () => {
  const read = from({
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: "hosted-secret" }),
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "hosted-publishable" }),
    SUPABASE_SECRET_KEY: "local-secret",
    SUPABASE_PUBLISHABLE_KEY: "local-publishable",
    SUPABASE_SERVICE_ROLE_KEY: "legacy-service-role",
    SUPABASE_ANON_KEY: "legacy-anon",
  });
  assert.equal(serviceKey(read), "hosted-secret");
  assert.equal(publishableKey(read), "hosted-publishable");
});

test("uses local single keys before legacy credentials", () => {
  const read = from({
    SUPABASE_SECRET_KEY: "local-secret",
    SUPABASE_PUBLISHABLE_KEY: "local-publishable",
    SUPABASE_SERVICE_ROLE_KEY: "legacy-service-role",
    SUPABASE_ANON_KEY: "legacy-anon",
  });
  assert.equal(serviceKey(read), "local-secret");
  assert.equal(publishableKey(read), "local-publishable");
});

test("falls back to legacy credentials only when current values are absent", () => {
  const read = from({ SUPABASE_SERVICE_ROLE_KEY: "legacy-service-role", SUPABASE_ANON_KEY: "legacy-anon" });
  assert.equal(serviceKey(read), "legacy-service-role");
  assert.equal(publishableKey(read), "legacy-anon");
});

test("rejects malformed or incomplete hosted key maps", () => {
  assert.throws(() => keyFromSupabaseMap("SUPABASE_SECRET_KEYS", from({ SUPABASE_SECRET_KEYS: "not-json" })), /Invalid JSON/);
  assert.throws(() => keyFromSupabaseMap("SUPABASE_SECRET_KEYS", from({ SUPABASE_SECRET_KEYS: JSON.stringify({ secondary: "key" }) })), /default key/);
});
