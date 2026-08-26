import { recordAuditEvent } from "../_shared/audit.ts";
import { errorResponse, handleOptions, HttpError, json, readJson } from "../_shared/http.ts";
import { reprocessPendingCandidates } from "../_shared/automation.ts";
import { assertEntitled, createServiceClient, requireUser } from "../_shared/supabase.ts";

interface CandidateDecision {
  candidateId: string;
  action: "accept" | "reject" | "duplicate";
  accountId?: string;
  categoryId?: string | null;
  corrections?: Record<string, unknown>;
  rememberSourceAccount?: boolean;
  learnCategory?: boolean;
}

Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const { user, client } = await requireUser(request);
    const service = createServiceClient();
    await assertEntitled(service, user.id);
    const body = await readJson<CandidateDecision>(request, 25_000);
    if (!isUuid(body.candidateId)) throw new HttpError(422, "invalid_candidate_id");

    if (body.action === "accept") {
      if (!isUuid(body.accountId)) throw new HttpError(422, "account_id_required");
      if (body.categoryId !== undefined && body.categoryId !== null && !isUuid(body.categoryId)) {
        throw new HttpError(422, "invalid_category_id");
      }
      const { data, error } = await client.rpc("accept_transaction_candidate", {
        p_candidate_id: body.candidateId,
        p_account_id: body.accountId,
        p_category_id: body.categoryId ?? null,
        p_corrections: body.corrections ?? {},
      });
      if (error) throw error;

      await learnFromReview(service, user.id, body, String(data));
      const onboardingAssociation = await recordOnboardingAssociation(service, user.id);
      const reprocessed = await reprocessPendingCandidates(service, user.id, 50);
      return json({ action: "accepted", transactionId: data, learned: true, onboardingAssociation, reprocessed });
    }

    if (body.action !== "reject" && body.action !== "duplicate") throw new HttpError(422, "invalid_action");
    const status = body.action === "duplicate" ? "duplicate" : "rejected";
    const { data, error } = await client
      .from("transaction_candidates")
      .update({ status, reviewed_at: new Date().toISOString(), auto_decision: false })
      .eq("id", body.candidateId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "candidate_not_found_or_not_pending");

    await recordAuditEvent(service, {
      userId: user.id,
      actor: "user",
      action: `candidate.${status}`,
      entityType: "transaction_candidate",
      entityId: body.candidateId,
    });
    return json({ action: status });
  } catch (error) {
    return errorResponse(error);
  }
});

async function recordOnboardingAssociation(service: ReturnType<typeof createServiceClient>, userId: string): Promise<number | null> {
  const { data: state, error } = await service.from("onboarding_state")
    .select("associations_confirmed,calibration_target,completed_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!state || state.completed_at) return null;

  const current = Number(state.associations_confirmed ?? 0);
  const target = Math.max(3, Math.min(5, Number(state.calibration_target ?? 3)));
  if (current >= target) return current;
  const next = Math.min(5, current + 1);
  const { error: updateError } = await service.from("onboarding_state")
    .update({ associations_confirmed: next, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (updateError) throw updateError;
  return next;
}

async function learnFromReview(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  body: CandidateDecision,
  transactionId: string,
): Promise<void> {
  const { data: preferences } = await service.from("financial_preferences")
    .select("learn_from_reviews")
    .eq("user_id", userId)
    .maybeSingle();
  if (preferences?.learn_from_reviews === false) return;

  const { data: candidate, error } = await service.from("transaction_candidates")
    .select("id,source_event_id,app_package,merchant,proposed_kind,currency")
    .eq("id", body.candidateId)
    .eq("user_id", userId)
    .single();
  if (error) throw error;

  if (body.learnCategory !== false && body.categoryId && candidate.merchant) {
    await upsertCategoryRule(service, {
      user_id: userId,
      match_type: "merchant_contains",
      match_value: normalizeRuleValue(candidate.merchant),
      category_id: body.categoryId,
      transaction_kind: candidate.proposed_kind,
      priority: 200,
      is_active: true,
    });
  }

  if (body.rememberSourceAccount !== false && body.accountId) {
    let matchType: "sender_equals" | "app_package_equals" | null = null;
    let matchValue: string | null = null;
    if (candidate.app_package) {
      matchType = "app_package_equals";
      matchValue = candidate.app_package;
    } else if (candidate.source_event_id) {
      const { data: source } = await service.from("source_events")
        .select("sender_normalized")
        .eq("id", candidate.source_event_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (source?.sender_normalized) {
        matchType = "sender_equals";
        matchValue = source.sender_normalized;
      }
    }
    if (matchType && matchValue) {
      await upsertAccountRule(service, {
        userId,
        matchType,
        matchValue,
        accountId: body.accountId,
        transactionKind: candidate.proposed_kind,
        candidateId: body.candidateId,
      });
    }
  }

  await recordAuditEvent(service, {
    userId,
    actor: "system",
    action: "automation.rules_learned_from_review",
    entityType: "transaction",
    entityId: transactionId,
    metadata: {
      candidate_id: body.candidateId,
      category_rule: Boolean(body.categoryId && body.learnCategory !== false && candidate.merchant),
      account_rule: body.rememberSourceAccount !== false,
    },
  });
}

async function upsertCategoryRule(service: ReturnType<typeof createServiceClient>, rule: Record<string, unknown>): Promise<void> {
  const { data: existing, error: searchError } = await service.from("categorization_rules")
    .select("id")
    .eq("user_id", rule.user_id)
    .eq("match_type", rule.match_type)
    .eq("match_value", rule.match_value)
    .eq("transaction_kind", rule.transaction_kind)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (searchError) throw searchError;
  if (existing) {
    const { error } = await service.from("categorization_rules").update({
      category_id: rule.category_id,
      priority: rule.priority,
    }).eq("id", existing.id);
    if (error) throw error;
    return;
  }
  const { error } = await service.from("categorization_rules").insert(rule);
  if (error) throw error;
}

async function upsertAccountRule(service: ReturnType<typeof createServiceClient>, input: {
  userId: string;
  matchType: "sender_equals" | "app_package_equals";
  matchValue: string;
  accountId: string;
  transactionKind: string;
  candidateId: string;
}): Promise<void> {
  const normalized = normalizeRuleValue(input.matchValue);
  const { data: rules, error: searchError } = await service.from("account_assignment_rules")
    .select("id,match_value")
    .eq("user_id", input.userId)
    .eq("match_type", input.matchType)
    .eq("transaction_kind", input.transactionKind)
    .eq("is_active", true);
  if (searchError) throw searchError;
  const existing = (rules ?? []).find((rule) => normalizeRuleValue(rule.match_value) === normalized);
  if (existing) {
    const { error } = await service.from("account_assignment_rules").update({
      account_id: input.accountId,
      learned_from_candidate_id: input.candidateId,
      priority: 250,
    }).eq("id", existing.id);
    if (error) throw error;
    return;
  }
  const { error } = await service.from("account_assignment_rules").insert({
    user_id: input.userId,
    match_type: input.matchType,
    match_value: normalized,
    account_id: input.accountId,
    transaction_kind: input.transactionKind,
    priority: 250,
    is_active: true,
    learned_from_candidate_id: input.candidateId,
  });
  if (error) throw error;
}

function normalizeRuleValue(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase().slice(0, 200);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
