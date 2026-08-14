import { useEffect, useState } from "react";

export type AppRoute =
  | "dashboard"
  | "transactions"
  | "goals"
  | "investments"
  | "advisor"
  | "integrations"
  | "data"
  | "subscription"
  | "settings";

const routes = new Set<AppRoute>([
  "dashboard",
  "transactions",
  "goals",
  "investments",
  "advisor",
  "integrations",
  "data",
  "subscription",
  "settings",
]);

export function useHashRoute(): [AppRoute, (route: AppRoute) => void] {
  const [route, setRoute] = useState<AppRoute>(readRoute);

  useEffect(() => {
    const handler = () => setRoute(readRoute());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  function navigate(next: AppRoute): void {
    window.location.hash = `/${next}`;
  }

  return [route, navigate];
}

function readRoute(): AppRoute {
  const value = window.location.hash.replace(/^#\/?/u, "").split("?")[0];
  if (value && routes.has(value as AppRoute)) return value as AppRoute;
  return "dashboard";
}
