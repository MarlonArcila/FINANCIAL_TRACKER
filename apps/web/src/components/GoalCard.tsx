import { useMemo, useState, type FormEvent } from "react";
import { formatMinor, fromMinorUnits, requiredPeriodicContribution, toMinorUnits } from "@capitalflow/core";

import { contributeToGoal, deleteGoal, updateGoal } from "../lib/data";
import type { Category, Goal } from "../lib/types";
import { Notice } from "./Notice";

export function GoalCard({
  goal,
  categoryName,
  categories,
  onUpdated,
}: {
  goal: Goal;
  categoryName: string | null;
  categories: Category[];
  onUpdated(): Promise<void> | void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(goal.name);
  const [editCategoryId, setEditCategoryId] = useState(goal.category_id ?? "");
  const [editTarget, setEditTarget] = useState(String(fromMinorUnits(goal.target_minor, goal.currency)));
  const [editTargetDate, setEditTargetDate] = useState(goal.target_date ?? "");
  const [editPriority, setEditPriority] = useState<1 | 2 | 3 | 4 | 5>(goal.priority);
  const [editStatus, setEditStatus] = useState<Goal["status"]>(goal.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const percentage = goal.target_minor <= 0 ? 0 : Math.min(100, Math.round(goal.current_minor / goal.target_minor * 100));
  const remaining = Math.max(0, goal.target_minor - goal.current_minor);
  const monthlySuggestion = calculateMonthlySuggestion(goal, remaining);
  const eligibleCategories = useMemo(
    () => categories.filter((category) => category.kind === "goal" || category.kind === "mixed"),
    [categories],
  );

  async function submitContribution(event: FormEvent<HTMLFormElement>): Promise<void> {
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

  function openEditor(): void {
    setExpanded(false);
    setEditing(true);
    setEditName(goal.name);
    setEditCategoryId(goal.category_id ?? "");
    setEditTarget(String(fromMinorUnits(goal.target_minor, goal.currency)));
    setEditTargetDate(goal.target_date ?? "");
    setEditPriority(goal.priority);
    setEditStatus(goal.status);
    setError(null);
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const targetMinor = toMinorUnits(editTarget, goal.currency);
      if (targetMinor <= 0) throw new Error("El monto objetivo debe ser mayor que cero.");
      await updateGoal(goal.id, {
        name: editName.trim(),
        category_id: editCategoryId || null,
        target_minor: targetMinor,
        target_date: editTargetDate || null,
        priority: editPriority,
        status: goal.current_minor >= targetMinor && editStatus === "active" ? "completed" : editStatus,
      });
      setEditing(false);
      await onUpdated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo editar la meta.");
    } finally {
      setBusy(false);
    }
  }

  async function removeGoal(): Promise<void> {
    if (!window.confirm(`¿Eliminar la meta “${goal.name}”? Sus aportes asociados también se eliminarán.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteGoal(goal.id);
      await onUpdated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo eliminar la meta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="goal-card">
      <div className="goal-topline">
        <div><div className="pill-row"><span className="priority-pill">Prioridad {goal.priority}</span>{categoryName ? <span className="category-pill">{categoryName}</span> : null}</div><h2>{goal.name}</h2></div>
        <span className={`status-pill ${goal.status}`}>{goal.status === "completed" ? "Completada" : goal.status === "active" ? "Activa" : goal.status === "paused" ? "Pausada" : "Cancelada"}</span>
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

      <div className="button-row">
        {goal.status !== "completed" && goal.status !== "canceled" ? <button className="secondary-button" type="button" onClick={() => { setEditing(false); setExpanded(!expanded); }}>{expanded ? "Cancelar aporte" : "Asignar monto"}</button> : null}
        <button className="secondary-button" type="button" onClick={() => editing ? setEditing(false) : openEditor()}>{editing ? "Cancelar edición" : "Editar meta"}</button>
        <button className="ghost-danger" type="button" disabled={busy} onClick={() => void removeGoal()}>Eliminar</button>
      </div>

      {expanded ? (
        <form className="inline-form" onSubmit={(event) => void submitContribution(event)}>
          <label className="field"><span>Monto ({goal.currency})</span><input type="number" min="0" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
          <label className="field"><span>Nota</span><input value={note} onChange={(event) => setNote(event.target.value)} maxLength={160} placeholder="Opcional" /></label>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "Guardando…" : "Confirmar aporte"}</button>
        </form>
      ) : null}

      {editing ? (
        <form className="inline-form goal-edit-form" onSubmit={(event) => void submitEdit(event)}>
          <label className="field"><span>Nombre</span><input value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={80} required /></label>
          <label className="field"><span>Categoría</span><select value={editCategoryId} onChange={(event) => setEditCategoryId(event.target.value)}><option value="">Automática: nombre de la meta</option>{eligibleCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label className="field"><span>Monto objetivo ({goal.currency})</span><input type="number" min="0" step="any" value={editTarget} onChange={(event) => setEditTarget(event.target.value)} required /></label>
          <label className="field"><span>Fecha objetivo</span><input type="date" value={editTargetDate} onChange={(event) => setEditTargetDate(event.target.value)} /></label>
          <label className="field"><span>Prioridad</span><select value={editPriority} onChange={(event) => setEditPriority(Number(event.target.value) as 1 | 2 | 3 | 4 | 5)}>{[5,4,3,2,1].map((item) => <option key={item} value={item}>{item} · {item === 5 ? "Máxima" : item === 1 ? "Baja" : "Media"}</option>)}</select></label>
          <label className="field"><span>Estado</span><select value={editStatus} onChange={(event) => setEditStatus(event.target.value as Goal["status"])}><option value="active">Activa</option><option value="paused">Pausada</option><option value="completed">Completada</option><option value="canceled">Cancelada</option></select></label>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar cambios"}</button>
        </form>
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
