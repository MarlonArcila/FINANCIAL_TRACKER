import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function requireMatch(condition, message) { if (!condition) throw new Error(message); }

const checkout = read("supabase/functions/whop-checkout/index.ts");
const webhook = read("supabase/functions/whop-webhook/index.ts");
const gate = read("apps/web/src/components/SubscriptionGate.tsx");
const page = read("apps/web/src/pages/SubscriptionPage.tsx");
const env = read("apps/web/src/lib/env.ts");
const integrations = read("apps/web/src/pages/IntegrationsPage.tsx");
const build = read("scripts/build-android-distribution-artifacts.sh");

requireMatch(checkout.includes("app_user_id: user.id"), "Whop checkout must carry the authenticated CapitalFlow user id");
requireMatch(checkout.includes("checkout=complete"), "Whop checkout must return to the subscription reconciliation route");
requireMatch(webhook.includes("service_apply_whop_membership"), "Whop webhook must apply membership server-side");
requireMatch(gate.includes("checkout=complete") && gate.includes("CHECKOUT_POLL_ATTEMPTS"), "checkout return must poll entitlement automatically");
requireMatch(page.includes("env.androidPlayUrl") && page.includes("env.androidApkUrl"), "active subscription page must expose Android distribution channels");
requireMatch(page.includes("active ?") && page.includes("android-distribution-panel"), "Android distribution must remain behind active subscription UI");
requireMatch(env.includes("VITE_ANDROID_PLAY_URL") && env.includes("VITE_ANDROID_APK_URL"), "Android distribution environment variables missing");
requireMatch(integrations.includes("requestNotificationAccess") && integrations.includes("parser trabaja localmente"), "notification access needs prominent disclosure before settings");
requireMatch(build.includes("assembleRelease bundleRelease"), "Android distribution build must produce APK and AAB");
requireMatch(build.includes("apksigner") && build.includes("jarsigner"), "APK and AAB signing checks missing");
console.log("ANDROID_DISTRIBUTION_WHOP_AUTOMATION_CONTRACT=PASS");
