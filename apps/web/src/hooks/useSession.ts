import { useCallback, useEffect, useState } from "react";

import { clearFinancialCache } from "../lib/cache";
import { demoMode } from "../lib/env";
import { supabase } from "../lib/supabase";
import type { AppUser } from "../lib/types";

const SESSION_BOOTSTRAP_TIMEOUT_MS = 10_000;
const SESSION_BOOTSTRAP_ERROR = "No se pudo iniciar tu sesión. Revisa tu conexión e inténtalo de nuevo.";
const SESSION_CONFIGURATION_ERROR = "CapitalFlow no pudo conectarse al servicio de acceso. Reintenta en unos instantes.";

interface SessionController {
  user: AppUser | null;
  loading: boolean;
  error: string | null;
  signUp(email: string, password: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<void>;
}

export function useSession(): SessionController {
  const [user, setUser] = useState<AppUser | null>(
    demoMode ? { id: "demo-user", email: "demo@capitalflow.local" } : null,
  );
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (demoMode) return undefined;

    const client = supabase;
    if (!client) {
      setUser(null);
      setError(SESSION_CONFIGURATION_ERROR);
      setLoading(false);
      return undefined;
    }

    let active = true;
    let authEventHandled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;

    try {
      const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
        authEventHandled = true;
        if (!active) return;
        setUser(toAppUser(session?.user));
        setError(null);
        setLoading(false);
      });
      unsubscribe = () => subscription.subscription.unsubscribe();
    } catch {
      setUser(null);
      setError(SESSION_BOOTSTRAP_ERROR);
      setLoading(false);
      return () => {
        active = false;
      };
    }

    const sessionPromise = Promise.resolve().then(() => client.auth.getSession());
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => reject(new Error("SESSION_BOOTSTRAP_TIMEOUT")), SESSION_BOOTSTRAP_TIMEOUT_MS);
    });

    void Promise.race([sessionPromise, timeoutPromise])
      .then(({ data, error: sessionError }) => {
        if (sessionError) throw sessionError;
        if (!active || authEventHandled) return;
        setUser(toAppUser(data.session?.user));
        setError(null);
      })
      .catch(() => {
        if (!active || authEventHandled) return;
        setUser(null);
        setError(SESSION_BOOTSTRAP_ERROR);
      })
      .finally(() => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        if (active && !authEventHandled) setLoading(false);
      });

    return () => {
      active = false;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      unsubscribe?.();
    };
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    if (demoMode) {
      setUser({ id: "demo-user", email });
      return;
    }
    if (!supabase) throw new Error("Supabase no está configurado.");
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (demoMode) {
      setUser({ id: "demo-user", email });
      return;
    }
    if (!supabase) throw new Error("Supabase no está configurado.");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    clearFinancialCache();
    if (demoMode) return;
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    if (demoMode) return;
    if (!supabase) throw new Error("Supabase no está configurado.");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/#/settings`,
    });
    if (error) throw error;
  }, []);

  return { user, loading, error, signUp, signIn, signOut, resetPassword };
}

function toAppUser(user: { id: string; email?: string | null } | null | undefined): AppUser | null {
  if (!user) return null;
  return { id: user.id, email: user.email ?? null };
}
