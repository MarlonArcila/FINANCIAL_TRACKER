import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { recordAuditEvent } from "./audit.ts";
import type { ParsedCandidate } from "./financial-parser.ts";
import { decideAutomationPolicy } from "./automation-policy.ts";
import { shouldHoldForCalibration } from "./onboarding-policy.ts";

interface AutomationPreferences {
  auto_post_enabled: boolean;
  auto_post_min_confidence: number;
  auto_review_min_confidence: number;
  auto_use_other_category: boolean;
}

interface ResolvedAccount {
  id: string;
  quality: number;
  reason: string;
}

interface ResolvedCategory {
  id: string | null;
  quality: number;
  reason: string;
}

export interface AutomationResult {
  outcome: "auto_posted" | "needs_review" | "auto_ignored";
  transactionId: string | null;
  reason: string;
  automationScore: number;
}

const DEFAULT_PREFERENCES: AutomationPreferences = {
  auto_post_enabled: true,
  auto_post_min_confidence: 0.94,
  auto_review_min_confidence: 0.70,
  auto_use_other_category: true,
};

export async function applyCandidateAutomation(
  service: SupabaseClient,
  userId: string,
  candidateId: string,
  candidate: ParsedCandidate,
): Promise<AutomationResult> {
  const preferences = await loadPreferences(service, userId);

  if (!await hasActiveSubscription(service, userId)) {
    return markReview(service, candidateId, "subscription_inactive", candidate.confidence);
  }

  if (!preferences.auto_post_enabled) {
    return markReview(service, candidateId, "automation_disabled", candidate.confidence);
  }

  if (candidate.confidence < preferences.auto_review_min_confidence) {
    const policy = decideAutomationPolicy({
      confidence: candidate.confidence, accountQuality: null, categoryQuality: null,
      autoPostEnabled: true,
      autoPostMinConfidence: preferences.auto_post_min_confidence,
      autoReviewMinConfidence: preferences.auto_review_min_confidence,
      categoryRequired: !preferences.auto_use_other_category,
    });
    const score = policy.score;
    await service.from("transaction_candidates").update({
      status: "expired",
      auto_decision: true,
      review_reason: "auto_ignored_low_confidence",
      automation_score: score,
      automation_metadata: { policy: "automation-first-v1", candidate_confidence: candidate.confidence },
      reviewed_at: new Date().toISOString(),
    }).eq("id", candidateId).eq("user_id", userId).eq("status", "pending");
    await audit(service, userId, "candidate.auto_ignored", candidateId, { reason: policy.reason, score });
    return { outcome: "auto_ignored", transactionId: null, reason: policy.reason, automationScore: score };
  }

  const [account, category, profile] = await Promise.all([
    resolveAccount(service, userId, candidate),
    resolveCategory(service, userId, candidate, preferences.auto_use_other_category),
    loadProfile(service, userId),
  ]);
  const categoryResolution = category ?? { id: null, quality: 0.55, reason: "uncategorized_allowed" };
  const policy = decideAutomationPolicy({
    confidence: candidate.confidence,
    accountQuality: account?.quality ?? null,
    categoryQuality: category?.quality ?? null,
    autoPostEnabled: preferences.auto_post_enabled,
    autoPostMinConfidence: preferences.auto_post_min_confidence,
    autoReviewMinConfidence: preferences.auto_review_min_confidence,
    categoryRequired: !preferences.auto_use_other_category,
  });
  if (policy.outcome !== "auto_post") {
    return markReview(service, candidateId, policy.reason, policy.score, account?.id ?? null, categoryResolution.id);
  }
  if (!account) throw new Error("automation_policy_account_invariant");
  const score = policy.score;

  // During first-run calibration, intercept only as many high-confidence signals as
  // are still needed. Once those examples are covered, normal auto-post continues.
  if (await needsOnboardingCalibration(service, userId, candidateId)) {
    return markReview(service, candidateId, "onboarding_calibration", score, account.id, categoryResolution.id);
  }

  const baseCurrency = profile.base_currency;
  const sameCurrency = baseCurrency === candidate.currency;
  const metadata = {
    parser_version: candidate.parserVersion,
    confidence: candidate.confidence,
    automation_score: score,
    account_resolution: account.reason,
    category_resolution: categoryResolution.reason,
    policy: "automation-first-v1",
  };
  const { data: transactionId, error: autoPostError } = await service.rpc("auto_post_transaction_candidate", {
    p_user_id: userId,
    p_candidate_id: candidateId,
    p_account_id: account.id,
    p_category_id: categoryResolution.id,
    p_automation_score: score,
    p_metadata: metadata,
    p_base_currency: baseCurrency,
    p_base_amount_minor: sameCurrency ? candidate.amountMinor : null,
    p_fx_rate: sameCurrency ? 1 : null,
    p_fx_source: sameCurrency ? "identity" : null,
    p_fx_rate_at: sameCurrency ? new Date().toISOString() : null,
  });
  if (autoPostError) throw autoPostError;

  await audit(service, userId, "candidate.auto_accepted", String(transactionId), {
    candidate_id: candidateId,
    score,
    account_resolution: account.reason,
    category_resolution: categoryResolution.reason,
  });
  return { outcome: "auto_posted", transactionId: String(transactionId), reason: "high_confidence", automationScore: score };
}

