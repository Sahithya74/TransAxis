import { Link } from 'react-router';
import { ALERT_SEVERITIES, ALERT_TYPES } from '@transaxis/shared';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '../../components/ui/Layout';
import { SortTh, Table, THead, Th, nextSort } from '../../components/ui/Table';
import { fmtDateTime, fmtRelative, titleCase } from '../../lib/format';
import { useListParams } from '../../lib/useListParams';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { useAlerts } from './api';
import { AlertActions } from './AlertActions';
import { ALERT_TYPE_LABEL, AlertStatusBadge, SeverityBadge } from './badges';

export function AlertsPage() {
  const tz = useOrgTimezone();
  const lp = useListParams(['status', 'severity', 'alertType'] as const);
  const status = lp.values.status ?? 'active';
  const list = useAlerts({ page: lp.page, pageSize: 25, sort: lp.sort, status: status === 'all' ? undefined : status, severity: lp.values.severity, alertType: lp.values.alertType });
  const sortBy = (f: string) => lp.update({ sort: nextSort(lp.sort, f) });

  return (
    <div>
      <PageHeader title="Safety alerts" subtitle="Raised automatically from GPS, check-ins and SOS. Warnings clear themselves when the condition ends; critical alerts wait for a person." />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Select aria-label="Status" className="w-auto" value={status} onChange={(e) => lp.update({ status: e.target.value === 'active' ? undefined : e.target.value })}>
            <option value="active">Open or acknowledged</option>
            <option value="open">Open</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </Select>
          <Select aria-label="Severity" className="w-auto" value={lp.values.severity ?? ''} onChange={(e) => lp.update({ severity: e.target.value || undefined })}>
            <option value="">Any severity</option>
            {ALERT_SEVERITIES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </Select>
          <Select aria-label="Type" className="w-auto" value={lp.values.alertType ?? ''} onChange={(e) => lp.update({ alertType: e.target.value || undefined })}>
            <option value="">Any type</option>
            {ALERT_TYPES.map((t) => <option key={t} value={t}>{ALERT_TYPE_LABEL[t]}</option>)}
          </Select>
          {lp.active && <Button variant="ghost" size="sm" onClick={lp.clear}>Clear filters</Button>}
        </div>
        {list.isError ? (
          <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
        ) : (
          <Table minWidth={1040}>
            <THead>
              <SortTh field="severity" label="Severity" sort={lp.sort} onSort={sortBy} />
              <Th>Alert</Th>
              <Th>Trip / vehicle</Th>
              <SortTh field="raisedAt" label="Raised" sort={lp.sort} onSort={sortBy} />
              <Th>Status</Th>
              <Th><span className="sr-only">Actions</span></Th>
            </THead>
            <tbody>
              {list.isPending && Array.from({ length: 6 }, (_, i) => <tr key={i}><td colSpan={6} className="h-12 px-4"><Skeleton className="h-4 w-full" /></td></tr>)}
              {list.data?.data.map((a) => (
                <tr key={a.id} className="border-b border-subtle align-top">
                  <td className="px-4 py-2.5"><SeverityBadge severity={a.severity} /></td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{ALERT_TYPE_LABEL[a.alertType]} {a.isSimulated && <Badge tone="neutral">simulated</Badge>}</div>
                    <div className="text-muted">{a.detail}</div>
                    {a.resolutionNote && <div className="text-xs text-ok-strong">{a.autoResolved ? 'Auto-resolved' : `Resolved by ${a.resolvedBy}`}: {a.resolutionNote}</div>}
                  </td>
                  <td className="px-4 py-2.5">
                    {a.trip && <Link to={`/trips/${a.trip.id}`} className="font-mono text-primary hover:underline">{a.trip.tripNo}</Link>}
                    {a.vehicle && <div className="font-mono text-xs text-muted">{a.vehicle.registrationNo}</div>}
                    {a.driver && <div className="text-xs text-muted">{a.driver.fullName}</div>}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums" title={fmtDateTime(a.raisedAt, tz)}>
                    {fmtRelative(a.raisedAt)}
                    {a.occurrences > 1 && <div className="text-xs text-muted">last seen {fmtRelative(a.lastSeenAt)}</div>}
                  </td>
                  <td className="px-4 py-2.5"><AlertStatusBadge status={a.status} /></td>
                  <td className="px-4 py-2.5 text-right"><AlertActions alert={a} compact /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.data?.data.length === 0 && <EmptyState title="No alerts match" />}
        {list.data && list.data.meta.total > 0 && (
          <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={list.data.meta.pageSize} onPage={(p) => lp.update({ page: String(p) })} />
        )}
      </Card>
    </div>
  );
}
