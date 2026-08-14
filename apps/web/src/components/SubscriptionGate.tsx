import { useCallback, useEffect, useState, type ReactNode } from "react";

import { LoadingScreen } from "./LoadingScreen";
import { loadSubscription } from "../lib/data";
import type { Subscription } from "../lib/types";
import { SubscriptionPage } from "../pages/SubscriptionPage";

export function SubscriptionGate({
  userId,
  forcePage,
  children,
  onSignOut,
}: {
  userId: string;
  forcePage: boolean;
  children: ReactNode;
  onSignOut(): Promise<void>;
}) {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSubscription(await loadSubscription(userId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo verificar la suscripción.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) return <LoadingScreen label="Verificando acceso…" />;
  if (error) {
    return (
      <main className="center-screen">
        <div className="error-card"><h1>No pudimos verificar tu acceso</h1><p>{error}</p><button className="primary-button" type="button" onClick={() => void refresh()}>Reintentar</button></div>
      </main>
    );
  }

  const entitled = Boolean(
    subscription
    && (subscription.status === "active" || subscription.status === "trialing")
    && (!subscription.current_period_end || Date.parse(subscription.current_period_end) > Date.now()),
  );
  if (!entitled || forcePage) return <SubscriptionPage subscription={subscription} onRefresh={refresh} onSignOut={onSignOut} />;
  return children;
}
