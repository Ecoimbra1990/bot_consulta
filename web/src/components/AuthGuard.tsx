import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Navigate, useLocation } from 'react-router-dom';
import { AdminContext } from '../lib/admin-context';
import { supabase } from '../lib/supabase';

export function AuthGuard({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) {
        return;
      }

      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) {
        return;
      }

      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">Carregando...</div>;
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (session.user.app_metadata?.role !== 'admin') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center">
        <p className="text-lg font-semibold text-white">Acesso restrito a administradores</p>
        <button
          type="button"
          onClick={() => void signOut()}
          className="rounded-md bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-white"
        >
          Sair
        </button>
      </div>
    );
  }

  return <AdminContext.Provider value={{ session, user: session.user, signOut }}>{children}</AdminContext.Provider>;
}
