import { useCallback, useEffect, useMemo, useState } from "react";
import { formatMinor } from "@capitalflow/core";

import { LoadingScreen } from "../components/LoadingScreen";
import { Notice } from "../components/Notice";
import { listAccounts, loadDashboardSummary, listGoals } from "../lib/data";
import type { Account, DashboardSummary, Goal } from "../lib/types";
import type { AppRoute } from "../hooks/useHashRoute";

const ACCOUNT_SCOPE_KEY = "capitalflow.accountScope";

export function DashboardPage({ navigate }: { navigate(route: AppRoute): void }) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountScope, setAccountScope] = useState<string>(() => localStorage.getItem(ACCOUNT_SCOPE_KEY) ?? "all");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const nextAccounts = await listAccounts();
      const validScope = accountScope === "all" || nextAccounts.some((account) => account.id === accountScope) ? accountScope : "all";
      if (validScope !== accountScope) {
        setAccountScope(validScope);
        localStorage.setItem(ACCOUNT_SCOPE_KEY, validScope);
      }
      const [nextSummary, nextGoals] = await Promise.all([loadDashboardSummary(validScope === "all" ? null : validScope), listGoals()]);
      setAccounts(nextAccounts);
      setSummary(nextSummary);
      setGoals(nextGoals.slice(0, 3));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible cargar el resumen.");
    }
  }, [accountScope]);

  useEffect(() => {
    void load();
    window.addEventListener("capitalflow:demo-change", load);
    return () => window.removeEventListener("capitalflow:demo-change", load);
  }, [load]);

  const scopedAccount = useMemo(() => accounts.find((account) => account.id === accountScope) ?? null, [accounts, accountScope]);

  function changeScope(value: string): void {
    setAccountScope(value);
    localStorage.setItem(ACCOUNT_SCOPE_KEY, value);
  }

  if (!summary && !error) return <LoadingScreen label="Calculando resumen…" />;
  if (error) return <section className="page"><div className="error-card"><h1>No pudimos cargar el tablero</h1><p>{error}</p><button className="primary-button" type="button" onClick={() => void load()}>Reintentar</button></div></section>;
  if (!summary) return null;

  return (
    <section className="page">
      <div className="page-heading">
        <div><span className="eyebrow">PANORAMA ACTUAL</span><h1>{scopedAccount ? scopedAccount.name : "Tu dinero, en contexto"}</h1><p>{scopedAccount ? `Vista independiente · ${accountPurpose(scopedAccount)}` : "Los movimientos de alta confianza se confirman automáticamente; solo las excepciones requieren revisión."}</p></div>
        <div className="heading-actions">
          {accounts.length > 1 ? <label className="scope-select"><span>Ver cuenta</span><select value={accountScope} onChange={(event) => changeScope(event.target.value)}><option value="all">Todas las cuentas activas</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.is_primary ? "Principal · " : ""}{account.name}</option>)}</select></label> : null}
          <button className="primary-button" type="button" onClick={() => navigate("transactions")}>+ Registrar movimiento</button>
        </div>
      </div>
      {summary.fxWarning ? <Notice tone="warning">{summary.fxWarning}{summary.fxAsOf ? ` Referencia consultada: ${new Date(summary.fxAsOf).toLocaleString("es-CO")}.` : ""}</Notice> : null}
      {scopedAccount ? <Notice tone="info">Estás viendo únicamente los movimientos de <strong>{scopedAccount.name}</strong>. Cambia a “Todas las cuentas activas” para volver al panorama consolidado.</Notice> : null}
      <div className="metric-grid">
        <Metric label="Ingresos confirmados" value={formatMinor(summary.incomeMinor, summary.baseCurrency)} detail={scopedAccount ? `Solo ${scopedAccount.name}` : "Acumulado visible"} />
        <Metric label="Gastos confirmados" value={formatMinor(summary.expenseMinor, summary.baseCurrency)} detail={scopedAccount ? `Solo ${scopedAccount.name}` : "Acumulado visible"} />
        <Metric label="Flujo neto" value={formatMinor(summary.balanceMinor, summary.baseCurrency)} detail={summary.balanceMinor >= 0 ? "Disponible antes de compromisos" : "Requiere ajuste"} />
        <Metric label="Excepciones por revisar" value={String(summary.pendingCandidates)} detail="Pendientes globales de tus fuentes" action={() => navigate("transactions")} />
      </div>
      <div className="two-column">
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">SIGUIENTE DECISIÓN</span><h2>Ordena el dinero disponible</h2></div></div>
          <p>El plan determinista protege obligaciones y reserva, después atiende metas y solo asigna el excedente a inversión.</p>
          <button className="secondary-button" type="button" onClick={() => navigate("advisor")}>Construir plan</button>
        </article>
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">METAS</span><h2>Progreso prioritario</h2></div><button className="text-button" type="button" onClick={() => navigate("goals")}>Ver todas</button></div>
          {goals.length === 0 ? <p className="empty-state">Aún no has creado metas.</p> : goals.map((goal) => <MiniGoal key={goal.id} goal={goal} />)}
        </article>
      </div>
      <article className="privacy-strip">
        <strong>Privacidad por diseño.</strong>
        <span>Las notificaciones y correos se reducen a campos financieros; la IA opcional no recibe el contenido crudo.</span>
        <button className="text-button" type="button" onClick={() => navigate("integrations")}>Administrar fuentes</button>
      </article>
    </section>
  );
}

function Metric({ label, value, detail, action }: { label: string; value: string; detail: string; action?: () => void }) {
  const content = <><span>{label}</span><strong>{value}</strong><small>{detail}</small></>;
  return action ? <button type="button" className="metric-card clickable" onClick={action}>{content}</button> : <article className="metric-card">{content}</article>;
}

function MiniGoal({ goal }: { goal: Goal }) {
  const percentage = goal.target_minor <= 0 ? 0 : Math.min(100, Math.round(goal.current_minor / goal.target_minor * 100));
  return (
    <div className="mini-goal">
      <div><strong>{goal.name}</strong><span>{percentage}%</span></div>
      <progress max="100" value={percentage}>{percentage}%</progress>
    </div>
  );
}

function accountPurpose(account: Account): string {
  if (account.is_primary) return "Cuenta principal";
  if (account.purpose_label) return account.purpose_label;
  return ({ trip: "Viaje", work: "Trabajo", shared: "Compartida", project: "Proyecto", other: "Otro seguimiento", general: "General" } as const)[account.purpose];
}
