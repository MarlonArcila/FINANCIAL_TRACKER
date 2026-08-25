import Whop from "npm:@whop/sdk";

import { optionalEnv } from "../_shared/env.ts";
import { requireWhopWebhookSecret, verifyConfiguredWhopSignature } from "../_shared/external-auth.ts";
import { errorResponse, handleOptions, HttpError, json } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";

interface WhopEvent {
  id?: string;
  type: string;
  data: Record<string, unknown>;
  timestamp?: string;
}

Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const raw = await request.text();
    const webhookSecret = requireWhopWebhookSecret(optionalEnv("WHOP_WEBHOOK_SECRET"));
    const apiKey = optionalEnv("WHOP_API_KEY");
    const whop = new Whop({
      ...(apiKey ? { apiKey } : {}),
      webhookKey: btoa(webhookSecret),
    });
    const event = verifyConfiguredWhopSignature(
      Boolean(webhookSecret),
      () => whop.webhooks.unwrap(raw, { headers: Object.fromEntries(request.headers.entries()) }) as WhopEvent,
    );
    if (!event.type || !event.data) throw new HttpError(400, "invalid_webhook_payload");
    const eventId = event.id ?? request.headers.get("webhook-id");
    if (!eventId) throw new HttpError(400, "missing_webhook_id");

    const service = createServiceClient();
    const { data: stored, error: storeError } = await service.schema("private").from("webhook_events").upsert({
      provider: "whop",
      event_id: eventId,
      event_type: event.type,
      payload: event,
      status: "received",
      attempts: 1,
    }, { onConflict: "provider,event_id", ignoreDuplicates: true }).select("id").maybeSingle();
    if (storeError) throw storeError;
    if (!stored) return json({ received: true, duplicate: true });

    try {
      if (event.type.startsWith("membership.")) {
        await processMembershipEvent(service, event, eventId);
      }
      await service.schema("private").from("webhook_events").update({
        status: "processed",
        processed_at: new Date().toISOString(),
      }).eq("provider", "whop").eq("event_id", eventId);
    } catch (processingError) {
      await service.schema("private").from("webhook_events").update({
        status: "failed",
        last_error: processingError instanceof Error ? processingError.message.slice(0, 1000) : "unknown",
      }).eq("provider", "whop").eq("event_id", eventId);
      throw processingError;
    }
    return json({ received: true });
  } catch (error) {
    return errorResponse(error);
  }
});

async function processMembershipEvent(service: ReturnType<typeof createServiceClient>, event: WhopEvent, eventId: string): Promise<void> {
  const data = event.data;
  const metadata = isRecord(data.metadata) ? data.metadata : {};
  const plan = isRecord(data.plan) ? data.plan : {};
  const planMetadata = isRecord(plan.metadata) ? plan.metadata : {};
  const userId = firstString(metadata.app_user_id, planMetadata.app_user_id);
  if (!userId || !/^[0-9a-f-]{36}$/iu.test(userId)) {
    throw new Error("Whop membership missing valid metadata.app_user_id");
  }
  const membershipId = firstString(data.id);
  if (!membershipId) throw new Error("Whop membership missing id");
  const planId = firstString(data.plan_id, plan.id);
  const status = mapStatus(firstString(data.status), event.type);
  const metadataInterval = firstString(metadata.interval, planMetadata.interval);
  const interval = planId === optionalEnv("WHOP_WEEKLY_PLAN_ID")
    ? "weekly"
    : planId === optionalEnv("WHOP_ANNUAL_PLAN_ID")
    ? "annual"
    : metadataInterval === "weekly" || metadataInterval === "annual" ? metadataInterval : null;
  const periodStart = asIso(data.current_period_start ?? data.renewal_period_start);
  const periodEnd = asIso(data.current_period_end ?? data.renewal_period_end);
  const cancelAtPeriodEnd = Boolean(data.cancel_at_period_end);

  const { error } = await service.from("subscriptions").upsert({
    user_id: userId,
    provider: "whop",
    provider_customer_id: firstString(data.user_id, isRecord(data.user) ? data.user.id : null),
    provider_membership_id: membershipId,
    provider_plan_id: planId,
    interval,
    status,
    current_period_start: periodStart,
    current_period_end: periodEnd,
    cancel_at_period_end: cancelAtPeriodEnd,
    raw_status: firstString(data.status, event.type),
  }, { onConflict: "provider,provider_membership_id" });
  if (error) throw error;

  await enforceAccountPlanAfterMembershipChange(service, userId);

  await service.schema("private").from("audit_events").insert({
    user_id: userId,
    actor: "whop",
    action: event.type,
    entity_type: "subscription",
    entity_id: membershipId,
    metadata: { status, interval, event_id: eventId },
  });
}

async function enforceAccountPlanAfterMembershipChange(service: ReturnType<typeof createServiceClient>, userId: string): Promise<void> {
  const { data, error } = await service.from("subscriptions")
    .select("interval,current_period_end")
    .eq("user_id", userId)
    .in("status", ["active", "trialing"]);
  if (error) throw error;
  const active = (data ?? []).filter((item) => !item.current_period_end || Date.parse(item.current_period_end) > Date.now());
  if (active.some((item) => item.interval === "annual")) return;
  if (!active.some((item) => item.interval === "weekly")) return;

  const { data: archived, error: archiveError } = await service.from("accounts")
    .update({ is_archived: true, archived_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("is_primary", false)
    .eq("is_archived", false)
    .select("id");
  if (archiveError) throw archiveError;
  if ((archived ?? []).length) {
    await service.schema("private").from("audit_events").insert({
      user_id: userId, actor: "system", action: "accounts.archived_on_weekly_plan", entity_type: "account", entity_id: null,
      metadata: { account_ids: (archived ?? []).map((item) => item.id) },
    });
  }
}

function mapStatus(raw: string | null, eventType: string): string {
  if (eventType === "membership.deactivated") return raw === "expired" ? "expired" : "canceled";
  if (["trialing", "active", "past_due", "canceled", "expired", "unresolved"].includes(raw ?? "")) return raw!;
  if (raw === "completed") return "active";
  return eventType === "membership.activated" ? "active" : "unresolved";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === "string" && value) return value;
  return null;
}

function asIso(value: unknown): string | null {
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim() !== "") return new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric).toISOString();
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  }
  return null;
}
