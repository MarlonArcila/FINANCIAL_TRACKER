import fs from "node:fs";

const required = [
  "scripts/pilot-lib.mjs",
  "scripts/pilot-rls-real-users.mjs",
  "scripts/pilot-google-drive-e2e.mjs",
  "scripts/pilot-whop-e2e.mjs",
  "scripts/pilot-cors-runtime-release.sh",
  "scripts/pilot-android-device-e2e.sh",
  "scripts/pilot-legal-privacy.mjs",
  "scripts/edge-http-deploy-closure.mjs",
  "scripts/pilot-readiness.sh",
];
for (const file of required) if (!fs.existsSync(file)) throw new Error(`PILOT_TOOL_MISSING_${file}`);
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
for (const name of ["pilot:rls", "pilot:drive", "pilot:whop", "pilot:cors-runtime", "pilot:android-device", "pilot:legal", "pilot:readiness"]) {
  if (!packageJson.scripts?.[name]) throw new Error(`PACKAGE_SCRIPT_MISSING_${name}`);
}
const cap = fs.readFileSync("apps/web/capacitor.config.ts", "utf8");
if (!cap.includes("CAPACITOR_APP_ID")) throw new Error("CAPACITOR_APP_ID_NOT_CONFIGURABLE");
const apk = fs.readFileSync("scripts/build-signed-apk.sh", "utf8");
if (!apk.includes("EXAMPLE_ANDROID_APP_ID_NOT_ALLOWED")) throw new Error("ANDROID_RELEASE_EXAMPLE_ID_GUARD_MISSING");
const pilotLib = fs.readFileSync("scripts/pilot-lib.mjs", "utf8");
if (!pilotLib.includes('service.rpc("service_apply_whop_membership"')) throw new Error("PILOT_FIXTURE_SERVICE_RPC_MISSING");
if (pilotLib.includes('.from("subscriptions").insert')) throw new Error("PILOT_FIXTURE_DIRECT_SUBSCRIPTION_DML_PRESENT");
const whopE2e = fs.readFileSync("scripts/pilot-whop-e2e.mjs", "utf8");
if (whopE2e.includes('ctx.service.from("subscriptions")')) throw new Error("WHOP_E2E_BYPASSES_USER_RLS");
const driveE2e = fs.readFileSync("scripts/pilot-google-drive-e2e.mjs", "utf8");
if (!driveE2e.includes("DRIVE_AUTHORIZATION_URL_MISSING_APPDATA_SCOPE")) throw new Error("DRIVE_REQUESTED_SCOPE_ASSERTION_MISSING");
const corsRuntime = fs.readFileSync("scripts/pilot-cors-runtime-release.sh", "utf8");
if (corsRuntime.includes("awk -F':'")) throw new Error("CORS_RUNTIME_HTTPS_HEADER_TRUNCATION_PRESENT");
if (!corsRuntime.includes('index($0, ":")')) throw new Error("CORS_RUNTIME_FIRST_COLON_PARSER_MISSING");
const vercelConfig = JSON.parse(fs.readFileSync("apps/web/vercel.json", "utf8"));
if (vercelConfig.installCommand !== "cd ../.. && npm ci") throw new Error("VERCEL_MONOREPO_ROOT_INSTALL_COMMAND_MISSING");
if (vercelConfig.buildCommand !== "cd ../.. && npm run build -w @capitalflow/core && npm run build -w @capitalflow/web") throw new Error("VERCEL_MONOREPO_ROOT_BUILD_COMMAND_MISSING");
if (vercelConfig.outputDirectory !== "dist") throw new Error("VERCEL_WEB_OUTPUT_DIRECTORY_INVALID");
console.log("VERCEL_MONOREPO_WORKSPACE_INSTALL_BOUNDARY=GREEN");
console.log("PILOT_EXTERNAL_TOOLING_BOUNDARY=GREEN");
