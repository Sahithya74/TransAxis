import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { ShieldCheck } from 'lucide-react';
import { loginRequestSchema } from '@transaxis/shared';
import { useAuth } from '../auth/AuthProvider';
import { ApiError } from '../lib/api';

const inputClass =
  'h-9 w-full rounded border border-line-strong bg-surface px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15';

function failureMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Could not reach the server. Check your connection and try again.';
  return err.status === 429 ? 'Too many attempts. Please wait a few minutes and try again.' : err.message;
}

export function LoginPage() {
  const { status, login, mfaPending } = useAuth();
  // Shown on the password step when a pending code step expired.
  const [notice, setNotice] = useState<string | null>(null);

  if (status === 'authenticated') return <Navigate to="/" replace />;

  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded bg-primary font-display font-bold text-white">
            TX
          </span>
          <div>
            <h1 className="text-xl leading-6">TransAxis</h1>
            <p className="text-[13px] text-muted">Fleet &amp; transport operations</p>
          </div>
        </div>

        {mfaPending ? <CodeStep onExpired={setNotice} /> : <PasswordStep login={login} notice={notice} />}

        <p className="mt-4 text-center text-xs text-muted">
          Demo accounts are listed in the project README. Demo data only.
        </p>
      </div>
    </div>
  );
}

function PasswordStep({ login, notice }: { login: ReturnType<typeof useAuth>['login']; notice: string | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>(notice ? { form: notice } : {});
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = loginRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as 'email' | 'password';
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await login(parsed.data);
    } catch (err) {
      setErrors({ form: failureMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="rounded-lg border border-line bg-surface p-6 shadow-card">
      <h2 className="mb-4 text-base">Sign in</h2>

      {errors.form && (
        <div role="alert" className="mb-4 rounded border border-crit/30 bg-crit-soft px-3 py-2 text-[13px] text-crit-strong">
          {errors.form}
        </div>
      )}

      <label className="mb-1 block text-[13px] font-medium" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        type="email"
        autoComplete="username"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-invalid={!!errors.email}
        aria-describedby={errors.email ? 'email-error' : undefined}
        className={inputClass}
      />
      {errors.email && (
        <p id="email-error" className="mt-1 text-xs text-crit-strong">
          {errors.email}
        </p>
      )}

      <label className="mb-1 mt-4 block text-[13px] font-medium" htmlFor="password">
        Password
      </label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        aria-invalid={!!errors.password}
        aria-describedby={errors.password ? 'password-error' : undefined}
        className={inputClass}
      />
      {errors.password && (
        <p id="password-error" className="mt-1 text-xs text-crit-strong">
          {errors.password}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="mt-6 h-9 w-full rounded bg-primary text-sm font-medium text-white hover:bg-primary-strong disabled:opacity-60"
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

/** Second step for accounts with two-step sign-in: a code from the authenticator app. */
function CodeStep({ onExpired }: { onExpired: (message: string) => void }) {
  const { verifyCode, cancelMfa } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your authenticator app');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await verifyCode(code);
    } catch (err) {
      // An expired challenge sends the person back to the password step with the reason.
      if (err instanceof ApiError && /expired/i.test(err.message)) {
        onExpired(err.message);
        cancelMfa();
        return;
      }
      setError(failureMessage(err));
      setCode('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="rounded-lg border border-line bg-surface p-6 shadow-card">
      <div className="mb-4 flex items-center gap-2">
        <ShieldCheck className="size-5 text-primary" aria-hidden />
        <h2 className="text-base">Two-step verification</h2>
      </div>
      <p className="mb-4 text-[13px] text-muted">Open your authenticator app and enter the 6-digit code shown for TransAxis.</p>

      {error && (
        <div role="alert" className="mb-4 rounded border border-crit/30 bg-crit-soft px-3 py-2 text-[13px] text-crit-strong">
          {error}
        </div>
      )}

      <label className="mb-1 block text-[13px] font-medium" htmlFor="otp">
        Code
      </label>
      <input
        ref={inputRef}
        id="otp"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        aria-invalid={!!error}
        className={`${inputClass} text-center font-mono text-lg tracking-[0.4em]`}
      />

      <button
        type="submit"
        disabled={busy}
        className="mt-6 h-9 w-full rounded bg-primary text-sm font-medium text-white hover:bg-primary-strong disabled:opacity-60"
      >
        {busy ? 'Checking…' : 'Verify and sign in'}
      </button>
      <button type="button" onClick={cancelMfa} className="mt-3 w-full text-center text-[13px] text-primary hover:underline">
        Use a different account
      </button>
      <p className="mt-4 text-xs text-muted">Lost your phone? Ask an administrator to reset two-step verification for your account.</p>
    </form>
  );
}
