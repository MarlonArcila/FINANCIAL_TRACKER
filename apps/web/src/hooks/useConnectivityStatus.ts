import { useEffect, useState } from "react";

import { getLastSuccessfulSync, type CacheFallbackDetail } from "../lib/cache";

export interface ConnectivityStatus {
  online: boolean;
  usingCachedData: boolean;
  lastSync: string | null;
}

export function useConnectivityStatus(): ConnectivityStatus {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [usingCachedData, setUsingCachedData] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(() => getLastSuccessfulSync());

  useEffect(() => {
    const onOnline = (): void => {
      setOnline(true);
      setUsingCachedData(false);
    };
    const onOffline = (): void => setOnline(false);
    const onFallback = (event: Event): void => {
      const detail = (event as CustomEvent<CacheFallbackDetail>).detail;
      setUsingCachedData(true);
      setLastSync(detail?.savedAt ?? getLastSuccessfulSync());
    };
    const onRefreshed = (event: Event): void => {
      const detail = (event as CustomEvent<{ savedAt?: string }>).detail;
      setUsingCachedData(false);
      setLastSync(detail?.savedAt ?? getLastSuccessfulSync());
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("capitalflow:cache-fallback", onFallback);
    window.addEventListener("capitalflow:cache-refreshed", onRefreshed);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("capitalflow:cache-fallback", onFallback);
      window.removeEventListener("capitalflow:cache-refreshed", onRefreshed);
    };
  }, []);

  return { online, usingCachedData, lastSync };
}
