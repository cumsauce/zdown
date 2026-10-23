import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, type Me } from './api';

interface Auth { me: Me | null; loading: boolean; signOut: () => Promise<void> }

const Ctx = createContext<Auth>({ me: null, loading: true, signOut: async () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.me().then(setMe, () => setMe(null)).finally(() => setLoading(false));
  }, []);
  const signOut = useCallback(async () => {
    await api.logout().catch(() => {});
    setMe(null);
    window.location.assign('/');
  }, []);
  return <Ctx.Provider value={{ me, loading, signOut }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
