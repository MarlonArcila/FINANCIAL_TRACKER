import { useCallback, useEffect, useState, type ReactNode } from "react";

import { LoadingScreen } from "./LoadingScreen";
import { loadOnboardingState, loadProfile, updateOnboardingState } from "../lib/data";
import { env } from "../lib/env";
import { getNotificationPermission, isAndroidNative } from "../lib/notificationAccess";
import type { AppUser } from "../lib/types";
import { OnboardingPage } from "../pages/OnboardingPage";

export function OnboardingGate({ user, children }: { user: AppUser; children: ReactNode }) {
  const [complete, setComplete] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      if (env.devBypassOnboarding) {
        setComplete(true);
        setError(null);
        return;
      }
      const [profile, state, notificationGranted] = await Promise.all([
        loadProfile(user.id),
        loadOnboardingState(user.id),
        isAndroidNative() ? getNotificationPermission() : Promise.resolve(true),
      ]);
      const native = isAndroidNative();
      if (native && notificationGranted && !state.notification_completed) {
        await updateOnboardingState(user.id, { notification_completed: true });
      }
      const baseComplete = Boolean(profile.onboarding_completed || state.completed_at);
      const notificationRequirementMet = !native || state.notification_completed || notificationGranted;
      setComplete(baseComplete && notificationRequirementMet);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible abrir la configuración inicial.");
    }
  }, [user.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (complete === null && !error) return <LoadingScreen label="Preparando tu configuración inicial…" />;
  if (error) return <main className="center-screen"><div className="error-card"><h1>No pudimos abrir el onboarding</h1><p>{error}</p><button className="primary-button" type="button" onClick={() => void refresh()}>Reintentar</button></div></main>;
  if (!complete) return <OnboardingPage user={user} onComplete={refresh} />;
  return children;
}
