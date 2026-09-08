import { useEffect, useMemo, useState } from "react";
import { invokeFunction } from "../lib/api";

type RelayState =
  "NOT_CONFIGURED" | "VERIFICATION_PENDING" | "ACTIVE" | "ERROR" | "REVOKED";
type SourceProvider = "gmail" | "outlook" | "proton" | "other";
type CatalogItem = {
  id: string;
  display_name: string;
  sender_domains: string[];
  country_code: string | null;
  sort_order: number;
};
type RelaySource = {
  id: string;
  provider: SourceProvider;
  label: string;
  state: RelayState;
  lastReceivedAt?: string | null;
  lastFinancialEventAt?: string | null;
};
type Verification = {
  id: string;
  sourceId: string | null;
  sourceLabel: string | null;
  provider: SourceProvider;
  status: "pending" | "opened";
  sender: string | null;
  subject: string | null;
  excerpt: string | null;
  verificationUrl: string | null;
  verificationCode: string | null;
  receivedAt: string;
  expiresAt: string;
};
type RelayResponse = {
  state: RelayState;
  address?: string | undefined;
  aliasHint?: string | null;
  domain?: string;
  sources?: RelaySource[];
  catalog?: CatalogItem[];
  verifications?: Verification[];
};
const labels: Record<RelayState, string> = {
  NOT_CONFIGURED: "No configurado",
  VERIFICATION_PENDING: "Verificación pendiente",
  ACTIVE: "Activo",
  ERROR: "Error",
  REVOKED: "Revocado",
};
const providerNames: Record<SourceProvider, string> = {
  gmail: "Gmail",
  outlook: "Outlook / Hotmail",
  proton: "Proton Mail",
  other: "Otro correo",
};
const guide = [
  [
    "Abre Gmail en un computador y haz clic en el ícono de Configuración (la tuerca) de la esquina superior derecha.",
    "step-settings.svg",
  ],
  ["Haz clic en «Ver toda la configuración».", "step-see-all-settings.svg"],
  ["Abre la pestaña «Reenvío y correo POP/IMAP».", "step-forwarding-tab.svg"],
  [
    "En la sección Reenvío, haz clic en «Agregar una dirección de reenvío».",
    "step-add-forwarding-address.svg",
  ],
  [
    "Pega tu dirección privada de CapitalFlow, que termina en @ingest.capitalflow.eu.cc, y continúa.",
    "step-enter-capitalflow-address.svg",
  ],
  [
    "Gmail enviará un mensaje de verificación. CapitalFlow lo detectará y lo mostrará aquí.",
    "step-verification-inbox.svg",
  ],
  [
    "Cuando aparezca la verificación, abre el enlace seguro o copia el código y completa la confirmación de Gmail.",
    "step-verification-inbox.svg",
  ],
  [
    "Regresa a Gmail y actualiza la configuración si es necesario.",
    "step-forwarding-tab.svg",
  ],
  [
    "No actives el reenvío global de todos los correos: usa el filtro financiero sugerido más abajo.",
    "filter-forward-action.svg",
  ],
];
export function EmailRelayCard() {
  const [state, setState] = useState<RelayResponse>({
    state: "NOT_CONFIGURED",
    sources: [],
  });
  const [provider, setProvider] = useState<SourceProvider>("gmail");
  const [sourceLabel, setSourceLabel] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const load = async () => {
    try {
      const data = await invokeFunction<RelayResponse>("email-relay-settings", {
        action: "state",
      });
      setState((prev) => {
        const next: RelayResponse = { ...data };
        if (data.address === undefined && prev.address !== undefined)
          next.address = prev.address;
        return next;
      });
    } catch {
      setMessage("No fue posible consultar el correo financiero automático.");
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!state.verifications?.length) return;
    const id = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(id);
  }, [state.verifications?.length]);
  const domains = useMemo(
    () => [
      ...new Set(
        (state.catalog ?? [])
          .filter((x) => selected.includes(x.id))
          .flatMap((x) => x.sender_domains),
      ),
    ],
    [state.catalog, selected],
  );
  const gmailFilter = domains.length
    ? `from:(${domains.map((x) => `@${x}`).join(" OR ")})`
    : "Selecciona entidades para generar el filtro.";
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const data = await invokeFunction<RelayResponse>("email-relay-settings", {
        action,
        ...extra,
      });
      if (
        (action === "generate" || action === "rotate") &&
        data.address !== undefined
      )
        setState((prev) => ({
          ...prev,
          ...data,
          address: data.address,
          sources: data.sources ?? [],
        }));
      else await load();
      setMessage(
        action === "revoke"
          ? "Dirección y fuentes revocadas."
          : "Estado actualizado.",
      );
    } catch {
      setMessage("No fue posible completar la acción. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  };
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copiado.`);
    } catch {
      setMessage("No se pudo copiar. Selecciona el texto manualmente.");
    }
  };
  return (
    <article
      className="integration-card relay-card"
      aria-labelledby="email-relay-title"
    >
      <header className="relay-header">
        <div>
          <h2 id="email-relay-title">Correo financiero automático</h2>
          <p className="muted">
            Una dirección privada recibe avisos de Gmail, Outlook, Proton Mail u
            otro correo, sin conectar la API de tu buzón.
          </p>
        </div>
        <span className={`relay-status state-${state.state.toLowerCase()}`}>
          {labels[state.state]}
        </span>
      </header>
      {message ? (
        <p className="notice relay-feedback" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      {state.address ? (
        <section className="relay-section private-address">
          <h3>Guarda esta dirección ahora</h3>
          <p>
            Por tu seguridad, la dirección completa solo se muestra una vez.
            Cópiala y guárdala en un gestor de contraseñas o en otro lugar
            seguro.
          </p>
          <code>{state.address}</code>
          <div className="button-row">
            <button
              className="secondary-button"
              type="button"
              onClick={() => void copy(state.address!, "Dirección")}
            >
              Copiar dirección
            </button>
          </div>
        </section>
      ) : state.aliasHint ? (
        <section className="relay-section">
          <h3>Dirección privada configurada</h3>
          <code>
            cf+{state.aliasHint}@{state.domain ?? "ingest.capitalflow.eu.cc"}
          </code>
          <p className="muted">
            La dirección completa solo se muestra al crearla o rotarla.
          </p>
        </section>
      ) : null}
      {state.aliasHint || state.address || state.state === "REVOKED" ? (
        <section className="notice relay-recovery">
          <strong>¿Perdiste la dirección completa?</strong>
          <ol>
            <li>Haz clic en «Revocar toda la ingesta por correo».</li>
            <li>Después usa «Rotar dirección» para crear una nueva.</li>
            <li>
              Copia inmediatamente la nueva dirección y guárdala de forma
              segura.
            </li>
            <li>
              Actualiza en Gmail, Outlook o Proton los reenvíos o filtros que
              utilizaban la dirección anterior.
            </li>
          </ol>
        </section>
      ) : null}
      <div className="button-row">
        {state.state === "NOT_CONFIGURED" ? (
          <button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={() => void act("generate")}
          >
            Generar dirección privada
          </button>
        ) : null}
        {state.state !== "NOT_CONFIGURED" ? (
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void act("rotate")}
          >
            Rotar dirección
          </button>
        ) : null}
        {state.state !== "NOT_CONFIGURED" && state.state !== "REVOKED" ? (
          <button
            className="danger-button"
            type="button"
            disabled={busy}
            onClick={() => void act("revoke")}
          >
            Revocar toda la ingesta por correo
          </button>
        ) : null}
      </div>
      {state.aliasHint || state.address ? (
        <section className="relay-section">
          <h3>Correos financieros conectados</h3>
          {(state.sources ?? []).length ? (
            <div className="relay-source-list">
              {state.sources?.map((source) => (
                <article className="relay-source" key={source.id}>
                  <div>
                    <strong>{source.label}</strong>
                    <span className="provider-badge">
                      {providerNames[source.provider]}
                    </span>
                    <span
                      className={`relay-status state-${source.state.toLowerCase()}`}
                    >
                      {labels[source.state]}
                    </span>
                    {source.lastReceivedAt ? (
                      <small>
                        Último correo:{" "}
                        {new Date(source.lastReceivedAt).toLocaleString(
                          "es-CO",
                        )}
                      </small>
                    ) : null}
                  </div>
                  <button
                    className="ghost-danger"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act("revoke_source", { sourceId: source.id })
                    }
                  >
                    Revocar esta fuente
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">
              Aún no has agregado una fuente. Puedes agregar varias a la misma
              dirección.
            </p>
          )}
        </section>
      ) : null}
      {state.verifications?.length ? (
        <section className="relay-section verification-inbox">
          <h3>Verificaciones de reenvío</h3>
          <p className="muted">
            CapitalFlow nunca te pedirá tu contraseña de Gmail.
          </p>
          {state.verifications.map((v) => (
            <article className="verification-card" key={v.id}>
              <div>
                <span className="provider-badge">
                  {providerNames[v.provider]}
                </span>
                <strong>Verificación de reenvío recibida</strong>
                <small>
                  Recibida: {new Date(v.receivedAt).toLocaleString("es-CO")}
                </small>
                {v.excerpt ? <p>{v.excerpt}</p> : null}
                {v.verificationCode ? (
                  <p>
                    Código: <code>{v.verificationCode}</code>
                  </p>
                ) : null}
              </div>
              <div className="button-row">
                {v.verificationUrl ? (
                  <a
                    className="primary-button"
                    href={v.verificationUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={() =>
                      void act("mark_verification_opened", {
                        verificationId: v.id,
                      })
                    }
                  >
                    Abrir verificación
                  </a>
                ) : null}
                {v.verificationCode ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void copy(v.verificationCode!, "Código")}
                  >
                    Copiar código
                  </button>
                ) : null}
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() =>
                    void act("resolve_verification", { verificationId: v.id })
                  }
                >
                  Ya confirmé el reenvío
                </button>
                <button
                  className="ghost-danger"
                  type="button"
                  onClick={() =>
                    void act("dismiss_verification", { verificationId: v.id })
                  }
                >
                  Descartar
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : null}
      {state.aliasHint || state.address ? (
        <section className="relay-section">
          <h3>Agregar otro correo</h3>
          <label className="field">
            Proveedor
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as SourceProvider)}
              disabled={busy}
            >
              <option value="gmail">Gmail</option>
              <option value="outlook">Outlook / Hotmail</option>
              <option value="proton">Proton Mail</option>
              <option value="other">Otro</option>
            </select>
          </label>
          <label className="field">
            Nombre opcional
            <input
              value={sourceLabel}
              onChange={(e) => setSourceLabel(e.target.value)}
              maxLength={80}
              placeholder={`${providerNames[provider]} personal`}
            />
          </label>
          <button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={() =>
              void act("add_source", {
                provider,
                label: sourceLabel.trim() || providerNames[provider],
              })
            }
          >
            Agregar fuente
          </button>
        </section>
      ) : null}
      <details className="relay-guide" open>
        <summary>Configuración del reenvío</summary>
        <ol className="guide-steps">
          {guide.map(([text, image], i) => (
            <li key={text as string}>
              <img
                loading="lazy"
                src={`/guides/gmail-forwarding/${image}`}
                alt={`Ilustración: ${text as string}`}
              />
              <span>
                <strong>Paso {i + 1}</strong>
                {text as string}
              </span>
            </li>
          ))}
        </ol>
      </details>
      <details className="relay-guide" open>
        <summary>Filtros sugeridos para Gmail</summary>
        <p>
          Elige las entidades cuyos avisos financieros quieres enviar a
          CapitalFlow. Crearemos un filtro para que Gmail reenvíe solo esos
          mensajes.
        </p>
        <div className="catalog">
          {(state.catalog ?? []).map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                onChange={() =>
                  setSelected((prev) =>
                    prev.includes(item.id)
                      ? prev.filter((x) => x !== item.id)
                      : [...prev, item.id],
                  )
                }
              />
              {item.display_name}
            </label>
          ))}
        </div>
        <code className="filter-query">{gmailFilter}</code>
        <div className="button-row">
          <button
            className="secondary-button"
            type="button"
            disabled={!domains.length}
            onClick={() => void copy(gmailFilter, "Filtro")}
          >
            Copiar filtro
          </button>
        </div>
        <ol>
          <li>Abre las opciones de búsqueda de Gmail y pega el criterio.</li>
          <li>
            Ejecuta una búsqueda primero para revisar qué mensajes coinciden.
          </li>
          <li>
            Haz clic en «Crear filtro», selecciona «Reenviarlo a» y elige la
            dirección de CapitalFlow ya verificada.
          </li>
        </ol>
        <p className="notice">
          Los filtros de Gmail se aplican a los mensajes nuevos. Revisa los
          resultados de búsqueda antes de crear el filtro. No necesitas activar
          el reenvío global de toda tu cuenta.
        </p>
      </details>
    </article>
  );
}
