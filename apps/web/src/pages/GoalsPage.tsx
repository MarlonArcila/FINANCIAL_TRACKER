import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { toMinorUnits } from "@capitalflow/core";

import { GoalCard } from "../components/GoalCard";
import { InlineCategoryCreator } from "../components/InlineCategoryCreator";
import { LoadingScreen } from "../components/LoadingScreen";
import { Notice } from "../components/Notice";
import { createGoal, listCategories, listGoals, loadProfile } from "../lib/data";
import type { Category, Goal } from "../lib/types";

export function GoalsPage({ userId }: { userId: string }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [showCategoryCreator, setShowCategoryCreator] = useState(false);
  const [target, setTarget] = useState("");
  const [currency, setCurrency] = useState("COP");
  const [currencies, setCurrencies] = useState<string[]>(["COP"]);
  const [targetDate, setTargetDate] = useState("");
  const [priority, setPriority] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextGoals, nextCategories, profile] = await Promise.all([listGoals(), listCategories(), loadProfile(userId)]);
      setGoals(nextGoals);
      setCategories(nextCategories);
      setCurrencies(profile.enabled_currencies);
      setCurrency((current) => profile.enabled_currencies.includes(current) ? current : profile.base_currency);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible cargar las metas.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const eligibleCategories = useMemo(
    () => categories.filter((category) => category.kind === "goal" || category.kind === "mixed"),
    [categories],
  );
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createGoal({
        category_id: categoryId || null,
        name: name.trim(),
        target_minor: toMinorUnits(target, currency),
        currency: currency.toUpperCase(),
        target_date: targetDate || null,
        priority,
      });
      setName("");
      setCategoryId("");
      setShowCategoryCreator(false);
      setTarget("");
      setTargetDate("");
      setShowForm(false);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible crear la meta.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingScreen label="Cargando metas…" />;

  return (
    <section className="page">
      <div className="page-heading">
        <div><span className="eyebrow">AHORRO CON PROPÓSITO</span><h1>Metas</h1><p>Asigna aportes explícitos y observa cuánto falta.</p></div>
        <button className="primary-button" type="button" onClick={() => setShowForm(!showForm)}>{showForm ? "Cerrar" : "+ Nueva meta"}</button>
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {showForm ? (
        <form className="form-card" onSubmit={(event) => void submit(event)}>
          <div className="form-grid">
            <label className="field span-2"><span>Nombre de la meta</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required placeholder="Ej. Fondo de emergencia" /></label>
            <label className="field"><span>Categoría</span><select value={categoryId} onChange={(event) => { if (event.target.value === "__create__") { setCategoryId(""); setShowCategoryCreator(true); return; } setShowCategoryCreator(false); setCategoryId(event.target.value); }}><option value="">Automática: nombre de la meta</option>{eligibleCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}<option value="__create__">＋ Crear categoría</option></select></label>
            {showCategoryCreator ? <div className="inline-category-slot span-2"><InlineCategoryCreator defaultKind="goal" options={[{ value: "goal", label: "Metas" }]} onCancel={() => setShowCategoryCreator(false)} onCreated={(category) => { setCategories((current) => [...current.filter((item) => item.id !== category.id), category].sort((a, b) => a.name.localeCompare(b.name, "es"))); setCategoryId(category.id); setShowCategoryCreator(false); }} /></div> : null}
            <label className="field"><span>Monto objetivo</span><input type="number" min="0" step="any" value={target} onChange={(event) => setTarget(event.target.value)} required /></label>
            <label className="field"><span>Moneda</span><select value={currency} onChange={(event) => setCurrency(event.target.value)}>{currencies.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="field"><span>Fecha objetivo</span><input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label>
            <label className="field"><span>Prioridad</span><select value={priority} onChange={(event) => setPriority(Number(event.target.value) as 1 | 2 | 3 | 4 | 5)}>{[5,4,3,2,1].map((item) => <option key={item} value={item}>{item} · {item === 5 ? "Máxima" : item === 1 ? "Baja" : "Media"}</option>)}</select></label>
          </div>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "Creando…" : "Crear meta"}</button>
        </form>
      ) : null}
      <div className="card-grid">
        {goals.map((goal) => <GoalCard key={goal.id} goal={goal} categoryName={goal.category_id ? categoryById.get(goal.category_id) ?? null : null} categories={categories} onUpdated={load} />)}
      </div>
      {goals.length === 0 ? <div className="empty-card"><strong>Define tu primera meta</strong><p>Puede ser una reserva, viaje, estudio, compra o cualquier objetivo medible.</p></div> : null}
    </section>
  );
}
