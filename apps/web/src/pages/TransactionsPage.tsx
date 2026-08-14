import { useCallback, useEffect, useMemo, useState } from "react";
import { formatMinor } from "@capitalflow/core";

import { CandidateReview } from "../components/CandidateReview";
import { LoadingScreen } from "../components/LoadingScreen";
import { Notice } from "../components/Notice";
import { TransactionForm } from "../components/TransactionForm";
import {
  deleteTransaction,
  listAccounts,
  listAllAccounts,
  listCategories,
  listPendingCandidates,
  listTransactions,
} from "../lib/data";
import type { Account, Category, Transaction, TransactionCandidate } from "../lib/types";

export function TransactionsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [candidates, setCandidates] = useState<TransactionCandidate[]>([]);
  const [tab, setTab] = useState<"candidates" | "manual" | "ledger">("candidates");
  const [filter, setFilter] = useState<"all" | "income" | "expense">("all");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextAccounts, nextAllAccounts, nextCategories, nextTransactions, nextCandidates] = await Promise.all([
        listAccounts(), listAllAccounts(), listCategories(), listTransactions(), listPendingCandidates(),
      ]);
      setAccounts(nextAccounts);
      setAllAccounts(nextAllAccounts);
      setCategories(nextCategories);
      setTransactions(nextTransactions);
      setCandidates(nextCandidates);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible cargar los movimientos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visibleTransactions = useMemo(
    () => transactions.filter((item) => (filter === "all" || item.kind === filter) && (accountFilter === "all" || item.account_id === accountFilter)),
    [transactions, filter, accountFilter],
  );
  const categoryById = useMemo(() => new Map(categories.map((item) => [item.id, item.name])), [categories]);
  const accountById = useMemo(() => new Map(allAccounts.map((item) => [item.id, item.name])), [allAccounts]);

  async function remove(id: string): Promise<void> {
    if (!window.confirm("¿Eliminar este movimiento?")) return;
    await deleteTransaction(id);
    await load();
  }

  if (loading) return <LoadingScreen label="Cargando movimientos…" />;

  return (
    <section className="page">
      <div className="page-heading"><div><span className="eyebrow">LIBRO FINANCIERO</span><h1>Movimientos</h1><p>Solo revisa excepciones ambiguas; los movimientos de alta confianza se registran automáticamente.</p></div></div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {accounts.length === 0 ? <Notice tone="warning">Necesitas al menos una cuenta. Créala en Ajustes.</Notice> : null}
      <div className="tabs">
        <button type="button" className={tab === "candidates" ? "active" : ""} onClick={() => setTab("candidates")}>Por revisar <span>{candidates.length}</span></button>
        <button type="button" className={tab === "manual" ? "active" : ""} onClick={() => setTab("manual")}>Registro manual</button>
        <button type="button" className={tab === "ledger" ? "active" : ""} onClick={() => setTab("ledger")}>Libro</button>
      </div>
      {tab === "candidates" ? (
        <div className="stack">
          {candidates.length === 0 ? <div className="empty-card"><strong>Todo está revisado</strong><p>Aquí solo aparecerán detecciones que necesiten una decisión. Las de alta confianza van directamente al libro.</p></div> : candidates.map((candidate) => (
            <CandidateReview key={candidate.id} candidate={candidate} accounts={accounts} categories={categories} onDecided={load} />
          ))}
        </div>
      ) : null}
      {tab === "manual" ? <TransactionForm accounts={accounts} categories={categories} onCreated={async () => { await load(); setTab("ledger"); }} /> : null}
      {tab === "ledger" ? (
        <div className="panel">
          <div className="panel-heading">
            <h2>Movimientos confirmados</h2>
            <div className="ledger-filters">
              {allAccounts.length > 1 ? <label className="compact-select"><span>Cuenta</span><select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}><option value="all">Todas</option>{allAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.is_archived ? " · archivada" : ""}</option>)}</select></label> : null}
              <div className="segmented compact">
                {(["all", "income", "expense"] as const).map((value) => <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "Todos" : value === "income" ? "Ingresos" : "Gastos"}</button>)}
              </div>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Fecha</th><th>Detalle</th><th>Categoría</th><th>Cuenta</th><th className="numeric">Monto</th><th aria-label="Acciones" /></tr></thead>
              <tbody>
                {visibleTransactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{new Date(transaction.occurred_at).toLocaleDateString("es-CO")}</td>
                    <td><strong>{transaction.merchant ?? transaction.description ?? "Movimiento"}</strong><small>{transaction.source}</small></td>
                    <td>{transaction.category_id ? categoryById.get(transaction.category_id) ?? "—" : "—"}</td>
                    <td>{accountById.get(transaction.account_id) ?? "—"}</td>
                    <td className={`numeric amount-${transaction.kind}`}>{transaction.kind === "expense" ? "−" : transaction.kind === "income" ? "+" : ""}{formatMinor(transaction.amount_minor, transaction.currency)}</td>
                    <td><button className="icon-button" type="button" aria-label="Eliminar" onClick={() => void remove(transaction.id)}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visibleTransactions.length === 0 ? <p className="empty-state">No hay movimientos para este filtro.</p> : null}
        </div>
      ) : null}
    </section>
  );
}
