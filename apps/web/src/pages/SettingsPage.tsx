import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatMinor, normalizeCurrencyCodes, toMinorUnits } from "@capitalflow/core";

import { Notice } from "../components/Notice";
import { invokeFunction } from "../lib/api";
import {
  createAccount,
  createCategory,
  getFxRate,
  listAllAccounts,
  listCategories,
  loadFinancialPreferences,
  loadProfile,
  loadSubscription,
  setAccountArchived,
  updateFinancialPreferences,
  updateProfile,
} from "../lib/data";
import { demoMode } from "../lib/env";
import { resetDemoState } from "../lib/demoStore";
import type { Account, AppUser, Category, FinancialPreferences, FxRateResult, Profile, Subscription } from "../lib/types";

export function SettingsPage({ user }: { user: AppUser }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [preferences, setPreferences] = useState<FinancialPreferences | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState<Account["type"]>("checking");
  const [accountCurrency, setAccountCurrency] = useState("COP");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [accountPurpose, setAccountPurpose] = useState<Account["purpose"]>("trip");
  const [accountPurposeLabel, setAccountPurposeLabel] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [categoryKind, setCategoryKind] = useState<Category["kind"]>("expense");
  const [fxAmount, setFxAmount] = useState("100");
  const [fxFrom, setFxFrom] = useState("USD");
  const [fxTo, setFxTo] = useState("COP");
  const [fxResult, setFxResult] = useState<FxRateResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextProfile, nextPreferences, nextAccounts, nextCategories, nextSubscription] = await Promise.all([
        loadProfile(user.id), loadFinancialPreferences(), listAllAccounts(), listCategories(), loadSubscription(user.id),
      ]);
      setProfile(nextProfile);
      setPreferences(nextPreferences);
      setAccounts(nextAccounts);
      setCategories(nextCategories);
      setSubscription(nextSubscription);
      setAccountCurrency((current) => nextProfile.enabled_currencies.includes(current) ? current : nextProfile.base_currency);
      setFxTo(nextProfile.base_currency);
      setFxFrom(nextProfile.enabled_currencies.find((currency) => currency !== nextProfile.base_currency) ?? nextProfile.base_currency);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible cargar ajustes.");
    }
  }, [user.id]);

  useEffect(() => { void load(); }, [load]);

  async function saveProfile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!profile) return;
    setBusy("profile");
    setError(null);
    try {
      const enabled = normalizeCurrencyCodes(profile.enabled_currencies, profile.base_currency);
      const next = await updateProfile(user.id, { ...profile, enabled_currencies: enabled });
      setProfile(next);
      setMessage("Perfil y monedas actualizados.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible guardar."); }
    finally { setBusy(null); }
  }

  async function saveAutomation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!preferences) return;
    setBusy("automation");
    setError(null);
    try {
      setPreferences(await updateFinancialPreferences({
        auto_post_enabled: preferences.auto_post_enabled,
        auto_post_min_confidence: Math.min(0.99, Math.max(0.70, Number(preferences.auto_post_min_confidence))),
        auto_review_min_confidence: Math.min(0.95, Math.max(0.50, Number(preferences.auto_review_min_confidence))),
        learn_from_reviews: preferences.learn_from_reviews,
        auto_use_other_category: preferences.auto_use_other_category,
      }));
      setMessage("Automatización actualizada.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible guardar la automatización."); }
    finally { setBusy(null); }
  }

  async function addAccount(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!profile) return;
    setBusy("account");
    try {
      await createAccount({
        name: accountName.trim(),
        type: accountType,
        currency: accountCurrency,
        opening_balance_minor: toMinorUnits(openingBalance || "0", accountCurrency),
        purpose: accountPurpose,
        purpose_label: accountPurposeLabel.trim() || null,
      });
      setAccountName(""); setOpeningBalance("0"); setAccountPurposeLabel(""); setMessage("Cuenta creada."); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible crear la cuenta."); }
    finally { setBusy(null); }
  }

  async function toggleAccount(account: Account): Promise<void> {
    setBusy(`account-${account.id}`); setError(null);
    try {
      await setAccountArchived(account.id, !account.is_archived);
      setMessage(account.is_archived ? "Cuenta restaurada." : "Cuenta archivada. Su historial se conserva y seguirá incluido en los backups.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible actualizar la cuenta."); }
    finally { setBusy(null); }
  }

  async function addCategory(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy("category");
    try {
      await createCategory({ name: categoryName.trim(), kind: categoryKind });
      setCategoryName(""); setMessage("Categoría creada."); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible crear la categoría."); }
    finally { setBusy(null); }
  }

  async function convertCurrency(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy("fx");
    setError(null);
    setFxResult(null);
    try {
      const amountMinor = toMinorUnits(fxAmount || "0", fxFrom);
      setFxResult(await getFxRate(fxFrom, fxTo, amountMinor));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible obtener la tasa de cambio."); }
    finally { setBusy(null); }
  }

  async function exportData(): Promise<void> {
    setBusy("export");
    try {
      if (demoMode) {
        const blob = new Blob([localStorage.getItem("capitalflow.demo.v1") ?? "{}"], { type: "application/json" });
        downloadBlob(blob, "capitalflow-demo-export.json");
      } else {
        const result = await invokeFunction<{ filename: string; mimeType: string; content: string }>("export-data", {});
        downloadBlob(new Blob([result.content], { type: result.mimeType }), result.filename);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible exportar."); }
    finally { setBusy(null); }
  }

  async function deleteAccount(): Promise<void> {
    const phrase = window.prompt("Escribe ELIMINAR para borrar permanentemente tu cuenta y sus datos.");
    if (phrase !== "ELIMINAR") return;
    setBusy("delete");
    try {
      if (demoMode) { resetDemoState(); window.location.reload(); return; }
      await invokeFunction("delete-account", { confirmation: phrase });
      window.location.reload();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible eliminar la cuenta."); }
    finally { setBusy(null); }
  }

  if (!profile || !preferences) return <section className="page"><p>Cargando ajustes…</p></section>;

  const currencyOptions = profile.enabled_currencies.length ? profile.enabled_currencies : [profile.base_currency];
  const activeAccounts = accounts.filter((account) => !account.is_archived);
  const archivedAccounts = accounts.filter((account) => account.is_archived);
  const annual = subscription?.interval === "annual" && (subscription.status === "active" || subscription.status === "trialing");
  const canCreateAccount = activeAccounts.length === 0 || annual;

  return (
    <section className="page">
      <div className="page-heading"><div><span className="eyebrow">CONTROL Y PRIVACIDAD</span><h1>Ajustes</h1><p>Configura monedas y cuánto puede actuar CapitalFlow sin pedirte confirmación.</p></div></div>
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="settings-grid">
        <form className="panel" onSubmit={(event) => void saveProfile(event)}>
          <h2>Perfil y monedas</h2>
          <label className="field"><span>Nombre</span><input value={profile.full_name ?? ""} onChange={(event) => setProfile({ ...profile, full_name: event.target.value })} /></label>
          <label className="field"><span>Moneda base</span><select value={profile.base_currency} onChange={(event) => setProfile({ ...profile, base_currency: event.target.value })}>{currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
          <label className="field"><span>Monedas habilitadas (códigos ISO separados por coma)</span><input value={profile.enabled_currencies.join(", ")} onChange={(event) => setProfile({ ...profile, enabled_currencies: event.target.value.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean) })} placeholder="COP, USD, EUR" /></label>
          <label className="field"><span>Locale</span><input value={profile.locale} onChange={(event) => setProfile({ ...profile, locale: event.target.value })} /></label>
          <label className="field"><span>Zona horaria</span><input value={profile.timezone} onChange={(event) => setProfile({ ...profile, timezone: event.target.value })} /></label>
          <button className="primary-button" type="submit" disabled={busy !== null}>{busy === "profile" ? "Guardando…" : "Guardar perfil"}</button>
        </form>

        <form className="panel" onSubmit={(event) => void saveAutomation(event)}>
          <h2>Automatización</h2>
          <p>CapitalFlow registra automáticamente lo que puede resolver con seguridad y aprende de las correcciones excepcionales.</p>
          <label className="checkbox-field"><input type="checkbox" checked={preferences.auto_post_enabled} onChange={(event) => setPreferences({ ...preferences, auto_post_enabled: event.target.checked })} /><span>Registrar automáticamente movimientos de alta confianza</span></label>
          <label className="checkbox-field"><input type="checkbox" checked={preferences.learn_from_reviews} onChange={(event) => setPreferences({ ...preferences, learn_from_reviews: event.target.checked })} /><span>Aprender cuenta y categoría de mis correcciones</span></label>
          <label className="checkbox-field"><input type="checkbox" checked={preferences.auto_use_other_category} onChange={(event) => setPreferences({ ...preferences, auto_use_other_category: event.target.checked })} /><span>Usar “Otros” cuando no haya categoría segura, sin detener el registro</span></label>
          <small>Las señales claras se procesan solas. Solo las excepciones ambiguas aparecen para revisión; tus correcciones alimentan reglas privadas para evitar repetir la misma pregunta.</small>
          <button className="secondary-button" type="submit" disabled={busy !== null}>{busy === "automation" ? "Guardando…" : "Guardar automatización"}</button>
        </form>

        <form className="panel accounts-panel" onSubmit={(event) => void addAccount(event)}>
          <h2>Cuentas de seguimiento</h2>
          <p>La cuenta principal concentra tu seguimiento habitual. En el plan anual puedes abrir espacios separados para viajes, trabajo, proyectos u otros periodos y archivarlos cuando terminen.</p>
          <div className="account-list">
            {activeAccounts.map((account) => <AccountRow key={account.id} account={account} annual={annual} busy={busy} onToggle={toggleAccount} />)}
          </div>
          {!canCreateAccount ? <Notice tone="info">Tu plan semanal incluye una sola cuenta principal. Cambia al anual para crear cuentas independientes sin mezclar sus movimientos con el seguimiento principal.</Notice> : <>
            <h3>{activeAccounts.length === 0 ? "Crear cuenta principal" : "Crear cuenta independiente"}</h3>
            <label className="field"><span>Nombre</span><input value={accountName} onChange={(event) => setAccountName(event.target.value)} required /></label>
            <label className="field"><span>Tipo</span><select value={accountType} onChange={(event) => setAccountType(event.target.value as Account["type"])}><option value="checking">Corriente</option><option value="savings">Ahorros</option><option value="cash">Efectivo</option><option value="credit">Crédito</option><option value="investment">Inversión</option><option value="other">Otra</option></select></label>
            <label className="field"><span>Moneda</span><select value={accountCurrency} onChange={(event) => setAccountCurrency(event.target.value)}>{currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
            {activeAccounts.length > 0 ? <><label className="field"><span>Propósito</span><select value={accountPurpose} onChange={(event) => setAccountPurpose(event.target.value as Account["purpose"])}><option value="trip">Viaje</option><option value="work">Trabajo</option><option value="shared">Compartido</option><option value="project">Proyecto</option><option value="other">Otro</option></select></label><label className="field"><span>Detalle opcional</span><input value={accountPurposeLabel} onChange={(event) => setAccountPurposeLabel(event.target.value)} placeholder="Ej. Viaje a México con amigos" /></label></> : null}
            <label className="field"><span>Saldo inicial ({accountCurrency})</span><input type="number" step="any" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} /></label>
            <button className="secondary-button" type="submit" disabled={busy !== null}>{busy === "account" ? "Creando…" : activeAccounts.length === 0 ? "Crear cuenta principal" : "Crear cuenta independiente"}</button>
          </>}
          {archivedAccounts.length > 0 ? <details className="archived-accounts"><summary>Cuentas archivadas ({archivedAccounts.length})</summary><div className="account-list">{archivedAccounts.map((account) => <AccountRow key={account.id} account={account} annual={annual} busy={busy} onToggle={toggleAccount} />)}</div></details> : null}
          <small>Archivar no elimina el historial: la cuenta y sus movimientos siguen incluidos en exportaciones y backups.</small>
        </form>

        <form className="panel" onSubmit={(event) => void convertCurrency(event)}>
          <h2>Conversor interno</h2>
          <p>Convierte montos para visualización sin alterar la moneda original del movimiento.</p>
          <label className="field"><span>Monto</span><input type="number" min="0" step="any" value={fxAmount} onChange={(event) => setFxAmount(event.target.value)} required /></label>
          <div className="form-grid">
            <label className="field"><span>Desde</span><select value={fxFrom} onChange={(event) => setFxFrom(event.target.value)}>{currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
            <label className="field"><span>Hacia</span><select value={fxTo} onChange={(event) => setFxTo(event.target.value)}>{currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
          </div>
          <button className="secondary-button" type="submit" disabled={busy !== null}>{busy === "fx" ? "Consultando…" : "Convertir"}</button>
          {fxResult && fxResult.convertedMinor !== null ? <div className="fx-result"><strong>{formatMinor(fxResult.convertedMinor, fxResult.quote)}</strong><small>1 {fxResult.base} = {fxResult.rate.toLocaleString("es-CO", { maximumFractionDigits: 8 })} {fxResult.quote} · {fxResult.sourceLabel} · {new Date(fxResult.fetchedAt).toLocaleString("es-CO")}</small></div> : null}
          {fxResult ? <Notice tone="warning">{fxResult.warning}</Notice> : <Notice tone="info">En producción, la fuente predeterminada es la referencia visible de Google Finance. La cotización es informativa y puede diferir de la tasa efectiva de una entidad financiera.</Notice>}
        </form>

        <form className="panel" onSubmit={(event) => void addCategory(event)}>
          <h2>Categorías</h2>
          <p>{categories.length} categoría(s) disponibles.</p>
          <label className="field"><span>Nombre</span><input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} required /></label>
          <label className="field"><span>Aplica a</span><select value={categoryKind} onChange={(event) => setCategoryKind(event.target.value as Category["kind"])}><option value="expense">Gastos</option><option value="income">Ingresos</option><option value="goal">Metas</option><option value="investment">Inversiones</option><option value="mixed">Mixta</option></select></label>
          <button className="secondary-button" type="submit" disabled={busy !== null}>{busy === "category" ? "Creando…" : "Crear categoría"}</button>
        </form>

        <article className="panel">
          <h2>Tus datos</h2>
          <p>Descarga una copia portable o inicia una eliminación irreversible.</p>
          <div className="button-row"><button className="secondary-button" type="button" disabled={busy !== null} onClick={() => void exportData()}>{busy === "export" ? "Preparando…" : "Exportar JSON"}</button><button className="danger-button" type="button" disabled={busy !== null} onClick={() => void deleteAccount()}>{busy === "delete" ? "Eliminando…" : "Eliminar cuenta"}</button></div>
        </article>
      </div>
    </section>
  );
}

function AccountRow({ account, annual, busy, onToggle }: { account: Account; annual: boolean; busy: string | null; onToggle(account: Account): Promise<void> }) {
  const purpose = account.is_primary ? "Principal" : account.purpose_label || purposeLabel(account.purpose);
  return <div className={`account-row ${account.is_archived ? "archived" : ""}`}><div><strong>{account.name}</strong><small>{purpose} · {account.currency} · {account.type}</small></div>{account.is_primary ? <span className="status-pill">Principal</span> : <button className="text-button" type="button" disabled={!annual || busy !== null} onClick={() => void onToggle(account)}>{busy === `account-${account.id}` ? "Guardando…" : account.is_archived ? "Restaurar" : "Archivar"}</button>}</div>;
}

function purposeLabel(purpose: Account["purpose"]): string {
  if (purpose === "trip") return "Viaje";
  if (purpose === "work") return "Trabajo";
  if (purpose === "shared") return "Compartido";
  if (purpose === "project") return "Proyecto";
  if (purpose === "general") return "General";
  return "Otro";
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
