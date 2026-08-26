import assert from "node:assert/strict";
import test from "node:test";

import { allowedCorsOrigin, corsHeaders, handleOptions } from "./http.ts";

function env(appUrl?: string) {
  return (name: string): string | undefined => name === "APP_URL" ? appUrl : undefined;
}

test("normalizes APP_URL to one exact HTTP(S) origin", () => {
  assert.equal(allowedCorsOrigin(env("https://app.example.com/path?q=1#hash")), "https://app.example.com");
  assert.equal(allowedCorsOrigin(env("http://localhost:5173/#/dashboard")), "http://localhost:5173");
});

test("fails closed when APP_URL is missing, invalid, credentialed, or non-http", () => {
  assert.equal(allowedCorsOrigin(env()), null);
  assert.equal(allowedCorsOrigin(env("*")), null);
  assert.equal(allowedCorsOrigin(env("ftp://app.example.com")), null);
  assert.equal(allowedCorsOrigin(env("https://user:pass@app.example.com")), null);
  assert.equal(corsHeaders(env())["access-control-allow-origin"], undefined);
});

test("allows preflight only from the configured exact origin", () => {
  const read = env("https://app.example.com/dashboard");
  const allowed = handleOptions(new Request("https://project.supabase.co/functions/v1/example", {
    method: "OPTIONS",
    headers: { origin: "https://app.example.com" },
  }), read);
  assert.ok(allowed);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://app.example.com");
  assert.equal(allowed.headers.get("vary"), "Origin");

  const denied = handleOptions(new Request("https://project.supabase.co/functions/v1/example", {
    method: "OPTIONS",
    headers: { origin: "https://evil.example" },
  }), read);
  assert.ok(denied);
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

test("non-OPTIONS requests pass through the preflight helper", () => {
  const response = handleOptions(new Request("https://project.supabase.co/functions/v1/example", {
    method: "POST",
    headers: { origin: "https://app.example.com" },
  }), env("https://app.example.com"));
  assert.equal(response, null);
});
