import type { InvestmentReturn } from "../domain.js";

export function futureValue(
  principalMinor: number,
  annualRateBps: number,
  years: number,
  compoundsPerYear = 12,
): number {
  validateProjectionInputs(principalMinor, annualRateBps, years, compoundsPerYear);
  if (years === 0) return Math.round(principalMinor);
  const annualRate = annualRateBps / 10_000;
  return Math.round(principalMinor * (1 + annualRate / compoundsPerYear) ** (compoundsPerYear * years));
}

export function futureValueWithContributions(input: {
  principalMinor: number;
  periodicContributionMinor: number;
  annualRateBps: number;
  periods: number;
  periodsPerYear?: number;
  contributionAtBeginning?: boolean;
}): number {
  const periodsPerYear = input.periodsPerYear ?? 12;
  validateProjectionInputs(input.principalMinor, input.annualRateBps, input.periods / periodsPerYear, periodsPerYear);
  assertNonNegativeSafeInteger(input.periodicContributionMinor, "periodicContributionMinor");
  if (!Number.isInteger(input.periods) || input.periods < 0) throw new Error("periods must be a non-negative integer.");

  const periodicRate = input.annualRateBps / 10_000 / periodsPerYear;
  const principalFuture = input.principalMinor * (1 + periodicRate) ** input.periods;
  const annuityFactor = periodicRate === 0
    ? input.periods
    : ((1 + periodicRate) ** input.periods - 1) / periodicRate;
  const timingFactor = input.contributionAtBeginning ? 1 + periodicRate : 1;
  return Math.round(principalFuture + input.periodicContributionMinor * annuityFactor * timingFactor);
}

export function requiredPeriodicContribution(input: {
  targetMinor: number;
  currentPrincipalMinor: number;
  annualRateBps: number;
  periods: number;
  periodsPerYear?: number;
  contributionAtBeginning?: boolean;
}): number {
  const periodsPerYear = input.periodsPerYear ?? 12;
  assertNonNegativeSafeInteger(input.targetMinor, "targetMinor");
  assertNonNegativeSafeInteger(input.currentPrincipalMinor, "currentPrincipalMinor");
  if (!Number.isInteger(input.periods) || input.periods <= 0) throw new Error("periods must be a positive integer.");

  const periodicRate = input.annualRateBps / 10_000 / periodsPerYear;
  const principalFuture = input.currentPrincipalMinor * (1 + periodicRate) ** input.periods;
  const remaining = Math.max(0, input.targetMinor - principalFuture);
  if (remaining === 0) return 0;

  const annuityFactor = periodicRate === 0
    ? input.periods
    : ((1 + periodicRate) ** input.periods - 1) / periodicRate;
  const timingFactor = input.contributionAtBeginning ? 1 + periodicRate : 1;
  if (annuityFactor <= 0) throw new Error("Invalid annuity factor.");
  return Math.ceil(remaining / (annuityFactor * timingFactor));
}

export function calculateInvestmentReturn(
  netContributionsMinor: number,
  currentValueMinor: number,
): InvestmentReturn {
  assertNonNegativeSafeInteger(netContributionsMinor, "netContributionsMinor");
  assertNonNegativeSafeInteger(currentValueMinor, "currentValueMinor");
  const gainMinor = currentValueMinor - netContributionsMinor;
  const returnBps = netContributionsMinor === 0
    ? null
    : Math.round((gainMinor / netContributionsMinor) * 10_000);
  return { gainMinor, returnBps };
}

function validateProjectionInputs(
  principalMinor: number,
  annualRateBps: number,
  years: number,
  compoundsPerYear: number,
): void {
  assertNonNegativeSafeInteger(principalMinor, "principalMinor");
  if (!Number.isFinite(annualRateBps) || annualRateBps <= -10_000) {
    throw new Error("annualRateBps must be finite and greater than -10000.");
  }
  if (!Number.isFinite(years) || years < 0) throw new Error("years must be non-negative.");
  if (!Number.isInteger(compoundsPerYear) || compoundsPerYear <= 0) {
    throw new Error("compoundsPerYear must be a positive integer.");
  }
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
}
