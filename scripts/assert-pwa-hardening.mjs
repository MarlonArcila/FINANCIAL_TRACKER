import fs from "node:fs";

function fail(message) {
  console.error(`STOP: ${message}`);
  process.exit(1);
}

const sw = fs.readFileSync("apps/web/public/sw.js", "utf8");
const register = fs.readFileSync("apps/web/src/registerServiceWorker.ts", "utf8");
const manifest = JSON.parse(fs.readFileSync("apps/web/public/manifest.webmanifest", "utf8"));
const shell = fs.readFileSync("apps/web/src/components/AppShell.tsx", "utf8");

if (!sw.includes('CACHE_PREFIX = "capitalflow-shell-"')) fail("cache_prefix_missing");
if (!sw.includes('`${CACHE_PREFIX}v2`')) fail("cache_version_v2_missing");
if (!sw.includes('requestUrl.pathname.startsWith("/assets/")')) fail("immutable_asset_boundary_missing");
if (!sw.includes('requestUrl.pathname === "/sw.js"')) fail("service_worker_self_cache_exclusion_missing");
if (/caches\.match\(event\.request\)/u.test(sw)) fail("generic_cache_every_request_pattern_present");
if (!sw.includes('requestUrl.origin !== self.location.origin')) fail("cross_origin_cache_boundary_missing");
if (!register.includes('updateViaCache: "none"')) fail("service_worker_update_cache_bypass_missing");
if (!register.includes("registration.update()")) fail("service_worker_update_probe_missing");
if (manifest.display !== "standalone" || manifest.scope !== "/") fail("manifest_installability_contract_missing");
if (!Array.isArray(manifest.icons) || manifest.icons.length < 2) fail("manifest_icons_missing");
if (!shell.includes('role="status"') || !shell.includes('aria-live="polite"')) fail("offline_status_accessibility_missing");
console.log("PWA_HARDENING_BOUNDARY=GREEN");
