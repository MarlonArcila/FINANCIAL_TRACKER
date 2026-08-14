import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  buildAllocationPlan,
  educationalAssetClasses,
  formatMinor,
  fromMinorUnits,
  toMinorUnits,
  type AllocationPlan,
  type RiskTolerance,
} from "@capitalflow/core";

import { Notice } from "../components/Notice";
import { invokeFunction } from "../lib/api";
import { demoMode } from "../lib/env";
import { listGoals, loadAdvisorSnapshot, loadProfile, loadSubscription } from "../lib/data";
import type { AdvisorSnapshot, Goal } from "../lib/types";

interface AdvisorForm {
  currency: string;
  liquid: string;
  expectedIncome: string;
  essentialExpenses: string;
  discretionary: string;
  emergencyCurrent: string;
  monthlyEssentials: string;
  emergencyMonths: string;
  horizonMonths: string;
  targetReturnPercent: string;
  risk: RiskTolerance;
}

const initialForm: AdvisorForm = {
  currency: "COP",
  liquid: "1500000",
  expectedIncome: "3000000",
  essentialExpenses: "1800000",
  discretionary: "400000",
  emergencyCurrent: "1200000",
  monthlyEssentials: "1800000",
  emergencyMonths: "3",
  horizonMonths: "60",
  targetReturnPercent: "8",
  risk: "medium",
};

