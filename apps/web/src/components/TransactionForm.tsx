import { useMemo, useState, type FormEvent } from "react";
import { fromMinorUnits, toMinorUnits, type TransactionKind } from "@capitalflow/core";

import { createTransaction } from "../lib/data";
import type { Account, Category } from "../lib/types";
import { MoneyInput } from "./MoneyInput";
import { Notice } from "./Notice";

export function TransactionForm({
  accounts,
  categories,
  onCreated,
}: {
  accounts: Account[];
  categories: Category[];
  onCreated(): Promise<void> | void;
}) {
  const defaultAccount = accounts[0];
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [accountId, setAccountId] = useState(defaultAccount?.id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [description, setDescription] = useState("");
  const [occurredAt, setOccurredAt] = useState(toLocalDateTime(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedAccount = accounts.find((account) => account.id === accountId) ?? defaultAccount;
  const currency = selectedAccount?.currency ?? "COP";
  const filteredCategories = useMemo(
    () => categories.filter((category) => category.kind === kind || category.kind === "mixed"),
    [categories, kind],
  );

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedAccount) {
      setError("Crea primero una cuenta.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createTransaction({
        account_id: selectedAccount.id,
        category_id: categoryId || null,
        kind: kind as TransactionKind,
        amount_minor: toMinorUnits(amount, currency),
        currency,
        merchant: merchant.trim() || null,
        description: description.trim() || null,
        occurred_at: new Date(occurredAt).toISOString(),
      });
      setAmount("");
      setMerchant("");
      setDescription("");
      await onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible registrar el movimiento.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-card" onSubmit={(event) => void submit(event)}>
      <div className="segmented" aria-label="Tipo de movimiento">
        <button type="button" className={kind === "expense" ? "active" : ""} onClick={() => { setKind("expense"); setCategoryId(""); }}>Gasto</button>
        <button type="button" className={kind === "income" ? "active" : ""} onClick={() => { setKind("income"); setCategoryId(""); }}>Ingreso</button>
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="form-grid">
        <label className="field">
          <span>Cuenta</span>
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)} required>
            <option value="" disabled>Selecciona</option>
            {accounts.map((account) => <option value={account.id} key={account.id}>{account.name} · {account.currency}</option>)}
          </select>
        </label>
        <MoneyInput label="Monto" value={amount} currency={currency} onChange={setAmount} required />
        <label className="field">
          <span>Categoría</span>
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">Sin categoría</option>
            {filteredCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Fecha y hora</span>
          <input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} required />
        </label>
        <label className="field">
          <span>{kind === "expense" ? "Comercio" : "Origen"}</span>
          <input value={merchant} onChange={(event) => setMerchant(event.target.value)} maxLength={80} placeholder="Opcional" />
        </label>
        <label className="field span-2">
          <span>Nota</span>
          <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={280} placeholder="Contexto breve" />
        </label>
      </div>
      <button className="primary-button" type="submit" disabled={busy || accounts.length === 0}>{busy ? "Guardando…" : "Guardar movimiento"}</button>
      {amount ? <small className="form-hint">Se guardará como {fromMinorUnits(toSafeMinor(amount, currency), currency).toLocaleString("es-CO")} {currency}.</small> : null}
    </form>
  );
}

function toSafeMinor(value: string, currency: string): number {
  try { return toMinorUnits(value, currency); } catch { return 0; }
}

function toLocalDateTime(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
