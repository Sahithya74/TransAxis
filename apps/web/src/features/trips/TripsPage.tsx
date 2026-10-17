import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Search } from 'lucide-react';
import { TRIP_STATUSES, type TripListItemDto } from '@transaxis/shared';
import { TRIP_STATUS_LABEL, TripStatusBadge } from '../../components/StatusBadges';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '../../components/ui/Layout';
import { SortTh, Table, THead, Th, nextSort } from '../../components/ui/Table';
import { Tabs } from '../../components/ui/Tabs';
import { fmtDateTime, fmtNumber, titleCase } from '../../lib/format';
import { useListParams } from '../../lib/useListParams';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { useTrips } from './api';

export function TripsPage() {
  const tz = useOrgTimezone();
  const navigate = useNavigate();
  const lp = useListParams(['tab', 'q', 'status', 'from', 'to'] as const);
  const [search, setSearch] = useState(lp.values.q ?? '');
  const activeOnly = lp.values.tab !== 'all';
  const list = useTrips({
    page: lp.page,
    pageSize: 25,
    sort: lp.sort,
    q: lp.values.q,
    active: activeOnly && !lp.values.status ? 'true' : undefined,
    status: lp.values.status,
    from: lp.values.from,
    to: lp.values.to,
  });
  const sortBy = (f: string) => lp.update({ sort: nextSort(lp.sort, f) });

  return (
    <div>
      <PageHeader title="Trips" subtitle="Every movement of a vehicle, from assignment to settlement" />
      <Tabs
        className="mb-4"
        active={activeOnly ? 'active' : 'all'}
        onChange={(t) => lp.update({ tab: t === 'all' ? 'all' : undefined })}
        tabs={[{ id: 'active', label: 'Active' }, { id: 'all', label: 'All trips' }]}
      />
      <Card>
        <form
          role="search"
          className="flex flex-wrap items-center gap-2 border-b border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            lp.update({ q: search.trim() || undefined });
          }}
        >
          <div className="relative min-w-52 flex-1 basis-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" aria-hidden />
            <Input aria-label="Search trips" placeholder="Trip, vehicle, driver, booking or LR number…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select aria-label="Status" className="w-auto" value={lp.values.status ?? ''} onChange={(e) => lp.update({ status: e.target.value || undefined })}>
            <option value="">{activeOnly ? 'Any active status' : 'Any status'}</option>
            {TRIP_STATUSES.map((s) => <option key={s} value={s}>{TRIP_STATUS_LABEL[s]}</option>)}
          </Select>
          <label className="flex items-center gap-1.5 text-[13px] text-muted">
            Starting from
            <Input type="date" aria-label="Starting from" className="w-auto" value={lp.values.from ?? ''} onChange={(e) => lp.update({ from: e.target.value || undefined })} />
          </label>
          <label className="flex items-center gap-1.5 text-[13px] text-muted">
            to
            <Input type="date" aria-label="Starting to" className="w-auto" value={lp.values.to ?? ''} onChange={(e) => lp.update({ to: e.target.value || undefined })} />
          </label>
          {lp.active && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); lp.update({ q: undefined, status: undefined, from: undefined, to: undefined }); }}>
              Clear filters
            </Button>
          )}
        </form>

        {list.isError ? (
          <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
        ) : (
          <Table minWidth={1000}>
            <THead>
              <SortTh field="tripNo" label="Trip" sort={lp.sort} onSort={sortBy} />
              <Th>Booking</Th>
              <Th>Route</Th>
              <Th>Vehicle</Th>
              <Th>Driver</Th>
              <SortTh field="plannedStart" label="Planned start" sort={lp.sort} onSort={sortBy} />
              <SortTh field="status" label="Status" sort={lp.sort} onSort={sortBy} />
            </THead>
            <tbody aria-busy={list.isFetching}>
              {list.isPending &&
                Array.from({ length: 8 }, (_, i) => (
                  <tr key={i} className="border-b border-subtle">
                    {Array.from({ length: 7 }, (__, j) => <td key={j} className="h-11 px-4"><Skeleton className="h-3.5 w-20" /></td>)}
                  </tr>
                ))}
              {list.data?.data.map((t: TripListItemDto) => (
                <tr key={t.id} className="cursor-pointer border-b border-subtle hover:bg-canvas" onClick={() => navigate(`/trips/${t.id}`)}>
                  <td className="h-11 px-4">
                    <Link to={`/trips/${t.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-primary hover:underline">{t.tripNo}</Link>
                    {t.tripType !== 'loaded' && <div className="text-xs text-muted">{titleCase(t.tripType)} run</div>}
                  </td>
                  <td className="px-4">
                    {t.booking ? (
                      <>
                        <div>{t.booking.customerName}</div>
                        <div className="font-mono text-xs text-muted">{t.booking.lrNumber ? `LR ${t.booking.lrNumber}` : t.booking.bookingNo}</div>
                      </>
                    ) : <span className="text-muted">—</span>}
                  </td>
                  <td className="px-4">{t.originCity} → {t.destinationCity}</td>
                  <td className="px-4 font-mono text-xs">{t.vehicle.registrationNo}</td>
                  <td className="px-4">{t.driver.fullName}</td>
                  <td className="px-4 tabular-nums">{fmtDateTime(t.plannedStart, tz)}</td>
                  <td className="px-4"><TripStatusBadge status={t.status} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.data && list.data.data.length === 0 && <EmptyState title={activeOnly ? 'No active trips' : 'No trips match these filters'} body="Trips are created by planning an approved booking." />}
        {list.data && list.data.meta.total > 0 && (
          <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={list.data.meta.pageSize} onPage={(p) => lp.update({ page: String(p) })} />
        )}
        {list.data && <p className="px-4 pb-3 text-xs text-muted">{fmtNumber(list.data.meta.total)} trips.</p>}
      </Card>
    </div>
  );
}