export function AdvisorPage({ userId }: { userId: string }) {
  const [form, setForm] = useState<AdvisorForm>(initialForm);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [includeGoals, setIncludeGoals] = useState(true);
  const [plan, setPlan] = useState<AllocationPlan | null>(null);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [busyAi, setBusyAi] = useState(false);
  const [annualAiEnabled, setAnnualAiEnabled] = useState(false);
  const [currencies, setCurrencies] = useState<string[]>(["COP"]);
  const [snapshotAssumptions, setSnapshotAssumptions] = useState<string[]>([]);
  const [busySnapshot, setBusySnapshot] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listGoals(), loadSubscription(userId), loadProfile(userId)]).then(async ([nextGoals, subscription, profile]) => {
      setGoals(nextGoals);
      setCurrencies(profile.enabled_currencies);
      const initialCurrency = profile.base_currency;
      setAnnualAiEnabled(Boolean(subscription && subscription.interval === "annual" && (subscription.status === "active" || subscription.status === "trialing") && (!subscription.current_period_end || Date.parse(subscription.current_period_end) > Date.now())));
      try {
        const snapshot = await loadAdvisorSnapshot(userId, initialCurrency);
        applySnapshot(snapshot);
      } catch {
        setForm((current) => ({ ...current, currency: initialCurrency }));
      }
    }).catch(() => { setGoals([]); setAnnualAiEnabled(false); });
  }, [userId]);

  const assetClasses = useMemo(
    () => educationalAssetClasses(form.risk, Number(form.horizonMonths) || 0),
    [form.risk, form.horizonMonths],
  );

  function applySnapshot(snapshot: AdvisorSnapshot): void {
    setForm({
      currency: snapshot.currency,
      liquid: String(fromMinorUnits(snapshot.liquidBalanceMinor, snapshot.currency)),
      expectedIncome: String(fromMinorUnits(snapshot.averageMonthlyIncomeMinor, snapshot.currency)),
      essentialExpenses: String(fromMinorUnits(snapshot.averageMonthlyEssentialExpenseMinor, snapshot.currency)),
      discretionary: String(fromMinorUnits(snapshot.averageMonthlyDiscretionaryExpenseMinor, snapshot.currency)),
      emergencyCurrent: String(fromMinorUnits(snapshot.estimatedEmergencyFundMinor, snapshot.currency)),
      monthlyEssentials: String(fromMinorUnits(snapshot.averageMonthlyEssentialExpenseMinor, snapshot.currency)),
      emergencyMonths: String(snapshot.emergencyMonthsTarget),
      horizonMonths: String(snapshot.horizonMonths),
      targetReturnPercent: String(snapshot.targetAnnualReturnBps / 100),
      risk: snapshot.riskTolerance,
    });
    setSnapshotAssumptions(snapshot.assumptions);
    setPlan(null);
    setAiExplanation(null);
  }

  async function refreshSnapshot(currency = form.currency): Promise<void> {
    setBusySnapshot(true);
    setError(null);
    try {
      applySnapshot(await loadAdvisorSnapshot(userId, currency));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible precargar los datos del tracker.");
    } finally {
      setBusySnapshot(false);
    }
  }

  function update<K extends keyof AdvisorForm>(key: K, value: AdvisorForm[K]): void {
    setForm((current) => ({ ...current, [key]: value }));
    setPlan(null);
    setAiExplanation(null);
  }

  function calculate(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    setAiExplanation(null);
    try {
      const currency = form.currency.toUpperCase();
      const nextPlan = buildAllocationPlan({
        currency,
        liquidBalanceMinor: toMinorUnits(form.liquid || "0", currency),
        expectedIncomeMinor: toMinorUnits(form.expectedIncome || "0", currency),
        essentialExpensesMinor: toMinorUnits(form.essentialExpenses || "0", currency),
        discretionaryBudgetMinor: toMinorUnits(form.discretionary || "0", currency),
        emergencyFundCurrentMinor: toMinorUnits(form.emergencyCurrent || "0", currency),
        monthlyEssentialExpensesMinor: toMinorUnits(form.monthlyEssentials || "0", currency),
        emergencyMonthsTarget: Number(form.emergencyMonths),
        goals: includeGoals ? goals.filter((goal) => goal.status === "active" && goal.currency === currency).map((goal) => ({
          id: goal.id,
          name: goal.name,
          remainingMinor: Math.max(0, goal.target_minor - goal.current_minor),
          priority: goal.priority,
          ...(goal.target_date ? { targetDate: goal.target_date } : {}),
        })) : [],
        riskTolerance: form.risk,
        horizonMonths: Number(form.horizonMonths),
        targetAnnualReturnBps: Math.round(Number(form.targetReturnPercent) * 100),
      });
      setPlan(nextPlan);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible construir el plan.");
    }
  }

  async function explainWithAi(): Promise<void> {
    if (!plan || !annualAiEnabled) return;
    setBusyAi(true);
    setError(null);
    try {
      if (demoMode) {
        setAiExplanation(`${plan.deterministicExplanation} La capa de IA está simulada en modo demo y no modifica ningún monto.`);
        return;
      }
      const result = await invokeFunction<{ explanation: string }>("ai-advisor", {
        plan,
        userPreferences: {
          language: "es",
          tone: "educational",
        },
      });
      setAiExplanation(result.explanation);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible generar la explicación con IA.");
    } finally {
      setBusyAi(false);
    }
  }

  return (
    <section className="page">
      <div className="page-heading"><div><span className="eyebrow">ASIGNACIÓN EXPLICABLE</span><h1>Plan de dinero disponible</h1><p>Primero calcula con reglas; después, opcionalmente, pide una explicación con IA.</p></div></div>
      <Notice tone="info">El resultado es educativo. No recomienda productos concretos, no garantiza rentabilidad y no reemplaza asesoría financiera regulada.</Notice>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {snapshotAssumptions.length ? <Notice tone="info">Autocompletado: {snapshotAssumptions.join(" ")}</Notice> : null}
      <div className="advisor-layout">
        <form className="form-card advisor-form" onSubmit={calculate}>
          <div className="button-row"><button className="text-button" type="button" disabled={busySnapshot} onClick={() => void refreshSnapshot()}>{busySnapshot ? "Actualizando…" : "Actualizar cifras desde el tracker"}</button></div>
          <small>Las cifras se precargan automáticamente desde tus cuentas y movimientos confirmados; puedes corregir cualquier supuesto antes de calcular.</small>
          <div className="form-grid">
            <label className="field"><span>Moneda</span><select value={form.currency} onChange={(event) => { update("currency", event.target.value); void refreshSnapshot(event.target.value); }}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
            <label className="field"><span>Dinero líquido actual</span><input type="number" min="0" step="any" value={form.liquid} onChange={(event) => update("liquid", event.target.value)} required /></label>
            <label className="field"><span>Ingresos esperados del periodo</span><input type="number" min="0" step="any" value={form.expectedIncome} onChange={(event) => update("expectedIncome", event.target.value)} required /></label>
            <label className="field"><span>Gastos esenciales del periodo</span><input type="number" min="0" step="any" value={form.essentialExpenses} onChange={(event) => update("essentialExpenses", event.target.value)} required /></label>
            <label className="field"><span>Tope de gasto discrecional</span><input type="number" min="0" step="any" value={form.discretionary} onChange={(event) => update("discretionary", event.target.value)} required /></label>
            <label className="field"><span>Reserva de emergencia actual</span><input type="number" min="0" step="any" value={form.emergencyCurrent} onChange={(event) => update("emergencyCurrent", event.target.value)} required /></label>
            <label className="field"><span>Gasto esencial mensual</span><input type="number" min="0" step="any" value={form.monthlyEssentials} onChange={(event) => update("monthlyEssentials", event.target.value)} required /></label>
            <label className="field"><span>Meses de reserva objetivo</span><input type="number" min="0" step="0.5" value={form.emergencyMonths} onChange={(event) => update("emergencyMonths", event.target.value)} required /></label>
            <label className="field"><span>Horizonte de inversión (meses)</span><input type="number" min="0" step="1" value={form.horizonMonths} onChange={(event) => update("horizonMonths", event.target.value)} required /></label>
            <label className="field"><span>Rentabilidad anual deseada (%)</span><input type="number" min="-99" max="100" step="0.1" value={form.targetReturnPercent} onChange={(event) => update("targetReturnPercent", event.target.value)} required /></label>
            <label className="field"><span>Tolerancia al riesgo</span><select value={form.risk} onChange={(event) => update("risk", event.target.value as RiskTolerance)}><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option></select></label>
            <label className="checkbox-field span-2"><input type="checkbox" checked={includeGoals} onChange={(event) => { setIncludeGoals(event.target.checked); setPlan(null); }} /><span>Incluir {goals.filter((goal) => goal.status === "active").length} meta(s) activa(s) de la misma moneda</span></label>
          </div>
          <button className="primary-button" type="submit">Calcular plan sin IA</button>
        </form>
        <aside className="panel educational-panel">
          <span className="eyebrow">CLASES EDUCATIVAS COMPATIBLES</span>
          <h2>Opciones por riesgo y plazo</h2>
          <p>Son categorías generales para conversar con un profesional o investigar; no son instrumentos ni promesas.</p>
          <div className="asset-list">
            {assetClasses.map((asset) => <article key={asset.name}><strong>{asset.name}</strong><span>Riesgo {asset.risk}</span><p>{asset.purpose}</p></article>)}
          </div>
        </aside>
      </div>
      {plan ? <PlanResult plan={plan} aiExplanation={aiExplanation} busyAi={busyAi} annualAiEnabled={annualAiEnabled} onExplain={() => void explainWithAi()} /> : null}
    </section>
  );
}

