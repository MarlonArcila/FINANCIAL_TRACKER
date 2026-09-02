import assert from "node:assert/strict";
import test from "node:test";
import {
  additionalAllowedCorsOrigin,
  APP_ADDITIONAL_ORIGINS_ENV,
  type EnvReader,
  withAdditionalCors,
} from "./additional-cors.ts";

function env(value?: string): EnvReader {
  return (name) => name === APP_ADDITIONAL_ORIGINS_ENV ? value : undefined;
}

const preview = "https://capitalflow-preview-example.vercel.app";
const production = "https://capitalflow-pilot.vercel.app";

test("allows only an exact configured additional origin", () => {
  assert.equal(additionalAllowedCorsOrigin(preview, env(preview)), preview);
  assert.equal(additionalAllowedCorsOrigin(`${preview}.attacker.example`, env(preview)), null);
});

test("supports comma-separated exact origins", () => {
  assert.equal(additionalAllowedCorsOrigin(preview, env(`${production}, ${preview}`)), preview);
});

test("rejects wildcard and embedded credentials", () => {
  assert.equal(additionalAllowedCorsOrigin(preview, env("*")), null);
  assert.equal(additionalAllowedCorsOrigin("https://u:p@example.com", env("https://u:p@example.com")), null);
});

test("answers OPTIONS for an exact additional origin", async () => {
  const request = new Request("https://project.supabase.co/functions/v1/example", {
    method: "OPTIONS",
    headers: { origin: preview },
  });
  let called = false;
  const response = await withAdditionalCors(request, () => {
    called = true;
    return new Response("unexpected");
  }, env(preview));
  assert.equal(called, false);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), preview);
  assert.equal(response.headers.get("vary"), "Origin");
});

test("wraps a normal response for an exact additional origin", async () => {
  const request = new Request("https://project.supabase.co/functions/v1/example", {
    method: "POST",
    headers: { origin: preview },
  });
  const response = await withAdditionalCors(
    request,
    () => new Response(JSON.stringify({ ok: true }), { status: 201, headers: { "content-type": "application/json" } }),
    env(preview),
  );
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("access-control-allow-origin"), preview);
  assert.deepEqual(await response.json(), { ok: true });
});

test("does not broaden responses for an unconfigured origin", async () => {
  const request = new Request("https://project.supabase.co/functions/v1/example", {
    method: "POST",
    headers: { origin: "https://untrusted.example" },
  });
  const response = await withAdditionalCors(
    request,
    () => new Response("ok", { headers: { "access-control-allow-origin": production } }),
    env(preview),
  );
  assert.equal(response.headers.get("access-control-allow-origin"), production);
});
