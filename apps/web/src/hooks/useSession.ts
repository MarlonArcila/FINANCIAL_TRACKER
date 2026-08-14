import { useCallback, useEffect, useState } from "react";

import { clearFinancialCache } from "../lib/cache";
import { demoMode } from "../lib/env";
import { supabase } from "../lib/supabase";
import type { AppUser } from "../lib/types";

interface SessionController {
  user: AppUser | null;
  loading: boolean;
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

  useEffect(() => {
    if (demoMode || !supabase) return undefined;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(toAppUser(data.session?.user));
      setLoading(false);
    }).catch(() => {
      if (active) setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(toAppUser(session?.user));
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
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

  return { user, loading, signUp, signIn, signOut, resetPassword };
}

function toAppUser(user: { id: string; email?: string | null } | null | undefined): AppUser | null {
  if (!user) return null;
  return { id: user.id, email: user.email ?? null };
}