/** Re-evaluates existing exceptions after the system learns a new rule or gains an unambiguous account. */
export async function reprocessPendingCandidates(service: SupabaseClient, userId: string, limit = 50): Promise<{ processed: number; autoPosted: number }> {
  const { data: rows, error } = await service.from("transaction_candidates")
    .select("id,source_event_id,provider,external_id,app_package,proposed_kind,amount_minor,currency,merchant,description,occurred_at,confidence,fingerprint,dedupe_key,reasons,parser_version")
    .eq("user_id", userId).eq("status", "pending").order("occurred_at", { ascending: false }).limit(limit);
  if (error) throw error;
  let processed = 0; let autoPosted = 0;
  for (const row of rows ?? []) {
    let senderNormalized: string | null = null;
    let titleSanitized: string | null = null;
    if (row.source_event_id) {
      const { data: source, error: sourceError } = await service.from("source_events")
        .select("sender_normalized,title_sanitized").eq("id", row.source_event_id).eq("user_id", userId).maybeSingle();
      if (sourceError) throw sourceError;
      senderNormalized = source?.sender_normalized ?? null; titleSanitized = source?.title_sanitized ?? null;
    }
    const result = await applyCandidateAutomation(service, userId, row.id, {
      localId: row.external_id ?? row.id, provider: row.provider, externalId: row.external_id ?? null, appPackage: row.app_package ?? null,
      occurredAt: row.occurred_at, proposedKind: row.proposed_kind, amountMinor: Number(row.amount_minor), currency: row.currency,
      merchant: row.merchant ?? null, description: row.description ?? null, confidence: Number(row.confidence), fingerprint: row.fingerprint,
      dedupeKey: row.dedupe_key, reasons: Array.isArray(row.reasons) ? row.reasons.map(String) : [], parserVersion: row.parser_version,
      senderNormalized, titleSanitized,
    } as ParsedCandidate);
    processed += 1; if (result.outcome === "auto_posted") autoPosted += 1;
  }
  return { processed, autoPosted };
}

