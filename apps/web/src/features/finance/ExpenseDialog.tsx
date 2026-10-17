import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Paperclip } from 'lucide-react';
import { todayIn, type ExpenseDto, type PaymentMode } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select, Textarea } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { uploadFile } from '../../lib/api';
import { apiFieldErrors, type FieldErrors } from '../../lib/forms';
import { fmtMoney } from '../../lib/format';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { useTrips } from '../trips/api';
import { useVehicles } from '../vehicles/api';
import { useWorkers } from '../workers/api';
import { post, useExpenseCategories, useFinanceMutation } from './api';
import { PAYMENT_MODE_LABEL } from './labels';

const OFFICE_MODES: PaymentMode[] = ['cash', 'bank', 'upi', 'card', 'fastag', 'driver_paid', 'vendor_credit'];
const CREW_MODES: PaymentMode[] = ['driver_paid', 'fastag'];

/**
 * Records an expense claim. Crew claim on their own trip and are reimbursed in their next settlement;
 * office staff can also record company-paid expenses against a trip or vehicle.
 */
export function ExpenseDialog({ open, onClose, trip }: { open: boolean; onClose: () => void; trip?: { id: number; tripNo: string } }) {
  const { can } = useAuth();
  const tz = useOrgTimezone();
  const toast = useToast();
  const office = can('finance:post');
  const crew = !office && can('trips:update_own') && !can('trips:read');
  const modes = crew ? CREW_MODES : OFFICE_MODES;

  const [categoryId, setCategoryId] = useState('');
  const [tripId, setTripId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<PaymentMode>('driver_paid');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    setCategoryId('');
    setTripId(trip ? String(trip.id) : '');
    setVehicleId('');
    setWorkerId('');
    setDate(todayIn(tz));
    setAmount('');
    setMode(crew ? 'driver_paid' : 'cash');
    setDescription('');
    setFile(null);
    setErrors({});
    setMessage(null);
  }, [open, trip, tz, crew]);

  const categories = useExpenseCategories(open);
  const trips = useTrips({ pageSize: 50, sort: '-plannedStart' }, { enabled: open && !trip });
  const vehicles = useVehicles({ page: 1, pageSize: 100, sort: 'registrationNo' }, open && !crew && can('vehicles:read'));
  const workers = useWorkers({ pageSize: 100, sort: 'fullName', status: 'active' }, open && !crew && can('workers:read'));
  const create = useFinanceMutation((body: unknown) => post<ExpenseDto>('/finance/expenses', body));

  const cat = categories.data?.find((c) => String(c.id) === categoryId);
  const receiptAbove = cat?.requiresReceiptAbove ? Number(cat.requiresReceiptAbove) : null;
  // Trip documents follow the trip's access rules; anything else is an office document.
  const uploadAs = tripId && can('trips:dispatch', 'trips:update_own') ? 'trip_document' : can('documents:write') ? 'general' : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setMessage(null);
    setBusy(true);
    try {
      const receipt = file && uploadAs ? await uploadFile(file, uploadAs, { tripId: uploadAs === 'trip_document' ? Number(tripId) : undefined }) : null;
      const x = await create.mutateAsync({
        categoryId: Number(categoryId) || undefined,
        tripId: tripId ? Number(tripId) : null,
        vehicleId: vehicleId ? Number(vehicleId) : null,
        workerId: workerId ? Number(workerId) : null,
        expenseDate: date,
        amount: amount === '' ? undefined : Number(amount),
        paymentMode: mode,
        description: description.trim(),
        receiptFileId: receipt?.id ?? null,
      });
      toast.success(`${x.category.name} claim for ${fmtMoney(x.amount, true)} sent for approval`);
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
      title={trip ? `Add an expense to ${trip.tripNo}` : 'Record an expense'}
      description={crew ? 'Money you spent on the trip is paid back in your next settlement once approved.' : 'Approved expenses are posted to the ledger against the trip or vehicle.'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="expense-form" loading={busy}>Submit</Button>
        </>
      }
    >
      <form id="expense-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {message && <div className="sm:col-span-2"><Banner tone="crit" title="Couldn’t save the expense">{message}</Banner></div>}
        <Field label="Category" required error={errors.categoryId} className="sm:col-span-2" hint={receiptAbove !== null ? `A receipt is needed above ${fmtMoney(receiptAbove)}` : undefined}>
          {(p) => (
            <Select {...p} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Choose…</option>
              {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
        </Field>
        {!trip && (
          <Field label="Trip" required={crew} error={errors.tripId} className="sm:col-span-2" hint={crew ? undefined : 'Leave empty for an expense that is not for one trip'}>
            {(p) => (
              <Select {...p} value={tripId} onChange={(e) => setTripId(e.target.value)}>
                <option value="">{crew ? 'Choose your trip…' : 'No trip'}</option>
                {trips.data?.data.map((t) => (
                  <option key={t.id} value={t.id}>{t.tripNo} · {t.originCity} → {t.destinationCity} · {t.vehicle.registrationNo}</option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {!crew && !tripId && (
          <Field label="Vehicle" error={errors.vehicleId} className="sm:col-span-2">
            {(p) => (
              <Select {...p} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="">No vehicle</option>
                {vehicles.data?.data.map((v) => <option key={v.id} value={v.id}>{v.registrationNo}</option>)}
              </Select>
            )}
          </Field>
        )}
        <Field label="Date" required error={errors.expenseDate}>
          {(p) => <Input {...p} type="date" value={date} max={todayIn(tz)} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label="Amount (₹)" required error={errors.amount}>
          {(p) => <Input {...p} type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <Field label="Paid by" required error={errors.paymentMode}>
          {(p) => (
            <Select {...p} value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>
              {modes.map((m) => <option key={m} value={m}>{m === 'driver_paid' && crew ? 'Me, from my own money' : PAYMENT_MODE_LABEL[m]}</option>)}
            </Select>
          )}
        </Field>
        {!crew && mode === 'driver_paid' ? (
          <Field label="Who paid" required error={errors.workerId}>
            {(p) => (
              <Select {...p} value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
                <option value="">{tripId ? 'The trip’s driver' : 'Choose…'}</option>
                {workers.data?.data.map((w) => <option key={w.id} value={w.id}>{w.fullName} ({w.employeeCode})</option>)}
              </Select>
            )}
          </Field>
        ) : (
          <div />
        )}
        <Field label="What was it for" required error={errors.description} className="sm:col-span-2">
          {(p) => <Textarea {...p} value={description} maxLength={255} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Toll at Krishnagiri plaza, both ways" />}
        </Field>
        {uploadAs ? (
          <Field label="Receipt photo or PDF" error={errors.receiptFileId} className="sm:col-span-2" hint="JPG, PNG, WebP or PDF">
            {(p) => (
              <label htmlFor={p.id} className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-line-strong px-3 py-2 text-[13px] hover:bg-canvas">
                <Paperclip className="size-4 text-muted" aria-hidden />
                <span className="truncate">{file ? file.name : 'Attach the receipt'}</span>
                <input id={p.id} aria-describedby={p['aria-describedby']} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            )}
          </Field>
        ) : (
          errors.receiptFileId && <p className="text-xs text-crit-strong sm:col-span-2">{errors.receiptFileId}. Choose the trip so the receipt can be attached to it.</p>
        )}
      </form>
    </Dialog>
  );
}
