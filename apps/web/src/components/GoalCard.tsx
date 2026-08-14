import { useState, type FormEvent } from "react";
import { formatMinor, requiredPeriodicContribution, toMinorUnits } from "@capitalflow/core";

import { contributeToGoal } from "../lib/data";
import type { Goal } from "../lib/types";
import { Notice } from "./Notice";

export function GoalCard({ goal, categoryName, onUpdated }: { goal: Goal; categoryName: string | null; onUpdated(): Promise<void> | void }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const percentage = goal.target_minor <= 0 ? 0 : Math.min(100, Math.round(goal.current_minor / goal.target_minor * 100));
  const remaining = Math.max(0, goal.target_minor - goal.current_minor);
  const monthlySuggestion = calculateMonthlySuggestion(goal, remaining);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await contributeToGoal(goal.id, toMinorUnits(amount, goal.currency), note.trim() || null);
      setAmount("");
      setNote("");
      setExpanded(false);
      await onUpdated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo registrar el aporte.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="goal-card">
      <div className="goal-topline">
        <div><div className="pill-row"><span className="priority-pill">Prioridad {goal.priority}</span>{categoryName ? <span className="category-pill">{categoryName}</span> : null}</div><h2>{goal.name}</h2></div>
        <span className={`status-pill ${goal.status}`}>{goal.status === "completed" ? "Completada" : goal.status === "active" ? "Activa" : goal.status}</span>
      </div>
      <div className="goal-amounts"><strong>{formatMinor(goal.current_minor, goal.currency)}</strong><span>de {formatMinor(goal.target_minor, goal.currency)}</span></div>
      <progress max="100" value={percentage}>{percentage}%</progress>
      <div className="goal-meta">
        <span>{percentage}% logrado</span>
        <span>Faltan {formatMinor(remaining, goal.currency)}</span>
        {goal.target_date ? <span>Meta: {new Date(`${goal.target_date}T12:00:00`).toLocaleDateString("es-CO")}</span> : null}
      </div>
      {monthlySuggestion !== null && remaining > 0 ? <p className="micro-advice">Aporte mensual orientativo sin asumir rentabilidad: {formatMinor(monthlySuggestion, goal.currency)}.</p> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {goal.status !== "completed" ? (
        <>
          <button className="secondary-button" type="button" onClick={() => setExpanded(!expanded)}>{expanded ? "Cancelar" : "Asignar monto"}</button>
          {expanded ? (
            <form className="inline-form" onSubmit={(event) => void submit(event)}>
              <label className="field"><span>Monto ({goal.currency})</span><input type="number" min="0" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
              <label className="field"><span>Nota</span><input value={note} onChange={(event) => setNote(event.target.value)} maxLength={160} placeholder="Opcional" /></label>
              <button className="primary-button" type="submit" disabled={busy}>{busy ? "Guardando…" : "Confirmar aporte"}</button>
            </form>
          ) : null}
        </>
      ) : null}
    </article>
  );
}

function calculateMonthlySuggestion(goal: Goal, remaining: number): number | null {
  if (!goal.target_date || remaining <= 0) return null;
  const today = new Date();
  const target = new Date(`${goal.target_date}T12:00:00`);
  const months = Math.max(1, Math.ceil((target.getTime() - today.getTime()) / (30.4375 * 24 * 60 * 60 * 1000)));
  if (target <= today) return remaining;
  return requiredPeriodicContribution({
    targetMinor: goal.target_minor,
    currentPrincipalMinor: goal.current_minor,
    annualRateBps: 0,
    periods: months,
  });
}
