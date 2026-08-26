import { createPilotUser, deletePilotUser, firstEnv, invokeEdge, openBrowser, requiredEnv, supabaseContext, waitFor } from "./pilot-lib.mjs";

if (firstEnv("CF_WHOP_SANDBOX_CONFIRMED") !== "true") throw new Error("CF_WHOP_SANDBOX_CONFIRMED_TRUE_REQUIRED");
const whopApiKey = requiredEnv("WHOP_API_KEY");
const whopApiBase = firstEnv("WHOP_API_BASE_URL") ?? "https://api.whop.com/api/v1";
const whopVersion = firstEnv("WHOP_API_VERSION_DATE") ?? "2026-08-10";
const interval = firstEnv("CF_WHOP_TEST_INTERVAL") ?? "weekly";
if (!new Set(["weekly", "annual"]).has(interval)) throw new Error("CF_WHOP_TEST_INTERVAL_INVALID");
const timeoutMs = Number(firstEnv("CF_WHOP_TIMEOUT_MS") ?? "600000");
const ctx = supabaseContext();
let pilot = null;
let membershipId = null;
try {
  pilot = await createPilotUser(ctx, "whop");
  const checkout = await invokeEdge(ctx, "whop-checkout", pilot.accessToken, { body: { interval } });
  const purchaseUrl = checkout.payload?.purchaseUrl;
  if (typeof purchaseUrl !== "string") throw new Error("WHOP_PURCHASE_URL_MISSING");
  console.log("WHOP_ACTION=COMPLETE_SANDBOX_CHECKOUT_IN_BROWSER");
  openBrowser(purchaseUrl);

  const subscription = await waitFor("WHOP_MEMBERSHIP_ACTIVATION", async () => {
    const { data, error } = await pilot.client.from("subscriptions")
      .select("provider_membership_id,provider_plan_id,interval,status,current_period_end")
      .eq("user_id", pilot.user.id).eq("provider", "whop")
      .in("status", ["active", "trialing"]).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data ?? null;
  }, { timeoutMs });
  membershipId = subscription.provider_membership_id;
  if (!membershipId || subscription.interval !== interval) throw new Error("WHOP_WEBHOOK_SUBSCRIPTION_MISMATCH");

  const cancel = await fetch(`${whopApiBase.replace(/\/$/u, "")}/memberships/${encodeURIComponent(membershipId)}/cancel`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${whopApiKey}`,
      "content-type": "application/json",
      "api-version-date": whopVersion,
    },
    body: JSON.stringify({ cancellation_mode: "immediate" }),
  });
  const cancelRaw = await cancel.text();
  if (!cancel.ok) throw new Error(`WHOP_CANCEL_HTTP_${cancel.status}:${cancelRaw.slice(0, 500)}`);

  await waitFor("WHOP_DEACTIVATION_WEBHOOK", async () => {
    const { data, error } = await pilot.client.from("subscriptions")
      .select("status").eq("user_id", pilot.user.id).eq("provider_membership_id", membershipId).maybeSingle();
    if (error) throw error;
    return data && new Set(["canceled", "expired"]).has(data.status) ? data : null;
  }, { timeoutMs: Math.min(timeoutMs, 300_000) });

  console.log(`WHOP_MEMBERSHIP_ID=${membershipId}`);
  console.log("WHOP_CHECKOUT_SANDBOX=GREEN");
  console.log("WHOP_SIGNED_WEBHOOK_ACTIVATION=GREEN");
  console.log("WHOP_SIGNED_WEBHOOK_DEACTIVATION=GREEN");
  console.log("WHOP_SANDBOX_E2E=GREEN");
} finally {
  if (pilot?.user?.id) await deletePilotUser(ctx, pilot.user.id).catch((error) => console.error(`cleanup_whop_user:${error.message}`));
}
