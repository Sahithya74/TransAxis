import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LoginRequest, Permission, SessionOrganization, SessionResponse, SessionUser } from '@transaxis/shared';
import { api, refreshSession, setAccessToken, setSessionLostHandler } from '../lib/api';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  status: Status;
  user: SessionUser | null;
  organization: SessionOrganization | null;
  login: (input: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  /** UI convenience only. The API enforces every permission again on the server. */
  can: (...anyOf: Permission[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [organization, setOrganization] = useState<SessionOrganization | null>(null);

  const clear = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setOrganization(null);
    setStatus('anonymous');
  }, []);

  const apply = useCallback((s: SessionResponse) => {
    setAccessToken(s.accessToken);
    setUser(s.user);
    setOrganization(s.organization);
    setStatus('authenticated');
  }, []);

  // Restore the session from the refresh cookie on first load.
  useEffect(() => {
    setSessionLostHandler(clear);
    let cancelled = false;
    (async () => {
      try {
        if (await refreshSession()) {
          const me = await api<Omit<SessionResponse, 'accessToken' | 'expiresIn'>>('/auth/me');
          if (!cancelled) {
            setUser(me.user);
            setOrganization(me.organization);
            setStatus('authenticated');
          }
          return;
        }
      } catch {
        /* fall through to anonymous */
      }
      if (!cancelled) clear();
    })();
    return () => {
      cancelled = true;
      setSessionLostHandler(null);
    };
  }, [clear]);

  const login = useCallback(
    async (input: LoginRequest) => {
      const s = await api<SessionResponse>('/auth/login', { method: 'POST', body: input, noRefresh: true });
      apply(s);
    },
    [apply],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', noRefresh: true });
    } finally {
      clear();
    }
  }, [clear]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      organization,
      login,
      logout,
      can: (...anyOf) => !!user && anyOf.some((p) => user.permissions.includes(p)),
    }),
    [status, user, organization, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
