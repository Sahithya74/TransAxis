import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { loginRequestSchema } from '@transaxis/shared';
import { useAuth } from '../auth/AuthProvider';
import { ApiError } from '../lib/api';

export function LoginPage() {
  const { status, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  if (status === 'authenticated') return <Navigate to="/" replace />;

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
      const message =
        err instanceof ApiError
          ? err.status === 429
            ? 'Too many attempts. Please wait a few minutes and try again.'
            : err.message
          : 'Could not reach the server. Check your connection and try again.';
      setErrors({ form: message });
    } finally {
      setBusy(false);
    }
  }

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

        <form
          onSubmit={onSubmit}
          noValidate
          className="rounded-lg border border-line bg-surface p-6 shadow-card"
        >
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
            className="h-9 w-full rounded border border-line-strong bg-surface px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
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
            className="h-9 w-full rounded border border-line-strong bg-surface px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
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

        <p className="mt-4 text-center text-xs text-muted">
          Demo accounts are listed in the project README. Demo data only.
        </p>
      </div>
    </div>
  );
}
