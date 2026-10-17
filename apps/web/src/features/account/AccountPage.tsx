import { useState, type FormEvent } from 'react';
import { Copy, KeyRound, LogOut, ShieldCheck, ShieldOff } from 'lucide-react';
import { passwordSchema, ROLE_LABELS, type SessionResponse, type TotpSetupDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input } from '../../components/ui/Field';
import { Card, PageHeader } from '../../components/ui/Layout';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { apiFieldErrors, type FieldErrors } from '../../lib/forms';

/** Current password, new password twice. Changing it signs every other device out. */
export function ChangePasswordForm({ onChanged, submitLabel = 'Change password' }: { onChanged?: () => void; submitLabel?: string }) {
  const { applySession } = useAuth();
  const toast = useToast();
  const [values, setValues] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next: FieldErrors = {};
    if (!values.currentPassword) next.currentPassword = 'Enter your current password';
    const policy = passwordSchema.safeParse(values.newPassword);
    if (!policy.success) next.newPassword = policy.error.issues[0]!.message;
    else if (values.newPassword === values.currentPassword) next.newPassword = 'Choose a password different from the current one';
    if (values.confirm !== values.newPassword) next.confirm = 'The two new passwords don’t match';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const session = await api<SessionResponse>('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: values.currentPassword, newPassword: values.newPassword },
        noRefresh: true,
      });
      applySession(session);
      setValues({ currentPassword: '', newPassword: '', confirm: '' });
      toast.success('Password changed. Other devices have been signed out.');
      onChanged?.();
    } catch (err) {
      const { fields, message } = apiFieldErrors(err);
      setErrors(Object.keys(fields).length ? fields : { _form: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {errors._form && (
        <p role="alert" className="rounded border border-crit/30 bg-crit-soft px-3 py-2 text-[13px] text-crit-strong">
          {errors._form}
        </p>
      )}
      <Field label="Current password" error={errors.currentPassword} required>
        {(p) => <Input {...p} type="password" autoComplete="current-password" value={values.currentPassword} onChange={set('currentPassword')} />}
      </Field>
      <Field label="New password" error={errors.newPassword} hint="At least 10 characters with upper and lower case letters and a number." required>
        {(p) => <Input {...p} type="password" autoComplete="new-password" value={values.newPassword} onChange={set('newPassword')} />}
      </Field>
      <Field label="Repeat the new password" error={errors.confirm} required>
        {(p) => <Input {...p} type="password" autoComplete="new-password" value={values.confirm} onChange={set('confirm')} />}
      </Field>
      <Button type="submit" variant="primary" loading={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}

/** Shown instead of the app while the person is still on a temporary password; the API refuses everything else. */
export function ForcedPasswordChange() {
  const { user, organization, logout } = useAuth();
  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded bg-primary font-display font-bold text-white">TX</span>
          <div>
            <h1 className="text-xl leading-6">Choose your password</h1>
            <p className="text-[13px] text-muted">{organization?.name}</p>
          </div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-6 shadow-card">
          <p className="mb-4 text-[13px] text-muted">
            Welcome{user ? `, ${user.fullName.split(' ')[0]}` : ''}. You signed in with a temporary password, so choose your own before continuing.
            Enter the temporary password as the current one.
          </p>
          <ChangePasswordForm submitLabel="Save and continue" />
        </div>
        <button onClick={() => void logout()} className="mx-auto mt-4 flex items-center gap-1.5 text-[13px] text-primary hover:underline">
          <LogOut className="size-3.5" aria-hidden /> Sign out
        </button>
      </div>
    </div>
  );
}

function TwoStepCard() {
  const { user, reloadUser } = useAuth();
  const toast = useToast();
  const [setup, setSetup] = useState<TotpSetupDto | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | undefined>();

  async function start() {
    setBusy(true);
    try {
      setSetup(await api<TotpSetupDto>('/auth/totp/setup', { method: 'POST' }));
      setCode('');
      setCodeError(undefined);
    } catch (err) {
      toast.error(apiFieldErrors(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setCodeError('Enter the 6-digit code your app shows now');
      return;
    }
    setBusy(true);
    try {
      await api('/auth/totp/enable', { method: 'POST', body: { code } });
      await reloadUser();
      setSetup(null);
      toast.success('Two-step verification is on. You’ll be asked for a code each time you sign in.');
    } catch (err) {
      setCodeError(apiFieldErrors(err).fields.code ?? apiFieldErrors(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!password) {
      setPasswordError('Enter your password');
      return;
    }
    setBusy(true);
    try {
      await api('/auth/totp/disable', { method: 'POST', body: { password } });
      await reloadUser();
      setDisableOpen(false);
      setPassword('');
      toast.success('Two-step verification is off.');
    } catch (err) {
      const { fields, message } = apiFieldErrors(err);
      setPasswordError(fields.password ?? message);
    } finally {
      setBusy(false);
    }
  }

  const grouped = setup?.secret.match(/.{1,4}/g)?.join(' ');

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-base">
            {user?.totpEnabled ? <ShieldCheck className="size-4 text-ok" aria-hidden /> : <ShieldOff className="size-4 text-muted" aria-hidden />}
            Two-step verification
            {user?.totpEnabled ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>}
          </h2>
          <p className="mt-1 max-w-xl text-[13px] text-muted">
            Ask for a code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy and others) after your password, so a
            stolen password alone isn’t enough to sign in.
          </p>
        </div>
        {user?.totpEnabled ? (
          <Button onClick={() => setDisableOpen(true)}>Turn off</Button>
        ) : (
          !setup && (
            <Button variant="primary" onClick={() => void start()} loading={busy}>
              Set up
            </Button>
          )
        )}
      </div>

      {setup && !user?.totpEnabled && (
        <form onSubmit={confirm} noValidate className="mt-5 grid gap-5 border-t border-line pt-5 sm:grid-cols-[auto_1fr]">
          <img src={setup.qrDataUrl} alt="QR code to add TransAxis to your authenticator app" width={180} height={180} className="rounded border border-line" />
          <div className="min-w-0 space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-[13px]">
              <li>In your authenticator app, add an account and scan this QR code.</li>
              <li>Or type this key instead:</li>
            </ol>
            <div className="flex items-center gap-2">
              <code className="min-w-0 break-all rounded bg-subtle px-2 py-1 font-mono text-[13px]">{grouped}</code>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Copy the key"
                onClick={() => void navigator.clipboard?.writeText(setup.secret).then(() => toast.success('Key copied'), () => undefined)}
              >
                <Copy className="size-4" />
              </Button>
            </div>
            <Field label="Code from the app" error={codeError} hint="Enter the 6-digit code to confirm the app is set up." required>
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-40 text-center font-mono tracking-[0.3em]"
                />
              )}
            </Field>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={busy}>
                Turn on
              </Button>
              <Button onClick={() => setSetup(null)}>Cancel</Button>
            </div>
          </div>
        </form>
      )}

      <Dialog
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        title="Turn off two-step verification?"
        description="Signing in will need only your password again. Confirm with your password."
        footer={
          <>
            <Button onClick={() => setDisableOpen(false)}>Keep it on</Button>
            <Button variant="danger" loading={busy} onClick={() => void disable()}>
              Turn off
            </Button>
          </>
        }
      >
        <Field label="Password" error={passwordError} required>
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void disable();
              }}
            />
          )}
        </Field>
      </Dialog>
    </Card>
  );
}

