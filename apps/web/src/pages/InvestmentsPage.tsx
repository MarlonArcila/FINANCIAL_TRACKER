import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { formatMinor, fromMinorUnits, toMinorUnits, type RiskTolerance } from "@capitalflow/core";

import { InlineCategoryCreator } from "../components/InlineCategoryCreator";
import { LoadingScreen } from "../components/LoadingScreen";
import { Notice } from "../components/Notice";
import {
  createInvestment,
  deleteInvestment,
  listCategories,
  listInvestments,
  loadProfile,
  recordInvestmentActivity,
  recordInvestmentValuation,
  updateInvestment,
} from "../lib/data";
import type { Category, Investment } from "../lib/types";

type InvestmentUpdateKind = "valuation" | "contribution" | "withdrawal";

export function InvestmentsPage({ userId }: { userId: string }) {
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [assetClass, setAssetClass] = useState("Fondo diversificado");
  const [categoryId, setCategoryId] = useState("");
  const [showCategoryCreator, setShowCategoryCreator] = useState(false);
  const [currency, setCurrency] = useState("COP");
  const [currencies, setCurrencies] = useState<string[]>(["COP"]);
  const [contributions, setContributions] = useState("");
  const [currentValue, setCurrentValue] = useState("");
  const [risk, setRisk] = useState<RiskTolerance>("medium");
  const [notes, setNotes] = useState("");

  const [activityInvestmentId, setActivityInvestmentId] = useState<string | null>(null);
  const [updateKind, setUpdateKind] = useState<InvestmentUpdateKind>("valuation");
  const [updateAmount, setUpdateAmount] = useState("");
  const [updateDate, setUpdateDate] = useState(todayInputValue());
  const [updateNote, setUpdateNote] = useState("");

  const [detailsInvestmentId, setDetailsInvestmentId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editAssetClass, setEditAssetClass] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editRisk, setEditRisk] = useState<RiskTolerance>("medium");
  const [editNotes, setEditNotes] = useState("");
  const [editContributions, setEditContributions] = useState("");
  const [editCurrentValue, setEditCurrentValue] = useState("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextInvestments, nextCategories, profile] = await Promise.all([listInvestments(), listCategories(), loadProfile(userId)]);
      setInvestments(nextInvestments);
      setCategories(nextCategories);
      setCurrencies(profile.enabled_currencies);
      setCurrency((current) => profile.enabled_currencies.includes(current) ? current : profile.base_currency);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible cargar inversiones.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const eligibleCategories = useMemo(
    () => categories.filter((category) => category.kind === "investment" || category.kind === "mixed"),
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
      await createInvestment({
        category_id: categoryId || null,
        name: name.trim(),
        asset_class: assetClass.trim(),
        currency: currency.toUpperCase(),
        net_contributions_minor: toMinorUnits(contributions || "0", currency),
        current_value_minor: toMinorUnits(currentValue || "0", currency),
        risk_level: risk,
        notes: notes.trim() || null,
      });
      setName("");
      setCategoryId("");
      setShowCategoryCreator(false);
      setContributions("");
      setCurrentValue("");
      setNotes("");
      setShowForm(false);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible guardar la inversión.");
    } finally {
      setBusy(false);
    }
  }

  async function submitUpdate(event: FormEvent<HTMLFormElement>, investment: Investment): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const amountMinor = toMinorUnits(updateAmount || "0", investment.currency);
      if (updateKind !== "valuation" && amountMinor <= 0) throw new Error("El monto debe ser mayor que cero.");
      const occurredAt = localDateToIso(updateDate);
      if (updateKind === "valuation") {
        await recordInvestmentValuation({
          investment_id: investment.id,
          value_minor: amountMinor,
          valued_at: occurredAt,
          note: updateNote.trim() || null,
        });
      } else {
        await recordInvestmentActivity({
          investment_id: investment.id,
          kind: updateKind,
          amount_minor: amountMinor,
          occurred_at: occurredAt,
          note: updateNote.trim() || null,
        });
      }
      closeActivityForm();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible actualizar la inversión.");
    } finally {
      setBusy(false);
    }
  }

  function openActivityForm(investment: Investment): void {
    if (activityInvestmentId === investment.id) {
      closeActivityForm();
      return;
    }
    setDetailsInvestmentId(null);
    setActivityInvestmentId(investment.id);
    setUpdateKind("valuation");
    setUpdateAmount(String(fromMinorUnits(investment.current_value_minor, investment.currency)));
    setUpdateDate(todayInputValue());
    setUpdateNote("");
    setError(null);
  }

  function closeActivityForm(): void {
    setActivityInvestmentId(null);
    setUpdateKind("valuation");
    setUpdateAmount("");
    setUpdateDate(todayInputValue());
    setUpdateNote("");
  }

  function openDetailsEditor(investment: Investment): void {
    if (detailsInvestmentId === investment.id) {
      setDetailsInvestmentId(null);
      return;
    }
    closeActivityForm();
    setDetailsInvestmentId(investment.id);
    setEditName(investment.name);
    setEditAssetClass(investment.asset_class);
    setEditCategoryId(investment.category_id ?? "");
    setEditRisk(investment.risk_level);
    setEditNotes(investment.notes ?? "");
    setEditContributions(String(fromMinorUnits(investment.net_contributions_minor, investment.currency)));
    setEditCurrentValue(String(fromMinorUnits(investment.current_value_minor, investment.currency)));
    setError(null);
  }

  async function submitDetails(event: FormEvent<HTMLFormElement>, investment: Investment): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const desiredContributionsMinor = toMinorUnits(editContributions || "0", investment.currency);
      const desiredCurrentValueMinor = toMinorUnits(editCurrentValue || "0", investment.currency);
      const correctionAt = new Date().toISOString();

      if (desiredContributionsMinor !== investment.net_contributions_minor) {
        const delta = Math.abs(desiredContributionsMinor - investment.net_contributions_minor);
        await recordInvestmentActivity({
          investment_id: investment.id,
          kind: desiredContributionsMinor > investment.net_contributions_minor ? "contribution" : "withdrawal",
          amount_minor: delta,
          occurred_at: correctionAt,
          note: "Corrección manual de aportes netos",
        });
      }

      // A final valuation makes the editor authoritative even when the capital
      // correction above also generated its paired valuation.
      if (desiredCurrentValueMinor !== investment.current_value_minor || desiredContributionsMinor !== investment.net_contributions_minor) {
        await recordInvestmentValuation({
          investment_id: investment.id,
          value_minor: desiredCurrentValueMinor,
          valued_at: new Date().toISOString(),
          note: "Corrección manual del valor actual",
        });
      }

      await updateInvestment(investment.id, {
        name: editName.trim(),
        asset_class: editAssetClass.trim(),
        category_id: editCategoryId || null,
        risk_level: editRisk,
        notes: editNotes.trim() || null,
      });
      setDetailsInvestmentId(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible editar la inversión.");
    } finally {
      setBusy(false);
    }
  }

  async function removeInvestment(investment: Investment): Promise<void> {
    if (!window.confirm(`¿Eliminar la inversión “${investment.name}”? También se eliminarán sus movimientos y valoraciones.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteInvestment(investment.id);
      if (activityInvestmentId === investment.id) closeActivityForm();
      if (detailsInvestmentId === investment.id) setDetailsInvestmentId(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible eliminar la inversión.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingScreen label="Cargando inversiones…" />;

  const totalContributed = investments.reduce((sum, item) => sum + item.net_contributions_minor, 0);
  const totalValue = investments.reduce((sum, item) => sum + item.current_value_minor, 0);
  const singleCurrency = new Set(investments.map((item) => item.currency)).size <= 1;
  const summaryCurrency = investments[0]?.currency ?? "COP";

  return (
    <section className="page">
      <div className="page-heading">
        <div><span className="eyebrow">REGISTRO MANUAL</span><h1>Inversiones</h1><p>Capital aportado, valor actual y rentabilidad simple. Sin conexión a brokers.</p></div>
        <button className="primary-button" type="button" onClick={() => setShowForm(!showForm)}>{showForm ? "Cerrar" : "+ Nueva inversión"}</button>
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {singleCurrency && investments.length > 0 ? (
        <div className="metric-grid three">
          <article className="metric-card"><span>Aportes netos</span><strong>{formatMinor(totalContributed, summaryCurrency)}</strong></article>
          <article className="metric-card"><span>Valor actual</span><strong>{formatMinor(totalValue, summaryCurrency)}</strong></article>
          <article className="metric-card"><span>Ganancia/pérdida</span><strong>{formatMinor(totalValue - totalContributed, summaryCurrency)}</strong></article>
        </div>
      ) : null}
      {showForm ? (
        <form className="form-card" onSubmit={(event) => void submit(event)}>
          <div className="form-grid">
            <label className="field"><span>Nombre</span><input value={name} onChange={(event) => setName(event.target.value)} required placeholder="Ej. Portafolio largo plazo" /></label>
            <label className="field"><span>Clase de activo</span><input value={assetClass} onChange={(event) => setAssetClass(event.target.value)} required /></label>
            <label className="field"><span>Categoría</span><select value={categoryId} onChange={(event) => { if (event.target.value === "__create__") { setCategoryId(""); setShowCategoryCreator(true); return; } setShowCategoryCreator(false); setCategoryId(event.target.value); }}><option value="">Sin categoría</option>{eligibleCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}<option value="__create__">＋ Crear categoría</option></select></label>
            {showCategoryCreator ? <div className="inline-category-slot span-2"><InlineCategoryCreator defaultKind="investment" options={[{ value: "investment", label: "Inversiones" }]} onCancel={() => setShowCategoryCreator(false)} onCreated={(category) => { setCategories((current) => [...current.filter((item) => item.id !== category.id), category].sort((a, b) => a.name.localeCompare(b.name, "es"))); setCategoryId(category.id); setShowCategoryCreator(false); }} /></div> : null}
            <label className="field"><span>Aportes netos</span><input type="number" min="0" step="any" value={contributions} onChange={(event) => setContributions(event.target.value)} required /></label>
            <label className="field"><span>Valor actual</span><input type="number" min="0" step="any" value={currentValue} onChange={(event) => setCurrentValue(event.target.value)} required /></label>
            <label className="field"><span>Moneda</span><select value={currency} onChange={(event) => setCurrency(event.target.value)}>{currencies.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="field"><span>Riesgo declarado</span><select value={risk} onChange={(event) => setRisk(event.target.value as RiskTolerance)}><option value="low">Bajo</option><option value="medium">Medio</option><option value="high">Alto</option></select></label>
            <label className="field span-2"><span>Notas</span><input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={280} /></label>
          </div>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar inversión"}</button>
        </form>
      ) : null}
      <div className="card-grid">
        {investments.map((investment) => {
          const gain = investment.current_value_minor - investment.net_contributions_minor;
          const categoryName = investment.category_id ? categoryById.get(investment.category_id) ?? null : null;
          return (
            <article className="investment-card" key={investment.id}>
              <div className="goal-topline"><div><div className="pill-row"><span className={`risk-pill ${investment.risk_level}`}>Riesgo {riskLabel(investment.risk_level)}</span>{categoryName ? <span className="category-pill">{categoryName}</span> : null}</div><h2>{investment.name}</h2></div><strong className={gain >= 0 ? "positive" : "negative"}>{investment.return_bps === null ? "N/D" : `${(investment.return_bps / 100).toFixed(2)}%`}</strong></div>
              <p>{investment.asset_class}</p>
              <dl><div><dt>Aportado</dt><dd>{formatMinor(investment.net_contributions_minor, investment.currency)}</dd></div><div><dt>Valor actual</dt><dd>{formatMinor(investment.current_value_minor, investment.currency)}</dd></div><div><dt>Resultado</dt><dd>{formatMinor(gain, investment.currency)}</dd></div></dl>
              {investment.notes ? <small>{investment.notes}</small> : null}
              <p className="legal-copy">Rentabilidad simple basada en valores ingresados; no representa TIR, rendimiento anualizado ni garantía.</p>
              <div className="button-row">
                <button className="secondary-button" type="button" onClick={() => openActivityForm(investment)}>{activityInvestmentId === investment.id ? "Cancelar movimiento" : "Registrar movimiento o valoración"}</button>
                <button className="secondary-button" type="button" onClick={() => openDetailsEditor(investment)}>{detailsInvestmentId === investment.id ? "Cancelar edición" : "Editar inversión"}</button>
                <button className="ghost-danger" type="button" disabled={busy} onClick={() => void removeInvestment(investment)}>Eliminar</button>
              </div>

              {activityInvestmentId === investment.id ? (
                <form className="inline-form investment-update-form" onSubmit={(event) => void submitUpdate(event, investment)}>
                  <label className="field"><span>Tipo</span><select value={updateKind} onChange={(event) => { const nextKind = event.target.value as InvestmentUpdateKind; setUpdateKind(nextKind); setUpdateAmount(nextKind === "valuation" ? String(fromMinorUnits(investment.current_value_minor, investment.currency)) : ""); }}><option value="valuation">Nueva valoración total</option><option value="contribution">Aporte</option><option value="withdrawal">Retiro</option></select></label>
                  <label className="field"><span>{updateKind === "valuation" ? "Nuevo valor total" : "Monto"} ({investment.currency})</span><input type="number" min="0" step="any" value={updateAmount} onChange={(event) => setUpdateAmount(event.target.value)} required /></label>
                  <label className="field"><span>Fecha</span><input type="date" value={updateDate} onChange={(event) => setUpdateDate(event.target.value)} required /></label>
                  <label className="field"><span>Nota</span><input value={updateNote} onChange={(event) => setUpdateNote(event.target.value)} maxLength={160} placeholder="Opcional" /></label>
                  <p className="form-hint span-2">Un aporte aumenta aportes netos y valor actual por el mismo monto; un retiro reduce ambos. Una valoración solo cambia el valor actual y, por tanto, la ganancia/pérdida.</p>
                  <button className="primary-button" type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar actualización"}</button>
                </form>
              ) : null}

              {detailsInvestmentId === investment.id ? (
                <form className="inline-form investment-edit-form" onSubmit={(event) => void submitDetails(event, investment)}>
                  <label className="field"><span>Nombre</span><input value={editName} onChange={(event) => setEditName(event.target.value)} required /></label>
                  <label className="field"><span>Clase de activo</span><input value={editAssetClass} onChange={(event) => setEditAssetClass(event.target.value)} required /></label>
                  <label className="field"><span>Categoría</span><select value={editCategoryId} onChange={(event) => setEditCategoryId(event.target.value)}><option value="">Sin categoría</option>{eligibleCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
                  <label className="field"><span>Riesgo</span><select value={editRisk} onChange={(event) => setEditRisk(event.target.value as RiskTolerance)}><option value="low">Bajo</option><option value="medium">Medio</option><option value="high">Alto</option></select></label>
                  <label className="field"><span>Aportes netos ({investment.currency})</span><input type="number" min="0" step="any" value={editContributions} onChange={(event) => setEditContributions(event.target.value)} required /></label>
                  <label className="field"><span>Valor actual ({investment.currency})</span><input type="number" min="0" step="any" value={editCurrentValue} onChange={(event) => setEditCurrentValue(event.target.value)} required /></label>
                  <label className="field span-2"><span>Notas</span><input value={editNotes} onChange={(event) => setEditNotes(event.target.value)} maxLength={280} /></label>
                  <p className="form-hint span-2">Usa “Aportes netos” y “Valor actual” para corregir una captura equivocada. La moneda se mantiene fija para no mezclar historiales incompatibles.</p>
                  <button className="primary-button" type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar cambios"}</button>
                </form>
              ) : null}
            </article>
          );
        })}
      </div>
      {investments.length === 0 ? <div className="empty-card"><strong>Registra tu primera inversión</strong><p>El MVP no consulta precios: tú controlas aportes, retiros y valoraciones.</p></div> : null}
    </section>
  );
}

function riskLabel(value: RiskTolerance): string {
  return value === "low" ? "bajo" : value === "medium" ? "medio" : "alto";
}

function todayInputValue(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function localDateToIso(value: string): string {
  if (value === todayInputValue()) return new Date().toISOString();
  const date = new Date(`${value}T23:59:59.999`);
  if (Number.isNaN(date.getTime())) throw new Error("La fecha de la actualización no es válida.");
  return date.toISOString();
}
