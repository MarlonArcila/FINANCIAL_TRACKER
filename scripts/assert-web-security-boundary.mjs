import fs from "node:fs";

function fail(message) {
  console.error(`STOP: ${message}`);
  process.exit(1);
}

const policy = fs.readFileSync("apps/web/security-policy.ts", "utf8");
const vite = fs.readFileSync("apps/web/vite.config.ts", "utf8");
const headers = fs.readFileSync("apps/web/public/_headers", "utf8");
const webPackage = JSON.parse(fs.readFileSync("apps/web/package.json", "utf8"));

for (const required of [
  "default-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "script-src 'self'",
  "worker-src 'self'",
]) {
  if (!policy.includes(required)) fail(`csp_directive_missing:${required}`);
}
for (const required of ["Content-Security-Policy", "Referrer-Policy", "X-Content-Type-Options", "Permissions-Policy", "Cross-Origin-Opener-Policy"]) {
  if (!headers.includes(required)) fail(`static_security_header_missing:${required}`);
}
if (!headers.includes("/sw.js") || !headers.includes("no-cache, no-store, must-revalidate")) fail("service_worker_cache_header_missing");
if (!vite.includes("productionSecurityMeta")) fail("vite_csp_meta_fallback_missing");
if (!vite.includes("headers: securityHeaders")) fail("vite_preview_security_headers_missing");
if (webPackage.scripts?.prebuild !== "node --experimental-strip-types scripts/write-static-security-headers.ts") fail("web_prebuild_header_generation_missing");
console.log("WEB_SECURITY_HEADERS_BOUNDARY=GREEN");
