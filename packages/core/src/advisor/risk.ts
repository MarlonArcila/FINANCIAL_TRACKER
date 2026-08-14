import type { ProjectionScenario, RiskTolerance } from "../domain.js";
import { futureValue } from "./compound.js";

export function assessReturnFeasibility(input: {
  targetAnnualReturnBps: number;
  horizonMonths: number;
  riskTolerance: RiskTolerance;
}): string[] {
  const warnings: string[] = [];
  const { targetAnnualReturnBps, horizonMonths, riskTolerance } = input;

  if (targetAnnualReturnBps < 0) {
    warnings.push("The target return is negative; verify whether this is intentional.");
  }
  if (horizonMonths < 12 && targetAnnualReturnBps > 500) {
    warnings.push("A short horizon and a high return target may require volatility that is incompatible with near-term liquidity.");
  }
  if (riskTolerance === "low" && targetAnnualReturnBps > 600) {
    warnings.push("The return target is high relative to the selected low risk tolerance.");
  }
  if (riskTolerance === "medium" && targetAnnualReturnBps > 1200) {
    warnings.push("The return target is aggressive for a medium risk profile and should be treated as an optimistic scenario.");
  }
  if (targetAnnualReturnBps > 2000) {
    warnings.push("The target exceeds the educational range used by the MVP; do not treat it as an expected or guaranteed outcome.");
  }
  return warnings;
}

export function buildProjectionScenarios(input: {
  principalMinor: number;
  targetAnnualReturnBps: number;
  horizonMonths: number;
  compoundsPerYear?: number;
}): ProjectionScenario[] {
  const years = Math.max(0, input.horizonMonths / 12);
  const rates = {
    conservative: Math.max(-200, Math.round(input.targetAnnualReturnBps * 0.5)),
    base: input.targetAnnualReturnBps,
    optimistic: Math.min(2500, Math.round(input.targetAnnualReturnBps * 1.5)),
  } as const;

  return (Object.entries(rates) as Array<[ProjectionScenario["name"], number]>).map(([name, rate]) => {
    const projectedValueMinor = futureValue(
      input.principalMinor,
      rate,
      years,
      input.compoundsPerYear ?? 12,
    );
    return {
      name,
      annualRateBps: rate,
      projectedValueMinor,
      gainMinor: projectedValueMinor - input.principalMinor,
      disclaimer: "Illustrative scenario based on user inputs; it is not a forecast or guarantee.",
    };
  });
}

export function educationalAssetClasses(
  riskTolerance: RiskTolerance,
  horizonMonths: number,
): Array<{ name: string; risk: string; purpose: string }> {
  const classes = [
    { name: "Cash and liquidity reserve", risk: "low", purpose: "Near-term expenses and emergency access." },
    { name: "High-quality fixed-income basket", risk: "low-to-medium", purpose: "Capital stability with defined horizon." },
    { name: "Diversified balanced portfolio", risk: "medium", purpose: "Medium/long-term growth with mixed assets." },
    { name: "Diversified equity exposure", risk: "high", purpose: "Long-term growth with material volatility." },
  ];

  return classes.filter((asset) => {
    if (horizonMonths < 12) return asset.risk === "low";
    if (riskTolerance === "low") return asset.risk !== "high";
    if (riskTolerance === "medium") return asset.risk !== "high" || horizonMonths >= 60;
    return true;
  });
}
