import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Plus, Search } from 'lucide-react';
import { VENDOR_TYPES, type VendorDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '../../components/ui/Layout';
import { SortTh, Table, THead, Th, nextSort } from '../../components/ui/Table';
import { Tabs } from '../../components/ui/Tabs';
import { fmtMoney, titleCase } from '../../lib/format';
import { useListParams } from '../../lib/useListParams';
import { useCustomers, useVendors } from './api';
import { CustomerFormDialog, VendorFormDialog } from './PartyForms';

export function PartiesPage() {
  const { can } = useAuth();
  const lp = useListParams(['tab', 'q', 'vendorType'] as const);
  const tab = lp.values.tab ?? (can('customers:read') ? 'customers' : 'vendors');
  const [search, setSearch] = useState(lp.values.q ?? '');
  const [creating, setCreating] = useState(false);
  const canWrite = tab === 'customers' ? can('customers:write') : can('vendors:write');

  return (
    <div>
      <PageHeader
        title="Customers & vendors"
        subtitle="Who you carry for, and who you buy from"
        actions={canWrite && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden /> {tab === 'customers' ? 'Add customer' : 'Add vendor'}
          </Button>
        )}
      />
      <Tabs
        className="mb-4"
        active={tab}
        onChange={(t) => {
          setSearch('');
          lp.update({ tab: t, q: undefined, vendorType: undefined, sort: undefined });
        }}
        tabs={[...(can('customers:read') ? [{ id: 'customers', label: 'Customers' }] : []), ...(can('vendors:read') ? [{ id: 'vendors', label: 'Vendors' }] : [])]}
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
            <Input aria-label="Search" placeholder="Search name, code, GSTIN or city…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {tab === 'vendors' && (
            <Select aria-label="Vendor type" className="w-auto" value={lp.values.vendorType ?? ''} onChange={(e) => lp.update({ vendorType: e.target.value || undefined })}>
              <option value="">All types</option>
              {VENDOR_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </Select>
          )}
        </form>
        {tab === 'customers' ? <CustomersTable lp={lp} /> : <VendorsTable lp={lp} />}
      </Card>
      {tab === 'customers' ? (
        <CustomerFormDialog open={creating} onClose={() => setCreating(false)} />
      ) : (
        <VendorFormDialog open={creating} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}

type LP = ReturnType<typeof useListParams<'tab' | 'q' | 'vendorType'>>;

function CustomersTable({ lp }: { lp: LP }) {
  const navigate = useNavigate();
  const list = useCustomers({ page: lp.page, pageSize: 25, sort: lp.sort, q: lp.values.q });
  if (list.isError) return <ErrorState message={(list.error as Error).message} />;
  return (
    <>
      <Table minWidth={820}>
        <THead>
          <SortTh field="name" label="Customer" sort={lp.sort} onSort={(f) => lp.update({ sort: nextSort(lp.sort, f) })} />
          <Th>GSTIN</Th>
          <Th>City</Th>
          <Th>Terms</Th>
          <Th>Credit limit</Th>
          <Th>Open bookings</Th>
          <Th>Status</Th>
        </THead>
        <tbody>
          {list.isPending && Array.from({ length: 6 }, (_, i) => <tr key={i}><td colSpan={7} className="h-11 px-4"><Skeleton className="h-4 w-full" /></td></tr>)}
          {list.data?.data.map((c) => (
            <tr key={c.id} className="cursor-pointer border-b border-subtle hover:bg-canvas" onClick={() => navigate(`/parties/customers/${c.id}`)}>
              <td className="h-11 px-4">
                <Link to={`/parties/customers/${c.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-primary hover:underline">{c.name}</Link>
                <div className="font-mono text-xs text-muted">{c.code}</div>
              </td>
              <td className="px-4 font-mono text-xs">{c.gstin ?? '—'}</td>
              <td className="px-4">{c.city ?? '—'}</td>
              <td className="px-4">{c.paymentTermsDays} days</td>
              <td className="px-4 tabular-nums">{fmtMoney(c.creditLimit)}</td>
              <td className="px-4 tabular-nums">{c.openBookings}</td>
              <td className="px-4"><Badge tone={c.status === 'active' ? 'ok' : c.status === 'on_hold' ? 'warn' : 'neutral'}>{titleCase(c.status)}</Badge></td>
            </tr>
          ))}
        </tbody>
      </Table>
      {list.data?.data.length === 0 && <EmptyState title="No customers found" />}
      {list.data && list.data.meta.total > 0 && (
        <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={list.data.meta.pageSize} onPage={(p) => lp.update({ page: String(p) })} />
      )}
    </>
  );
}

function VendorsTable({ lp }: { lp: LP }) {
  const { can } = useAuth();
  const [editing, setEditing] = useState<VendorDto | null>(null);
  const list = useVendors({ page: lp.page, pageSize: 25, sort: lp.sort, q: lp.values.q, vendorType: lp.values.vendorType });
  if (list.isError) return <ErrorState message={(list.error as Error).message} />;
  return (
    <>
      <Table minWidth={820}>
        <THead>
          <SortTh field="name" label="Vendor" sort={lp.sort} onSort={(f) => lp.update({ sort: nextSort(lp.sort, f) })} />
          <SortTh field="vendorType" label="Type" sort={lp.sort} onSort={(f) => lp.update({ sort: nextSort(lp.sort, f) })} />
          <Th>City</Th>
          <Th>Contact</Th>
          <Th>GSTIN</Th>
          <Th>Terms</Th>
          <Th>Status</Th>
        </THead>
        <tbody>
          {list.isPending && Array.from({ length: 6 }, (_, i) => <tr key={i}><td colSpan={7} className="h-11 px-4"><Skeleton className="h-4 w-full" /></td></tr>)}
          {list.data?.data.map((v) => (
            <tr key={v.id} className={`border-b border-subtle ${can('vendors:write') ? 'cursor-pointer hover:bg-canvas' : ''}`} onClick={() => can('vendors:write') && setEditing(v)}>
              <td className="h-11 px-4">
                <div className="font-medium">{v.name}</div>
                <div className="font-mono text-xs text-muted">{v.code}</div>
              </td>
              <td className="px-4">{titleCase(v.vendorType)}</td>
              <td className="px-4">{v.city ?? '—'}</td>
              <td className="px-4">{v.contactName ?? '—'}<div className="text-xs text-muted">{v.phone}</div></td>
              <td className="px-4 font-mono text-xs">{v.gstin ?? '—'}</td>
              <td className="px-4">{v.paymentTermsDays} days</td>
              <td className="px-4"><Badge tone={v.status === 'active' ? 'ok' : 'neutral'}>{titleCase(v.status)}</Badge></td>
            </tr>
          ))}
        </tbody>
      </Table>
      {list.data?.data.length === 0 && <EmptyState title="No vendors found" />}
      {list.data && list.data.meta.total > 0 && (
        <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={list.data.meta.pageSize} onPage={(p) => lp.update({ page: String(p) })} />
      )}
      {editing && <VendorFormDialog open onClose={() => setEditing(null)} vendor={editing} />}
    </>
  );
}
