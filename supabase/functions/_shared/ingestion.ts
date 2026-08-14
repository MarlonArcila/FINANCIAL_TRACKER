import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import type { ParsedCandidate } from "./financial-parser.ts";
import { applyCandidateAutomation, type AutomationResult } from "./automation.ts";

export interface IngestResult {
  inserted: boolean;
  duplicate: boolean;
  candidateId: string | null;
  automation: AutomationResult | null;
}

export async function ingestCandidate(
  service: SupabaseClient,
  userId: string,
  candidate: ParsedCandidate,
  connectionId: string | null = null,
): Promise<IngestResult> {
  const { data: existing, error: existingError } = await service
    .from("transaction_candidates")
    .select("id,status")
    .eq("user_id", userId)
    .eq("provider", candidate.provider)
    .eq("fingerprint", candidate.fingerprint)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return { inserted: false, duplicate: true, candidateId: existing.id, automation: null };

  const occurred = Date.parse(candidate.occurredAt);
  const windowStart = new Date(occurred - 15 * 60_000).toISOString();
  const windowEnd = new Date(occurred + 15 * 60_000).toISOString();
  const { data: nearby, error: crossError } = await service
    .from("transaction_candidates")
    .select("id,merchant,provider")
    .eq("user_id", userId)
    .eq("proposed_kind", candidate.proposedKind)
    .eq("amount_minor", candidate.amountMinor)
    .eq("currency", candidate.currency)
    .in("status", ["pending", "accepted"])
    .gte("occurred_at", windowStart)
    .lte("occurred_at", windowEnd)
    .order("occurred_at", { ascending: false })
    .limit(10);
  if (crossError) throw crossError;
  const crossSource = (nearby ?? []).find((item) => item.provider !== candidate.provider && merchantsCompatible(item.merchant, candidate.merchant)) ?? null;

  const sourcePayload = {
    user_id: userId,
    connection_id: connectionId,
    provider: candidate.provider,
    external_id: candidate.externalId,
    app_package: candidate.appPackage,
    occurred_at: candidate.occurredAt,
    sender_normalized: candidate.senderNormalized ?? null,
    title_sanitized: candidate.titleSanitized ?? null,
    text_sanitized: candidate.description,
    fingerprint: candidate.fingerprint,
    metadata: { parser_version: candidate.parserVersion },
    processing_status: "parsed",
  };
  const { data: source, error: sourceError } = await service
    .from("source_events")
    .upsert(sourcePayload, { onConflict: "user_id,provider,fingerprint", ignoreDuplicates: false })
    .select("id")
    .single();
  if (sourceError) throw sourceError;

  const candidatePayload = {
    user_id: userId,
    source_event_id: source.id,
    provider: candidate.provider,
    external_id: candidate.externalId,
    app_package: candidate.appPackage,
    proposed_kind: candidate.proposedKind,
    amount_minor: candidate.amountMinor,
    currency: candidate.currency,
    merchant: candidate.merchant,
    description: candidate.description,
    occurred_at: candidate.occurredAt,
    confidence: candidate.confidence,
    fingerprint: candidate.fingerprint,
    dedupe_key: candidate.dedupeKey,
    reasons: candidate.reasons,
    parser_version: candidate.parserVersion,
    status: crossSource ? "duplicate" : "pending",
    duplicate_of: crossSource?.id ?? null,
  };
  const { data: inserted, error: insertError } = await service
    .from("transaction_candidates")
    .insert(candidatePayload)
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") return { inserted: false, duplicate: true, candidateId: null, automation: null };
    throw insertError;
  }
  let automation: AutomationResult | null = null;
  if (!crossSource) {
    automation = await applyCandidateAutomation(service, userId, inserted.id, candidate);
  }
  return { inserted: true, duplicate: Boolean(crossSource), candidateId: inserted.id, automation };
}

function merchantsCompatible(left: string | null, right: string | null): boolean {
  const a = normalizeMerchant(left);
  const b = normalizeMerchant(right);
  if (!a || !b) return true;
  const leftTokens = new Set(a.split(" ").filter(Boolean));
  const rightTokens = new Set(b.split(" ").filter(Boolean));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union > 0 && intersection / union >= 0.6;
}

function normalizeMerchant(value: string | null): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
