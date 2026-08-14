import { useMemo, useState } from "react";
import { formatMinor, fromMinorUnits, toMinorUnits } from "@capitalflow/core";

import { decideCandidate } from "../lib/data";
import type { Account, Category, TransactionCandidate } from "../lib/types";
import { Notice } from "./Notice";

export function CandidateReview({
  candidate,
  accounts,
  categories,
  onDecided,
}: {
  candidate: TransactionCandidate;
  accounts: Account[];
  categories: Category[];
  onDecided(action?: "accept" | "reject"): Promise<void> | void;
}) {
  const [kind, setKind] = useState(candidate.proposed_kind);
  const [amount, setAmount] = useState(String(fromMinorUnits(candidate.amount_minor, candidate.currency)));
  const [currency, setCurrency] = useState(candidate.currency);
  const [merchant, setMerchant] = useState(candidate.merchant ?? "");
  const [description, setDescription] = useState(candidate.description ?? "");
  const matchingAccounts = accounts.filter((item) => item.currency === candidate.currency);
  const [accountId, setAccountId] = useState(candidate.resolved_account_id ?? (matchingAccounts.length === 1 ? matchingAccounts[0]?.id ?? "" : ""));
  const [categoryId, setCategoryId] = useState(candidate.resolved_category_id ?? "");
  const [rememberSourceAccount, setRememberSourceAccount] = useState(true);
  const [learnCategory, setLearnCategory] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filteredCategories = useMemo(
    () => categories.filter((category) => category.kind === kind || category.kind === "mixed"),
    [categories, kind],
  );

  async function decide(action: "accept" | "reject"): Promise<void> {
    if (action === "accept" && !accountId) {
      setError("Selecciona una cuenta antes de aceptar.");
      return;
    }
    setBusy(action);
    setError(null);
    try {
      await decideCandidate({
        candidateId: candidate.id,
        action,
        ...(action === "accept" ? {
          accountId,
          categoryId: categoryId || null,
          rememberSourceAccount,
          learnCategory,
          corrections: {
            kind,
            amountMinor: toMinorUnits(amount, currency),
            currency: currency.toUpperCase(),
            merchant: merchant.trim() || null,
            description: description.trim() || null,
          },
        } : {}),
      });
      await onDecided(action);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible procesar el candidato.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="candidate-card">
      <div className="candidate-main">
        <div className={`direction-badge ${candidate.proposed_kind}`}>{candidate.proposed_kind === "expense" ? "−" : "+"}</div>
        <div>
          <strong>{candidate.merchant ?? (candidate.proposed_kind === "expense" ? "Gasto detectado" : "Ingreso detectado")}</strong>
          <span>{new Date(candidate.occurred_at).toLocaleString("es-CO")}</span>
          <small>{providerLabel(candidate.provider)} · confianza {Math.round(candidate.confidence * 100)}%{candidate.review_reason ? ` · ${reviewReasonLabel(candidate.review_reason)}` : ""}</small>
        </div>
        <strong className="candidate-amount">{formatMinor(candidate.amount_minor, candidate.currency)}</strong>
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="candidate-actions">
        <button className="text-button" type="button" onClick={() => setExpanded(!expanded)}>{expanded ? "Ocultar edición" : "Revisar y editar"}</button>
        <button className="ghost-danger" type="button" disabled={busy !== null} onClick={() => void decide("reject")}>{busy === "reject" ? "Rechazando…" : "No es un movimiento"}</button>
        <button className="primary-button" type="button" disabled={busy !== null || accounts.length === 0} onClick={() => void decide("accept")}>{busy === "accept" ? "Guardando…" : "Aceptar"}</button>
      </div>
      {expanded ? (
        <div className="candidate-editor">
          <div className="segmented compact">
            <button type="button" className={kind === "expense" ? "active" : ""} onClick={() => { setKind("expense"); setCategoryId(""); }}>Gasto</button>
            <button type="button" className={kind === "income" ? "active" : ""} onClick={() => { setKind("income"); setCategoryId(""); }}>Ingreso</button>
          </div>
          <label className="field"><span>Monto</span><input type="number" min="0" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <label className="field"><span>Moneda</span><input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></label>
          <label className="field"><span>Cuenta</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Selecciona</option>{accounts.filter((item) => item.currency === currency).map((item) => <option value={item.id} key={item.id}>{item.name} · {item.currency}</option>)}</select></label>
          <label className="field"><span>Categoría</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Sin categoría</option>{filteredCategories.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label className="field"><span>Comercio/origen</span><input value={merchant} onChange={(event) => setMerchant(event.target.value)} /></label>
          <label className="field span-2"><span>Descripción sanitizada</span><input value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <label className="checkbox-field span-2"><input type="checkbox" checked={rememberSourceAccount} onChange={(event) => setRememberSourceAccount(event.target.checked)} /><span>Recordar esta cuenta para movimientos futuros de esta fuente</span></label>
          <label className="checkbox-field span-2"><input type="checkbox" checked={learnCategory} onChange={(event) => setLearnCategory(event.target.checked)} /><span>Aprender esta categoría para comercios similares</span></label>
          <details className="span-2"><summary>Por qué se detectó</summary><ul>{candidate.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></details>
        </div>
      ) : null}
    </article>
  );
}

function providerLabel(provider: TransactionCandidate["provider"]): string {
  if (provider === "android_notification") return "Notificación Android";
  if (provider === "gmail") return "Gmail";
  return "Outlook";
}

function reviewReasonLabel(reason: string): string {
  if (reason === "account_ambiguous_or_missing") return "elige la cuenta una sola vez";
  if (reason === "confidence_below_auto_post_threshold") return "revisión de seguridad";
  if (reason === "category_unresolved") return "categoría no resuelta";
  if (reason === "automation_disabled") return "automatización desactivada";
  return "requiere revisión";
}
