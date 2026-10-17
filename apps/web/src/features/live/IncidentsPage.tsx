import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ChevronLeft, Plus, Siren } from 'lucide-react';
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES, INCIDENT_TYPES, type IncidentDto, type IncidentStatus } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Select, Textarea } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '../../components/ui/Layout';
import { SortTh, Table, THead, Th, nextSort } from '../../components/ui/Table';
import { Timeline } from '../../components/ui/Timeline';
import { useToast } from '../../components/ui/Toast';
import { ApiError } from '../../lib/api';
import { apiFieldErrors } from '../../lib/forms';
import { fmtDateTime, fmtRelative, titleCase } from '../../lib/format';
import { useListParams } from '../../lib/useListParams';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { useColleagues, useIncident, useIncidents, useSafetyMutations } from './api';
import { IncidentDialog } from './AlertActions';
import { INCIDENT_TYPE_LABEL, IncidentStatusBadge, SeverityBadge } from './badges';

export function IncidentsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const lp = useListParams(['status', 'severity', 'incidentType'] as const);
  const status = lp.values.status ?? 'active';
  const [reporting, setReporting] = useState(false);
  const list = useIncidents({ page: lp.page, pageSize: 25, sort: lp.sort, status: status === 'all' ? undefined : status, severity: lp.values.severity, incidentType: lp.values.incidentType });
  const sortBy = (f: string) => lp.update({ sort: nextSort(lp.sort, f) });

  return (
    <div>
      <PageHeader
        title="Incidents"
        subtitle="Accidents, breakdowns, cargo problems and SOS calls, from report to resolution"
        actions={can('incidents:manage') && <Button variant="primary" onClick={() => setReporting(true)}><Plus className="size-4" aria-hidden /> Report incident</Button>}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Select aria-label="Status" className="w-auto" value={status} onChange={(e) => lp.update({ status: e.target.value === 'active' ? undefined : e.target.value })}>
            <option value="active">Active</option>
            {INCIDENT_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            <option value="all">All</option>
          </Select>
          <Select aria-label="Severity" className="w-auto" value={lp.values.severity ?? ''} onChange={(e) => lp.update({ severity: e.target.value || undefined })}>
            <option value="">Any severity</option>
            {INCIDENT_SEVERITIES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </Select>
          <Select aria-label="Type" className="w-auto" value={lp.values.incidentType ?? ''} onChange={(e) => lp.update({ incidentType: e.target.value || undefined })}>
            <option value="">Any type</option>
            {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{INCIDENT_TYPE_LABEL[t]}</option>)}
          </Select>
          {lp.active && <Button variant="ghost" size="sm" onClick={lp.clear}>Clear filters</Button>}
        </div>
        {list.isError ? (
          <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
        ) : (
          <Table minWidth={960}>
            <THead>
              <SortTh field="incidentNo" label="Incident" sort={lp.sort} onSort={sortBy} />
              <Th>Type</Th>
              <SortTh field="severity" label="Severity" sort={lp.sort} onSort={sortBy} />
              <Th>Trip / vehicle</Th>
              <Th>Assigned to</Th>
              <SortTh field="reportedAt" label="Reported" sort={lp.sort} onSort={sortBy} />
              <Th>Status</Th>
            </THead>
            <tbody>
              {list.isPending && Array.from({ length: 6 }, (_, i) => <tr key={i}><td colSpan={7} className="h-11 px-4"><Skeleton className="h-4 w-full" /></td></tr>)}
              {list.data?.data.map((i) => (
                <tr key={i.id} className="cursor-pointer border-b border-subtle hover:bg-canvas" onClick={() => navigate(`/incidents/${i.id}`)}>
                  <td className="h-11 px-4">
                    <Link to={`/incidents/${i.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 font-mono text-primary hover:underline">
                      {i.incidentType === 'sos' && <Siren className="size-3.5 text-crit" aria-hidden />}
                      {i.incidentNo}
                    </Link>
                    <div className="max-w-72 truncate text-xs text-muted">{i.title}</div>
                  </td>
                  <td className="px-4">{INCIDENT_TYPE_LABEL[i.incidentType]}</td>
                  <td className="px-4"><SeverityBadge severity={i.severity} /></td>
                  <td className="px-4">
                    {i.trip ? <span className="font-mono text-xs">{i.trip.tripNo}</span> : '—'}
                    {i.vehicle && <div className="font-mono text-xs text-muted">{i.vehicle.registrationNo}</div>}
                  </td>
                  <td className="px-4">{i.assignedTo?.fullName ?? <span className="text-muted">Unassigned</span>}</td>
                  <td className="px-4 tabular-nums">{fmtRelative(i.reportedAt)}</td>
                  <td className="px-4"><IncidentStatusBadge status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.data?.data.length === 0 && <EmptyState title="No incidents match" />}
        {list.data && list.data.meta.total > 0 && (
          <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={list.data.meta.pageSize} onPage={(p) => lp.update({ page: String(p) })} />
        )}
      </Card>
      {reporting && <IncidentDialog open onClose={() => setReporting(false)} />}
    </div>
  );
}

const NEXT_LABEL: Record<IncidentStatus, string> = {
  open: 'Reopen',
  investigating: 'Start investigating',
  escalated: 'Escalate to management',
  resolved: 'Mark resolved',
  closed: 'Close',
};

export function IncidentDetailPage() {
  const id = Number(useParams().id);
  const tz = useOrgTimezone();
  const { can } = useAuth();
  const q = useIncident(id);
  const [moveTo, setMoveTo] = useState<IncidentStatus | null>(null);
  const [noting, setNoting] = useState(false);

  if (q.isError) {
    const nf = q.error instanceof ApiError && q.error.status === 404;
    return <Card>{nf ? <EmptyState title="Incident not found" /> : <ErrorState message={(q.error as Error).message} />}</Card>;
  }
  const i = q.data;
  return (
    <div>
      <Link to="/incidents" className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden /> Incidents
      </Link>
      <PageHeader
        title={i ? <span className="flex items-center gap-2">{i.incidentType === 'sos' && <Siren className="size-6 text-crit" aria-hidden />}<span className="font-mono">{i.incidentNo}</span></span> : <Skeleton className="h-7 w-56" />}
        subtitle={i && (
          <span className="flex flex-wrap items-center gap-2">
            <IncidentStatusBadge status={i.status} />
            <SeverityBadge severity={i.severity} />
            <span>{INCIDENT_TYPE_LABEL[i.incidentType]}</span>
            <span>· reported {fmtDateTime(i.reportedAt, tz)}{i.reportedBy ? ` by ${i.reportedBy}` : ''}</span>
          </span>
        )}
        actions={i && can('incidents:manage') && (
          <>
            {i.allowedStatuses.map((s) => (
              <Button key={s} variant={s === 'resolved' ? 'primary' : s === 'escalated' ? 'danger' : 'secondary'} onClick={() => setMoveTo(s)}>{NEXT_LABEL[s]}</Button>
            ))}
            {i.status !== 'closed' && <Button onClick={() => setNoting(true)}>Add update</Button>}
          </>
        )}
      />
      {i?.incidentType === 'sos' && i.status !== 'closed' && (
        <Banner tone="crit" title="SOS">Call the driver first. TransAxis has not contacted emergency services; dial 112 if anyone is in danger.</Banner>
      )}
      {!i ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card className="p-5">
              <h2 className="mb-2 text-base">{i.title}</h2>
              <p className="whitespace-pre-line text-[13px]">{i.description ?? <span className="text-muted">No description.</span>}</p>
              {i.resolution && (
                <div className="mt-4 rounded border border-ok/40 bg-ok-soft p-3 text-[13px] text-ok-strong">
                  <span className="font-semibold">Resolution:</span> {i.resolution}
                </div>
              )}
            </Card>
            <Card className="p-5">
              <h2 className="mb-3 text-base">Updates</h2>
              <Timeline
                items={i.updates.map((u) => ({
                  id: u.id,
                  tone: u.kind === 'escalation' ? 'crit' : u.toStatus === 'resolved' ? 'ok' : u.kind === 'created' ? 'info' : 'default',
                  title: u.kind === 'status_change' || u.kind === 'escalation' ? `${titleCase(u.fromStatus ?? '')} → ${titleCase(u.toStatus ?? '')}` : u.kind === 'created' ? 'Reported' : u.kind === 'assignment' ? 'Assignment' : 'Update',
                  meta: `${fmtDateTime(u.at, tz)}${u.by ? ` · ${u.by}` : ''}`,
                  body: u.body,
                }))}
              />
            </Card>
          </div>
          <div className="space-y-5">
            <Card className="p-5">
              <h2 className="mb-3 text-base">Details</h2>
              <dl className="space-y-3 text-[13px]">
                <Item label="Assigned to">
                  <AssignSelect incident={i} />
                </Item>
                <Item label="Trip">{i.trip ? <Link to={`/trips/${i.trip.id}`} className="font-mono text-primary hover:underline">{i.trip.tripNo}</Link> : '—'}</Item>
                <Item label="Vehicle">{i.vehicle ? <Link to={`/tracking?vehicle=${i.vehicle.id}`} className="font-mono text-primary hover:underline">{i.vehicle.registrationNo}</Link> : '—'}</Item>
                <Item label="Driver">{i.driver ? <>{i.driver.fullName} · <a className="text-primary" href={`tel:${i.driver.phone.replace(/\s/g, '')}`}>{i.driver.phone}</a></> : '—'}</Item>
                <Item label="Location">
                  {i.locationText ?? '—'}
                  {i.lat != null && i.lng != null && (
                    <a className="block text-xs text-primary hover:underline" href={`https://www.openstreetmap.org/?mlat=${i.lat}&mlon=${i.lng}#map=13/${i.lat}/${i.lng}`} target="_blank" rel="noreferrer">
                      {i.lat.toFixed(4)}, {i.lng.toFixed(4)} on the map
                    </a>
                  )}
                </Item>
                <Item label="Resolved">{fmtDateTime(i.resolvedAt, tz)}</Item>
              </dl>
            </Card>
          </div>
        </div>
      )}
      {i && moveTo && <StatusDialog incident={i} to={moveTo} onClose={() => setMoveTo(null)} />}
      {i && noting && <StatusDialog incident={i} to={null} onClose={() => setNoting(false)} />}
    </div>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

function AssignSelect({ incident }: { incident: IncidentDto }) {
  const { can } = useAuth();
  const manage = can('incidents:manage');
  const people = useColleagues('incidents:manage', manage);
  const { changeIncident } = useSafetyMutations();
  const toast = useToast();
  if (!manage || incident.status === 'closed') return <>{incident.assignedTo?.fullName ?? 'Unassigned'}</>;
  return (
    <Select
      aria-label="Assign to"
      value={incident.assignedTo?.id ?? ''}
      disabled={changeIncident.isPending}
      onChange={async (e) => {
        try {
          await changeIncident.mutateAsync({ id: incident.id, body: { assignedToUserId: e.target.value ? Number(e.target.value) : null, version: incident.version } });
          toast.success('Assignment updated');
        } catch (err) {
          toast.error(apiFieldErrors(err).message);
        }
      }}
    >
      <option value="">Unassigned</option>
      {people.data?.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
    </Select>
  );
}

function StatusDialog({ incident, to, onClose }: { incident: IncidentDto; to: IncidentStatus | null; onClose: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { changeIncident } = useSafetyMutations();
  const toast = useToast();
  useEffect(() => setError(null), [text]);
  const isResolve = to === 'resolved';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if ((isResolve || !to) && body.length < 5) return setError(isResolve ? 'Describe how it was resolved' : 'Write the update');
    try {
      await changeIncident.mutateAsync({
        id: incident.id,
        body: { ...(to ? { status: to } : {}), ...(isResolve ? { resolution: body } : body ? { note: body } : {}), version: incident.version },
      });
      toast.success(to ? `${incident.incidentNo}: ${titleCase(to)}` : 'Update added');
      onClose();
    } catch (err) {
      setError(apiFieldErrors(err).message);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={to ? `${NEXT_LABEL[to]}: ${incident.incidentNo}` : `Add an update: ${incident.incidentNo}`}
      description={to === 'escalated' ? 'Management is notified immediately.' : undefined}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant={to === 'escalated' ? 'danger' : 'primary'} type="submit" form="incident-status-form" loading={changeIncident.isPending}>{to ? NEXT_LABEL[to] : 'Add update'}</Button></>}
    >
      <form id="incident-status-form" onSubmit={submit} noValidate>
        <Field label={isResolve ? 'Resolution' : to ? 'Note (optional)' : 'Update'} required={isResolve || !to} error={error ?? undefined}>
          {(p) => <Textarea {...p} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} autoFocus />}
        </Field>
      </form>
    </Dialog>
  );
}
