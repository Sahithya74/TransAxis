import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowDown, ArrowUp, ArrowUpDown, Plus, Search } from 'lucide-react';
import { todayIn, VEHICLE_STATUSES, type VehicleDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '../../components/ui/Layout';
import { fmtNumber, fmtWeight } from '../../lib/format';
import { useVehicles, useVehicleTypes, type VehicleListParams } from './api';
import { ComplianceBadge, VEHICLE_STATUS_LABEL, VehicleStatusBadge } from './badges';
import { VehicleFormDialog } from './VehicleFormDialog';

const PAGE_SIZE = 20;

export function VehiclesPage() {
  const { can, organization } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const today = todayIn(organization?.timezone ?? 'Asia/Kolkata');

  const query: VehicleListParams = {
    page: Number(params.get('page') ?? 1) || 1,
    pageSize: PAGE_SIZE,
    sort: params.get('sort') ?? undefined,
    q: params.get('q') ?? undefined,
    status: params.get('status') ?? undefined,
    vehicleTypeId: params.get('type') ?? undefined,
    compliance: params.get('compliance') ?? undefined,
  };
  const list = useVehicles(query);
  const types = useVehicleTypes();

  /** Filters live in the URL so views can be bookmarked and shared. Any change resets to page 1. */
  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const toggleSort = (field: string) => {
    const current = query.sort;
    update({ sort: current === field ? `-${field}` : current === `-${field}` ? undefined : field });
  };

  const filtersActive = !!(query.q || query.status || query.vehicleTypeId || query.compliance);

  return (
    <div>
      <PageHeader
        title="Vehicles"
        subtitle={list.data ? `${fmtNumber(list.data.meta.total)} vehicle${list.data.meta.total === 1 ? '' : 's'}${filtersActive ? ' match the filters' : ' in the fleet'}` : ' '}
        actions={
          can('vehicles:write') && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden /> Register vehicle
            </Button>
          )
        }
      />

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
              aria-label="Search registration, make or model"
              placeholder="Search registration, make, model…"
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => (search.trim() || undefined) !== query.q && update({ q: search.trim() || undefined })}
            />
          </div>
          <Select aria-label="Status" className="w-auto" value={query.status ?? ''} onChange={(e) => update({ status: e.target.value || undefined })}>
            <option value="">All statuses</option>
            {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{VEHICLE_STATUS_LABEL[s]}</option>)}
          </Select>
          <Select aria-label="Vehicle type" className="w-auto" value={query.vehicleTypeId ?? ''} onChange={(e) => update({ type: e.target.value || undefined })}>
            <option value="">All types</option>
            {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <Select aria-label="Compliance" className="w-auto" value={query.compliance ?? ''} onChange={(e) => update({ compliance: e.target.value || undefined })}>
            <option value="">Any compliance</option>
            <option value="expired">Has expired document</option>
            <option value="expiring">Expiring soon</option>
            <option value="ok">Fully compliant</option>
          </Select>
          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('');
                setParams(new URLSearchParams(), { replace: true });
              }}
            >
              Clear filters
            </Button>
          )}
        </form>

        {list.isError ? (
          <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[13px]">
              <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
                <tr>
                  <SortHeader field="registrationNo" label="Registration" sort={query.sort} onSort={toggleSort} />
                  <th className="h-9 px-4 font-semibold">Type</th>
                  <th className="h-9 px-4 font-semibold">Make / model</th>
                  <SortHeader field="payloadCapacityKg" label="Payload" sort={query.sort} onSort={toggleSort} align="right" />
                  <SortHeader field="status" label="Status" sort={query.sort} onSort={toggleSort} />
                  <th className="h-9 px-4 font-semibold">Compliance</th>
                  <th className="h-9 px-4 font-semibold">Branch</th>
                </tr>
              </thead>
              <tbody aria-busy={list.isFetching}>
                {list.isPending &&
                  Array.from({ length: 8 }, (_, i) => (
                    <tr key={i} className="border-b border-subtle">
                      {Array.from({ length: 7 }, (__, j) => (
                        <td key={j} className="h-11 px-4"><Skeleton className="h-3.5 w-24" /></td>
                      ))}
                    </tr>
                  ))}
                {list.data?.data.map((v: VehicleDto) => (
                  <tr
                    key={v.id}
                    className="cursor-pointer border-b border-subtle hover:bg-canvas"
                    onClick={() => navigate(`/vehicles/${v.id}`)}
                  >
                    <td className="h-11 px-4">
                      <Link to={`/vehicles/${v.id}`} onClick={(e) => e.stopPropagation()} className="font-mono font-semibold tracking-wide text-primary hover:underline">
                        {v.registrationNo}
                      </Link>
                    </td>
                    <td className="px-4">{v.vehicleType.name}</td>
                    <td className="px-4 text-muted">{[v.make, v.model].filter(Boolean).join(' ') || '—'}</td>
                    <td className="px-4 text-right tabular-nums">{fmtWeight(v.payloadCapacityKg)}</td>
                    <td className="px-4"><VehicleStatusBadge status={v.status} /></td>
                    <td className="px-4"><ComplianceBadge compliance={v.compliance} today={today} /></td>
                    <td className="px-4 text-muted">{v.branch?.name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.data && list.data.data.length === 0 && (
              <EmptyState
                title={filtersActive ? 'No vehicles match these filters' : 'No vehicles yet'}
                body={filtersActive ? 'Try removing a filter or searching for part of the registration number.' : 'Register the first vehicle to start assigning trips.'}
              />
            )}
          </div>
        )}
        {list.data && list.data.meta.total > 0 && (
          <Pagination
            page={list.data.meta.page}
            totalPages={list.data.meta.totalPages}
            total={list.data.meta.total}
            pageSize={list.data.meta.pageSize}
            onPage={(p) => update({ page: String(p) })}
          />
        )}
      </Card>

      <VehicleFormDialog open={creating} onClose={() => setCreating(false)} onSaved={(v) => navigate(`/vehicles/${v.id}`)} />
    </div>
  );
}

function SortHeader({
  field,
  label,
  sort,
  onSort,
  align = 'left',
}: {
  field: string;
  label: ReactNode;
  sort?: string;
  onSort: (f: string) => void;
  align?: 'left' | 'right';
}) {
  const state = sort === field ? 'ascending' : sort === `-${field}` ? 'descending' : 'none';
  const Icon = state === 'ascending' ? ArrowUp : state === 'descending' ? ArrowDown : ArrowUpDown;
  return (
    <th aria-sort={state} className={`h-9 px-4 font-semibold ${align === 'right' ? 'text-right' : ''}`}>
      <button onClick={() => onSort(field)} className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {label}
        <Icon className={`size-3 ${state === 'none' ? 'opacity-40' : 'text-primary'}`} aria-hidden />
      </button>
    </th>
  );
}
