import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const functionsRoot = path.join(root, "supabase", "functions");
const httpPath = path.join(functionsRoot, "_shared", "http.ts");
const http = fs.readFileSync(httpPath, "utf8");

function fail(message) {
  console.error(`STOP: ${message}`);
  process.exit(1);
}

if (/access-control-allow-origin["']?\s*:\s*["']\*["']/iu.test(http)) fail("wildcard_access_control_allow_origin_in_shared_http");
if (!http.includes('optionalEnv("APP_URL"')) fail("shared_http_does_not_bind_cors_to_app_url");
if (!http.includes('request.headers.get("origin")')) fail("preflight_origin_not_checked");
if (!http.includes('requestOrigin !== allowedOrigin')) fail("preflight_exact_origin_comparison_missing");
if (!http.includes('"vary": "Origin"')) fail("vary_origin_missing");
if (!http.includes('status: 403')) fail("disallowed_preflight_does_not_fail_closed");
if (!http.includes('status: 204')) fail("allowed_preflight_status_not_204");
for (const required of ["authorization", "x-client-info", "apikey", "content-type", "x-retry-count", "traceparent", "tracestate", "baggage"]) {
  if (!http.includes(required)) fail(`required_cors_header_missing:${required}`);
}

const offenders = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && /\.(?:ts|js|mjs)$/u.test(entry.name)) {
      const source = fs.readFileSync(full, "utf8");
      if (/access-control-allow-origin["']?\s*:\s*["']\*["']/iu.test(source)) offenders.push(path.relative(root, full));
    }
  }
}
walk(functionsRoot);
if (offenders.length) fail(`wildcard_cors_found:${offenders.join(",")}`);
console.log("EDGE_CORS_ORIGIN_BOUNDARY=GREEN");
