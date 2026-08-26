import { recordAuditEvent } from "../_shared/audit.ts";
import { optionalEnv, requiredEnv } from "../_shared/env.ts";
import { errorResponse, handleOptions, HttpError, json, readJson } from "../_shared/http.ts";
import { enforceUserRateLimit, RATE_LIMIT_POLICIES } from "../_shared/rate-limit.ts";
import { createServiceClient, requireUser } from "../_shared/supabase.ts";

interface CheckoutInput { interval: "weekly" | "annual" }

Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const { user } = await requireUser(request);
    const service = createServiceClient();
    await enforceUserRateLimit(service, user.id, RATE_LIMIT_POLICIES.WHOP_CHECKOUT);
    // Checkout is the one paid endpoint that does not require an existing entitlement.
    const body = await readJson<CheckoutInput>(request, 10_000);
    if (body.interval !== "weekly" && body.interval !== "annual") throw new HttpError(422, "invalid_interval");
    const planId = requiredEnv(body.interval === "weekly" ? "WHOP_WEEKLY_PLAN_ID" : "WHOP_ANNUAL_PLAN_ID");
    const redirectBase = optionalEnv("APP_URL") ?? new URL(request.url).origin;
    const idempotencyKey = `${user.id}:${body.interval}:${new Date().toISOString().slice(0, 10)}`;
    const response = await fetch(`${optionalEnv("WHOP_API_BASE_URL") ?? "https://api.whop.com/api/v1"}/checkout_configurations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${requiredEnv("WHOP_API_KEY")}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        "api-version-date": optionalEnv("WHOP_API_VERSION_DATE") ?? "2026-08-10",
      },
      body: JSON.stringify({
        account_id: requiredEnv("WHOP_COMPANY_ID"),
        mode: "payment",
        plan_id: planId,
        redirect_url: `${redirectBase.replace(/\/$/u, "")}/#/subscription?checkout=complete`,
        metadata: { app_user_id: user.id, interval: body.interval },
      }),
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok || typeof payload.purchase_url !== "string") {
      console.error("Whop checkout failed", response.status);
      throw new HttpError(502, "checkout_provider_error");
    }
    await recordAuditEvent(service, {
      userId: user.id,
      actor: "user",
      action: "checkout.created",
      entityType: "whop_checkout",
      entityId: typeof payload.id === "string" ? payload.id : null,
      metadata: { interval: body.interval, plan_id: planId },
    });
    return json({ purchaseUrl: payload.purchase_url });
  } catch (error) {
    return errorResponse(error);
  }
});
