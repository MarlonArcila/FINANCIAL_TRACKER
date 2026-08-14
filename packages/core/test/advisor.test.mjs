import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAllocationPlan,
  calculateInvestmentReturn,
  futureValue,
  futureValueWithContributions,
  requiredPeriodicContribution,
} from "../dist/src/index.js";

test("allocation plan follows essentials, reserve, goals, discretion, investment", () => {
  const plan = buildAllocationPlan({
    currency: "COP",
    liquidBalanceMinor: 5_000_000,
    expectedIncomeMinor: 3_000_000,
    essentialExpensesMinor: 2_000_000,
    discretionaryBudgetMinor: 500_000,
    emergencyFundCurrentMinor: 4_000_000,
    monthlyEssentialExpensesMinor: 2_000_000,
    emergencyMonthsTarget: 3,
    goals: [
      {
        id: "goal-1",
        name: "Curso",
        remainingMinor: 750_000,
        requiredContributionMinor: 500_000,
        priority: 5,
        targetDate: "2026-12-01",
      },
    ],
    riskTolerance: "medium",
    horizonMonths: 60,
    targetAnnualReturnBps: 800,
  });

  assert.equal(plan.grossAvailableMinor, 8_000_000);
  assert.deepEqual(
    plan.allocations.map((line) => line.bucket),
    ["essential_expenses", "emergency_fund", "goal", "discretionary", "investment"],
  );
  assert.equal(plan.allocations.at(-1)?.amountMinor, 3_000_000);
  assert.equal(plan.deficitMinor, 0);
});

test("deficit blocks investment", () => {
  const plan = buildAllocationPlan({
    currency: "COP",
    liquidBalanceMinor: 500_000,
    expectedIncomeMinor: 500_000,
    essentialExpensesMinor: 1_500_000,
    discretionaryBudgetMinor: 100_000,
    emergencyFundCurrentMinor: 0,
    monthlyEssentialExpensesMinor: 1_500_000,
    emergencyMonthsTarget: 3,
    goals: [],
    riskTolerance: "low",
    horizonMonths: 12,
    targetAnnualReturnBps: 400,
  });

  assert.equal(plan.deficitMinor, 500_000);
  assert.equal(plan.allocations.some((line) => line.bucket === "investment"), false);
  assert.match(plan.deterministicExplanation, /cash deficit/i);
});

test("compound-interest helpers return reproducible values", () => {
  assert.equal(futureValue(1_000_000, 1_000, 1, 12), 1_104_713);
  assert.equal(
    futureValueWithContributions({
      principalMinor: 1_000_000,
      periodicContributionMinor: 100_000,
      annualRateBps: 1_000,
      periods: 12,
    }),
    2_361_270,
  );

  const required = requiredPeriodicContribution({
    targetMinor: 5_000_000,
    currentPrincipalMinor: 1_000_000,
    annualRateBps: 800,
    periods: 24,
  });
  assert.ok(required > 0);
  assert.ok(required < 200_000);
});

test("investment return reports null percentage without contributions", () => {
  assert.deepEqual(calculateInvestmentReturn(0, 100_000), {
    gainMinor: 100_000,
    returnBps: null,
  });
  assert.deepEqual(calculateInvestmentReturn(1_000_000, 1_150_000), {
    gainMinor: 150_000,
    returnBps: 1_500,
  });
});
