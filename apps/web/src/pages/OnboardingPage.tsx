import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { normalizeCurrencyCodes, toMinorUnits } from "@capitalflow/core";

import { CandidateReview } from "../components/CandidateReview";
import { LoadingScreen } from "../components/LoadingScreen";
import { Notice } from "../components/Notice";
import { invokeFunction } from "../lib/api";
import {
  completeOnboarding,
  createAccount,
  listAccounts,
  listCategories,
  listConnections,
  listPendingCandidates,
  loadOnboardingState,
  loadProfile,
  loadSubscription,
  updateOnboardingState,
  updateProfile,
} from "../lib/data";
import { demoMode } from "../lib/env";
import {
  getNotificationPermission,
  isAndroidNative,
  openNotificationPermissionSettings,
  setNotificationDefaultCurrency,
  syncAndroidCandidates,
} from "../lib/notificationAccess";
import type { Account, AppUser, Category, OnboardingState, Profile, SourceConnection, Subscription, TransactionCandidate } from "../lib/types";

export function OnboardingPage({ user, onComplete }: { user: AppUser; onComplete(): Promise<void> }) {
  const nativeAndroid = isAndroidNative();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [state, setState] = useState<OnboardingState | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [connections, setConnections] = useState<SourceConnection[]>([]);
  const [candidates, setCandidates] = useState<TransactionCandidate[]>([]);
  const [notificationPermission, setNotificationPermission] = useState(false);
  const [accountName, setAccountName] = useState("Cuenta principal");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextProfile, nextState, nextSubscription, nextAccounts, nextCategories, nextConnections, nextCandidates, permission] = await Promise.all([
        loadProfile(user.id), loadOnboardingState(user.id), loadSubscription(user.id), listAccounts(), listCategories(), listConnections(), listPendingCandidates(),
        nativeAndroid ? getNotificationPermission() : Promise.resolve(false),
      ]);
      setProfile(nextProfile); setState(nextState); setSubscription(nextSubscription); setAccounts(nextAccounts); setCategories(nextCategories);
      setConnections(nextConnections); setCandidates(nextCandidates.slice(0, 5)); setNotificationPermission(permission);
      if (nativeAndroid) await setNotificationDefaultCurrency(nextProfile.base_currency);
      const patch: Partial<OnboardingState> = {};
      if (nextAccounts.length > 0 && !nextState.account_completed) patch.account_completed = true;
      if (nextProfile.enabled_currencies.length > 0 && !nextState.currencies_completed) patch.currencies_completed = true;
      if (nextConnections.some((item) => item.status === "active") && !nextState.email_completed) patch.email_completed = true;
      if (nativeAndroid && permission && !nextState.notification_completed) patch.notification_completed = true;
      if (Object.keys(patch).length) setState(await updateOnboardingState(user.id, patch));
      setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible cargar el onboarding."); }
  }, [nativeAndroid, user.id]);

  useEffect(() => { void load(); }, [load]);

  async function saveCurrencies(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (!profile) return;
    setBusy("currencies"); setError(null);
    try {
      const enabled = normalizeCurrencyCodes(profile.enabled_currencies, profile.base_currency);
      const next = await updateProfile(user.id, { base_currency: profile.base_currency, enabled_currencies: enabled });
      setProfile(next); await updateOnboardingState(user.id, { currencies_completed: true });
      if (nativeAndroid) await setNotificationDefaultCurrency(next.base_currency);
      setMessage("Monedas guardadas. CapitalFlow conservará siempre el importe original de cada movimiento."); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible guardar las monedas."); }
    finally { setBusy(null); }
  }

  async function createPrimary(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (!profile) return;
    setBusy("account"); setError(null);
    try {
      await createAccount({ name: accountName.trim() || "Cuenta principal", type: "checking", currency: profile.base_currency, opening_balance_minor: toMinorUnits(openingBalance || "0", profile.base_currency), purpose: "general" });
      await updateOnboardingState(user.id, { account_completed: true }); setMessage("Cuenta principal creada."); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible crear la cuenta principal."); }
    finally { setBusy(null); }
  }

  async function connect(provider: "gmail" | "outlook"): Promise<void> {
    setBusy(provider); setError(null);
    try {
      if (demoMode) { await updateOnboardingState(user.id, { email_completed: true }); setMessage(`${provider} conectado en modo demo.`); await load(); return; }
      const result = await invokeFunction<{ authorizationUrl: string }>(`${provider}-oauth-start`, { returnUrl: `${window.location.origin}/#/dashboard` });
      window.location.assign(result.authorizationUrl);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible iniciar la conexión."); setBusy(null); }
  }

  async function grantNotifications(): Promise<void> {
    setError(null);
    try { await openNotificationPermissionSettings(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible abrir el permiso de notificaciones."); }
  }

  async function verifyNotifications(): Promise<void> {
    setBusy("notifications");
    try {
      const granted = nativeAndroid ? await getNotificationPermission() : true;
      setNotificationPermission(granted);
      if (granted) { await updateOnboardingState(user.id, { notification_completed: true }); setMessage("Acceso a notificaciones listo. El filtrado financiero se realiza localmente en el dispositivo."); }
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible verificar el permiso."); }
    finally { setBusy(null); }
  }

  async function findCalibrationExamples(): Promise<void> {
    setBusy("calibration"); setError(null); setMessage(null);
    try {
      let detected = 0;
      for (const connection of connections.filter((item) => item.status === "active")) {
        if (demoMode) continue;
        const result = await invokeFunction<{ inserted: number }>(`${connection.provider}-sync`, {});
        detected += result.inserted ?? 0;
      }
      if (nativeAndroid && notificationPermission) {
        const android = await syncAndroidCandidates(); detected += android.inserted;
      }
      await updateOnboardingState(user.id, { calibration_attempted: true });
      setMessage(detected > 0 ? "Encontramos ejemplos para calibrar tus reglas iniciales." : "No encontramos más señales recientes. CapitalFlow seguirá aprendiendo automáticamente con las primeras excepciones reales.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible buscar ejemplos de calibración."); }
    finally { setBusy(null); }
  }

  async function candidateDecided(_action?: "accept" | "reject"): Promise<void> {
    // The backend records onboarding confirmations atomically before it reprocesses
    // other pending signals, so the client only refreshes state here.
    await load();
  }

  async function finish(): Promise<void> {
    setBusy("finish"); setError(null);
    try { await completeOnboarding(user.id); await onComplete(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible finalizar el onboarding."); }
    finally { setBusy(null); }
  }

  const annual = subscription?.interval === "annual";
  const emailReady = connections.some((item) => item.status === "active") || Boolean(state?.email_completed);
  const notificationReady = !nativeAndroid || notificationPermission || Boolean(state?.notification_completed);
  const coreReady = Boolean(profile && accounts.length > 0 && emailReady && notificationReady && state?.currencies_completed);
  const calibrationReady = Boolean(state && (state.associations_confirmed >= state.calibration_target || (state.calibration_attempted && candidates.length === 0)));
  const canFinish = coreReady && calibrationReady;
  const progress = useMemo(() => [Boolean(profile && state?.currencies_completed), accounts.length > 0, emailReady, notificationReady, calibrationReady].filter(Boolean).length, [profile, state, accounts.length, emailReady, notificationReady, calibrationReady]);

  if (!profile || !state || !subscription) return <LoadingScreen label="Configurando CapitalFlow…" />;

  return (
    <main className="onboarding-shell">
      <section className="onboarding-hero">
        <span className="eyebrow">CONFIGURACIÓN ÚNICA · {progress}/5</span>
        <h1>Déjalo listo una vez. Después, CapitalFlow trabaja por ti.</h1>
        <p>Conectaremos las fuentes, definiremos dónde registrar el dinero y confirmaremos unos pocos ejemplos reales para que el sistema aprenda tus patrones.</p>
        <div className="onboarding-progress"><progress max="5" value={progress}>{progress}/5</progress></div>
      </section>
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <div className="onboarding-grid">
        <form className={`panel onboarding-step ${state.currencies_completed ? "done" : ""}`} onSubmit={(event) => void saveCurrencies(event)}>
          <StepNumber value="1" done={state.currencies_completed} />
          <h2>Monedas</h2><p>Elige tu moneda principal y las monedas que vas a manejar.</p>
          <label className="field"><span>Moneda base</span><input value={profile.base_currency} maxLength={3} onChange={(event) => setProfile({ ...profile, base_currency: event.target.value.toUpperCase() })} /></label>
          <label className="field"><span>Monedas habilitadas</span><input value={profile.enabled_currencies.join(", ")} onChange={(event) => setProfile({ ...profile, enabled_currencies: event.target.value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean) })} placeholder="COP, USD, EUR" /></label>
          <button className="secondary-button" type="submit" disabled={busy !== null}>{state.currencies_completed ? "Actualizar monedas" : "Guardar monedas"}</button>
        </form>

        <form className={`panel onboarding-step ${accounts.length ? "done" : ""}`} onSubmit={(event) => void createPrimary(event)}>
          <StepNumber value="2" done={accounts.length > 0} />
          <h2>Cuenta principal</h2>
          {accounts.length ? <><strong>{accounts.find((item) => item.is_primary)?.name ?? accounts[0].name}</strong><p>Esta será el destino predeterminado cuando no exista ambigüedad.</p></> : <>
            <label className="field"><span>Nombre</span><input value={accountName} onChange={(event) => setAccountName(event.target.value)} required /></label>
            <label className="field"><span>Saldo inicial ({profile.base_currency})</span><input type="number" step="any" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} /></label>
            <button className="secondary-button" type="submit" disabled={busy !== null}>Crear cuenta principal</button>
          </>}
          <small>{annual ? "Tu plan anual permite crear después cuentas independientes para viajes, trabajo, proyectos u otros seguimientos." : "Tu plan semanal incluye una cuenta principal. Las cuentas independientes adicionales están disponibles en el anual."}</small>
        </form>

        <article className={`panel onboarding-step ${emailReady ? "done" : ""}`}>
          <StepNumber value="3" done={emailReady} />
          <h2>Correo financiero</h2><p>Conecta Gmail o Outlook. Después del OAuth se inicia automáticamente una primera sincronización.</p>
          <div className="button-row">
            <button className="secondary-button" type="button" disabled={busy !== null} onClick={() => void connect("gmail")}>{connections.some((item) => item.provider === "gmail" && item.status === "active") ? "Gmail conectado" : "Conectar Gmail"}</button>
            <button className="secondary-button" type="button" disabled={busy !== null} onClick={() => void connect("outlook")}>{connections.some((item) => item.provider === "outlook" && item.status === "active") ? "Outlook conectado" : "Conectar Outlook"}</button>
          </div>
          <small>Solo necesitas una cuenta de correo. Puedes añadir la otra posteriormente.</small>
        </article>

        <article className={`panel onboarding-step ${notificationReady ? "done" : ""}`}>
          <StepNumber value="4" done={notificationReady} />
          <h2>Notificaciones Android</h2>
          {!nativeAndroid ? <Notice tone="info">En la PWA web este paso no aplica. Cuando instales el APK Android, podrás activar la captura automática desde Ajustes → Fuentes.</Notice> : <>
            <p>CapitalFlow filtra localmente señales financieras. No necesitas escribir nombres técnicos de aplicaciones.</p>
            <div className="button-row"><button className="secondary-button" type="button" onClick={() => void grantNotifications()}>{notificationPermission ? "Revisar permiso" : "Autorizar notificaciones"}</button><button className="text-button" type="button" disabled={busy !== null} onClick={() => void verifyNotifications()}>Ya lo autoricé: verificar</button></div>
          </>}
        </article>
      </div>

      <article className={`panel onboarding-calibration ${calibrationReady ? "done" : ""}`}>
        <div className="panel-heading"><div><StepNumber value="5" done={calibrationReady} /><span className="eyebrow">CALIBRACIÓN INICIAL</span><h2>Confirma de 3 a 5 ejemplos y CapitalFlow recuerda la decisión</h2></div><button className="secondary-button" type="button" disabled={!coreReady || busy !== null} onClick={() => void findCalibrationExamples()}>{busy === "calibration" ? "Buscando…" : "Buscar ejemplos recientes"}</button></div>
        <p>Cada ejemplo aceptado puede enseñar una asociación de fuente→cuenta y comercio→categoría. Si tus fuentes no tienen suficientes señales recientes, puedes terminar cuando ya no queden ejemplos: el aprendizaje continúa con futuras excepciones.</p>
        <div className="calibration-count"><strong>{state.associations_confirmed}</strong><span>asociaciones confirmadas · objetivo inicial {state.calibration_target}</span></div>
        {candidates.length > 0 ? <div className="candidate-list">{candidates.map((candidate) => <CandidateReview key={candidate.id} candidate={candidate} accounts={accounts} categories={categories} onDecided={candidateDecided} />)}</div> : state.calibration_attempted ? <Notice tone="success">No quedan ejemplos pendientes. El sistema continuará aprendiendo de manera silenciosa y solo pedirá ayuda ante una ambigüedad real.</Notice> : <p className="empty-state">Conecta tus fuentes y pulsa “Buscar ejemplos recientes”.</p>}
      </article>

      <div className="onboarding-finish">
        {!canFinish ? <small>Completa las fuentes y la calibración disponible para activar el modo autónomo.</small> : <strong>Configuración lista. Desde aquí CapitalFlow priorizará resolver los movimientos sin interrumpirte.</strong>}
        <button className="primary-button" type="button" disabled={!canFinish || busy !== null} onClick={() => void finish()}>{busy === "finish" ? "Activando…" : "Activar CapitalFlow"}</button>
      </div>
    </main>
  );
}

function StepNumber({ value, done }: { value: string; done: boolean }) {
  return <span className={`step-number ${done ? "done" : ""}`}>{done ? "✓" : value}</span>;
}
