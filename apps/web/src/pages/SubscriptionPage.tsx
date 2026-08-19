import { useState } from "react";

import { Notice } from "../components/Notice";
import { invokeFunction } from "../lib/api";
import { clearFinancialCache } from "../lib/cache";
import { demoMode, env } from "../lib/env";
import { resetDemoState } from "../lib/demoStore";
import type { Subscription } from "../lib/types";

export function SubscriptionPage({
  subscription,
  onRefresh,
  onSignOut,
}: {
  subscription: Subscription | null;
  onRefresh(): Promise<void>;
  onSignOut(): Promise<void>;
}) {
  const [busy, setBusy] = useState<"weekly" | "annual" | "export" | "delete" | "signout" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const active = Boolean(
    subscription
    && (subscription.status === "active" || subscription.status === "trialing")
    && (!subscription.current_period_end || Date.parse(subscription.current_period_end) > Date.now()),
  );

  async function checkout(interval: "weekly" | "annual"): Promise<void> {
    setBusy(interval);
    setError(null);
    setMessage(null);
    try {
      if (demoMode) return;
      const result = await invokeFunction<{ purchaseUrl: string }>("whop-checkout", { interval });
      window.location.assign(result.purchaseUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible abrir el checkout.");
    } finally {
      setBusy(null);
    }
  }

  async function exportData(): Promise<void> {
    setBusy("export");
    setError(null);
    setMessage(null);
    try {
      if (demoMode) {
        downloadBlob(new Blob([localStorage.getItem("capitalflow.demo.v1") ?? "{}"], { type: "application/json" }), "capitalflow-demo-export.json");
      } else {
        const result = await invokeFunction<{ filename: string; mimeType: string; content: string }>("export-data", {});
        downloadBlob(new Blob([result.content], { type: result.mimeType }), result.filename);
      }
      setMessage("Exportación preparada.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible exportar tus datos.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount(): Promise<void> {
    const phrase = window.prompt("Escribe ELIMINAR para borrar permanentemente tu cuenta, conexiones y datos.");
    if (phrase !== "ELIMINAR") return;
    setBusy("delete");
    setError(null);
    setMessage(null);
    try {
      if (demoMode) {
        resetDemoState();
        clearFinancialCache();
        window.location.reload();
        return;
      }
      await invokeFunction("delete-account", { confirmation: phrase });
      clearFinancialCache();
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible eliminar la cuenta.");
    } finally {
      setBusy(null);
    }
  }

  async function signOut(): Promise<void> {
    setBusy("signout");
    try {
      await onSignOut();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible cerrar sesión.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="page narrow-page">
      <div className="page-heading">
        <div><span className="eyebrow">ACCESO</span><h1>Elige cuánto tiempo quieres dejar tus finanzas en automático</h1><p>El plan semanal sirve para comprobar el flujo completo con una cuenta principal. El anual añade IA, cuentas independientes y backup/restore en nube para una experiencia continua.</p></div>
      </div>
      {active && subscription ? (
        <Notice tone="success">
          Tu plan {subscription.interval === "weekly" ? "semanal" : "anual"} está activo
          {subscription.current_period_end ? ` hasta ${new Date(subscription.current_period_end).toLocaleDateString("es-CO")}` : ""}.
        </Notice>
      ) : (
        <Notice tone="warning">CapitalFlow no tiene plan gratuito. Ambos planes incluyen automatización real; la IA es exclusiva del anual.</Notice>
      )}
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="pricing-grid">
        <article className="pricing-card">
          <span className="eyebrow">PRUÉBALO PAGANDO SOLO UNA SEMANA</span>
          <h2>Semanal</h2>
          {env.weeklyPriceLabel ? <strong className="price-label">{env.weeklyPriceLabel}</strong> : null}
          <p>Para validar que la detección automática encaja con tus bancos, correos y hábitos antes de comprometerte.</p>
          <FeatureList annual={false} />
          <button className="secondary-button full" type="button" disabled={busy !== null} onClick={() => void checkout("weekly")}>
            {busy === "weekly" ? "Abriendo…" : "Empezar por una semana"}
          </button>
        </article>
        <article className="pricing-card featured">
          <span className="eyebrow">RECOMENDADO · EXPERIENCIA COMPLETA</span>
          <h2>Anual</h2>
          {env.annualPriceLabel ? <strong className="price-label">{env.annualPriceLabel}</strong> : null}
          {env.annualSavingsLabel ? <span className="savings-badge">{env.annualSavingsLabel}</span> : null}
          <p>Para convertir el tracker en un sistema continuo: automatización + cuentas independientes + backup/restore + análisis y explicación financiera asistida por IA.</p>
          <FeatureList annual />
          <button className="primary-button full" type="button" disabled={busy !== null} onClick={() => void checkout("annual")}>
            {busy === "annual" ? "Abriendo…" : "Elegir anual completo"}
          </button>
        </article>
      </div>
      <div className="button-row">
        <button className="text-button" type="button" disabled={busy !== null} onClick={() => void onRefresh()}>Ya pagué: verificar estado</button>
        {active ? <button className="text-button" type="button" onClick={() => { window.location.hash = "/dashboard"; }}>Volver al tablero</button> : null}
      </div>

      <article className="panel account-control-panel">
        <h2>Control de cuenta y privacidad</h2>
        <p>Estas acciones permanecen disponibles incluso cuando la membresía está vencida.</p>
        <div className="button-row">
          <button className="secondary-button" type="button" disabled={busy !== null} onClick={() => void exportData()}>{busy === "export" ? "Preparando…" : "Exportar mis datos"}</button>
          <button className="danger-button" type="button" disabled={busy !== null} onClick={() => void deleteAccount()}>{busy === "delete" ? "Eliminando…" : "Eliminar cuenta"}</button>
          <button className="text-button" type="button" disabled={busy !== null} onClick={() => void signOut()}>{busy === "signout" ? "Cerrando…" : "Cerrar sesión"}</button>
        </div>
      </article>
      <p className="legal-copy">El cobro, cancelación y renovación se administran en Whop. CapitalFlow habilita las funciones según el intervalo de membresía verificado mediante eventos firmados.</p>
    </section>
  );
}

function FeatureList({ annual }: { annual: boolean }) {
  return (
    <ul className="feature-list">
      <li>Registro automático desde Android y Gmail</li>
      <li>Aprendizaje de cuenta y categoría tras tus correcciones</li>
      <li>Importación desde Excel, CSV, TSV y JSON</li>
      <li>Metas, inversiones, multi‑moneda y asesor determinista</li>
      <li>{annual ? <strong>Cuentas independientes para viajes, trabajo y proyectos</strong> : "Una cuenta principal"}</li>
      <li>{annual ? <strong>Backups/restores en Google Drive</strong> : "Sin backup/restore en nube"}</li>
      <li>{annual ? <strong>Asesor y explicaciones con IA</strong> : "Sin funciones de IA"}</li>
    </ul>
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
