import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import type { AuditLogDto, SystemHealthDto, TenantDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { ReasonDialog } from '../../components/ReasonDialog';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, Pagination, Skeleton } from '../../components/ui/Layout';
import { Table, Th, THead } from '../../components/ui/Table';
import { useToast } from '../../components/ui/Toast';
import { fmtDateTime, fmtRelative } from '../../lib/format';
import { apiFieldErrors } from '../../lib/forms';
import { useListParams } from '../../lib/useListParams';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { send, useAdminMutation, useAuditLog, useSystemHealth, useTenants } from './api';

// ------------------------------------------------------------------ audit log

const ACTION_GROUPS: { value: string; label: string }[] = [
  { value: 'auth.', label: 'Sign-ins and passwords' },
  { value: 'user.', label: 'People' },
  { value: 'role.', label: 'Roles' },
  { value: 'settings.', label: 'Settings' },
  { value: 'config.', label: 'Configuration' },
  { value: 'tenant.', label: 'Company status' },
  { value: 'booking.', label: 'Bookings' },
  { value: 'trip.', label: 'Trips' },
  { value: 'invoice.', label: 'Invoices' },
  { value: 'receipt.', label: 'Payments received' },
  { value: 'expense.', label: 'Expenses' },
  { value: 'fuel.', label: 'Fuel' },
  { value: 'settlement.', label: 'Settlements' },
  { value: 'work_order.', label: 'Work orders' },
  { value: 'vehicle', label: 'Vehicles and their documents' },
  { value: 'worker.', label: 'Workers' },
  { value: 'customer.', label: 'Customers' },
  { value: 'incident.', label: 'Incidents' },
  { value: 'document.', label: 'Library documents' },
];

