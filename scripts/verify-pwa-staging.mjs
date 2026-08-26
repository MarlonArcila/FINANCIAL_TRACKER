const raw = process.env.PILOT_APP_URL ?? process.argv[2];
if (!raw) throw new Error("PILOT_APP_URL_REQUIRED");
const base = new URL(raw);
const allowInsecure = process.env.ALLOW_INSECURE_PILOT_SMOKE === "true";
if (base.protocol !== "https:" && !allowInsecure) throw new Error("PILOT_APP_URL_MUST_USE_HTTPS");
if (base.username || base.password) throw new Error("PILOT_APP_URL_MUST_NOT_CONTAIN_CREDENTIALS");

const rootUrl = new URL("/", base);
const root = await fetch(rootUrl, { redirect: "follow", headers: { "cache-control": "no-cache" } });
if (!root.ok) throw new Error(`PWA_ROOT_HTTP_${root.status}`);
const html = await root.text();
if (!html.includes('rel="manifest"')) throw new Error("PWA_MANIFEST_LINK_MISSING");

const requiredHeaders = {
  "content-security-policy": ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'"],
  "referrer-policy": ["strict-origin-when-cross-origin"],
  "x-content-type-options": ["nosniff"],
  "permissions-policy": ["camera=()", "microphone=()", "geolocation=()"],
};
for (const [name, fragments] of Object.entries(requiredHeaders)) {
  const value = root.headers.get(name) ?? "";
  for (const fragment of fragments) if (!value.includes(fragment)) throw new Error(`PWA_HEADER_MISSING_${name}_${fragment}`);
}

const manifestResponse = await fetch(new URL("/manifest.webmanifest", base), { headers: { "cache-control": "no-cache" } });
if (!manifestResponse.ok) throw new Error(`PWA_MANIFEST_HTTP_${manifestResponse.status}`);
const manifest = await manifestResponse.json();
if (manifest.display !== "standalone" || manifest.scope !== "/" || !Array.isArray(manifest.icons) || manifest.icons.length < 2) {
  throw new Error("PWA_MANIFEST_CONTRACT_INVALID");
}

const swResponse = await fetch(new URL("/sw.js", base), { headers: { "cache-control": "no-cache" } });
if (!swResponse.ok) throw new Error(`PWA_SW_HTTP_${swResponse.status}`);
const sw = await swResponse.text();
if (!sw.includes("capitalflow-shell-") || !sw.includes("v2")) throw new Error("PWA_SW_VERSION_NOT_DEPLOYED");
const swCacheControl = swResponse.headers.get("cache-control") ?? "";
if (!/no-cache|no-store|max-age=0/i.test(swCacheControl)) throw new Error("PWA_SW_CACHE_CONTROL_TOO_AGGRESSIVE");

console.log(`PWA_STAGING_ORIGIN=${base.origin}`);
console.log("PWA_STAGING_SMOKE=GREEN");
