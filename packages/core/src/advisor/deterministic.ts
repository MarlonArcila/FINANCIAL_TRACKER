import type {
  AdvisorInput,
  AllocationLine,
  AllocationPlan,
  GoalAdvisorInput,
} from "../domain.js";
import { assessReturnFeasibility, buildProjectionScenarios } from "./risk.js";

export const ADVISOR_VERSION = "2026-08-12.1";

export function buildAllocationPlan(input: AdvisorInput): AllocationPlan {
  validateAdvisorInput(input);

  const grossAvailableMinor = input.liquidBalanceMinor + input.expectedIncomeMinor;
  let remaining = grossAvailableMinor;
  const allocations: AllocationLine[] = [];
  const warnings = assessReturnFeasibility(input);
  const assumptions = [
    "All amounts are evaluated in one currency without automatic FX conversion.",
    "Detected income is treated as available only when the user marks it as expected or confirmed.",
    "Investment projections use the user-provided annual return and compound frequency.",
    "Investment scenarios are educational and do not include taxes, fees, inflation, or market slippage.",
  ];

  remaining = allocate(
    allocations,
    remaining,
    input.essentialExpensesMinor,
    "essential_expenses",
    null,
    "Essential expenses and obligations",
    100,
    "Fund essential obligations before optional goals or market risk.",
    grossAvailableMinor,
  );

  if (input.essentialExpensesMinor > grossAvailableMinor) {
    warnings.push("Available money does not fully cover essential expenses for the selected period.");
  }

  const emergencyTargetMinor = Math.round(
    input.monthlyEssentialExpensesMinor * input.emergencyMonthsTarget,
  );
  const emergencyShortfallMinor = Math.max(0, emergencyTargetMinor - input.emergencyFundCurrentMinor);
  remaining = allocate(
    allocations,
    remaining,
    emergencyShortfallMinor,
    "emergency_fund",
    null,
    "Emergency reserve",
    90,
    `Build the configured ${input.emergencyMonthsTarget}-month emergency reserve before taking additional investment risk.`,
    grossAvailableMinor,
  );

  for (const goal of sortGoals(input.goals)) {
    const desired = Math.min(
      goal.remainingMinor,
      goal.requiredContributionMinor ?? goal.remainingMinor,
    );
    remaining = allocate(
      allocations,
      remaining,
      desired,
      "goal",
      goal.id,
      goal.name,
      70 + goal.priority,
      goal.targetDate
        ? `Priority ${goal.priority}; target date ${goal.targetDate}.`
        : `Priority ${goal.priority}; no target date provided.`,
      grossAvailableMinor,
    );
  }

  remaining = allocate(
    allocations,
    remaining,
    input.discretionaryBudgetMinor,
    "discretionary",
    null,
    "Discretionary spending cap",
    50,
    "A capped discretionary amount preserves plan sustainability without treating all spending as essential.",
    grossAvailableMinor,
  );

  const investmentMinor = remaining;
  remaining = allocate(
    allocations,
    remaining,
    investmentMinor,
    "investment",
    null,
    "Long-term investment allocation",
    30,
    investmentRationale(input),
    grossAvailableMinor,
  );

  if (remaining > 0) {
    allocations.push(line(
      "unallocated",
      null,
      "Unallocated cash",
      remaining,
      10,
      "Keep as flexible liquidity or assign it to a user-selected goal.",
      grossAvailableMinor,
    ));
  }

  const committedMinor = allocations
    .filter((item) => item.bucket !== "unallocated")
    .reduce((sum, item) => sum + item.amountMinor, 0);
  const essentialAllocated = allocations
    .filter((item) => item.bucket === "essential_expenses")
    .reduce((sum, item) => sum + item.amountMinor, 0);
  const deficitMinor = Math.max(0, input.essentialExpensesMinor - essentialAllocated);
  const investmentAllocation = allocations.find((item) => item.bucket === "investment")?.amountMinor ?? 0;

  if (investmentAllocation === 0) {
    warnings.push("No money remains for new investment after higher-priority allocations.");
  }
  if (emergencyShortfallMinor > 0 && investmentAllocation > 0) {
    warnings.push("Part of the emergency reserve remains unfunded; consider directing investment allocation to the reserve first.");
  }

  const projections = buildProjectionScenarios({
    principalMinor: investmentAllocation,
    targetAnnualReturnBps: input.targetAnnualReturnBps,
    horizonMonths: input.horizonMonths,
    compoundsPerYear: input.compoundsPerYear ?? 12,
  });

  return {
    version: ADVISOR_VERSION,
    currency: input.currency.toUpperCase(),
    grossAvailableMinor,
    availableMinor: Math.max(0, grossAvailableMinor - deficitMinor),
    committedMinor,
    deficitMinor,
    emergencyTargetMinor,
    emergencyShortfallMinor,
    allocations,
    warnings: unique(warnings),
    assumptions,
    projections,
    deterministicExplanation: buildExplanation({
      grossAvailableMinor,
      deficitMinor,
      emergencyShortfallMinor,
      investmentAllocation,
      goalCount: input.goals.length,
    }),
  };
}

