import { useEffect } from "react";

import { isAndroidNative, syncAndroidCandidates } from "../lib/notificationAccess";

/** Uploads the local Android queue whenever the authenticated app becomes active. */
export function useAndroidCandidateSync(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !isAndroidNative()) return;
    let stopped = false;

    async function synchronize(): Promise<void> {
      if (stopped || document.visibilityState === "hidden" || !navigator.onLine) return;
      try {
        const result = await syncAndroidCandidates();
        if (result.inserted > 0) window.dispatchEvent(new Event("capitalflow:candidates-updated"));
      } catch {
        // Keep the on-device queue intact. The next foreground/online cycle retries.
      }
    }

    const onVisibility = (): void => { if (document.visibilityState === "visible") void synchronize(); };
    const onOnline = (): void => { void synchronize(); };
    void synchronize();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => void synchronize(), 60_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled]);
}