function PlanResult({ plan, aiExplanation, busyAi, annualAiEnabled, onExplain }: { plan: AllocationPlan; aiExplanation: string | null; busyAi: boolean; annualAiEnabled: boolean; onExplain(): void }) {
  return (
    <section className="plan-result" aria-live="polite">
      <div className="page-heading compact-heading"><div><span className="eyebrow">RESULTADO {plan.version}</span><h2>Orden propuesto</h2><p>{plan.deterministicExplanation}</p></div>{annualAiEnabled ? <button className="secondary-button" type="button" disabled={busyAi} onClick={onExplain}>{busyAi ? "Explicando…" : "Explicar con IA"}</button> : <button className="secondary-button" type="button" onClick={() => { window.location.hash = "/subscription"; }}>IA disponible en anual</button>}</div>
      {plan.warnings.map((warning) => <Notice tone="warning" key={warning}>{warning}</Notice>)}
      <div className="allocation-list">
        {plan.allocations.map((line, index) => (
          <article key={`${line.bucket}-${line.referenceId ?? index}`}>
            <div className="allocation-number">{index + 1}</div>
            <div><strong>{line.label}</strong><p>{line.rationale}</p></div>
            <div className="allocation-value"><strong>{formatMinor(line.amountMinor, plan.currency)}</strong><span>{(line.percentageBps / 100).toFixed(1)}%</span></div>
          </article>
        ))}
      </div>
      <div className="scenario-grid">
        {plan.projections.map((scenario) => (
          <article className="scenario-card" key={scenario.name}>
            <span>{scenario.name === "conservative" ? "Conservador" : scenario.name === "base" ? "Base" : "Optimista"}</span>
            <strong>{formatMinor(scenario.projectedValueMinor, plan.currency)}</strong>
            <small>{(scenario.annualRateBps / 100).toFixed(2)}% anual · ganancia ilustrativa {formatMinor(scenario.gainMinor, plan.currency)}</small>
          </article>
        ))}
      </div>
      {aiExplanation ? <article className="ai-explanation"><span className="eyebrow">EXPLICACIÓN IA — NO MODIFICA CIFRAS</span><p>{aiExplanation}</p></article> : null}
      <details><summary>Supuestos del cálculo</summary><ul>{plan.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></details>
    </section>
  );
}