export function AccountPage() {
  const { user, organization } = useAuth();
  if (!user) return null;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="My account" subtitle={`${user.fullName} · ${organization?.name ?? ''}`} />
      <Card className="p-5">
        <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
          <div>
            <dt className="text-muted">Name</dt>
            <dd className="font-medium">{user.fullName}</dd>
          </div>
          <div>
            <dt className="text-muted">Email (sign-in)</dt>
            <dd className="font-medium break-all">{user.email}</dd>
          </div>
          <div>
            <dt className="text-muted">Roles</dt>
            <dd className="flex flex-wrap gap-1 pt-0.5">
              {user.roles.length ? user.roles.map((r) => <Badge key={r}>{ROLE_LABELS[r]}</Badge>) : <span>Custom role</span>}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Organisation</dt>
            <dd className="font-medium">{organization?.name}</dd>
          </div>
        </dl>
        <details className="mt-4 text-[13px]">
          <summary className="cursor-pointer text-primary">What I can do ({user.permissions.length} permissions)</summary>
          <ul className="mt-2 flex flex-wrap gap-1">
            {user.permissions.map((p) => (
              <li key={p}>
                <code className="rounded bg-subtle px-1.5 py-0.5 text-[12px]">{p}</code>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-muted">Your administrator manages roles. Changes apply the next time you sign in or within 15 minutes.</p>
        </details>
      </Card>

      <Card className="p-5">
        <h2 className="mb-1 flex items-center gap-2 text-base">
          <KeyRound className="size-4 text-muted" aria-hidden /> Password
        </h2>
        <p className="mb-4 text-[13px] text-muted">Changing your password signs you out on every other device.</p>
        <div className="max-w-sm">
          <ChangePasswordForm />
        </div>
      </Card>

      <TwoStepCard />
    </div>
  );
}
