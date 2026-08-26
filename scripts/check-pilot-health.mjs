const supabaseUrl = process.env.SUPABASE_URL;
const cronSecret = process.env.CRON_SECRET;
if (!supabaseUrl) throw new Error("SUPABASE_URL_REQUIRED");
if (!cronSecret) throw new Error("CRON_SECRET_REQUIRED");

const endpoint = new URL("/functions/v1/health-status", supabaseUrl);
const response = await fetch(endpoint, {
  method: "GET",
  headers: { "x-cron-secret": cronSecret, "cache-control": "no-cache" },
});
let data;
try { data = await response.json(); } catch { throw new Error(`HEALTH_NON_JSON_HTTP_${response.status}`); }
if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("HEALTH_PAYLOAD_INVALID");
const status = String(data.status ?? "unknown");
if (!new Set(["healthy", "warning", "degraded"]).has(status)) throw new Error(`HEALTH_STATUS_INVALID_${status}`);
if (status === "degraded" || response.status === 503) {
  console.error(JSON.stringify({
    status,
    criticalIssues: data.criticalIssues ?? null,
    warningIssues: data.warningIssues ?? null,
  }));
  throw new Error("PILOT_HEALTH_DEGRADED");
}
if (!response.ok) throw new Error(`HEALTH_HTTP_${response.status}`);
console.log(`PILOT_HEALTH_STATUS=${status}`);
console.log(`PILOT_HEALTH_WARNINGS=${Number(data.warningIssues ?? 0)}`);
console.log("PILOT_HEALTH_CHECK=GREEN");
