import { useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { isAdminPermission, type Permission, type RoleDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select } from '../../components/ui/Field';
import { Card, ErrorState, Skeleton } from '../../components/ui/Layout';
import { useToast } from '../../components/ui/Toast';
import { apiFieldErrors } from '../../lib/forms';
import { send, useAdminMutation, usePermissionCatalogue, useRoles, type PermissionInfo } from './api';

/** Permission resources grouped the way people think about the business. */
const GROUPS: { title: string; resources: string[] }[] = [
  { title: 'Administration', resources: ['orgs', 'settings', 'users', 'audit', 'system'] },
  { title: 'Fleet', resources: ['vehicles', 'vehicle_documents'] },
  { title: 'People', resources: ['workers', 'attendance'] },
  { title: 'Customers and vendors', resources: ['customers', 'vendors'] },
  { title: 'Bookings and trips', resources: ['bookings', 'trips'] },
  { title: 'Tracking and safety', resources: ['tracking', 'alerts', 'incidents'] },
  { title: 'Maintenance and fuel', resources: ['maintenance', 'fuel'] },
  { title: 'Finance', resources: ['finance', 'settlements', 'expenses'] },
  { title: 'Reports, documents and AI', resources: ['reports', 'notifications', 'documents', 'ai'] },
  { title: 'Customer portal', resources: ['portal'] },
];

function NewRoleDialog({ open, roles, onClose, onCreated }: { open: boolean; roles: RoleDto[]; onClose: () => void; onCreated: (id: number) => void }) {
  const { can } = useAuth();
  const [name, setName] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const [error, setError] = useState<string | undefined>();
  const create = useAdminMutation((body: { name: string; permissions: Permission[] }) => send<RoleDto>('/admin/roles', 'POST', body));
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setName('');
      setCopyFrom('');
      setError(undefined);
    }
    wasOpen.current = open;
  }, [open]);

  async function submit() {
    if (name.trim().length < 3) {
      setError('Name the role (at least 3 characters)');
      return;
    }
    // Copying keeps only what this person may grant; anything else would be refused.
    const source = roles.find((r) => String(r.id) === copyFrom);
    const permissions = (source?.permissions ?? []).filter((p) => !isAdminPermission(p) || can(p));
    try {
      const role = await create.mutateAsync({ name: name.trim(), permissions });
      onCreated(role.id);
    } catch (err) {
      const { fields, message } = apiFieldErrors(err);
      setError(fields.name ?? message);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New role"
      description="Create a role for a job that the built-in roles don’t fit, then choose its permissions."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} onClick={() => void submit()}>
            Create role
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Role name" error={error} required>
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Yard supervisor" />}
        </Field>
        <Field label="Start from" hint="Copies that role’s permissions; you can change them next.">
          {(p) => (
            <Select {...p} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
              <option value="">No permissions</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function RoleEditor({ role, catalogue }: { role: RoleDto; catalogue: PermissionInfo[] }) {
  const { can } = useAuth();
  const toast = useToast();
  const [chosen, setChosen] = useState<Set<Permission>>(new Set(role.permissions));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useAdminMutation((permissions: Permission[]) => send<RoleDto>(`/admin/roles/${role.id}/permissions`, 'PUT', { permissions }));
  const remove = useAdminMutation(() => send<void>(`/admin/roles/${role.id}`, 'DELETE'));

  const outranked = role.permissions.filter((p) => isAdminPermission(p) && !can(p));
  const readOnly = role.key === 'super_admin' || outranked.length > 0 || !can('users:manage');
  const dirty = chosen.size !== role.permissions.length || role.permissions.some((p) => !chosen.has(p));
  const toggle = (p: Permission) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const byGroup = GROUPS.map((g) => ({ ...g, items: catalogue.filter((c) => g.resources.includes(c.group)) })).filter((g) => g.items.length);

  return (
    <Card>
      <div className="flex flex-wrap items-start gap-3 border-b border-line p-4">
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-base">
            {role.name}
            {role.isSystem ? <Badge>Built-in</Badge> : <Badge tone="info">Custom</Badge>}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {role.userCount} {role.userCount === 1 ? 'person has' : 'people have'} this role · {chosen.size} permissions
          </p>
        </div>
        {!role.isSystem && !readOnly && (
          <Button variant="ghost" onClick={() => setConfirmDelete(true)} aria-label={`Delete ${role.name}`}>
            <Trash2 className="size-4" /> Delete
          </Button>
        )}
        {!readOnly && (
          <Button
            variant="primary"
            disabled={!dirty}
            loading={save.isPending}
            onClick={() =>
              void save.mutateAsync([...chosen]).then(
                () => toast.success(`Saved ${role.name}. People with it get the change within 15 minutes.`),
                (err) => toast.error(apiFieldErrors(err).message),
              )
            }
          >
            Save permissions
          </Button>
        )}
      </div>
      {readOnly && (
        <p className="border-b border-line bg-canvas px-4 py-2 text-[13px] text-muted">
          {role.key === 'super_admin'
            ? 'The platform administrator role always has every permission.'
            : outranked.length
              ? `This role has administration access you don’t have (${outranked.join(', ')}), so only someone with at least that access can change it.`
              : 'You can view roles but not change them.'}
        </p>
      )}
      <div className="grid gap-x-6 gap-y-5 p-4 lg:grid-cols-2">
        {byGroup.map((g) => (
          <fieldset key={g.title} disabled={readOnly}>
            <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{g.title}</legend>
            <ul className="space-y-1">
              {g.items.map((item) => {
                const locked = isAdminPermission(item.key) && !can(item.key);
                return (
                  <li key={item.key}>
                    <label className={`flex items-start gap-2 text-[13px] ${locked ? 'text-muted' : ''}`}>
                      <input type="checkbox" className="mt-0.5" checked={chosen.has(item.key)} disabled={locked} onChange={() => toggle(item.key)} />
                      <span>
                        {item.description}
                        <code className="ml-1.5 text-[11px] text-muted">{item.key}</code>
                        {locked && <Lock className="ml-1 inline size-3" aria-label="Only someone who has this permission can grant it" />}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ))}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete the ${role.name} role?`}
        description={role.userCount ? `${role.userCount} people still have it; move them to another role first.` : 'Nobody has this role. This can’t be undone.'}
        confirmLabel="Delete role"
        danger
        onConfirm={async () => {
          await remove.mutateAsync(undefined);
          toast.success(`Deleted ${role.name}`);
        }}
      />
    </Card>
  );
}

export function RolesTab() {
  const { can } = useAuth();
  const roles = useRoles();
  const catalogue = usePermissionCatalogue();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useMemo(() => roles.data ?? [], [roles.data]);
  const selected = list.find((r) => r.id === selectedId) ?? list[0];

  if (roles.isError) return <ErrorState message={apiFieldErrors(roles.error).message} onRetry={() => void roles.refetch()} />;
  if (roles.isPending || catalogue.isPending) return <Skeleton className="h-96" />;

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <Card className="self-start">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="text-[13px] font-semibold">Roles</h2>
          {can('users:manage') && (
            <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New
            </Button>
          )}
        </div>
        <ul className="p-1.5" aria-label="Roles">
          {list.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => setSelectedId(r.id)}
                aria-current={selected?.id === r.id ? 'true' : undefined}
                className={`flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[13px] ${
                  selected?.id === r.id ? 'bg-primary-soft font-medium text-primary-strong' : 'hover:bg-subtle'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className="tabular-nums text-xs text-muted" title="People with this role">
                  {r.userCount}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {/* Keyed by the saved permissions too, so a save or another role starts a fresh working copy. */}
      {selected && catalogue.data && <RoleEditor key={`${selected.id}:${selected.permissions.join(',')}`} role={selected} catalogue={catalogue.data} />}
      <NewRoleDialog
        open={creating}
        roles={list}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          setSelectedId(id);
        }}
      />
    </div>
  );
}
