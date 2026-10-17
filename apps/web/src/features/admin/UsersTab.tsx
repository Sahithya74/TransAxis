import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Copy, KeyRound, LockOpen, Plus, Search, ShieldOff, UserCog } from 'lucide-react';
import type { AdminUserDto, RoleDto, TemporaryPasswordDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Drawer } from '../../components/ui/Drawer';
import { Field, Input, Select } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, Pagination, Skeleton } from '../../components/ui/Layout';
import { SortTh, Table, Th, THead, nextSort } from '../../components/ui/Table';
import { useToast } from '../../components/ui/Toast';
import { fmtRelative } from '../../lib/format';
import { apiFieldErrors, type FieldErrors } from '../../lib/forms';
import { useListParams } from '../../lib/useListParams';
import { send, useAdminMutation, useAdminUsers, useLinkOptions, useRoles } from './api';

/** Shows a temporary password once, with a copy button. It is never retrievable again. */
function TemporaryPasswordDialog({ result, onClose }: { result: TemporaryPasswordDto | null; onClose: () => void }) {
  const toast = useToast();
  return (
    <Dialog
      open={!!result}
      onClose={onClose}
      title="Temporary password"
      description={result ? `For ${result.user.fullName} (${result.user.email})` : undefined}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {result && (
        <div className="space-y-3 text-[13px]">
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-subtle px-3 py-2 font-mono text-base tracking-wide">{result.temporaryPassword}</code>
            <Button
              aria-label="Copy the temporary password"
              onClick={() => void navigator.clipboard?.writeText(result.temporaryPassword).then(() => toast.success('Copied'), () => undefined)}
            >
              <Copy className="size-4" /> Copy
            </Button>
          </div>
          <p>Give it to the person directly (in person or by phone). They’ll be asked to choose their own password when they first sign in.</p>
          <p className="text-muted">It is shown only now and isn’t stored anywhere readable. If it’s lost, reset the password again.</p>
        </div>
      )}
    </Dialog>
  );
}

interface FormValues {
  email: string;
  fullName: string;
  phone: string;
  roleIds: number[];
  workerId: string;
  customerId: string;
  status: 'active' | 'disabled';
}

const empty: FormValues = { email: '', fullName: '', phone: '', roleIds: [], workerId: '', customerId: '', status: 'active' };

