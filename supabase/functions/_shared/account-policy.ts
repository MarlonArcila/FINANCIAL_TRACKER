export type SubscriptionInterval = "weekly" | "annual";
export type AccountPurpose = "general" | "trip" | "work" | "shared" | "project" | "other";

export interface AccountCreatePolicyInput {
  interval: SubscriptionInterval;
  activeAccountCount: number;
  requestedPurpose?: AccountPurpose;
}

export interface AccountCreatePolicy {
  allowed: boolean;
  isPrimary: boolean;
  purpose: AccountPurpose;
  reason: "first_account" | "annual_multi_account" | "annual_required_for_multiple_accounts";
}

export function decideAccountCreatePolicy(input: AccountCreatePolicyInput): AccountCreatePolicy {
  const first = input.activeAccountCount === 0;
  if (first) return { allowed: true, isPrimary: true, purpose: "general", reason: "first_account" };
  if (input.interval === "weekly") {
    return { allowed: false, isPrimary: false, purpose: "general", reason: "annual_required_for_multiple_accounts" };
  }
  return {
    allowed: true,
    isPrimary: false,
    purpose: input.requestedPurpose ?? "other",
    reason: "annual_multi_account",
  };
}
