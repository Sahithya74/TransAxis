import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LoginRequest, MfaChallengeDto, Permission, SessionOrganization, SessionResponse, SessionUser } from '@transaxis/shared';
import { api, refreshSession, setAccessToken, setSessionLostHandler } from '../lib/api';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  status: Status;
  user: SessionUser | null;
  organization: SessionOrganization | null;
  /** Password step. Resolves to 'mfa' when the account needs an authenticator code next. */
  login: (input: LoginRequest) => Promise<'done' | 'mfa'>;
  /** Second step of a pending sign-in: the 6-digit code from the authenticator app. */
  verifyCode: (code: string) => Promise<void>;
  /** True between a correct password and the code, for accounts with two-step sign-in. */
  mfaPending: boolean;
  cancelMfa: () => void;
  /** Installs a session the API handed back, e.g. after changing the password. */
  applySession: (s: SessionResponse) => void;
  /** Re-reads the profile after account changes such as turning two-step sign-in on. */
  reloadUser: () => Promise<void>;
  logout: () => Promise<void>;
  /** UI convenience only. The API enforces every permission again on the server. */
  can: (...anyOf: Permission[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

type Me = Omit<SessionResponse, 'accessToken' | 'expiresIn'>;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [organization, setOrganization] = useState<SessionOrganization | null>(null);
  // The challenge lives only in memory for its five minutes; a reload simply starts the sign-in again.
  const [mfaToken, setMfaToken] = useState<string | null>(null);

  const clear = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setOrganization(null);
    setMfaToken(null);
    setStatus('anonymous');
  }, []);

  const apply = useCallback((s: SessionResponse) => {
    setAccessToken(s.accessToken);
    setUser(s.user);
    setOrganization(s.organization);
    setMfaToken(null);
    setStatus('authenticated');
  }, []);

  // Restore the session from the refresh cookie on first load.
  useEffect(() => {
    setSessionLostHandler(clear);
    let cancelled = false;
    (async () => {
      try {
        if (await refreshSession()) {
          const me = await api<Me>('/auth/me');
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
      const res = await api<SessionResponse | MfaChallengeDto>('/auth/login', { method: 'POST', body: input, noRefresh: true });
      if ('mfaRequired' in res) {
        setMfaToken(res.mfaToken);
        return 'mfa' as const;
      }
      apply(res);
      return 'done' as const;
    },
    [apply],
  );

  const verifyCode = useCallback(
    async (code: string) => {
      if (!mfaToken) throw new Error('No sign-in is waiting for a code');
      apply(await api<SessionResponse>('/auth/login/totp', { method: 'POST', body: { mfaToken, code }, noRefresh: true }));
    },
    [apply, mfaToken],
  );

  const cancelMfa = useCallback(() => setMfaToken(null), []);

  const reloadUser = useCallback(async () => {
    const me = await api<Me>('/auth/me');
    setUser(me.user);
    setOrganization(me.organization);
  }, []);

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
      verifyCode,
      mfaPending: mfaToken !== null,
      cancelMfa,
      applySession: apply,
      reloadUser,
      logout,
      can: (...anyOf) => !!user && anyOf.some((p) => user.permissions.includes(p)),
    }),
    [status, user, organization, login, verifyCode, mfaToken, cancelMfa, apply, reloadUser, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