function allocate(
  allocations: AllocationLine[],
  remaining: number,
  requested: number,
  bucket: AllocationLine["bucket"],
  referenceId: string | null,
  label: string,
  priority: number,
  rationale: string,
  total: number,
): number {
  const amount = Math.max(0, Math.min(remaining, requested));
  if (amount > 0) {
    allocations.push(line(bucket, referenceId, label, amount, priority, rationale, total));
  }
  return remaining - amount;
}

function line(
  bucket: AllocationLine["bucket"],
  referenceId: string | null,
  label: string,
  amountMinor: number,
  priority: number,
  rationale: string,
  total: number,
): AllocationLine {
  return {
    bucket,
    referenceId,
    label,
    amountMinor,
    percentageBps: total <= 0 ? 0 : Math.round((amountMinor / total) * 10_000),
    priority,
    rationale,
  };
}

function sortGoals(goals: GoalAdvisorInput[]): GoalAdvisorInput[] {
  return [...goals].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    const aDate = a.targetDate ? Date.parse(a.targetDate) : Number.POSITIVE_INFINITY;
    const bDate = b.targetDate ? Date.parse(b.targetDate) : Number.POSITIVE_INFINITY;
    return aDate - bDate;
  });
}

function investmentRationale(input: AdvisorInput): string {
  return `Only the residual after essentials, reserve, prioritized goals, and the discretionary cap is assigned to investment. Profile: ${input.riskTolerance}; horizon: ${input.horizonMonths} months.`;
}

function buildExplanation(input: {
  grossAvailableMinor: number;
  deficitMinor: number;
  emergencyShortfallMinor: number;
  investmentAllocation: number;
  goalCount: number;
}): string {
  if (input.deficitMinor > 0) {
    return "The plan identifies a cash deficit. It prioritizes essential obligations and does not assume that investment returns can solve an immediate liquidity gap.";
  }
  if (input.investmentAllocation === 0) {
    return "All available money is assigned to essential obligations, emergency reserve, goals, or the selected discretionary cap. No additional investment is proposed for this period.";
  }
  return `The plan protects essential spending and the emergency reserve, considers ${input.goalCount} goal(s), and assigns only the remaining money to an illustrative long-term investment scenario.`;
}

function validateAdvisorInput(input: AdvisorInput): void {
  const integerFields: Array<[string, number]> = [
    ["liquidBalanceMinor", input.liquidBalanceMinor],
    ["expectedIncomeMinor", input.expectedIncomeMinor],
    ["essentialExpensesMinor", input.essentialExpensesMinor],
    ["discretionaryBudgetMinor", input.discretionaryBudgetMinor],
    ["emergencyFundCurrentMinor", input.emergencyFundCurrentMinor],
    ["monthlyEssentialExpensesMinor", input.monthlyEssentialExpensesMinor],
  ];
  for (const [name, value] of integerFields) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer.`);
  }
  if (!Number.isFinite(input.emergencyMonthsTarget) || input.emergencyMonthsTarget < 0) {
    throw new Error("emergencyMonthsTarget must be non-negative.");
  }
  if (!Number.isFinite(input.horizonMonths) || input.horizonMonths < 0) {
    throw new Error("horizonMonths must be non-negative.");
  }
  for (const goal of input.goals) {
    if (!Number.isSafeInteger(goal.remainingMinor) || goal.remainingMinor < 0) {
      throw new Error(`Goal ${goal.id} has an invalid remaining amount.`);
    }
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
