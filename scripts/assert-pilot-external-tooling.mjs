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
console.log("PILOT_EXTERNAL_TOOLING_BOUNDARY=GREEN");
