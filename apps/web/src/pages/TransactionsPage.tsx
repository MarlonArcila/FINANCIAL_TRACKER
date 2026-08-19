import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { formatMinor, toMinorUnits } from "@capitalflow/core";

import { CandidateReview } from "../components/CandidateReview";
import { LoadingScreen } from "../components/LoadingScreen";
import { Notice } from "../components/Notice";
import { TransactionForm } from "../components/TransactionForm";
import {
  createAccount,
  deleteTransaction,
  listAccounts,
  listAllAccounts,
  listCategories,
  listPendingCandidates,
  listTransactions,
  loadProfile,
} from "../lib/data";
import type { Account, Category, Profile, Transaction, TransactionCandidate } from "../lib/types";

type MovementCategoryGroup = "income" | "expense";

export function TransactionsPage({ userId }: { userId: string }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [candidates, setCandidates] = useState<TransactionCandidate[]>([]);
  const [tab, setTab] = useState<"candidates" | "manual" | "ledger">(readInitialTab);
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [categoryGroupFilter, setCategoryGroupFilter] = useState<MovementCategoryGroup>("expense");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountName, setAccountName] = useState("Cuenta principal");
  const [accountType, setAccountType] = useState<Account["type"]>("checking");
  const [accountCurrency, setAccountCurrency] = useState("COP");
  const [openingBalance, setOpeningBalance] = useState("0");

  const load = useCallback(async () => {
    try {
      const [nextAccounts, nextAllAccounts, nextProfile, nextCategories, nextTransactions, nextCandidates] = await Promise.all([
        listAccounts(), listAllAccounts(), loadProfile(userId), listCategories(), listTransactions(), listPendingCandidates(),
      ]);
      setAccounts(nextAccounts);
      setAllAccounts(nextAllAccounts);
      setProfile(nextProfile);
      setCategories(nextCategories);
      setTransactions(nextTransactions);
      setCandidates(nextCandidates);
      if (nextAccounts.length === 0) setAccountCurrency(nextProfile.base_currency);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible cargar los movimientos.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const categoryById = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories]);
  const accountById = useMemo(() => new Map(allAccounts.map((item) => [item.id, item.name])), [allAccounts]);
  const movementCategories = useMemo(
    () => categories.filter((category) => category.kind === "income" || category.kind === "expense" || category.kind === "mixed"),
    [categories],
  );
  const selectableCategories = useMemo(
    () => movementCategories.filter((category) => category.kind === categoryGroupFilter || category.kind === "mixed"),
    [movementCategories, categoryGroupFilter],
  );

  const visibleTransactions = useMemo(
    () => transactions.filter((item) => {
      if (item.kind !== categoryGroupFilter) return false;
      if (accountFilter !== "all" && item.account_id !== accountFilter) return false;
      if (categoryFilter === "uncategorized" && item.category_id !== null) return false;
      if (categoryFilter !== "all" && categoryFilter !== "uncategorized" && item.category_id !== categoryFilter) return false;
      return true;
    }),
    [transactions, accountFilter, categoryFilter, categoryGroupFilter],
  );

  async function remove(id: string): Promise<void> {
    if (!window.confirm("¿Eliminar este movimiento?")) return;
    await deleteTransaction(id);
    await load();
  }

  async function createPrimaryAccount(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!profile) return;
    setAccountBusy(true);
    setError(null);
    try {
      await createAccount({
        name: accountName.trim() || "Cuenta principal",
        type: accountType,
        currency: accountCurrency,
        opening_balance_minor: toMinorUnits(openingBalance || "0", accountCurrency),
        purpose: "general",
        purpose_label: null,
      });
      await load();
      setTab("manual");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible crear la cuenta principal.");
    } finally {
      setAccountBusy(false);
    }
  }

  function changeCategoryGroup(value: MovementCategoryGroup): void {
    setCategoryGroupFilter(value);
    setCategoryFilter("all");
  }

  if (loading) return <LoadingScreen label="Cargando movimientos…" />;

  return (
    <section className="page">
      <div className="page-heading"><div><span className="eyebrow">LIBRO FINANCIERO</span><h1>Movimientos</h1><p>Solo revisa excepciones ambiguas; los movimientos de alta confianza se registran automáticamente.</p></div></div>
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {accounts.length === 0 ? (
        <form className="panel quick-account-setup" onSubmit={(event) => void createPrimaryAccount(event)}>
          <div className="panel-heading"><div><span className="eyebrow">PASO NECESARIO</span><h2>Crea tu cuenta principal</h2></div></div>
          <p>Todo movimiento debe pertenecer a una cuenta. Puedes crearla aquí y continuar inmediatamente con el registro manual.</p>
          <div className="form-grid">
            <label className="field"><span>Nombre</span><input value={accountName} onChange={(event) => setAccountName(event.target.value)} required /></label>
            <label className="field"><span>Tipo</span><select value={accountType} onChange={(event) => setAccountType(event.target.value as Account["type"])}><option value="checking">Corriente</option><option value="savings">Ahorros</option><option value="cash">Efectivo</option><option value="credit">Crédito</option><option value="investment">Inversión</option><option value="other">Otra</option></select></label>
            <label className="field"><span>Moneda</span><select value={accountCurrency} onChange={(event) => setAccountCurrency(event.target.value)}>{(profile?.enabled_currencies?.length ? profile.enabled_currencies : [profile?.base_currency ?? "COP"]).map((currency) => <option key={currency}>{currency}</option>)}</select></label>
            <label className="field"><span>Saldo inicial</span><input type="number" step="any" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} /></label>
          </div>
          <button className="primary-button" type="submit" disabled={accountBusy}>{accountBusy ? "Creando…" : "Crear cuenta y registrar movimiento"}</button>
          <small>En producción la creación pasa por la función segura <code>account-manage</code>; durante staging, el fallback de desarrollo sigue protegido por RLS y por el trigger de límites del plan.</small>
        </form>
      ) : null}

      <article className="panel movement-category-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">CLASIFICACIÓN</span><h2>Categorías y filtros</h2></div>
          <small>{movementCategories.length} categorías aplicables a movimientos</small>
        </div>
        <div className="category-filter-controls">
          <label className="compact-select"><span>Grupo de categorías</span><select value={categoryGroupFilter} onChange={(event) => changeCategoryGroup(event.target.value as MovementCategoryGroup)}><option value="expense">Gastos</option><option value="income">Ingresos</option></select></label>
          <label className="compact-select"><span>Categoría (unidad)</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">Todas en conjunto</option><option value="uncategorized">Sin categoría</option>{selectableCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
        </div>
      </article>

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
      {tab === "manual" ? (
        <TransactionForm
          accounts={accounts}
          categories={categories}
          onCategoryCreated={(category) => setCategories((current) => [...current.filter((item) => item.id !== category.id), category].sort((a, b) => a.name.localeCompare(b.name, "es")))}
          onCreated={async () => { await load(); setTab("ledger"); }}
        />
      ) : null}
      {tab === "ledger" ? (
        <div className="panel">
          <div className="panel-heading">
            <h2>Movimientos confirmados</h2>
            <div className="ledger-filters">
              {allAccounts.length > 1 ? <label className="compact-select"><span>Cuenta</span><select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}><option value="all">Todas</option>{allAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.is_archived ? " · archivada" : ""}</option>)}</select></label> : null}
            </div>
          </div>
          <p className="filter-summary">Mostrando <strong>{visibleTransactions.length}</strong> de {transactions.length} movimiento(s) según los filtros seleccionados.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Fecha</th><th>Detalle</th><th>Categoría</th><th>Cuenta</th><th className="numeric">Monto</th><th aria-label="Acciones" /></tr></thead>
              <tbody>
                {visibleTransactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{new Date(transaction.occurred_at).toLocaleDateString("es-CO")}</td>
                    <td><strong>{transaction.merchant ?? transaction.description ?? "Movimiento"}</strong><small>{transaction.auto_posted ? `Auto-contabilizado · ${sourceLabel(transaction.source)}` : sourceLabel(transaction.source)}</small></td>
                    <td>{transaction.category_id ? categoryById.get(transaction.category_id)?.name ?? "—" : "—"}</td>
                    <td>{accountById.get(transaction.account_id) ?? "—"}</td>
                    <td className={`numeric amount-${transaction.kind}`}>{transaction.kind === "expense" ? "−" : transaction.kind === "income" ? "+" : ""}{formatMinor(transaction.amount_minor, transaction.currency)}</td>
                    <td><button className="icon-button" type="button" aria-label="Eliminar" onClick={() => void remove(transaction.id)}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visibleTransactions.length === 0 ? <p className="empty-state">No hay movimientos para esta combinación de filtros.</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function sourceLabel(source: Transaction["source"]): string {
  if (source === "android_notification") return "Notificación Android";
  if (source === "gmail") return "Gmail";
  if (source === "import_file") return "Importación";
  if (source === "manual") return "Registro manual";
  return "Sistema";
}

function readInitialTab(): "candidates" | "manual" | "ledger" {
  const query = window.location.hash.split("?")[1] ?? "";
  const value = new URLSearchParams(query).get("tab");
  return value === "manual" || value === "ledger" ? value : "candidates";
}
