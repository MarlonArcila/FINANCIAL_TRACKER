import { useState, type FormEvent } from "react";

import { Notice } from "../components/Notice";

export function AuthPage({
  onSignIn,
  onSignUp,
  onReset,
}: {
  onSignIn(email: string, password: string): Promise<void>;
  onSignUp(email: string, password: string): Promise<void>;
  onReset(email: string): Promise<void>;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (mode === "signup" && !legalAccepted) {
      setError("Confirma que eres mayor de 18 años y que aceptas los documentos legales.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "signin") {
        await onSignIn(email.trim(), password);
      } else {
        await onSignUp(email.trim(), password);
        setMessage("Cuenta creada. Revisa tu correo si la confirmación está habilitada.");
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function reset(): Promise<void> {
    if (!email.trim()) {
      setError("Escribe primero tu correo.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onReset(email.trim());
      setMessage("Te enviamos el enlace de recuperación.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function changeMode(next: "signin" | "signup"): void {
    setMode(next);
    setLegalAccepted(false);
    setError(null);
    setMessage(null);
  }

  return (
    <main className="auth-layout">
      <section className="auth-copy">
        <span className="eyebrow">FINANZAS PERSONALES SIN API BANCARIA</span>
        <h1>Convierte señales dispersas en decisiones claras.</h1>
        <p>
          Registra movimientos manualmente o revísalos desde notificaciones y correo. Separa gastos,
          metas e inversión sin perder el control sobre lo que entra a tu libro.
        </p>
        <div className="auth-feature-grid">
          <article><strong>Revisión primero</strong><span>Ninguna detección se contabiliza sin tu decisión.</span></article>
          <article><strong>Plan explicable</strong><span>Prioridades y escenarios calculados sin depender de IA.</span></article>
          <article><strong>PWA + Android</strong><span>Una misma interfaz con capacidades nativas cuando están disponibles.</span></article>
        </div>
      </section>
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="brand auth-brand"><span className="brand-mark">CF</span><span>CapitalFlow</span></div>
        <h2 id="auth-title">{mode === "signin" ? "Ingresar" : "Crear cuenta"}</h2>
        <p>{mode === "signin" ? "Accede a tu espacio financiero." : "El acceso requiere una suscripción paga y tener al menos 18 años."}</p>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {message ? <Notice tone="success">{message}</Notice> : null}
        <form onSubmit={(event) => void submit(event)}>
          <label className="field">
            <span>Correo</span>
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label className="field">
            <span>Contraseña</span>
            <input
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {mode === "signup" ? (
            <label className="legal-consent">
              <input type="checkbox" checked={legalAccepted} onChange={(event) => setLegalAccepted(event.target.checked)} required />
              <span>
                Confirmo que tengo 18 años o más y acepto los <a href="/terms/" target="_blank" rel="noreferrer">Términos</a>,
                la <a href="/privacy/" target="_blank" rel="noreferrer">Política de Privacidad</a> y la
                <a href="/cookies/" target="_blank" rel="noreferrer"> Política de Cookies</a>.
              </span>
            </label>
          ) : null}
          <button className="primary-button full" type="submit" disabled={busy || (mode === "signup" && !legalAccepted)}>
            {busy ? "Procesando…" : mode === "signin" ? "Ingresar" : "Crear cuenta"}
          </button>
        </form>
        <button className="text-button" type="button" onClick={() => changeMode(mode === "signin" ? "signup" : "signin")}>
          {mode === "signin" ? "¿No tienes cuenta? Regístrate" : "Ya tengo cuenta"}
        </button>
        {mode === "signin" ? (
          <button className="text-button" type="button" disabled={busy} onClick={() => void reset()}>
            Recuperar contraseña
          </button>
        ) : null}
        <nav className="auth-legal-links" aria-label="Documentos legales">
          <a href="/privacy/" target="_blank" rel="noreferrer">Privacidad</a>
          <a href="/terms/" target="_blank" rel="noreferrer">Términos</a>
          <a href="/cookies/" target="_blank" rel="noreferrer">Cookies</a>
          <a href="/legal-regions/" target="_blank" rel="noreferrer">Regiones</a>
        </nav>
      </section>
    </main>
  );
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : "Ocurrió un error inesperado.";
}

