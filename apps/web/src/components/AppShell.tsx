import type { ReactNode } from "react";

import type { AppRoute } from "../hooks/useHashRoute";
import { useConnectivityStatus } from "../hooks/useConnectivityStatus";
import type { AppUser } from "../lib/types";

const items: Array<{ route: AppRoute; label: string; icon: string }> = [
  { route: "dashboard", label: "Resumen", icon: "▦" },
  { route: "transactions", label: "Movimientos", icon: "↕" },
  { route: "goals", label: "Metas", icon: "◎" },
  { route: "investments", label: "Inversiones", icon: "⌁" },
  { route: "advisor", label: "Plan", icon: "◇" },
  { route: "integrations", label: "Fuentes", icon: "⛓" },
  { route: "data", label: "Datos", icon: "⇄" },
  { route: "settings", label: "Ajustes", icon: "⚙" },
];

export function AppShell({
  route,
  navigate,
  user,
  onSignOut,
  children,
}: {
  route: AppRoute;
  navigate(route: AppRoute): void;
  user: AppUser;
  onSignOut(): Promise<void>;
  children: ReactNode;
}) {
  const connectivity = useConnectivityStatus();
  const lastSyncLabel = connectivity.lastSync
    ? new Date(connectivity.lastSync).toLocaleString("es-CO")
    : "sin sincronización previa";
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("dashboard")} type="button">
          <span className="brand-mark">CF</span>
          <span>CapitalFlow</span>
        </button>
        <nav aria-label="Principal">
          {items.map((item) => (
            <button
              type="button"
              className={route === item.route ? "nav-item active" : "nav-item"}
              onClick={() => navigate(item.route)}
              key={item.route}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button type="button" className="plan-chip" onClick={() => navigate("subscription")}>Plan activo</button>
          <div className="user-row">
            <div className="avatar">{(user.email?.[0] ?? "U").toUpperCase()}</div>
            <div>
              <strong>{user.email ?? "Usuario"}</strong>
              <button className="text-button" type="button" onClick={() => void onSignOut()}>Cerrar sesión</button>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-column">
        <div
          className={`connectivity-status ${!connectivity.online || connectivity.usingCachedData ? "stale" : ""}`}
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true">{connectivity.online && !connectivity.usingCachedData ? "●" : "○"}</span>
          {connectivity.online && !connectivity.usingCachedData
            ? `En línea · última sincronización ${lastSyncLabel}`
            : `Modo lectura · mostrando datos guardados del ${lastSyncLabel}`}
        </div>
        <header className="mobile-header">
          <button className="brand" onClick={() => navigate("dashboard")} type="button">
            <span className="brand-mark">CF</span>
            <span>CapitalFlow</span>
          </button>
          <select className="mobile-route-select" aria-label="Ir a sección" value={route} onChange={(event) => navigate(event.target.value as AppRoute)}>
            {items.map((item) => <option key={item.route} value={item.route}>{item.label}</option>)}
          </select>
        </header>
        <main className="content">{children}</main>
        <nav className="bottom-nav" aria-label="Navegación móvil">
          {items.slice(0, 5).map((item) => (
            <button
              type="button"
              className={route === item.route ? "active" : ""}
              onClick={() => navigate(item.route)}
              key={item.route}
            >
              <span aria-hidden="true">{item.icon}</span>
              <small>{item.label}</small>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
