import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Paperclip } from 'lucide-react';
import type { FuelLogDto, PaymentMode } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { uploadFile } from '../../lib/api';
import { apiFieldErrors, type FieldErrors } from '../../lib/forms';
import { fmtMoney, fromLocalInput, toLocalInput } from '../../lib/format';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { post, useFinanceMutation } from '../finance/api';
import { PAYMENT_MODE_LABEL } from '../finance/labels';
import { useVehicles } from '../vehicles/api';

const MODES: PaymentMode[] = ['fuel_card', 'cash', 'bank', 'upi', 'card', 'vendor_credit'];

export interface FuelTrip {
  id: number;
  tripNo: string;
  vehicleId: number;
  registrationNo: string;
}

/** Records a fill. Mileage is measured between full-tank fills, and unusual fills are flagged for review. */
export function FuelDialog({ open, onClose, trip }: { open: boolean; onClose: () => void; trip?: FuelTrip }) {
  const { can } = useAuth();
  const tz = useOrgTimezone();
  const toast = useToast();
  const crew = !can('fuel:write') && !can('finance:post');
  const [v, setV] = useState({ vehicleId: '', filledAt: '', odometerKm: '', litres: '', pricePerLitre: '', paymentMode: 'fuel_card' as PaymentMode, fullTank: true, stationName: '' });
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    setV({ vehicleId: trip ? String(trip.vehicleId) : '', filledAt: toLocalInput(new Date().toISOString(), tz), odometerKm: '', litres: '', pricePerLitre: '', paymentMode: 'fuel_card', fullTank: true, stationName: '' });
    setFile(null);
    setErrors({});
    setMessage(null);
  }, [open, trip, tz]);

  const vehicles = useVehicles({ page: 1, pageSize: 100, sort: 'registrationNo' }, open && !trip && can('vehicles:read'));
  const create = useFinanceMutation((body: unknown) => post<FuelLogDto>('/finance/fuel', body));
  const amount = (Number(v.litres) || 0) * (Number(v.pricePerLitre) || 0);
  const uploadAs = trip && can('trips:dispatch', 'trips:update_own') ? 'trip_document' : can('documents:write') ? 'general' : null;
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setMessage(null);
    setBusy(true);
    try {
      const receipt = file && uploadAs ? await uploadFile(file, uploadAs, { tripId: uploadAs === 'trip_document' ? trip?.id : undefined }) : null;
      const log = await create.mutateAsync({
        vehicleId: Number(v.vehicleId) || undefined,
        tripId: trip?.id ?? null,
        filledAt: fromLocalInput(v.filledAt, tz) || undefined,
        odometerKm: v.odometerKm === '' ? undefined : Number(v.odometerKm),
        litres: v.litres === '' ? undefined : Number(v.litres),
        pricePerLitre: v.pricePerLitre === '' ? undefined : Number(v.pricePerLitre),
        paymentMode: v.paymentMode,
        fullTank: v.fullTank,
        stationName: v.stationName.trim() || null,
        receiptFileId: receipt?.id ?? null,
      });
      if (log.anomaly) toast.error(`Fill saved but flagged: ${log.anomalyReasons.join('; ')}`);
      else toast.success(`Fill of ${log.litres} L saved${log.kmpl ? `: ${log.kmpl} km/L since the last full tank` : ''}`);
      onClose();
    } catch (err) {
      const r = apiFieldErrors(err);
      setErrors(r.fields);
      setMessage(Object.keys(r.fields).length ? null : r.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={trip ? `Record fuel for ${trip.registrationNo}` : 'Record a fuel fill'}
      description={crew ? 'For fuel-card or company-cash fills. Paid with your own money? Add it as an expense instead so it is paid back.' : 'Fill to the brim and tick “Full tank” so mileage can be measured.'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="fuel-form" loading={busy}>Save fill</Button>
        </>
      }
    >
      <form id="fuel-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {message && <div className="sm:col-span-2"><Banner tone="crit" title="Couldn’t save the fill">{message}</Banner></div>}
        {!trip && (
          <Field label="Vehicle" required error={errors.vehicleId} className="sm:col-span-2">
            {(p) => (
              <Select {...p} value={v.vehicleId} onChange={set('vehicleId')}>
                <option value="">Choose…</option>
                {vehicles.data?.data.map((x) => <option key={x.id} value={x.id}>{x.registrationNo}</option>)}
              </Select>
            )}
          </Field>
        )}
        <Field label="Filled at" required error={errors.filledAt}>{(p) => <Input {...p} type="datetime-local" value={v.filledAt} onChange={set('filledAt')} />}</Field>
        <Field label="Odometer (km)" required error={errors.odometerKm}>{(p) => <Input {...p} type="number" min="0" inputMode="numeric" value={v.odometerKm} onChange={set('odometerKm')} />}</Field>
        <Field label="Litres" required error={errors.litres}>{(p) => <Input {...p} type="number" min="0" step="0.01" inputMode="decimal" value={v.litres} onChange={set('litres')} />}</Field>
        <Field label="Price per litre (₹)" required error={errors.pricePerLitre}>{(p) => <Input {...p} type="number" min="0" step="0.01" inputMode="decimal" value={v.pricePerLitre} onChange={set('pricePerLitre')} />}</Field>
        <Field label="Paid by" required error={errors.paymentMode} hint={amount > 0 ? `Amount ${fmtMoney(amount, true)}` : undefined}>
          {(p) => (
            <Select {...p} value={v.paymentMode} onChange={set('paymentMode')}>
              {(crew ? MODES.slice(0, 2) : MODES).map((m) => <option key={m} value={m}>{PAYMENT_MODE_LABEL[m]}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Fuel station" error={errors.stationName}>{(p) => <Input {...p} value={v.stationName} maxLength={120} onChange={set('stationName')} placeholder="e.g. IOCL Krishnagiri" />}</Field>
        <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
          <input type="checkbox" className="size-4 accent-primary" checked={v.fullTank} onChange={(e) => setV((x) => ({ ...x, fullTank: e.target.checked }))} />
          Full tank (filled to the brim)
        </label>
        {uploadAs && (
          <Field label="Fuel slip" error={errors.receiptFileId} className="sm:col-span-2">
            {(p) => (
              <label htmlFor={p.id} className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-line-strong px-3 py-2 text-[13px] hover:bg-canvas">
                <Paperclip className="size-4 text-muted" aria-hidden />
                <span className="truncate">{file ? file.name : 'Attach a photo of the slip'}</span>
                <input id={p.id} aria-describedby={p['aria-describedby']} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            )}
          </Field>
        )}
      </form>
    </Dialog>
  );
}
