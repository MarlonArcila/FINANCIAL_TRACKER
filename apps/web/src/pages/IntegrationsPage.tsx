import { useCallback, useEffect, useState } from "react";

import { Notice } from "../components/Notice";
import { invokeFunction } from "../lib/api";
import { demoMode } from "../lib/env";
import { listConnections, loadProfile } from "../lib/data";
import {
  getAllowedNotificationPackages,
  getNotificationPermission,
  isAndroidNative,
  openNotificationPermissionSettings,
  setAllowedNotificationPackages,
  setNotificationDefaultCurrency,
  syncAndroidCandidates,
} from "../lib/notificationAccess";
import type { AppUser, SourceConnection } from "../lib/types";

export function IntegrationsPage({ user }: { user: AppUser }) {
  const nativeAndroid = isAndroidNative();
  const [permission, setPermission] = useState(false);
  const [packages, setPackages] = useState("");
  const [connections, setConnections] = useState<SourceConnection[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextConnections, nextPermission, nextPackages, profile] = await Promise.all([
        listConnections(),
        nativeAndroid ? getNotificationPermission() : Promise.resolve(false),
        nativeAndroid ? getAllowedNotificationPackages() : Promise.resolve([]),
        loadProfile(user.id),
      ]);
      if (nativeAndroid) await setNotificationDefaultCurrency(profile.base_currency);
      setConnections(nextConnections);
      setPermission(nextPermission);
      setPackages(nextPackages.join("\n"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible cargar las integraciones.");
    }
  }, [nativeAndroid, user.id]);

  useEffect(() => { void load(); }, [load]);

  async function connect(provider: "gmail"): Promise<void> {
    setBusy(provider);
    setError(null);
    setMessage(null);
    try {
      if (demoMode) {
        setMessage(`Conexión ${provider} simulada. En producción se abrirá OAuth.`);
        return;
      }
      const result = await invokeFunction<{ authorizationUrl: string }>(`${provider}-oauth-start`, {
        returnUrl: `${window.location.origin}/#/integrations`,
      });
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible iniciar OAuth.");
    } finally {
      setBusy(null);
    }
  }

  async function syncMail(provider: "gmail"): Promise<void> {
    setBusy(`${provider}-sync`);
    setError(null);
    setMessage(null);
    try {
      if (demoMode) {
        setMessage(`Sincronización ${provider} simulada.`);
        return;
      }
      const result = await invokeFunction<{ scanned: number; inserted: number; duplicates: number }>(`${provider}-sync`, {});
      setMessage(`${provider}: ${result.scanned} mensajes revisados, ${result.inserted} candidatos nuevos y ${result.duplicates} duplicados.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible sincronizar.");
    } finally {
      setBusy(null);
    }
  }


  async function disconnect(provider: "gmail"): Promise<void> {
    if (!window.confirm(`Desconectar ${provider} y eliminar sus credenciales locales?`)) return;
    setBusy(`${provider}-disconnect`);
    setError(null);
    setMessage(null);
    try {
      if (demoMode) {
        setMessage(`Desconexión ${provider} simulada.`);
        return;
      }
      const result = await invokeFunction<{ disconnected: boolean; warning?: string | null }>("disconnect-source", { provider });
      setMessage(result.warning ? `Cuenta desconectada; limpieza remota pendiente: ${result.warning}` : "Cuenta desconectada.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible desconectar la cuenta.");
    } finally {
      setBusy(null);
    }
  }

  async function savePackages(): Promise<void> {
    setBusy("packages");
    setError(null);
    try {
      await setAllowedNotificationPackages(packages.split(/\r?\n/u));
      setMessage("Lista de aplicaciones autorizadas guardada en el dispositivo.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible guardar la lista.");
    } finally {
      setBusy(null);
    }
  }

  async function syncAndroid(): Promise<void> {
    setBusy("android-sync");
    setError(null);
    try {
      const result = await syncAndroidCandidates();
      setMessage(`Android: ${result.sent} enviados, ${result.inserted} nuevos y ${result.duplicates} duplicados.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible enviar candidatos Android.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="page">
      <div className="page-heading"><div><span className="eyebrow">ORÍGENES DE DATOS</span><h1>Integraciones</h1><p>Autoriza únicamente las fuentes que quieras revisar.</p></div></div>
      <Notice tone="info">Las señales claras se registran automáticamente. Solo las ambigüedades quedan pendientes para revisión y aprendizaje.</Notice>
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="integration-grid">
        <article className="integration-card">
          <div className="integration-icon">A</div>
          <div><span className="eyebrow">ANDROID</span><h2>Notificaciones del dispositivo</h2></div>
          {!nativeAndroid ? <Notice tone="warning">Esta capacidad requiere el APK Android. La PWA del navegador no puede leer notificaciones de otras apps.</Notice> : (
            <>
              <p>Permiso: <strong>{permission ? "Concedido" : "Pendiente"}</strong></p>
              <button className="secondary-button" type="button" onClick={() => void openNotificationPermissionSettings()}>{permission ? "Revisar permiso" : "Conceder permiso"}</button>
              <details><summary>Filtro avanzado de aplicaciones</summary><label className="field"><span>Limitar a paquetes concretos, uno por línea</span><textarea rows={5} value={packages} onChange={(event) => setPackages(event.target.value)} placeholder="com.ejemplo.billetera" /><small>Lista vacía = detección automática local en todas las notificaciones; solo se envían las señales que el parser identifica como financieras.</small></label></details>
              <div className="button-row"><button className="secondary-button" type="button" disabled={busy !== null} onClick={() => void savePackages()}>Guardar lista</button><button className="primary-button" type="button" disabled={!permission || busy !== null} onClick={() => void syncAndroid()}>Enviar candidatos</button></div>
            </>
          )}
        </article>
        <MailCard provider="gmail" connection={connections.find((item) => item.provider === "gmail")} busy={busy} onConnect={connect} onSync={syncMail} onDisconnect={disconnect} />
      </div>
      <article className="panel privacy-panel"><h2>Minimización de datos</h2><p>La implementación almacena identificadores externos, remitente normalizado, asunto/fragmento sanitizado y campos financieros inferidos. No debe conservar cuerpos completos ni adjuntos por defecto. Los tokens OAuth viven cifrados en un esquema privado del backend.</p></article>
    </section>
  );
}

function MailCard({ provider, connection, busy, onConnect, onSync, onDisconnect }: {
  provider: "gmail";
  connection: SourceConnection | undefined;
  busy: string | null;
  onConnect(provider: "gmail"): Promise<void>;
  onSync(provider: "gmail"): Promise<void>;
  onDisconnect(provider: "gmail"): Promise<void>;
}) {
  const title = "Gmail";
  return (
    <article className="integration-card">
      <div className="integration-icon">G</div>
      <div><span className="eyebrow">CORREO</span><h2>{title}</h2></div>
      {connection ? <p><strong>{connection.email_address ?? "Cuenta vinculada"}</strong><br /><small>Estado {connection.status}{connection.last_sync_at ? ` · última sincronización ${new Date(connection.last_sync_at).toLocaleString("es-CO")}` : ""}</small></p> : <p>Conecta por OAuth con permiso de lectura mínimo para detectar mensajes financieros.</p>}
      {connection?.last_error ? <Notice tone="warning">{connection.last_error}</Notice> : null}
      <div className="button-row">
        <button className="secondary-button" type="button" disabled={busy !== null} onClick={() => void onConnect(provider)}>{busy === provider ? "Abriendo…" : connection ? "Reconectar" : "Conectar"}</button>
        {connection?.status === "active" ? <button className="primary-button" type="button" disabled={busy !== null} onClick={() => void onSync(provider)}>{busy === `${provider}-sync` ? "Sincronizando…" : "Sincronizar ahora"}</button> : null}
        {connection ? <button className="danger-button" type="button" disabled={busy !== null} onClick={() => void onDisconnect(provider)}>{busy === `${provider}-disconnect` ? "Desconectando…" : "Desconectar"}</button> : null}
      </div>
    </article>
  );
}