/** Before/after values side by side, only for keys that differ. */
function Changes({ before, after }: { before: unknown; after: unknown }) {
  const b = before && typeof before === 'object' ? (before as Record<string, unknown>) : {};
  const a = after && typeof after === 'object' ? (after as Record<string, unknown>) : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
  if (!keys.length) return <p className="text-muted">No field changes recorded.</p>;
  const show = (v: unknown) => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
  return (
    <table className="w-full text-[12px]">
      <thead className="text-left text-muted">
        <tr>
          <th className="py-1 pr-3 font-medium">Field</th>
          <th className="py-1 pr-3 font-medium">Before</th>
          <th className="py-1 font-medium">After</th>
        </tr>
      </thead>
      <tbody className="font-mono">
        {keys.map((k) => (
          <tr key={k} className="align-top">
            <td className="py-0.5 pr-3 font-sans font-medium">{k}</td>
            <td className="max-w-xs break-all py-0.5 pr-3 text-crit-strong">{show(b[k])}</td>
            <td className="max-w-xs break-all py-0.5 text-ok-strong">{show(a[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AuditTab() {
  const tz = useOrgTimezone();
  const { values, page, update } = useListParams(['tab', 'q', 'action', 'from', 'to'] as const);
  const [search, setSearch] = useState(values.q ?? '');
  const [open, setOpen] = useState<number | null>(null);
  const log = useAuditLog({ q: values.q, action: values.action, from: values.from, to: values.to, page, pageSize: 50 });
  const rows: AuditLogDto[] = log.data?.data ?? [];

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
            aria-label="Search the audit log"
            placeholder="Search summary or action…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => (search.trim() || undefined) !== values.q && update({ q: search.trim() || undefined })}
          />
        </div>
        <Select aria-label="Kind of event" className="w-auto" value={values.action ?? ''} onChange={(e) => update({ action: e.target.value || undefined })}>
          <option value="">All events</option>
          {ACTION_GROUPS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-[13px] text-muted">
          From
          <Input type="date" className="w-auto" value={values.from ?? ''} onChange={(e) => update({ from: e.target.value || undefined })} />
        </label>
        <label className="flex items-center gap-1.5 text-[13px] text-muted">
          To
          <Input type="date" className="w-auto" value={values.to ?? ''} onChange={(e) => update({ to: e.target.value || undefined })} />
        </label>
      </form>
      <p className="border-b border-line bg-canvas px-4 py-2 text-xs text-muted">
        The audit log is append-only: entries can’t be edited or deleted, by anyone, through the app or the database.
      </p>

      {log.isError ? (
        <ErrorState message={apiFieldErrors(log.error).message} onRetry={() => void log.refetch()} />
      ) : log.isPending ? (
        <Skeleton className="m-4 h-64" />
      ) : rows.length === 0 ? (
        <EmptyState title="No events match" body="Widen the dates or clear the filters." />
      ) : (
        <>
          <Table minWidth={860}>
            <THead>
              <Th className="w-8" />
              <Th>When</Th>
              <Th>Who</Th>
              <Th>Event</Th>
              <Th>Details</Th>
            </THead>
            <tbody>
              {rows.map((a) => (
                <Fragment key={a.id}>
                  <tr className="border-b border-line align-top hover:bg-canvas">
                    <td className="px-2 py-2">
                      <button
                        onClick={() => setOpen(open === a.id ? null : a.id)}
                        aria-expanded={open === a.id}
                        aria-label={open === a.id ? 'Hide details' : 'Show details'}
                        className="rounded p-1 text-muted hover:bg-subtle hover:text-ink"
                      >
                        {open === a.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums" title={a.createdAt}>
                      {fmtDateTime(a.createdAt, tz)}
                    </td>
                    <td className="px-4 py-2">{a.user ? a.user.fullName : <span className="text-muted">System or signed-out</span>}</td>
                    <td className="px-4 py-2">
                      <code className="text-[12px]">{a.action}</code>
                    </td>
                    <td className="px-4 py-2 text-muted">
                      {a.summary ?? '—'}
                      {a.entityType && (
                        <span className="ml-1.5 text-xs">
                          ({a.entityType} {a.entityId})
                        </span>
                      )}
                    </td>
                  </tr>
                  {open === a.id && (
                    <tr className="border-b border-line bg-canvas">
                      <td />
                      <td colSpan={4} className="space-y-3 px-4 py-3">
                        <Changes before={a.before} after={a.after} />
                        <dl className="grid gap-x-6 gap-y-1 text-xs text-muted sm:grid-cols-3">
                          <div>
                            <dt className="inline">IP address: </dt>
                            <dd className="inline font-mono">{a.ip ?? '—'}</dd>
                          </div>
                          <div>
                            <dt className="inline">Request: </dt>
                            <dd className="inline font-mono">{a.requestId ?? '—'}</dd>
                          </div>
                          <div className="sm:col-span-3">
                            <dt className="inline">Browser: </dt>
                            <dd className="inline break-all">{a.userAgent ?? '—'}</dd>
                          </div>
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </Table>
          {log.data && (
            <Pagination
              page={log.data.meta.page}
              totalPages={log.data.meta.totalPages}
              total={log.data.meta.total}
              pageSize={log.data.meta.pageSize}
              onPage={(p) => update({ page: String(p) })}
            />
          )}
        </>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ system health

function Check({ ok, label }: { ok: boolean; label?: string }) {
  return ok ? <Badge tone="ok">{label ?? 'Working'}</Badge> : <Badge tone="crit">{label ?? 'Problem'}</Badge>;
}

function uptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

function HealthCard({ title, status, children }: { title: string; status: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {status}
      </div>
      <dl className="space-y-1 text-[13px]">{children}</dl>
    </Card>
  );
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex justify-between gap-3">
    <dt className="text-muted">{k}</dt>
    <dd className="text-right tabular-nums">{v}</dd>
  </div>
);

export function HealthTab() {
  const tz = useOrgTimezone();
  const health = useSystemHealth();
  if (health.isError) return <ErrorState message={apiFieldErrors(health.error).message} onRetry={() => void health.refetch()} />;
  if (health.isPending) return <Skeleton className="h-64" />;
  const h: SystemHealthDto = health.data;
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">
        Checked {fmtRelative(h.checkedAt)}; refreshes every 30 seconds.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <HealthCard title="API" status={<Check ok />}>
          <Row k="Version" v={h.api.version} />
          <Row k="Node.js" v={h.api.node} />
          <Row k="Running for" v={uptime(h.api.uptimeSeconds)} />
          <Row k="Environment" v={h.api.environment} />
        </HealthCard>
        <HealthCard title="Database" status={<Check ok={h.database.ok} />}>
          <Row k="Response time" v={h.database.latencyMs !== null ? `${h.database.latencyMs} ms` : '—'} />
          <Row k="Migrations applied" v={h.database.migrations} />
        </HealthCard>
        <HealthCard title="Document search" status={<Check ok={h.documentService.ok} label={h.documentService.ok ? 'Working' : 'Unavailable'} />}>
          <Row k="Answers" v={h.documentService.mode === 'claude' ? 'Claude' : h.documentService.mode === 'mock' ? 'Offline (mock)' : '—'} />
          <Row k="Embeddings" v={h.documentService.embedding ?? '—'} />
          <Row k="Waiting to process" v={h.documentService.queued} />
          <Row k="Failed" v={h.documentService.failed ? <span className="text-crit-strong">{h.documentService.failed}</span> : 0} />
        </HealthCard>
        <HealthCard title="File storage" status={<Check ok={h.storage.uploadsWritable} label={h.storage.uploadsWritable ? 'Writable' : 'Read-only'} />}>
          <Row k="Uploads folder" v={h.storage.uploadsWritable ? 'Accepting files' : 'Uploads will fail'} />
        </HealthCard>
      </div>
      <Card>
        <h3 className="border-b border-line px-4 py-2.5 text-[13px] font-semibold">Background jobs</h3>
        {h.jobs.length === 0 ? (
          <EmptyState title="No jobs have run yet" body="Jobs start with the API when JOBS_ENABLED is on." />
        ) : (
          <Table minWidth={600}>
            <THead>
              <Th>Job</Th>
              <Th>Running on</Th>
              <Th>Lease until</Th>
              <Th>Status</Th>
            </THead>
            <tbody>
              {h.jobs.map((j) => (
                <tr key={j.name} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 font-mono text-[12px]">{j.name}</td>
                  <td className="px-4 py-2.5 text-muted">{j.lockedBy}</td>
                  <td className="px-4 py-2.5 tabular-nums">{fmtDateTime(j.lockedUntil, tz)}</td>
                  <td className="px-4 py-2.5">{j.healthy ? <Badge tone="ok">Running</Badge> : <Badge tone="warn" title="Its lease lapsed more than 5 minutes ago">Stopped</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ tenants

export function TenantsTab() {
  const { organization } = useAuth();
  const toast = useToast();
  const tenants = useTenants();
  const [target, setTarget] = useState<TenantDto | null>(null);
  const change = useAdminMutation(({ id, status, reason }: { id: number; status: 'active' | 'suspended'; reason: string }) =>
    send<TenantDto>(`/admin/tenants/${id}/status`, 'POST', { status, reason }),
  );

  if (tenants.isError) return <ErrorState message={apiFieldErrors(tenants.error).message} onRetry={() => void tenants.refetch()} />;
  if (tenants.isPending) return <Skeleton className="h-48" />;
  const suspending = target?.status === 'active';

  return (
    <Card>
      <div className="border-b border-line p-4">
        <h2 className="text-base">Companies on the platform</h2>
        <p className="text-[13px] text-muted">Suspending a company signs its people out at once and stops new sign-ins. Its data is kept.</p>
      </div>
      <Table minWidth={640}>
        <THead>
          <Th>Company</Th>
          <Th>Code</Th>
          <Th className="text-right">People</Th>
          <Th className="text-right">Vehicles</Th>
          <Th>Status</Th>
          <Th className="w-32" />
        </THead>
        <tbody>
          {tenants.data.map((t) => (
            <tr key={t.id} className="border-b border-line last:border-0">
              <td className="px-4 py-2.5 font-medium">{t.name}</td>
              <td className="px-4 py-2.5 font-mono text-[12px]">{t.code}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{t.users}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{t.vehicles}</td>
              <td className="px-4 py-2.5">{t.status === 'active' ? <Badge tone="ok">Active</Badge> : <Badge tone="crit">Suspended</Badge>}</td>
              <td className="px-4 py-2.5 text-right">
                {t.id === organization?.id ? (
                  <span className="text-xs text-muted">Your company</span>
                ) : (
                  <Button size="sm" variant={t.status === 'active' ? 'secondary' : 'primary'} onClick={() => setTarget(t)}>
                    {t.status === 'active' ? 'Suspend' : 'Reactivate'}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <ReasonDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title={target ? `${suspending ? 'Suspend' : 'Reactivate'} ${target.name}?` : ''}
        description={suspending ? 'Everyone in this company is signed out now and can’t sign in until it’s reactivated.' : 'People in this company can sign in again.'}
        confirmLabel={suspending ? 'Suspend company' : 'Reactivate'}
        danger={suspending}
        minLength={5}
        onConfirm={async (reason) => {
          await change.mutateAsync({ id: target!.id, status: suspending ? 'suspended' : 'active', reason });
          toast.success(`${target!.name} ${suspending ? 'suspended' : 'reactivated'}`);
        }}
      />
    </Card>
  );
}
