import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { FlaskConical, Plus } from 'lucide-react';
import { TYRE_STATUSES, WORK_ORDER_TYPES, type PartDto, type ScheduleDto, type TyreDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '../../components/ui/Layout';
import { StatCard } from '../../components/ui/Stat';
import { Table, THead, Th } from '../../components/ui/Table';
import { Tabs } from '../../components/ui/Tabs';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from '../../lib/format';
import { useListParams } from '../../lib/useListParams';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { useVehicles } from '../vehicles/api';
import { useInsights, useParts, useSchedules, useTyres, useWorkOrders } from './api';
import { PartDialog, PurchaseDialog, ScheduleDialog, TyreActionDialog, TyreDialog, WorkOrderDialog } from './MaintenanceDialogs';
import { PriorityBadge, ServiceDueBadge, TYRE_POSITION_LABEL, TYRE_STATUS_LABEL, WO_STATUS_LABEL, WO_TYPE_LABEL, WorkOrderStatusBadge } from './labels';

const TABS = [
  { id: 'work-orders', label: 'Work orders' },
  { id: 'schedule', label: 'Service schedule' },
  { id: 'parts', label: 'Parts' },
  { id: 'tyres', label: 'Tyres' },
  { id: 'insights', label: 'Insights' },
];

export function MaintenancePage() {
  const { can } = useAuth();
  const lp = useListParams(['tab', 'status', 'vehicleId', 'woType', 'due'] as const);
  const tab = lp.values.tab ?? 'work-orders';
  const write = can('maintenance:write');
  const [dialog, setDialog] = useState<{ kind: 'wo'; schedule?: ScheduleDto } | { kind: 'schedule'; schedule?: ScheduleDto } | { kind: 'part' } | { kind: 'tyre' } | null>(null);
  const due = useSchedules({ due: 'due' });
  const active = useWorkOrders({ status: 'active', pageSize: 1 });
  const parts = useParts();
  const low = parts.data?.filter((p) => p.lowStock).length;

  return (
    <div>
      <PageHeader
        title="Maintenance"
        subtitle="Workshop jobs, scheduled services, spare parts and tyres"
        actions={
          write && (
            <>
              {tab === 'schedule' && <Button onClick={() => setDialog({ kind: 'schedule' })}><Plus className="size-4" aria-hidden /> Add schedule</Button>}
              {tab === 'parts' && <Button onClick={() => setDialog({ kind: 'part' })}><Plus className="size-4" aria-hidden /> Add part</Button>}
              {tab === 'tyres' && <Button onClick={() => setDialog({ kind: 'tyre' })}><Plus className="size-4" aria-hidden /> Add tyre</Button>}
              <Button variant="primary" onClick={() => setDialog({ kind: 'wo' })}><Plus className="size-4" aria-hidden /> New work order</Button>
            </>
          )
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Jobs open or in the workshop" loading={!active.data} value={fmtNumber(active.data?.meta.total)} to="/maintenance" />
        <StatCard
          label="Services overdue"
          loading={!due.data}
          value={fmtNumber(due.data?.filter((s) => s.due.status === 'overdue').length)}
          tone={due.data?.some((s) => s.due.status === 'overdue') ? 'crit' : undefined}
          to="/maintenance?tab=schedule"
        />
        <StatCard label="Services due soon" loading={!due.data} value={fmtNumber(due.data?.filter((s) => s.due.status === 'due_soon').length)} to="/maintenance?tab=schedule" />
        <StatCard label="Parts at or below reorder level" loading={!parts.data} value={fmtNumber(low)} tone={low ? 'warn' : undefined} to="/maintenance?tab=parts" />
      </div>
      <Tabs className="mb-4" active={tab} onChange={(t) => lp.update({ tab: t === 'work-orders' ? undefined : t, status: undefined, due: undefined })} tabs={TABS} />
      {tab === 'schedule' ? (
        <Schedules showAll={lp.values.due === 'all'} onShowAll={(all) => lp.update({ due: all ? 'all' : undefined })} write={write} onEdit={(s) => setDialog({ kind: 'schedule', schedule: s })} onOpenWo={(s) => setDialog({ kind: 'wo', schedule: s })} />
      ) : tab === 'parts' ? (
        <Parts write={write} />
      ) : tab === 'tyres' ? (
        <Tyres write={write} />
      ) : tab === 'insights' ? (
        <Insights />
      ) : (
        <WorkOrders lp={lp} />
      )}
      <WorkOrderDialog open={dialog?.kind === 'wo'} onClose={() => setDialog(null)} preset={dialog?.kind === 'wo' ? { schedule: dialog.schedule } : undefined} />
      <ScheduleDialog open={dialog?.kind === 'schedule'} onClose={() => setDialog(null)} schedule={dialog?.kind === 'schedule' ? dialog.schedule : undefined} />
      <PartDialog open={dialog?.kind === 'part'} onClose={() => setDialog(null)} />
      <TyreDialog open={dialog?.kind === 'tyre'} onClose={() => setDialog(null)} />
    </div>
  );
}

function WorkOrders({ lp }: { lp: ReturnType<typeof useListParams<'tab' | 'status' | 'vehicleId' | 'woType' | 'due'>> }) {
  const tz = useOrgTimezone();
  const navigate = useNavigate();
  const status = lp.values.status ?? 'active';
  const vehicles = useVehicles({ page: 1, pageSize: 100, sort: 'registrationNo' });
  const list = useWorkOrders({ page: lp.page, pageSize: 25, status: status === 'all' ? undefined : status, vehicleId: lp.values.vehicleId, woType: lp.values.woType });
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <Select aria-label="Status" className="w-auto" value={status} onChange={(e) => lp.update({ status: e.target.value === 'active' ? undefined : e.target.value })}>
          <option value="active">Open and in the workshop</option>
          {(['open', 'in_progress', 'completed', 'cancelled'] as const).map((s) => <option key={s} value={s}>{WO_STATUS_LABEL[s]}</option>)}
          <option value="all">All</option>
        </Select>
        <Select aria-label="Type" className="w-auto" value={lp.values.woType ?? ''} onChange={(e) => lp.update({ woType: e.target.value || undefined })}>
          <option value="">Any type</option>
          {WORK_ORDER_TYPES.map((t) => <option key={t} value={t}>{WO_TYPE_LABEL[t]}</option>)}
        </Select>
        <Select aria-label="Vehicle" className="w-auto" value={lp.values.vehicleId ?? ''} onChange={(e) => lp.update({ vehicleId: e.target.value || undefined })}>
          <option value="">All vehicles</option>
          {vehicles.data?.data.map((v) => <option key={v.id} value={v.id}>{v.registrationNo}</option>)}
        </Select>
      </div>
      {list.isError ? (
        <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
      ) : (
        <Table minWidth={960}>
          <THead>
            <Th>Work order</Th>
            <Th>Vehicle</Th>
            <Th>Job</Th>
            <Th>Opened</Th>
            <Th>Status</Th>
            <Th className="text-right">Cost</Th>
          </THead>
          <tbody aria-busy={list.isFetching}>
            {list.isPending &&
              Array.from({ length: 6 }, (_, i) => (
                <tr key={i} className="border-b border-subtle">
                  {Array.from({ length: 6 }, (__, j) => <td key={j} className="h-11 px-4"><Skeleton className="h-3.5 w-20" /></td>)}
                </tr>
              ))}
            {list.data?.data.map((w) => (
              <tr key={w.id} className="cursor-pointer border-b border-subtle hover:bg-canvas" onClick={() => navigate(`/maintenance/work-orders/${w.id}`)}>
                <td className="h-12 px-4">
                  <Link to={`/maintenance/work-orders/${w.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-primary hover:underline">{w.woNo}</Link>
                </td>
                <td className="px-4 font-mono text-xs">{w.vehicle.registrationNo}</td>
                <td className="px-4">
                  <div>{w.title}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">{WO_TYPE_LABEL[w.woType]} {w.priority !== 'normal' && <PriorityBadge priority={w.priority} />}</div>
                </td>
                <td className="px-4 tabular-nums">{fmtDateTime(w.openedAt, tz)}</td>
                <td className="px-4"><WorkOrderStatusBadge status={w.status} /></td>
                <td className="px-4 text-right tabular-nums">{Number(w.total) ? fmtMoney(w.total, true) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {list.data && list.data.data.length === 0 && <EmptyState title={status === 'active' ? 'Nothing in the workshop' : 'No work orders match'} />}
      {list.data && list.data.meta.total > 0 && (
        <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={list.data.meta.pageSize} onPage={(p) => lp.update({ page: String(p) })} />
      )}
    </Card>
  );
}

function Schedules({ showAll, onShowAll, write, onEdit, onOpenWo }: { showAll: boolean; onShowAll: (all: boolean) => void; write: boolean; onEdit: (s: ScheduleDto) => void; onOpenWo: (s: ScheduleDto) => void }) {
  const q = useSchedules({ due: showAll ? 'all' : 'due' });
  const rank = { overdue: 0, due_soon: 1, ok: 2 } as const;
  const rows = [...(q.data ?? [])].sort((a, b) => rank[a.due.status] - rank[b.due.status] || a.vehicle.registrationNo.localeCompare(b.vehicle.registrationNo));
  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-line p-3 text-[13px]">
        <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-primary" checked={showAll} onChange={(e) => onShowAll(e.target.checked)} /> Show services that are not due yet</label>
      </div>
      {q.isError ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <Table minWidth={900}>
          <THead>
            <Th>Vehicle</Th>
            <Th>Service</Th>
            <Th>Interval</Th>
            <Th>Last done</Th>
            <Th>Due</Th>
            {write && <Th><span className="sr-only">Actions</span></Th>}
          </THead>
          <tbody>
            {q.isPending && <tr><td colSpan={6} className="p-4"><Skeleton className="h-32 w-full" /></td></tr>}
            {rows.map((s) => (
              <tr key={s.id} className="border-b border-subtle align-top">
                <td className="px-4 py-3">
                  <Link to={`/vehicles/${s.vehicle.id}`} className="font-mono text-xs text-primary hover:underline">{s.vehicle.registrationNo}</Link>
                  <div className="text-xs text-muted">{fmtNumber(s.vehicle.odometerKm)} km now</div>
                </td>
                <td className="px-4 py-3">{s.task}</td>
                <td className="px-4 py-3 text-muted">{[s.everyKm ? `${fmtNumber(s.everyKm)} km` : null, s.everyDays ? `${s.everyDays} days` : null].filter(Boolean).join(' or ')}</td>
                <td className="px-4 py-3 tabular-nums">
                  {s.lastDoneOn ? fmtDate(s.lastDoneOn) : '—'}
                  {s.lastDoneKm !== null && <div className="text-xs text-muted">at {fmtNumber(s.lastDoneKm)} km</div>}
                </td>
                <td className="px-4 py-3"><ServiceDueBadge due={s.due} /></td>
                {write && (
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => onEdit(s)}>Edit</Button>
                      {s.openWorkOrder ? (
                        <Link to={`/maintenance/work-orders/${s.openWorkOrder.id}`} className="inline-flex h-8 items-center px-2 font-mono text-xs text-primary hover:underline">{s.openWorkOrder.woNo}</Link>
                      ) : (
                        s.due.status !== 'ok' && <Button size="sm" onClick={() => onOpenWo(s)}>Open job</Button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {q.data && rows.length === 0 && <EmptyState title={showAll ? 'No service schedules' : 'No services due'} body={showAll ? 'Add a schedule for oil changes, filters, greasing and inspections.' : 'Tick the box above to see every schedule.'} />}
    </Card>
  );
}

function Parts({ write }: { write: boolean }) {
  const q = useParts();
  const [buying, setBuying] = useState<PartDto | null>(null);
  return (
    <Card>
      {q.isError ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <Table minWidth={760}>
          <THead>
            <Th>Part</Th>
            <Th className="text-right">In stock</Th>
            <Th className="text-right">Reorder at</Th>
            <Th className="text-right">Average cost</Th>
            <Th className="text-right">Stock value</Th>
            {write && <Th><span className="sr-only">Actions</span></Th>}
          </THead>
          <tbody>
            {q.isPending && <tr><td colSpan={6} className="p-4"><Skeleton className="h-32 w-full" /></td></tr>}
            {q.data?.map((p) => (
              <tr key={p.id} className="border-b border-subtle">
                <td className="h-11 px-4">
                  {p.name}
                  <div className="font-mono text-xs text-muted">{p.partNo}</div>
                </td>
                <td className="px-4 text-right tabular-nums">
                  {fmtNumber(p.stockQty)} {p.unit} {p.lowStock && <Badge tone="warn">Low</Badge>}
                </td>
                <td className="px-4 text-right tabular-nums text-muted">{fmtNumber(p.reorderLevel)}</td>
                <td className="px-4 text-right tabular-nums">{fmtMoney(p.unitCost, true)}</td>
                <td className="px-4 text-right tabular-nums">{fmtMoney(p.stockQty * Number(p.unitCost))}</td>
                {write && <td className="px-4 text-right"><Button size="sm" onClick={() => setBuying(p)}>Buy</Button></td>}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {q.data && q.data.length === 0 && <EmptyState title="No spare parts" body="Add the parts you keep in stock, then record purchases." />}
      <p className="border-t border-line px-4 py-3 text-xs text-muted">Parts added to a work order come out of stock straight away and go back if the job is cancelled.</p>
      <PurchaseDialog part={buying} onClose={() => setBuying(null)} />
    </Card>
  );
}

function Tyres({ write }: { write: boolean }) {
  const [status, setStatus] = useState('');
  const q = useTyres({ status: status || undefined });
  const [acting, setActing] = useState<TyreDto | null>(null);
  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-line p-3">
        <Select aria-label="Status" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          {TYRE_STATUSES.map((s) => <option key={s} value={s}>{TYRE_STATUS_LABEL[s]}</option>)}
        </Select>
      </div>
      {q.isError ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <Table minWidth={900}>
          <THead>
            <Th>Tyre</Th>
            <Th>Status</Th>
            <Th>Fitted to</Th>
            <Th className="text-right">Km run</Th>
            <Th>Wear</Th>
            {write && <Th><span className="sr-only">Actions</span></Th>}
          </THead>
          <tbody>
            {q.isPending && <tr><td colSpan={6} className="p-4"><Skeleton className="h-32 w-full" /></td></tr>}
            {q.data?.map((t) => (
              <tr key={t.id} className="border-b border-subtle">
                <td className="h-12 px-4">
                  <span className="font-mono text-xs">{t.serialNo}</span>
                  <div className="text-xs text-muted">{t.brand} · {t.size}</div>
                </td>
                <td className="px-4"><Badge tone={t.status === 'fitted' ? 'ok' : t.status === 'scrapped' ? 'neutral' : 'info'}>{TYRE_STATUS_LABEL[t.status]}</Badge></td>
                <td className="px-4">
                  {t.vehicle ? (
                    <>
                      <span className="font-mono text-xs">{t.vehicle.registrationNo}</span>
                      <div className="text-xs text-muted">{t.position ? TYRE_POSITION_LABEL[t.position] : ''}{t.fittedOn ? ` · since ${fmtDate(t.fittedOn)}` : ''}</div>
                    </>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="px-4 text-right tabular-nums">{fmtNumber(t.kmRun)}</td>
                <td className="px-4">
                  {t.wearPct !== null ? (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-subtle" aria-hidden>
                        <div className={`h-full ${t.wearPct >= 90 ? 'bg-crit' : t.wearPct >= 70 ? 'bg-warn' : 'bg-ok'}`} style={{ width: `${Math.min(100, t.wearPct)}%` }} />
                      </div>
                      <span className="text-xs tabular-nums">{t.wearPct}%</span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted">No life set</span>
                  )}
                </td>
                {write && (
                  <td className="px-4 text-right">
                    {t.status !== 'scrapped' && <Button size="sm" onClick={() => setActing(t)}>{t.status === 'fitted' ? 'Remove' : 'Fit'}</Button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {q.data && q.data.length === 0 && <EmptyState title="No tyres recorded" />}
      <p className="border-t border-line px-4 py-3 text-xs text-muted">Wear is the distance run against the tyre’s expected life.</p>
      <TyreActionDialog tyre={acting} onClose={() => setActing(null)} />
    </Card>
  );
}

function Insights() {
  const q = useInsights();
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <FlaskConical className="size-4 text-ai" aria-hidden />
        <h2 className="text-base">Maintenance hints</h2>
        <Badge tone="ai">Experimental</Badge>
      </div>
      <p className="border-b border-line px-5 py-3 text-[13px] text-muted">
        Simple rules over your own records, not predictions: repeated breakdowns in 90 days, fuel economy falling over the last fills, and overdue services
        without a job. Treat them as prompts to check, not diagnoses.
      </p>
      {q.isError ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <div className="p-4"><Skeleton className="h-24 w-full" /></div>
      ) : q.data.length === 0 ? (
        <EmptyState title="Nothing stands out" body="Hints appear when a vehicle’s records show one of the patterns above." />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((i, idx) => (
            <li key={idx} className="flex flex-wrap items-start gap-3 px-5 py-3 text-[13px]">
              <Link to={`/vehicles/${i.vehicle.id}`} className="w-28 shrink-0 font-mono text-xs text-primary hover:underline">{i.vehicle.registrationNo}</Link>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{i.signal}</div>
                <div className="text-muted">{i.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