async function needsOnboardingCalibration(service: SupabaseClient, userId: string, candidateId?: string): Promise<boolean> {
  const [{ data: onboarding, error }, pendingResult, candidateResult] = await Promise.all([
    service.from("onboarding_state")
      .select("completed_at,associations_confirmed,calibration_target")
      .eq("user_id", userId)
      .maybeSingle(),
    service.from("transaction_candidates")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "pending")
      .eq("review_reason", "onboarding_calibration"),
    candidateId
      ? service.from("transaction_candidates").select("review_reason").eq("id", candidateId).eq("user_id", userId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (error) throw error;
  if (pendingResult.error) throw pendingResult.error;
  if (candidateResult.error) throw candidateResult.error;
  if (!onboarding || onboarding.completed_at) return false;

  return shouldHoldForCalibration({
    completedAt: onboarding.completed_at ?? null,
    confirmed: Number(onboarding.associations_confirmed ?? 0),
    target: Number(onboarding.calibration_target ?? 3),
    pendingCalibration: pendingResult.count ?? 0,
    currentCandidateHeld: candidateResult.data?.review_reason === "onboarding_calibration",
  });
}

async function loadPreferences(service: SupabaseClient, userId: string): Promise<AutomationPreferences> {
  const { data, error } = await service.from("financial_preferences")
    .select("auto_post_enabled,auto_post_min_confidence,auto_review_min_confidence,auto_use_other_category")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return {
    auto_post_enabled: data?.auto_post_enabled ?? DEFAULT_PREFERENCES.auto_post_enabled,
    auto_post_min_confidence: Number(data?.auto_post_min_confidence ?? DEFAULT_PREFERENCES.auto_post_min_confidence),
    auto_review_min_confidence: Number(data?.auto_review_min_confidence ?? DEFAULT_PREFERENCES.auto_review_min_confidence),
    auto_use_other_category: data?.auto_use_other_category ?? DEFAULT_PREFERENCES.auto_use_other_category,
  };
}

async function hasActiveSubscription(service: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await service.from("subscriptions")
    .select("status,current_period_end")
    .eq("user_id", userId)
    .in("status", ["active", "trialing"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data && (!data.current_period_end || Date.parse(data.current_period_end) > Date.now()));
}

async function loadProfile(service: SupabaseClient, userId: string): Promise<{ base_currency: string }> {
  const { data, error } = await service.from("profiles").select("base_currency").eq("id", userId).single();
  if (error) throw error;
  return { base_currency: String(data.base_currency).toUpperCase() };
}

async function resolveAccount(service: SupabaseClient, userId: string, candidate: ParsedCandidate): Promise<ResolvedAccount | null> {
  const { data: rules, error: rulesError } = await service.from("account_assignment_rules")
    .select("match_type,match_value,account_id,transaction_kind,priority")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("priority", { ascending: false });
  if (rulesError && rulesError.code !== "42P01") throw rulesError;

  const matchingRule = (rules ?? []).find((rule) => {
    if (rule.transaction_kind && rule.transaction_kind !== candidate.proposedKind) return false;
    const value = normalize(rule.match_value);
    if (rule.match_type === "app_package_equals") return normalize(candidate.appPackage ?? "") === value;
    if (rule.match_type === "sender_equals") return normalize(candidate.senderNormalized ?? "") === value;
    return false;
  });
  if (matchingRule) {
    const { data: account, error } = await service.from("accounts")
      .select("id,currency,is_archived")
      .eq("id", matchingRule.account_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (account && !account.is_archived && account.currency === candidate.currency) {
      return { id: account.id, quality: 0.995, reason: `learned_${matchingRule.match_type}` };
    }
  }

  const { data: accounts, error } = await service.from("accounts")
    .select("id,currency")
    .eq("user_id", userId)
    .eq("currency", candidate.currency)
    .eq("is_archived", false);
  if (error) throw error;
  if ((accounts ?? []).length === 1) return { id: accounts![0].id, quality: 0.96, reason: "single_account_for_currency" };
  return null;
}

async function resolveCategory(
  service: SupabaseClient,
  userId: string,
  candidate: ParsedCandidate,
  allowOther: boolean,
): Promise<ResolvedCategory | null> {
  const { data: rules, error: rulesError } = await service.from("categorization_rules")
    .select("match_type,match_value,category_id,transaction_kind,priority")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("priority", { ascending: false });
  if (rulesError) throw rulesError;
  const matchingRule = (rules ?? []).find((rule) => matchesCategoryRule(rule, candidate));
  if (matchingRule) return { id: matchingRule.category_id, quality: 0.99, reason: `learned_${matchingRule.match_type}` };

  const { data: categories, error } = await service.from("categories")
    .select("id,name,kind,is_system")
    .eq("user_id", userId)
    .eq("is_archived", false);
  if (error) throw error;

  const inferredName = inferSystemCategory(candidate);
  if (inferredName) {
    const category = (categories ?? []).find((item) => item.is_system && item.kind === candidate.proposedKind && normalize(item.name) === normalize(inferredName));
    if (category) return { id: category.id, quality: 0.88, reason: `system_heuristic_${normalize(inferredName).replaceAll(" ", "_")}` };
  }

  if (allowOther) {
    const other = (categories ?? []).find((item) => item.is_system && item.kind === "mixed" && normalize(item.name) === "otros")
      ?? (categories ?? []).find((item) => item.kind === "mixed");
    if (other) return { id: other.id, quality: 0.62, reason: "fallback_other" };
  }
  return null;
}

function matchesCategoryRule(rule: Record<string, any>, candidate: ParsedCandidate): boolean {
  if (rule.transaction_kind && rule.transaction_kind !== candidate.proposedKind) return false;
  const expected = normalize(String(rule.match_value ?? ""));
  if (!expected) return false;
  if (rule.match_type === "merchant_contains") return normalize(candidate.merchant ?? "").includes(expected);
  if (rule.match_type === "sender_equals") return normalize(candidate.senderNormalized ?? "") === expected;
  if (rule.match_type === "app_package_equals") return normalize(candidate.appPackage ?? "") === expected;
  if (rule.match_type === "description_contains") return normalize(candidate.description ?? "").includes(expected);
  return false;
}

function inferSystemCategory(candidate: ParsedCandidate): string | null {
  const haystack = normalize([candidate.merchant, candidate.description, candidate.titleSanitized].filter(Boolean).join(" "));
  if (candidate.proposedKind === "income") {
    if (/salario|nomina|payroll|sueldo/u.test(haystack)) return "Salario";
    return "Otros ingresos";
  }
  if (/supermerc|mercado|restaur|comida|food|grocery|caf[eé]|rappi|ifood/u.test(haystack)) return "Alimentación";
  if (/uber|didi|taxi|metro|bus|gasolin|combust|fuel|transporte/u.test(haystack)) return "Transporte";
  if (/arriendo|alquiler|rent|vivienda|energ[ií]a|electric|agua|acueduct|gas natural|internet hogar/u.test(haystack)) return "Vivienda";
  if (/farmac|m[eé]dic|cl[ií]nic|hospital|salud|droguer/u.test(haystack)) return "Salud";
  if (/curso|univers|coleg|educa|libro|udemy|coursera/u.test(haystack)) return "Educación";
  if (/netflix|spotify|cine|cinema|entreten|steam|playstation|xbox/u.test(haystack)) return "Entretenimiento";
  return null;
}

async function markReview(
  service: SupabaseClient,
  candidateId: string,
  reason: string,
  scoreValue: number,
  accountId: string | null = null,
  categoryId: string | null = null,
): Promise<AutomationResult> {
  const score = roundScore(scoreValue);
  const { error } = await service.from("transaction_candidates").update({
    auto_decision: false,
    review_reason: reason,
    resolved_account_id: accountId,
    resolved_category_id: categoryId,
    automation_score: score,
    automation_metadata: { policy: "automation-first-v1" },
  }).eq("id", candidateId).eq("status", "pending");
  if (error) throw error;
  return { outcome: "needs_review", transactionId: null, reason, automationScore: score };
}

async function audit(service: SupabaseClient, userId: string, action: string, entityId: string, metadata: Record<string, unknown>): Promise<void> {
  try {
    await recordAuditEvent(service, {
      userId,
      actor: "system",
      action,
      entityType: "transaction_candidate",
      entityId,
      metadata,
    });
  } catch {
    console.warn(JSON.stringify({ event: "automation_audit_failed", action }));
  }
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}.@_-]+/gu, " ").trim();
}

function roundScore(value: number): number {
  return Number(Math.min(1, Math.max(0, value)).toFixed(4));
}
