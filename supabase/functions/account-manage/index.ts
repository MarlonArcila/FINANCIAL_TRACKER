import { decideAccountCreatePolicy, type AccountPurpose, type SubscriptionInterval } from "../_shared/account-policy.ts";
import { reprocessPendingCandidates } from "../_shared/automation.ts";
import { errorResponse, handleOptions, HttpError, json, readJson } from "../_shared/http.ts";
import { assertEntitled, createServiceClient, requireUser } from "../_shared/supabase.ts";

type Body =
  | { action: "create"; name: string; type: string; currency: string; openingBalanceMinor: number; purpose?: AccountPurpose; purposeLabel?: string | null }
  | { action: "archive"; accountId: string }
  | { action: "restore"; accountId: string };

Deno.serve(async (request) => {
  const preflight = handleOptions(request); if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const { user } = await requireUser(request);
    const service = createServiceClient();
    await assertEntitled(service, user.id);
    const body = await readJson<Body>(request, 20_000);
    const interval = await activeInterval(service, user.id);

    if (body.action === "create") {
      const name = body.name?.trim();
      const currency = body.currency?.trim().toUpperCase();
      if (!name || name.length > 80) throw new HttpError(422, "invalid_account_name");
      if (!/^[A-Z]{3}$/u.test(currency)) throw new HttpError(422, "invalid_currency");
      if (!Number.isSafeInteger(body.openingBalanceMinor)) throw new HttpError(422, "invalid_opening_balance");
      if (!["cash","checking","savings","credit","investment","other"].includes(body.type)) throw new HttpError(422, "invalid_account_type");

      const { count, error: countError } = await service.from("accounts")
        .select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("is_archived", false);
      if (countError) throw countError;
      const policy = decideAccountCreatePolicy({ interval, activeAccountCount: count ?? 0, requestedPurpose: body.purpose });
      if (!policy.allowed) throw new HttpError(402, policy.reason);

      const { data, error } = await service.from("accounts").insert({
        user_id: user.id,
        name,
        type: body.type,
        currency,
        opening_balance_minor: body.openingBalanceMinor,
        is_primary: policy.isPrimary,
        purpose: policy.purpose,
        purpose_label: policy.isPrimary ? null : body.purposeLabel?.trim().slice(0, 120) || null,
      }).select("*").single();
      if (error) throw error;
      await audit(service, user.id, "account.created", data.id, { purpose: policy.purpose, is_primary: policy.isPrimary });
      const reprocessed = await reprocessPendingCandidates(service, user.id, 50);
      return json({ account: data, reprocessed });
    }

    if (!isUuid(body.accountId)) throw new HttpError(422, "invalid_account_id");
    const { data: account, error: accountError } = await service.from("accounts").select("*")
      .eq("id", body.accountId).eq("user_id", user.id).maybeSingle();
    if (accountError) throw accountError;
    if (!account) throw new HttpError(404, "account_not_found");
    if (account.is_primary) throw new HttpError(422, "primary_account_cannot_be_archived");
    if (interval !== "annual") throw new HttpError(402, "annual_subscription_required_for_multiple_accounts");

    const isArchive = body.action === "archive";
    const { data, error } = await service.from("accounts").update({
      is_archived: isArchive,
      archived_at: isArchive ? new Date().toISOString() : null,
    }).eq("id", body.accountId).eq("user_id", user.id).select("*").single();
    if (error) throw error;
    await audit(service, user.id, isArchive ? "account.archived" : "account.restored", body.accountId, {});
    return json({ account: data });
  } catch (error) { return errorResponse(error); }
});

async function activeInterval(service: ReturnType<typeof createServiceClient>, userId: string): Promise<SubscriptionInterval> {
  const { data, error } = await service.from("subscriptions").select("interval,current_period_end,updated_at")
    .eq("user_id", userId).in("status", ["active","trialing"]).order("updated_at", { ascending: false }).limit(10);
  if (error) throw error;
  const active = (data ?? []).filter((item) => !item.current_period_end || Date.parse(item.current_period_end) > Date.now());
  if (active.some((item) => item.interval === "annual")) return "annual";
  if (active.length) return "weekly";
  throw new HttpError(402, "active_subscription_required");
}

async function audit(service: ReturnType<typeof createServiceClient>, userId: string, action: string, entityId: string, metadata: Record<string, unknown>) {
  await service.schema("private").from("audit_events").insert({ user_id: userId, actor: "user", action, entity_type: "account", entity_id: entityId, metadata });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
