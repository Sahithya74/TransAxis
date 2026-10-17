import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ChevronLeft, MapPin, Pencil, Plus } from 'lucide-react';
import { todayIn } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../components/ui/Layout';
import { Table, THead, Th } from '../../components/ui/Table';
import { ApiError } from '../../lib/api';
import { fmtDate, fmtMoney, titleCase } from '../../lib/format';
import { useCustomer } from './api';
import { ContactDialog, CustomerFormDialog, RateCardDialog } from './PartyForms';

export function CustomerDetailPage() {
  const id = Number(useParams().id);
  const { can, organization } = useAuth();
  const q = useCustomer(id);
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState(false);
  const [rate, setRate] = useState(false);
  const today = todayIn(organization?.timezone ?? 'Asia/Kolkata');

  if (q.isError) {
    const nf = q.error instanceof ApiError && q.error.status === 404;
    return <Card>{nf ? <EmptyState title="Customer not found" /> : <ErrorState message={(q.error as Error).message} />}</Card>;
  }
  const c = q.data;
  const canWrite = can('customers:write');

  return (
    <div>
      <Link to="/parties" className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden /> Customers
      </Link>
      <PageHeader
        title={c?.name ?? <Skeleton className="h-7 w-56" />}
        subtitle={c && (
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{c.code}</span>
            <Badge tone={c.status === 'active' ? 'ok' : 'warn'}>{titleCase(c.status)}</Badge>
            {c.openBookings > 0 && <Link to={`/bookings?customerId=${c.id}`} className="text-primary hover:underline">{c.openBookings} open booking(s)</Link>}
          </span>
        )}
        actions={c && canWrite && <Button onClick={() => setEditing(true)}><Pencil className="size-4" aria-hidden /> Edit</Button>}
      />
      {!c ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="mb-3 text-base">Billing</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
              <Item label="Legal name" wide>{c.legalName ?? '—'}</Item>
              <Item label="GSTIN"><span className="font-mono">{c.gstin ?? '—'}</span></Item>
              <Item label="PAN"><span className="font-mono">{c.pan ?? '—'}</span></Item>
              <Item label="Address" wide>{[c.billingAddress, c.city, c.state, c.pincode].filter(Boolean).join(', ') || '—'}</Item>
              <Item label="Payment terms">{c.paymentTermsDays} days</Item>
              <Item label="Credit limit">{fmtMoney(c.creditLimit)}</Item>
              <Item label="Phone">{c.phone ?? '—'}</Item>
              <Item label="Email">{c.email ?? '—'}</Item>
            </dl>
          </Card>

          <Card>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="text-base">Contacts</h2>
              {canWrite && <Button size="sm" onClick={() => setContact(true)}><Plus className="size-4" aria-hidden /> Add</Button>}
            </div>
            {c.contacts.length === 0 ? (
              <EmptyState title="No contacts" />
            ) : (
              <ul className="divide-y divide-line">
                {c.contacts.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-3 px-5 py-2.5 text-[13px]">
                    <div>
                      <div className="font-medium">{p.name} {p.isPrimary && <Badge tone="info">Primary</Badge>}</div>
                      <div className="text-xs text-muted">{p.designation ?? '—'}</div>
                    </div>
                    <div className="text-right text-xs text-muted">{p.phone}<br />{p.email}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="lg:col-span-2">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="text-base">Rate cards</h2>
              {(canWrite || can('bookings:approve')) && <Button size="sm" onClick={() => setRate(true)}><Plus className="size-4" aria-hidden /> Add rate card</Button>}
            </div>
            {c.rateCards.length === 0 ? (
              <EmptyState title="No rate cards" body="Without a rate card, bookings for this customer are priced manually." />
            ) : (
              <Table minWidth={820}>
                <THead><Th>Lane</Th><Th>Vehicle</Th><Th>Rate</Th><Th>Loading / unloading</Th><Th>Detention</Th><Th>Validity</Th></THead>
                <tbody>
                  {c.rateCards.map((r) => {
                    const active = r.validFrom <= today && (!r.validTo || r.validTo >= today);
                    return (
                      <tr key={r.id} className="border-b border-subtle">
                        <td className="h-11 px-4 font-medium">{r.originCity} → {r.destinationCity}</td>
                        <td className="px-4">{r.vehicleType?.name ?? 'Any'}</td>
                        <td className="px-4 tabular-nums">{fmtMoney(r.rate)} <span className="text-xs text-muted">{titleCase(r.rateBasis)}</span></td>
                        <td className="px-4 tabular-nums">{fmtMoney(r.loadingCharge)} / {fmtMoney(r.unloadingCharge)}</td>
                        <td className="px-4 text-xs">{fmtMoney(r.detentionRatePerHour)}/h after {r.detentionFreeHours} h</td>
                        <td className="px-4"><Badge tone={active ? 'ok' : 'neutral'}>{active ? 'Active' : 'Inactive'}</Badge> <span className="text-xs text-muted">{fmtDate(r.validFrom)} – {r.validTo ? fmtDate(r.validTo) : 'open'}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          <Card className="lg:col-span-2">
            <div className="border-b border-line px-5 py-3"><h2 className="text-base">Sites</h2></div>
            {c.locations.length === 0 ? (
              <EmptyState title="No saved sites" />
            ) : (
              <ul className="divide-y divide-line">
                {c.locations.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                    <MapPin className="size-4 text-muted" aria-hidden />
                    <span className="font-medium">{l.name}</span>
                    <span className="text-muted">{l.city}{l.lat != null ? ` · ${l.lat.toFixed(4)}, ${l.lng?.toFixed(4)}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      {c && <CustomerFormDialog open={editing} onClose={() => setEditing(false)} customer={c} />}
      {c && <ContactDialog open={contact} onClose={() => setContact(false)} customerId={c.id} />}
      {c && <RateCardDialog open={rate} onClose={() => setRate(false)} customerId={c.id} today={today} />}
    </div>
  );
}

function Item({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}