/** Add or edit a person: details, roles and the worker or customer their login belongs to. */
function UserDrawer({
  open,
  user,
  roles,
  onClose,
  onCreated,
}: {
  open: boolean;
  user: AdminUserDto | null;
  roles: RoleDto[];
  onClose: () => void;
  onCreated: (r: TemporaryPasswordDto) => void;
}) {
  const { user: me } = useAuth();
  const toast = useToast();
  const links = useLinkOptions(open);
  const [values, setValues] = useState<FormValues>(empty);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirm, setConfirm] = useState<null | 'reset' | 'two-step' | 'disable'>(null);
  const wasOpen = useRef(false);
  const save = useAdminMutation<object, AdminUserDto | TemporaryPasswordDto>((body) =>
    user ? send<AdminUserDto>(`/admin/users/${user.id}`, 'PATCH', body) : send<TemporaryPasswordDto>('/admin/users', 'POST', body),
  );
  const action = useAdminMutation((path: string) => send<AdminUserDto | TemporaryPasswordDto>(path, 'POST', {}));

  // Reset the form only when the drawer opens, so background refetches don't wipe what's typed.
  useEffect(() => {
    if (open && !wasOpen.current) {
      setErrors({});
      setValues(
        user
          ? {
              email: user.email,
              fullName: user.fullName,
              phone: user.phone ?? '',
              roleIds: user.roles.map((r) => r.id),
              workerId: user.worker ? String(user.worker.id) : '',
              customerId: user.customer ? String(user.customer.id) : '',
              status: user.status,
            }
          : empty,
      );
    }
    wasOpen.current = open;
  }, [open, user]);

  const self = !!user && user.id === me?.id;
  const chosenKeys = new Set(roles.filter((r) => values.roleIds.includes(r.id)).map((r) => r.key));
  const set = (k: keyof FormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));
  const toggleRole = (id: number) =>
    setValues((v) => ({ ...v, roleIds: v.roleIds.includes(id) ? v.roleIds.filter((r) => r !== id) : [...v.roleIds, id] }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next: FieldErrors = {};
    if (!user && !/^\S+@\S+\.\S+$/.test(values.email.trim())) next.email = 'Enter a valid email address';
    if (values.fullName.trim().length < 2) next.fullName = 'Enter the full name';
    if (!values.roleIds.length) next.roleIds = 'Give the person at least one role';
    setErrors(next);
    if (Object.keys(next).length) return;
    const body = {
      ...(user ? {} : { email: values.email.trim() }),
      fullName: values.fullName.trim(),
      phone: values.phone.trim() || null,
      roleIds: values.roleIds,
      workerId: values.workerId ? Number(values.workerId) : null,
      customerId: values.customerId ? Number(values.customerId) : null,
      ...(user && !self ? { status: values.status } : {}),
    };
    try {
      const res = await save.mutateAsync(body);
      if (user) {
        toast.success(`Saved ${values.fullName.trim()}`);
        onClose();
      } else {
        onCreated(res as TemporaryPasswordDto);
      }
    } catch (err) {
      const { fields, message } = apiFieldErrors(err);
      setErrors(Object.keys(fields).length ? fields : { _form: message });
    }
  }

  const workers = links.data?.workers.filter((w) => w.linkedUserId === null || w.linkedUserId === user?.id) ?? [];
  const customers = links.data?.customers ?? [];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={user ? user.fullName : 'Add a person'}
      description={user ? user.email : 'They get a temporary password to sign in with and choose their own.'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="user-form" loading={save.isPending}>
            {user ? 'Save changes' : 'Create login'}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {errors._form && (
          <p role="alert" className="rounded border border-crit/30 bg-crit-soft px-3 py-2 text-[13px] text-crit-strong">
            {errors._form}
          </p>
        )}
        {!user && (
          <Field label="Email (used to sign in)" error={errors.email} required>
            {(p) => <Input {...p} type="email" autoComplete="off" value={values.email} onChange={set('email')} />}
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" error={errors.fullName} required>
            {(p) => <Input {...p} value={values.fullName} onChange={set('fullName')} />}
          </Field>
          <Field label="Phone" error={errors.phone}>
            {(p) => <Input {...p} type="tel" value={values.phone} onChange={set('phone')} placeholder="+91 98400 12345" />}
          </Field>
        </div>

        <fieldset>
          <legend className="mb-1 text-[13px] font-medium">
            Roles<span className="ml-0.5 text-crit" aria-hidden>*</span>
          </legend>
          {self && <p className="mb-2 text-xs text-muted">You can’t change your own roles. Ask another administrator.</p>}
          <div className="grid gap-1.5 sm:grid-cols-2">
            {roles.map((r) => (
              <label key={r.id} className="flex items-start gap-2 rounded border border-line px-2.5 py-2 text-[13px] has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                <input type="checkbox" className="mt-0.5" checked={values.roleIds.includes(r.id)} disabled={self} onChange={() => toggleRole(r.id)} />
                <span>
                  <span className="font-medium">{r.name}</span>
                  <span className="block text-xs text-muted">
                    {r.permissions.length} permissions{r.isSystem ? '' : ' · custom'}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {errors.roleIds && <p className="mt-1 text-xs text-crit-strong">{errors.roleIds}</p>}
        </fieldset>

        {(chosenKeys.has('driver') || values.workerId) && (
          <Field label="Worker record" error={errors.workerId} hint="Drivers see only their own trips and pay." required={chosenKeys.has('driver')}>
            {(p) => (
              <Select {...p} value={values.workerId} onChange={set('workerId')}>
                <option value="">Not linked</option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.fullName} ({w.employeeCode}, {w.workerType})
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {(chosenKeys.has('customer') || values.customerId) && (
          <Field label="Customer" error={errors.customerId} hint="Portal users see only this customer’s bookings and invoices." required={chosenKeys.has('customer')}>
            {(p) => (
              <Select {...p} value={values.customerId} onChange={set('customerId')}>
                <option value="">Not linked</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        {user && !self && (
          <Field label="Status">
            {(p) => (
              <Select {...p} value={values.status} onChange={set('status')}>
                <option value="active">Active: can sign in</option>
                <option value="disabled">Disabled: signed out and can’t sign in</option>
              </Select>
            )}
          </Field>
        )}
      </form>

      {user && !self && (
        <div className="mt-6 border-t border-line pt-4">
          <h3 className="mb-2 text-[13px] font-semibold">Account help</h3>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setConfirm('reset')}>
              <KeyRound className="size-4" /> Reset password
            </Button>
            {user.lockedUntil && (
              <Button
                size="sm"
                loading={action.isPending}
                onClick={() =>
                  void action.mutateAsync(`/admin/users/${user.id}/unlock`).then(
                    () => toast.success(`${user.fullName} can sign in again`),
                    (err) => toast.error(apiFieldErrors(err).message),
                  )
                }
              >
                <LockOpen className="size-4" /> Unlock
              </Button>
            )}
            {user.totpEnabled && (
              <Button size="sm" onClick={() => setConfirm('two-step')}>
                <ShieldOff className="size-4" /> Reset two-step verification
              </Button>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirm === 'reset'}
        onClose={() => setConfirm(null)}
        title={`Reset ${user?.fullName ?? ''}’s password?`}
        description="They’ll be signed out everywhere and get a temporary password, shown to you once, to choose a new one with."
        confirmLabel="Reset password"
        onConfirm={async () => {
          const res = (await action.mutateAsync(`/admin/users/${user!.id}/reset-password`)) as TemporaryPasswordDto;
          onCreated(res);
        }}
      />
      <ConfirmDialog
        open={confirm === 'two-step'}
        onClose={() => setConfirm(null)}
        title="Reset two-step verification?"
        description="Use this when the person has lost their phone. They’ll sign in with just their password and can set up a new authenticator app."
        confirmLabel="Reset"
        danger
        onConfirm={async () => {
          await action.mutateAsync(`/admin/users/${user!.id}/reset-two-step`);
          toast.success('Two-step verification reset');
        }}
      />
    </Drawer>
  );
}

export function UsersTab() {
  const { can, user: me } = useAuth();
  const manage = can('users:manage');
  const { values, page, sort, update } = useListParams(['tab', 'q', 'status', 'roleId'] as const);
  const [search, setSearch] = useState(values.q ?? '');
  const users = useAdminUsers({ q: values.q, status: values.status, roleId: values.roleId, sort, page, pageSize: 25 });
  const roles = useRoles();
  const [editing, setEditing] = useState<AdminUserDto | null>(null);
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<TemporaryPasswordDto | null>(null);

  const rows = users.data?.data ?? [];

  return (
    <Card>
      <form
        role="search"
        className="flex flex-wrap items-center gap-2 border-b border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: search.trim() || undefined });
        }}
      >
        <div className="relative min-w-52 flex-1 basis-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" aria-hidden />
          <Input
            aria-label="Search name or email"
            placeholder="Search name or email…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => (search.trim() || undefined) !== values.q && update({ q: search.trim() || undefined })}
          />
        </div>
        <Select aria-label="Status" value={values.status ?? ''} onChange={(e) => update({ status: e.target.value || undefined })} className="w-auto">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </Select>
        <Select aria-label="Role" value={values.roleId ?? ''} onChange={(e) => update({ roleId: e.target.value || undefined })} className="w-auto">
          <option value="">Any role</option>
          {roles.data?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
        {manage && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add person
          </Button>
        )}
      </form>

      {users.isError ? (
        <ErrorState message={apiFieldErrors(users.error).message} onRetry={() => void users.refetch()} />
      ) : users.isPending ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No one matches" body="Try a different search or filter." />
      ) : (
        <>
          <Table minWidth={820}>
            <THead>
              <SortTh field="fullName" label="Person" sort={sort} onSort={(f) => update({ sort: nextSort(sort, f) })} />
              <Th>Roles</Th>
              <Th>Linked to</Th>
              <Th>Status</Th>
              <SortTh field="lastLoginAt" label="Last sign-in" sort={sort} onSort={(f) => update({ sort: nextSort(sort, f) })} />
              <Th className="w-16" />
            </THead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-b border-line last:border-0 hover:bg-canvas">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">
                      {u.fullName}
                      {u.id === me?.id && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}
                    </div>
                    <div className="text-xs text-muted">{u.email}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => (
                        <Badge key={r.id}>{r.name}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{u.worker?.fullName ?? u.customer?.name ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {u.status === 'active' ? <Badge tone="ok">Active</Badge> : <Badge tone="crit">Disabled</Badge>}
                      {u.lockedUntil && <Badge tone="warn">Locked</Badge>}
                      {u.mustChangePassword && <Badge tone="info" title="Still on a temporary password">New password due</Badge>}
                      {u.totpEnabled && <Badge tone="ok" title="Two-step verification is on">2-step</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{u.lastLoginAt ? fmtRelative(u.lastLoginAt) : 'Never'}</td>
                  <td className="px-4 py-2.5 text-right">
                    {manage && (
                      <Button size="sm" variant="ghost" aria-label={`Edit ${u.fullName}`} onClick={() => setEditing(u)}>
                        <UserCog className="size-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {users.data && (
            <Pagination
              page={users.data.meta.page}
              totalPages={users.data.meta.totalPages}
              total={users.data.meta.total}
              pageSize={users.data.meta.pageSize}
              onPage={(p) => update({ page: String(p) })}
            />
          )}
        </>
      )}

      <UserDrawer
        open={adding || !!editing}
        user={editing}
        roles={roles.data ?? []}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        onCreated={(r) => {
          setAdding(false);
          setEditing(null);
          setIssued(r);
        }}
      />
      <TemporaryPasswordDialog result={issued} onClose={() => setIssued(null)} />
    </Card>
  );
}
