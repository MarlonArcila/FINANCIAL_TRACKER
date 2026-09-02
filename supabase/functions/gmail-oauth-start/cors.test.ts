import assert from "node:assert/strict";
import test from "node:test";
import {
  additionalAllowedCorsOrigin,
  GMAIL_OAUTH_ADDITIONAL_ORIGINS_ENV,
  isAllowedGmailOauthReturnOrigin,
  type EnvReader,
} from "./cors.ts";

function env(value?: string): EnvReader {
  return (name) => name === GMAIL_OAUTH_ADDITIONAL_ORIGINS_ENV ? value : undefined;
}

test("allows an exact configured preview origin", () => {
  const origin = "https://capitalflow-pilot-mqtevjpzj-arcilalarrea-3167.vercel.app";
  assert.equal(additionalAllowedCorsOrigin(origin, env(origin)), origin);
});

test("allows one exact origin from a comma-separated allowlist", () => {
  const preview = "https://capitalflow-pilot-mqtevjpzj-arcilalarrea-3167.vercel.app";
  const other = "https://capitalflow-pilot-second-arcilalarrea-3167.vercel.app";
  assert.equal(additionalAllowedCorsOrigin(preview, env(`${other}, ${preview}`)), preview);
});

test("rejects a Vercel sibling that was not explicitly configured", () => {
  const allowed = "https://capitalflow-pilot-mqtevjpzj-arcilalarrea-3167.vercel.app";
  const sibling = "https://capitalflow-pilot-attacker-arcilalarrea-3167.vercel.app";
  assert.equal(additionalAllowedCorsOrigin(sibling, env(allowed)), null);
});

test("rejects wildcard configuration", () => {
  const origin = "https://capitalflow-pilot.vercel.app";
  assert.equal(additionalAllowedCorsOrigin(origin, env("*")), null);
});

test("normalizes configured URLs to exact origins", () => {
  const origin = "https://capitalflow-pilot.vercel.app";
  assert.equal(
    additionalAllowedCorsOrigin(origin, env("https://capitalflow-pilot.vercel.app/path?q=1#x")),
    origin,
  );
});

test("rejects non-http schemes and embedded credentials", () => {
  assert.equal(additionalAllowedCorsOrigin("ftp://capitalflow-pilot.vercel.app", env("ftp://capitalflow-pilot.vercel.app")), null);
  assert.equal(additionalAllowedCorsOrigin("https://user:pass@capitalflow-pilot.vercel.app", env("https://user:pass@capitalflow-pilot.vercel.app")), null);
});

test("allows production APP_URL origin for OAuth return", () => {
  const production = "https://capitalflow-pilot.vercel.app";
  assert.equal(isAllowedGmailOauthReturnOrigin(production, production, env()), true);
});

test("allows an exactly configured preview origin for OAuth return", () => {
  const production = "https://capitalflow-pilot.vercel.app";
  const preview = "https://capitalflow-pilot-mqtevjpzj-arcilalarrea-3167.vercel.app";
  assert.equal(isAllowedGmailOauthReturnOrigin(preview, production, env(preview)), true);
});

test("rejects an unconfigured sibling preview as OAuth return", () => {
  const production = "https://capitalflow-pilot.vercel.app";
  const configured = "https://capitalflow-pilot-mqtevjpzj-arcilalarrea-3167.vercel.app";
  const sibling = "https://capitalflow-pilot-attacker-arcilalarrea-3167.vercel.app";
  assert.equal(isAllowedGmailOauthReturnOrigin(sibling, production, env(configured)), false);
});

test("does not turn wildcard configuration into an OAuth return allowlist", () => {
  const production = "https://capitalflow-pilot.vercel.app";
  const preview = "https://capitalflow-pilot-mqtevjpzj-arcilalarrea-3167.vercel.app";
  assert.equal(isAllowedGmailOauthReturnOrigin(preview, production, env("*")), false);
});
