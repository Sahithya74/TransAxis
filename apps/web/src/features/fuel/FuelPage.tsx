import { useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, Plus } from 'lucide-react';
import type { FuelLogDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { PeriodPicker, usePeriod } from '../../components/PeriodPicker';
import { ReasonDialog } from '../../components/ReasonDialog';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '../../components/ui/Layout';
import { SortTh, Table, THead, Th, nextSort } from '../../components/ui/Table';
import { Tabs } from '../../components/ui/Tabs';
import { useToast } from '../../components/ui/Toast';
import { fmtDateTime, fmtMoney, fmtNumber } from '../../lib/format';
import { useListParams } from '../../lib/useListParams';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { post, useFinanceMutation, useFuelLogs, useFuelSummary } from '../finance/api';
import { PAYMENT_MODE_LABEL } from '../finance/labels';
import { useVehicles } from '../vehicles/api';
import { FuelDialog } from './FuelDialog';

export function FuelPage() {
  const { can } = useAuth();
  const lp = useListParams(['tab', 'vehicleId', 'anomaly'] as const);
  const [adding, setAdding] = useState(false);
  const tab = lp.values.tab === 'vehicles' ? 'vehicles' : 'log';
  return (
    <div>
      <PageHeader
        title="Fuel"
        subtitle="Every fill with mileage measured full tank to full tank, and fills that look wrong flagged for review"
        actions={can('fuel:write', 'finance:post') && <Button variant="primary" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Record fill</Button>}
      />
      <Tabs className="mb-4" active={tab} onChange={(t) => lp.update({ tab: t === 'log' ? undefined : t })} tabs={[{ id: 'log', label: 'Fill log' }, { id: 'vehicles', label: 'By vehicle' }]} />
      {tab === 'vehicles' ? <ByVehicle /> : <FillLog lp={lp} />}
      <FuelDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function FillLog({ lp }: { lp: ReturnType<typeof useListParams<'tab' | 'vehicleId' | 'anomaly'>> }) {
  const { can } = useAuth();
  const tz = useOrgTimezone();
  const toast = useToast();
  const [reviewing, setReviewing] = useState<FuelLogDto | null>(null);
  const vehicles = useVehicles({ page: 1, pageSize: 100, sort: 'registrationNo' });
  const list = useFuelLogs({ page: lp.page, pageSize: 25, sort: lp.sort, vehicleId: lp.values.vehicleId, anomaly: lp.values.anomaly });
  const review = useFinanceMutation(({ id, note }: { id: number; note: string }) => post<FuelLogDto>(`/finance/fuel/${id}/review`, { note }));
  const sortBy = (f: string) => lp.update({ sort: nextSort(lp.sort, f) });

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
        <Select aria-label="Vehicle" className="w-auto" value={lp.values.vehicleId ?? ''} onChange={(e) => lp.update({ vehicleId: e.target.value || undefined })}>
          <option value="">All vehicles</option>
          {vehicles.data?.data.map((v) => <option key={v.id} value={v.id}>{v.registrationNo}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" className="size-4 accent-primary" checked={lp.values.anomaly === 'true'} onChange={(e) => lp.update({ anomaly: e.target.checked ? 'true' : undefined })} />
          Flagged fills only
        </label>
      </div>
      {list.isError ? (
        <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
      ) : (
        <Table minWidth={1050}>
          <THead>
            <SortTh field="filledAt" label="Filled" sort={lp.sort} onSort={sortBy} />
            <Th>Vehicle</Th>
            <Th className="text-right">Odometer</Th>
            <Th className="text-right">Litres</Th>
            <Th className="text-right">Amount</Th>
            <SortTh field="kmpl" label="Km/L" sort={lp.sort} onSort={sortBy} align="right" />
            <Th>Paid by</Th>
            <Th>Check</Th>
          </THead>
          <tbody aria-busy={list.isFetching}>
            {list.isPending &&
              Array.from({ length: 8 }, (_, i) => (
                <tr key={i} className="border-b border-subtle">
                  {Array.from({ length: 8 }, (__, j) => <td key={j} className="h-11 px-4"><Skeleton className="h-3.5 w-16" /></td>)}
                </tr>
              ))}
            {list.data?.data.map((f) => (
              <tr key={f.id} className={`border-b border-subtle align-top ${f.anomaly && !f.reviewNote ? 'bg-warn-soft/40' : ''}`}>
                <td className="px-4 py-3 tabular-nums">
                  {fmtDateTime(f.filledAt, tz)}
                  {f.stationName && <div className="text-xs text-muted">{f.stationName}</div>}
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono text-xs">{f.vehicle.registrationNo}</span>
                  {f.trip && <div><Link to={`/trips/${f.trip.id}`} className="font-mono text-xs text-primary hover:underline">{f.trip.tripNo}</Link></div>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtNumber(f.odometerKm)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {fmtNumber(f.litres)}
                  {!f.fullTank && <div className="text-xs text-muted">part fill</div>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {fmtMoney(f.amount, true)}
                  <div className="text-xs text-muted">₹{f.pricePerLitre}/L</div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{f.kmpl ?? '—'}</td>
                <td className="px-4 py-3">
                  {PAYMENT_MODE_LABEL[f.paymentMode]}
                  {f.worker && <div className="text-xs text-muted">{f.worker.fullName}</div>}
                </td>
                <td className="px-4 py-3">
                  {f.anomaly ? (
                    <div className="max-w-64 space-y-1">
                      <Badge tone={f.reviewNote ? 'neutral' : 'warn'}>{f.reviewNote ? 'Reviewed' : 'Flagged'}</Badge>
                      {f.anomalyReasons.map((r) => <div key={r} className="flex gap-1 text-xs text-warn-strong"><AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />{r}</div>)}
                      {f.reviewNote && <div className="text-xs text-muted">“{f.reviewNote}”{f.reviewedBy ? `, ${f.reviewedBy}` : ''}</div>}
                      {!f.reviewNote && can('fuel:write') && <Button size="sm" variant="ghost" onClick={() => setReviewing(f)}>Mark reviewed</Button>}
                    </div>
                  ) : (
                    <span className="text-xs text-muted">OK</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {list.data && list.data.data.length === 0 && <EmptyState title={lp.values.anomaly ? 'No flagged fills' : 'No fills recorded'} />}
      {list.data && list.data.meta.total > 0 && (
        <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={list.data.meta.pageSize} onPage={(p) => lp.update({ page: String(p) })} />
      )}
      <p className="border-t border-line px-4 py-3 text-xs text-muted">
        A fill is flagged when mileage drops well below the vehicle’s usual, more litres go in than the tank holds, or the odometer goes backwards.
      </p>
      <ReasonDialog
        open={!!reviewing}
        onClose={() => setReviewing(null)}
        title="Mark this fill as reviewed"
        description={reviewing ? `${reviewing.vehicle.registrationNo}, ${reviewing.litres} L on ${fmtDateTime(reviewing.filledAt, tz)}. Say what you found, e.g. a slip checked or a ghat section.` : undefined}
        confirmLabel="Mark reviewed"
        onConfirm={async (note) => {
          await review.mutateAsync({ id: reviewing!.id, note });
          toast.success('Fill marked as reviewed');
        }}
      />
    </Card>
  );
}

function ByVehicle() {
  const period = usePeriod('last_90');
  const q = useFuelSummary(period.from, period.to);
  return (
    <Card>
      <div className="border-b border-line p-3"><PeriodPicker period={period} /></div>
      {q.isError ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <Table minWidth={860}>
          <THead>
            <Th>Vehicle</Th>
            <Th className="text-right">Fills</Th>
            <Th className="text-right">Litres</Th>
            <Th className="text-right">Spend</Th>
            <Th className="text-right">Km/L</Th>
            <Th className="text-right">Expected km/L</Th>
            <Th className="text-right">Flagged</Th>
          </THead>
          <tbody aria-busy={q.isFetching}>
            {q.isPending && <tr><td colSpan={7} className="p-4"><Skeleton className="h-40 w-full" /></td></tr>}
            {q.data?.map((r) => {
              const poor = r.kmpl !== null && r.declaredKmpl !== null && r.kmpl < r.declaredKmpl * 0.85;
              return (
                <tr key={r.vehicle.id} className="border-b border-subtle">
                  <td className="h-11 px-4">
                    <Link to={`/fuel?vehicleId=${r.vehicle.id}`} className="font-mono text-xs text-primary hover:underline">{r.vehicle.registrationNo}</Link>
                    <div className="text-xs text-muted">{r.vehicle.vehicleType}</div>
                  </td>
                  <td className="px-4 text-right tabular-nums">{r.fills}</td>
                  <td className="px-4 text-right tabular-nums">{fmtNumber(Math.round(r.litres))}</td>
                  <td className="px-4 text-right tabular-nums">{fmtMoney(r.amount)}</td>
                  <td className={`px-4 text-right tabular-nums ${poor ? 'font-semibold text-crit-strong' : ''}`}>{r.kmpl ?? '—'}</td>
                  <td className="px-4 text-right tabular-nums text-muted">{r.declaredKmpl ?? '—'}</td>
                  <td className="px-4 text-right tabular-nums">{r.anomalies ? <Badge tone="warn">{r.anomalies}</Badge> : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {q.data && q.data.length === 0 && <EmptyState title="No fills in this period" />}
      <p className="border-t border-line px-4 py-3 text-xs text-muted">Km/L is the average of the full-tank-to-full-tank readings in the period; it is red when more than 15% below the expected km/L on the vehicle’s record.</p>
    </Card>
  );
}
