import type { ReactNode } from 'react';
import { useParams } from 'react-router';
import { Printer } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { todayIn, type PortalTrackingDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../../components/ui/Button';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber, fmtWeight, titleCase } from '../../lib/format';
import { useOrgProfile } from '../../lib/useOrgProfile';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { useBooking } from '../bookings/api';
import { useTrip } from '../trips/api';

/** A4 page with a toolbar that disappears when printing. */
export function PrintShell({ title, children, ready }: { title: string; children: ReactNode; ready: boolean }) {
  return (
    <div className="min-h-screen bg-subtle py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[210mm] items-center gap-2 px-4 print:hidden">
        <h1 className="flex-1 text-base">{title}</h1>
        <Button onClick={() => window.close()}>Close</Button>
        <Button variant="primary" disabled={!ready} onClick={() => window.print()}><Printer className="size-4" aria-hidden /> Print</Button>
      </div>
      <article className="mx-auto max-w-[210mm] bg-white p-[12mm] text-[12px] leading-snug text-black shadow-raised print:max-w-none print:p-0 print:shadow-none">
        {ready ? children : <p className="text-muted">Loading…</p>}
      </article>
    </div>
  );
}

export function Letterhead({ docTitle, number, date }: { docTitle: string; number: string; date: string }) {
  const org = useOrgProfile().data;
  return (
    <header className="mb-4 flex items-start justify-between gap-6 border-b-2 border-black pb-3">
      <div>
        <div className="font-display text-lg font-bold">{org?.legalName ?? org?.name}</div>
        <div>{[org?.addressLine, org?.city, org?.state].filter(Boolean).join(', ')}</div>
        {org?.gstin && <div>GSTIN {org.gstin}</div>}
      </div>
      <div className="text-right">
        <div className="text-base font-bold uppercase tracking-wide">{docTitle}</div>
        <div className="font-mono text-sm">{number}</div>
        <div>{date}</div>
      </div>
    </header>
  );
}

export const Box = ({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) => (
  <div className={`border border-black p-2 ${className}`}>
    <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-600">{label}</div>
    <div className="mt-0.5">{children}</div>
  </div>
);

export const Sign = ({ label }: { label: string }) => (
  <div className="flex h-20 flex-col justify-end border border-black p-2 text-center text-[11px]">
    <div className="border-t border-dashed border-black pt-1">{label}</div>
  </div>
);

export function LorryReceiptPrint() {
  const id = Number(useParams().id);
  const tz = useOrgTimezone();
  const staff = useAuth().can('trips:read');
  const booking = useBooking(id);
  const b = booking.data;
  const trip = useTrip(b?.trip?.id ?? 0, staff && !!b?.trip);
  // Customers can't open trips; the portal's tracking view gives them the vehicle and driver's first name.
  const tracking = useQuery({
    queryKey: ['portal', 'tracking', id],
    queryFn: ({ signal }) => api<PortalTrackingDto>(`/portal/bookings/${id}/tracking`, { signal }),
    enabled: !staff && !!b?.trip,
  });
  const t = b?.trip && staff ? trip.data : undefined;
  const pt = tracking.data?.trip;
  const vehicle = t ? `${t.vehicle.registrationNo} (${t.vehicle.vehicleType})` : (pt?.vehicleNo ?? '—');
  const driver = t ? `${t.driver.fullName} · ${t.driver.phone}` : (pt?.driverName ?? '—');
  const pickup = b?.stops[0];
  const drop = b?.stops[b.stops.length - 1];
  const ready = !!b && (!b.trip || !!t || !!tracking.data);

  return (
    <PrintShell title={`Lorry receipt ${b?.lrNumber ?? ''}`} ready={ready}>
      {b && (
        <>
          <Letterhead docTitle="Consignment note / Lorry receipt" number={b.lrNumber ?? 'Not issued'} date={fmtDate(todayIn(tz, new Date(t?.plannedStart ?? b.loadingWindowStart)))} />
          <div className="grid grid-cols-2 gap-2">
            <Box label="Consignor (from)">
              <div className="font-semibold">{pickup?.name}</div>
              <div>{[pickup?.addressLine, pickup?.city, pickup?.state, pickup?.pincode].filter(Boolean).join(', ')}</div>
              {pickup?.contactPhone && <div>{pickup.contactName} {pickup.contactPhone}</div>}
            </Box>
            <Box label="Consignee (to)">
              <div className="font-semibold">{drop?.name}</div>
              <div>{[drop?.addressLine, drop?.city, drop?.state, drop?.pincode].filter(Boolean).join(', ')}</div>
              {drop?.contactPhone && <div>{drop.contactName} {drop.contactPhone}</div>}
            </Box>
            <Box label="Billing party">{b.customer.name}{b.customerRef ? ` · Ref ${b.customerRef}` : ''}</Box>
            <Box label="Booking">{b.bookingNo}</Box>
            <Box label="Vehicle">{vehicle}</Box>
            <Box label="Driver">{driver}</Box>
            <Box label="From → To">{b.originCity} → {b.destinationCity}</Box>
            <Box label="E-way bill">{b.ewayBillNo ? `${b.ewayBillNo}${b.ewayBillExpiresAt ? `, valid to ${fmtDateTime(b.ewayBillExpiresAt, tz)}` : ''}` : 'Not applicable'}</Box>
          </div>

          <table className="mt-3 w-full border-collapse text-left">
            <thead>
              <tr className="[&>th]:border [&>th]:border-black [&>th]:px-2 [&>th]:py-1 [&>th]:text-[10px] [&>th]:uppercase">
                <th>#</th><th>Description of goods</th><th>HSN</th><th>Packages</th><th className="text-right">Actual weight</th><th className="text-right">Declared value</th>
              </tr>
            </thead>
            <tbody>
              {b.cargo.map((c, i) => (
                <tr key={c.id} className="[&>td]:border [&>td]:border-black [&>td]:px-2 [&>td]:py-1">
                  <td>{i + 1}</td>
                  <td>{c.description}{c.category !== 'general' ? ` (${titleCase(c.category)})` : ''}</td>
                  <td>{c.hsnCode ?? '—'}</td>
                  <td>{fmtNumber(c.quantity)} {c.unit}{c.packaging ? `, ${c.packaging}` : ''}</td>
                  <td className="text-right">{fmtWeight(c.weightKg)}</td>
                  <td className="text-right">{fmtMoney(c.declaredValue)}</td>
                </tr>
              ))}
              <tr className="font-semibold [&>td]:border [&>td]:border-black [&>td]:px-2 [&>td]:py-1">
                <td colSpan={4}>Total</td>
                <td className="text-right">{fmtWeight(b.totalWeightKg)}</td>
                <td className="text-right">{fmtMoney(b.cargo.reduce((s, c) => s + Number(c.declaredValue ?? 0), 0))}</td>
              </tr>
            </tbody>
          </table>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <Box label="Freight (before GST)">{fmtMoney(b.approvedAmount ?? b.quotedAmount)}</Box>
            <Box label="GST on freight">SAC 9965, charged on the tax invoice</Box>
            <Box label="Hazardous">{b.isHazardous ? 'YES: handle per hazardous goods rules' : 'No'}</Box>
          </div>
          {b.specialInstructions && <Box label="Special instructions" className="mt-2">{b.specialInstructions}</Box>}
          <p className="mt-3 text-[10px] text-neutral-600">
            Goods received in apparent good order for carriage subject to the terms agreed with the billing party. Delivery is confirmed by the consignee’s one-time code or an authorised proof of delivery.
          </p>
          <div className="mt-4 grid grid-cols-4 gap-2">
            <Sign label="Consignor" />
            <Sign label="Driver" />
            <Sign label="Consignee: received in good condition" />
            <Sign label="For the carrier" />
          </div>
        </>
      )}
    </PrintShell>
  );
}

export function TripSheetPrint() {
  const id = Number(useParams().id);
  const tz = useOrgTimezone();
  const t = useTrip(id).data;
  return (
    <PrintShell title={`Trip sheet ${t?.tripNo ?? ''}`} ready={!!t}>
      {t && (
        <>
          <Letterhead docTitle="Trip sheet" number={t.tripNo} date={fmtDate(todayIn(tz, new Date(t.plannedStart)))} />
          <div className="grid grid-cols-3 gap-2">
            <Box label="Vehicle">{t.vehicle.registrationNo}<br />{t.vehicle.vehicleType}</Box>
            <Box label="Driver">{t.driver.fullName}<br />{t.driver.phone}</Box>
            <Box label="Crew">{t.crew.length ? t.crew.map((c) => `${c.fullName} (${titleCase(c.role)})`).join(', ') : '—'}</Box>
            <Box label="Booking / LR">{t.booking ? `${t.booking.bookingNo}${t.booking.lrNumber ? ` / ${t.booking.lrNumber}` : ''}` : '—'}</Box>
            <Box label="Customer">{t.booking?.customerName ?? '—'}</Box>
            <Box label="Cargo">{fmtWeight(t.cargoWeightKg)}</Box>
            <Box label="Planned start">{fmtDateTime(t.plannedStart, tz)}</Box>
            <Box label="Planned end">{fmtDateTime(t.plannedEnd, tz)}</Box>
            <Box label="Route">{t.route ? `${t.route.name}, ${fmtNumber(t.route.distanceKm)} km` : `${t.originCity} → ${t.destinationCity}`}</Box>
          </div>

          <h2 className="mb-1 mt-4 text-[13px] font-bold uppercase">Stops</h2>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="[&>th]:border [&>th]:border-black [&>th]:px-2 [&>th]:py-1 [&>th]:text-[10px] [&>th]:uppercase">
                <th>#</th><th>Place</th><th>Contact</th><th>Arrived</th><th>Departed</th><th>Signature / stamp</th>
              </tr>
            </thead>
            <tbody>
              {t.stops.map((s) => (
                <tr key={s.id} className="h-10 [&>td]:border [&>td]:border-black [&>td]:px-2 [&>td]:py-1">
                  <td>{s.seq}</td>
                  <td><span className="font-semibold uppercase">{s.stopType}</span> {s.name}, {s.city}</td>
                  <td>{[s.contactName, s.contactPhone].filter(Boolean).join(' ')}</td>
                  <td>{s.actualArrival ? fmtDateTime(s.actualArrival, tz) : ''}</td>
                  <td>{s.actualDeparture ? fmtDateTime(s.actualDeparture, tz) : ''}</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <Box label="Odometer at start">{t.startOdometer != null ? `${fmtNumber(t.startOdometer)} km` : ' '}</Box>
            <Box label="Odometer at end">{t.endOdometer != null ? `${fmtNumber(t.endOdometer)} km` : ' '}</Box>
            <Box label="Cargo seals">{t.seals.length ? t.seals.map((s) => s.sealNo).join(', ') : ' '}</Box>
          </div>

          <h2 className="mb-1 mt-4 text-[13px] font-bold uppercase">Trip expenses (attach receipts)</h2>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="[&>th]:border [&>th]:border-black [&>th]:px-2 [&>th]:py-1 [&>th]:text-[10px] [&>th]:uppercase">
                <th className="w-24">Date</th><th>Item (fuel, toll, food, repair…)</th><th className="w-28">Amount (₹)</th><th className="w-28">Receipt no.</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 8 }, (_, i) => (
                <tr key={i} className="h-8 [&>td]:border [&>td]:border-black"><td /><td /><td /><td /></tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Box label="Advance given to driver">&nbsp;</Box>
            <Box label="Cash collected on delivery">&nbsp;</Box>
          </div>
          {t.notes && <Box label="Instructions" className="mt-2">{t.notes}</Box>}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Sign label="Dispatcher" />
            <Sign label="Driver" />
            <Sign label="Accounts (on return)" />
          </div>
        </>
      )}
    </PrintShell>
  );
}
