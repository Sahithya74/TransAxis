import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Plus, Search } from 'lucide-react';
import { BOOKING_STATUSES, type BookingListItemDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { BOOKING_STATUS_LABEL, BookingStatusBadge, TripStatusBadge } from '../../components/StatusBadges';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '../../components/ui/Layout';
import { SortTh, Table, THead, Th, nextSort } from '../../components/ui/Table';
import { Tabs } from '../../components/ui/Tabs';
import { fmtDateTime, fmtMoney, fmtNumber, fmtWeight } from '../../lib/format';
import { useListParams } from '../../lib/useListParams';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { useCustomers } from '../parties/api';
import { useBookings } from './api';

export function BookingsPage() {
  const { can } = useAuth();
  const tz = useOrgTimezone();
  const navigate = useNavigate();
  const lp = useListParams(['tab', 'q', 'status', 'customerId', 'from', 'to'] as const);
  const [search, setSearch] = useState(lp.values.q ?? '');
  const queue = lp.values.tab === 'plan';
  const customers = useCustomers({ pageSize: 100, sort: 'name' });

  const list = useBookings({
    page: lp.page,
    pageSize: 25,
    sort: lp.sort,
    q: lp.values.q,
    status: queue ? undefined : lp.values.status,
    customerId: lp.values.customerId,
    unassigned: queue ? 'true' : undefined,
    from: lp.values.from,
    to: lp.values.to,
  });
  const sortBy = (f: string) => lp.update({ sort: nextSort(lp.sort, f) });

  return (
    <div>
      <PageHeader
        title="Bookings"
        subtitle="Customer orders from enquiry to delivery"
        actions={can('bookings:write') && (
          <Button variant="primary" onClick={() => navigate('/bookings/new')}>
            <Plus className="size-4" aria-hidden /> New booking
          </Button>
        )}
      />
      <Tabs
        className="mb-4"
        active={queue ? 'plan' : 'all'}
        onChange={(t) => lp.update({ tab: t === 'plan' ? 'plan' : undefined, status: undefined })}
        tabs={[{ id: 'all', label: 'All bookings' }, { id: 'plan', label: 'Awaiting a trip' }]}
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
            <Input aria-label="Search bookings" placeholder="Booking no., LR no., customer or their reference…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {!queue && (
            <Select aria-label="Status" className="w-auto" value={lp.values.status ?? ''} onChange={(e) => lp.update({ status: e.target.value || undefined })}>
              <option value="">Any status</option>
              {BOOKING_STATUSES.map((s) => <option key={s} value={s}>{BOOKING_STATUS_LABEL[s]}</option>)}
            </Select>
          )}
          {customers.data && (
            <Select aria-label="Customer" className="w-auto max-w-56" value={lp.values.customerId ?? ''} onChange={(e) => lp.update({ customerId: e.target.value || undefined })}>
              <option value="">All customers</option>
              {customers.data.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
          <label className="flex items-center gap-1.5 text-[13px] text-muted">
            Loading from
            <Input type="date" aria-label="Loading from" className="w-auto" value={lp.values.from ?? ''} onChange={(e) => lp.update({ from: e.target.value || undefined })} />
          </label>
          <label className="flex items-center gap-1.5 text-[13px] text-muted">
            to
            <Input type="date" aria-label="Loading to" className="w-auto" value={lp.values.to ?? ''} onChange={(e) => lp.update({ to: e.target.value || undefined })} />
          </label>
          {lp.active && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); lp.clear(); }}>
              Clear filters
            </Button>
          )}
        </form>

        {list.isError ? (
          <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
        ) : (
          <Table minWidth={1040}>
            <THead>
              <SortTh field="bookingNo" label="Booking" sort={lp.sort} onSort={sortBy} />
              <Th>Customer</Th>
              <Th>Route</Th>
              <SortTh field="loadingWindowStart" label="Loading" sort={lp.sort} onSort={sortBy} />
              <SortTh field="deliveryDeadline" label="Deliver by" sort={lp.sort} onSort={sortBy} />
              <Th className="text-right">Weight</Th>
              <Th className="text-right">Value</Th>
              <Th>Trip</Th>
              <Th>Status</Th>
            </THead>
            <tbody aria-busy={list.isFetching}>
              {list.isPending &&
                Array.from({ length: 8 }, (_, i) => (
                  <tr key={i} className="border-b border-subtle">
                    {Array.from({ length: 9 }, (__, j) => <td key={j} className="h-11 px-4"><Skeleton className="h-3.5 w-20" /></td>)}
                  </tr>
                ))}
              {list.data?.data.map((b: BookingListItemDto) => (
                <tr key={b.id} className="cursor-pointer border-b border-subtle hover:bg-canvas" onClick={() => navigate(`/bookings/${b.id}`)}>
                  <td className="h-11 px-4">
                    <Link to={`/bookings/${b.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-primary hover:underline">{b.bookingNo}</Link>
                    <div className="text-xs text-muted">{b.lrNumber ? `LR ${b.lrNumber}` : (b.customerRef ?? '')}</div>
                  </td>
                  <td className="px-4">{b.customer.name}</td>
                  <td className="px-4">{b.originCity} → {b.destinationCity}</td>
                  <td className="px-4 tabular-nums">{fmtDateTime(b.loadingWindowStart, tz)}</td>
                  <td className="px-4 tabular-nums">{fmtDateTime(b.deliveryDeadline, tz)}</td>
                  <td className="px-4 text-right tabular-nums">{fmtWeight(b.totalWeightKg)}</td>
                  <td className="px-4 text-right tabular-nums">
                    {b.approvedAmount ? fmtMoney(b.approvedAmount) : b.quotedAmount ? <span className="text-muted" title="Quoted, not yet approved">{fmtMoney(b.quotedAmount)}</span> : '—'}
                  </td>
                  <td className="px-4">
                    {b.trip ? (
                      <Link to={`/trips/${b.trip.id}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-primary hover:underline">{b.trip.tripNo.slice(-6)}</span>
                        <TripStatusBadge status={b.trip.status} />
                      </Link>
                    ) : b.status === 'approved' ? (
                      <span className="text-xs font-medium text-warn-strong">Needs a trip</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4"><BookingStatusBadge status={b.status} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.data && list.data.data.length === 0 && (
          <EmptyState
            title={queue ? 'Every approved booking has a trip' : 'No bookings match these filters'}
            body={queue ? 'Approved bookings appear here until a vehicle and driver are assigned.' : 'Try clearing a filter.'}
          />
        )}
        {list.data && list.data.meta.total > 0 && (
          <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={list.data.meta.pageSize} onPage={(p) => lp.update({ page: String(p) })} />
        )}
        {list.data && <p className="px-4 pb-3 text-xs text-muted">{fmtNumber(list.data.meta.total)} bookings. Values exclude GST.</p>}
      </Card>
    </div>
  );
}
