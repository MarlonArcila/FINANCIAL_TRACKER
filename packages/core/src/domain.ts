export type TransactionKind =
  | "income"
  | "expense"
  | "transfer"
  | "goal_contribution"
  | "investment_contribution"
  | "investment_return"
  | "adjustment";

export type CandidateKind = "income" | "expense";
export type CandidateProvider = "android_notification" | "gmail";
export type RiskTolerance = "low" | "medium" | "high";

export interface ParsedMoney {
  amountMinor: number;
  currency: string;
  rawAmount: string;
  confidence: number;
}

export interface DirectionClassification {
  kind: CandidateKind | null;
  confidence: number;
  reasons: string[];
}

export interface FinancialEventInput {
  provider: CandidateProvider;
  occurredAt: string | Date;
  text: string;
  title?: string;
  sender?: string;
  externalId?: string;
  appPackage?: string;
  defaultCurrency?: string;
}

export interface DetectedCandidate {
  localId: string;
  provider: CandidateProvider;
  externalId: string | null;
  appPackage: string | null;
  occurredAt: string;
  proposedKind: CandidateKind;
  amountMinor: number;
  currency: string;
  merchant: string | null;
  description: string | null;
  confidence: number;
  fingerprint: string;
  dedupeKey: string;
  reasons: string[];
  parserVersion: string;
}

export interface DuplicateComparable {
  proposedKind: CandidateKind;
  amountMinor: number;
  currency: string;
  merchant: string | null;
  occurredAt: string;
  provider?: CandidateProvider;
}

export interface GoalAdvisorInput {
  id: string;
  name: string;
  remainingMinor: number;
  priority: 1 | 2 | 3 | 4 | 5;
  requiredContributionMinor?: number;
  targetDate?: string;
}

export interface AdvisorInput {
  currency: string;
  liquidBalanceMinor: number;
  expectedIncomeMinor: number;
  essentialExpensesMinor: number;
  discretionaryBudgetMinor: number;
  emergencyFundCurrentMinor: number;
  monthlyEssentialExpensesMinor: number;
  emergencyMonthsTarget: number;
  goals: GoalAdvisorInput[];
  riskTolerance: RiskTolerance;
  horizonMonths: number;
  targetAnnualReturnBps: number;
  compoundsPerYear?: number;
}

export type AllocationBucket =
  | "essential_expenses"
  | "emergency_fund"
  | "goal"
  | "discretionary"
  | "investment"
  | "unallocated";

export interface AllocationLine {
  bucket: AllocationBucket;
  referenceId: string | null;
  label: string;
  amountMinor: number;
  percentageBps: number;
  priority: number;
  rationale: string;
}

export interface ProjectionScenario {
  name: "conservative" | "base" | "optimistic";
  annualRateBps: number;
  projectedValueMinor: number;
  gainMinor: number;
  disclaimer: string;
}

export interface AllocationPlan {
  version: string;
  currency: string;
  grossAvailableMinor: number;
  availableMinor: number;
  committedMinor: number;
  deficitMinor: number;
  emergencyTargetMinor: number;
  emergencyShortfallMinor: number;
  allocations: AllocationLine[];
  warnings: string[];
  assumptions: string[];
  projections: ProjectionScenario[];
  deterministicExplanation: string;
}

export interface InvestmentReturn {
  gainMinor: number;
  returnBps: number | null;
}
