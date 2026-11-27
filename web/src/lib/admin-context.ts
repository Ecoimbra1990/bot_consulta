import { createContext, useContext } from 'react';
import type { Session } from '@supabase/supabase-js';

export interface AdminContextValue {
  session: Session;
  user: Session['user'];
  signOut: () => Promise<void>;
}

export const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const context = useContext(AdminContext);

  if (!context) {
    throw new Error('useAdmin deve ser usado dentro de AuthGuard.');
  }

  return context;
}
