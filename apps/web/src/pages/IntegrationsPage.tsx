import { EmailRelayCard } from "../components/EmailRelayCard";
import { Notice } from "../components/Notice";
import type { AppUser } from "../lib/types";

export function IntegrationsPage({ user: _user }: { user: AppUser }) {
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ORÍGENES DE DATOS</span>
          <h1>Integraciones</h1>
          <p>Configura el correo financiero automático para registrar movimientos sin conectar la API de tu correo.</p>
        </div>
      </div>

      <Notice tone="info">
        Genera una única dirección privada de CapitalFlow y úsala para reenviar tus avisos financieros desde Gmail, Outlook, Proton Mail u otro proveedor.
      </Notice>

      <div className="integration-grid" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
        <EmailRelayCard />
      </div>

      <article className="panel privacy-panel">
        <h2>Privacidad y control</h2>
        <p>
          Esta integración no requiere acceso OAuth al buzón ni acceso a las notificaciones del dispositivo. Tú eliges qué mensajes reenviar a la dirección privada de CapitalFlow y puedes revocar una fuente, rotar la dirección o detener toda la ingesta cuando quieras.
        </p>
      </article>
    </section>
  );
}
