import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Plus, Search } from 'lucide-react';
import { EMPLOYMENT_STATUSES, WORKER_TYPES, todayIn, type WorkerDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { LicenceBadge, TripStatusBadge } from '../../components/StatusBadges';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '../../components/ui/Layout';
import { SortTh, Table, THead, Th, nextSort } from '../../components/ui/Table';
import { Tabs } from '../../components/ui/Tabs';
import { fmtDate, fmtNumber, titleCase } from '../../lib/format';
import { useListParams } from '../../lib/useListParams';
import { useWorkers } from './api';
import { AttendancePanel } from './AttendancePanel';
import { LeavePanel } from './LeavePanel';
import { WorkerFormDialog } from './WorkerFormDialog';

export function WorkersPage() {
  const { can, organization } = useAuth();
  const navigate = useNavigate();
  const lp = useListParams(['tab', 'q', 'workerType', 'status', 'licence'] as const);
  const tab = lp.values.tab ?? 'people';
  const [search, setSearch] = useState(lp.values.q ?? '');
  const [creating, setCreating] = useState(false);
  const canAttendance = can('attendance:manage');
  const today = todayIn(organization?.timezone ?? 'Asia/Kolkata');

  const list = useWorkers({
    page: lp.page,
    pageSize: 25,
    sort: lp.sort,
    q: lp.values.q,
    workerType: lp.values.workerType,
    status: lp.values.status,
    licence: lp.values.licence,
  });

  return (
    <div>
      <PageHeader
        title="Drivers & workforce"
        subtitle="Licences, availability and current assignments"
        actions={can('workers:write') && tab === 'people' && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden /> Add worker
          </Button>
        )}
      />
      <Tabs
        className="mb-4"
        active={tab}
        onChange={(t) => lp.update({ tab: t === 'people' ? undefined : t })}
        tabs={[{ id: 'people', label: 'People' }, ...(canAttendance || can('workers:read') ? [{ id: 'leave', label: 'Leave' }] : []), ...(canAttendance ? [{ id: 'attendance', label: 'Attendance' }] : [])]}
      />

      {tab === 'leave' && <LeavePanel />}
      {tab === 'attendance' && canAttendance && <AttendancePanel defaultDate={today} />}
      {tab === 'people' && (
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
              <Input aria-label="Search name, code or phone" placeholder="Search name, code or phone…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select aria-label="Role" className="w-auto" value={lp.values.workerType ?? ''} onChange={(e) => lp.update({ workerType: e.target.value || undefined })}>
              <option value="">All roles</option>
              {WORKER_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </Select>
            <Select aria-label="Employment status" className="w-auto" value={lp.values.status ?? ''} onChange={(e) => lp.update({ status: e.target.value || undefined })}>
              <option value="">Any status</option>
              {EMPLOYMENT_STATUSES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </Select>
            <Select aria-label="Licence" className="w-auto" value={lp.values.licence ?? ''} onChange={(e) => lp.update({ licence: e.target.value || undefined })}>
              <option value="">Any licence</option>
              <option value="expired">Expired licence</option>
              <option value="expiring">Expiring soon</option>
              <option value="missing">No licence</option>
              <option value="ok">Valid</option>
            </Select>
            {lp.active && (
              <Button variant="ghost" size="sm" onClick={() => { setSearch(''); lp.clear(); }}>
                Clear filters
              </Button>
            )}
          </form>

          {list.isError ? (
            <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
          ) : (
            <Table minWidth={900}>
              <THead>
                <SortTh field="fullName" label="Name" sort={lp.sort} onSort={(f) => lp.update({ sort: nextSort(lp.sort, f) })} />
                <SortTh field="workerType" label="Role" sort={lp.sort} onSort={(f) => lp.update({ sort: nextSort(lp.sort, f) })} />
                <Th>Phone</Th>
                <Th>Licence</Th>
                <SortTh field="licenceValidUntil" label="Valid until" sort={lp.sort} onSort={(f) => lp.update({ sort: nextSort(lp.sort, f) })} />
                <Th>Now</Th>
                <Th>Branch</Th>
              </THead>
              <tbody aria-busy={list.isFetching}>
                {list.isPending &&
                  Array.from({ length: 8 }, (_, i) => (
                    <tr key={i} className="border-b border-subtle">
                      {Array.from({ length: 7 }, (__, j) => <td key={j} className="h-11 px-4"><Skeleton className="h-3.5 w-24" /></td>)}
                    </tr>
                  ))}
                {list.data?.data.map((w: WorkerDto) => (
                  <tr key={w.id} className="cursor-pointer border-b border-subtle hover:bg-canvas" onClick={() => navigate(`/workers/${w.id}`)}>
                    <td className="h-11 px-4">
                      <Link to={`/workers/${w.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-primary hover:underline">{w.fullName}</Link>
                      <div className="text-xs text-muted">{w.employeeCode}</div>
                    </td>
                    <td className="px-4">{titleCase(w.workerType)}</td>
                    <td className="px-4 tabular-nums">{w.phone}</td>
                    <td className="px-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <LicenceBadge state={w.licenceState} />
                        {w.licence && <span className="text-xs text-muted">{w.licence.classes.join(', ')}</span>}
                        {w.licence?.verification === 'unverified' && <Badge tone="warn">Unverified</Badge>}
                      </div>
                    </td>
                    <td className="px-4 tabular-nums">{fmtDate(w.licence?.validUntil)}</td>
                    <td className="px-4">
                      {w.employmentStatus !== 'active' ? (
                        <Badge tone="crit">{titleCase(w.employmentStatus)}</Badge>
                      ) : w.onLeaveToday ? (
                        <Badge tone="warn">On leave</Badge>
                      ) : w.currentTrip ? (
                        <span className="flex items-center gap-1.5">
                          <TripStatusBadge status={w.currentTrip.status} />
                          <span className="font-mono text-xs text-muted">{w.currentTrip.tripNo.slice(-6)}</span>
                        </span>
                      ) : (
                        <Badge tone="ok">Free</Badge>
                      )}
                    </td>
                    <td className="px-4 text-muted">{w.branch?.name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {list.data && list.data.data.length === 0 && <EmptyState title="No one matches these filters" body="Try clearing a filter or searching by employee code." />}
          {list.data && list.data.meta.total > 0 && (
            <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={list.data.meta.pageSize} onPage={(p) => lp.update({ page: String(p) })} />
          )}
          {list.data && <p className="px-4 pb-3 text-xs text-muted">{fmtNumber(list.data.meta.total)} people. Licence numbers are masked unless you have HR access.</p>}
        </Card>
      )}

      <WorkerFormDialog open={creating} onClose={() => setCreating(false)} onSaved={(w) => navigate(`/workers/${w.id}`)} />
    </div>
  );
}
