import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { LoadingScreen } from "./LoadingScreen";
import { loadSubscription } from "../lib/data";
import type { Subscription } from "../lib/types";
import { SubscriptionPage } from "../pages/SubscriptionPage";

const CHECKOUT_POLL_INTERVAL_MS = 2_000;
const CHECKOUT_POLL_ATTEMPTS = 30;

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
  const checkoutComplete = useMemo(() => /(?:\?|&)checkout=complete(?:&|$)/u.test(window.location.hash), []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSubscription(await loadSubscription(userId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo verificar la suscripcion.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!checkoutComplete) return;
    let cancelled = false;
    let timer: number | null = null;

    async function poll(attempt: number): Promise<void> {
      if (cancelled) return;
      try {
        const next = await loadSubscription(userId);
        if (cancelled) return;
        setSubscription(next);
        setLoading(false);
        setError(null);
        if (isEntitled(next)) {
          window.location.hash = "/subscription?activated=1";
          return;
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "No se pudo verificar la suscripcion.");
      }

      if (attempt + 1 >= CHECKOUT_POLL_ATTEMPTS) {
        if (!cancelled) setError("Whop aun no confirma la membresia. Puedes reintentar la verificacion sin volver a pagar.");
        return;
      }
      timer = window.setTimeout(() => void poll(attempt + 1), CHECKOUT_POLL_INTERVAL_MS);
    }

    void poll(0);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [checkoutComplete, userId]);

  if (loading) return <LoadingScreen label="Verificando acceso..." />;
  if (error && !subscription) {
    return (
      <main className="center-screen">
        <div className="error-card"><h1>No pudimos verificar tu acceso</h1><p>{error}</p><button className="primary-button" type="button" onClick={() => void refresh()}>Reintentar</button></div>
      </main>
    );
  }

  const entitled = isEntitled(subscription);
  if (!entitled || forcePage) return <SubscriptionPage subscription={subscription} onRefresh={refresh} onSignOut={onSignOut} />;
  return children;
}

function isEntitled(subscription: Subscription | null): boolean {
  return Boolean(
    subscription
    && (subscription.status === "active" || subscription.status === "trialing")
    && (!subscription.current_period_end || Date.parse(subscription.current_period_end) > Date.now()),
  );
}
