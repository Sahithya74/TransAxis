import { useEffect, useState, type FormEvent } from 'react';
import { Copy, KeyRound, Upload } from 'lucide-react';
import { MANUAL_TRIP_EVENTS, type InspectionType, type OtpIssuedDto, type TripDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select, Textarea } from '../../components/ui/Field';
import { Skeleton } from '../../components/ui/Layout';
import { Tabs } from '../../components/ui/Tabs';
import { useToast } from '../../components/ui/Toast';
import { uploadFile } from '../../lib/api';
import { apiFieldErrors, type FieldErrors } from '../../lib/forms';
import { fmtDateTime, fmtNumber } from '../../lib/format';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { useChecklists, useTripMutations } from './api';
import { EVENT_LABEL } from './labels';

const Alert = ({ text }: { text: string | null }) =>
  text ? <div role="alert" className="rounded border border-crit/30 bg-crit-soft px-3 py-2 text-[13px] text-crit-strong">{text}</div> : null;

// ------------------------------------------------------------------ inspection

export function InspectionDialog({ open, onClose, trip, type }: { open: boolean; onClose: () => void; trip: TripDto; type: InspectionType }) {
  const lists = useChecklists();
  const list = lists.data?.find((l) => l.inspectionType === type);
  const [answers, setAnswers] = useState<Record<string, 'pass' | 'fail' | 'na'>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [odometer, setOdometer] = useState('');
  const [seals, setSeals] = useState('');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { inspect } = useTripMutations();
  const toast = useToast();
  useEffect(() => {
    if (open) {
      setAnswers({});
      setNotes({});
      setOdometer('');
      setSeals('');
      setRemarks('');
      setError(null);
    }
  }, [open]);

  const unanswered = list?.items.filter((i) => !answers[i.key]) ?? [];
  const failedCritical = list?.items.filter((i) => i.critical && answers[i.key] === 'fail') ?? [];

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!list) return;
    if (unanswered.length) return setError(`Answer every item (${unanswered.length} left).`);
    try {
      const saved = await inspect.mutateAsync({
        id: trip.id,
        body: {
          inspectionType: type,
          odometer: odometer || undefined,
          items: list.items.map((i) => ({ key: i.key, result: answers[i.key], note: notes[i.key] || null })),
          sealNumbers: seals.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean),
          notes: remarks || null,
        },
      });
      const last = saved.inspections[0];
      if (last?.result === 'fail') toast.error(`Inspection failed on critical items. ${trip.tripNo} cannot be dispatched until they are fixed.`);
      else toast.success(type === 'pre_trip' ? `${trip.tripNo} passed inspection and is ready to dispatch` : 'Post-trip inspection recorded');
      onClose();
    } catch (err) {
      setError(apiFieldErrors(err).message);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="lg"
      title={`${type === 'pre_trip' ? 'Pre-trip' : 'Post-trip'} inspection: ${trip.tripNo}`}
      description={`${trip.vehicle.registrationNo} · ${trip.vehicle.vehicleType}. Any failed critical item fails the inspection.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={failedCritical.length ? 'danger' : 'primary'} type="submit" form="inspection-form" loading={inspect.isPending} disabled={!list}>
            {failedCritical.length ? 'Record failed inspection' : 'Save inspection'}
          </Button>
        </>
      }
    >
      <form id="inspection-form" onSubmit={onSubmit} noValidate className="space-y-4">
        <Alert text={error} />
        {!list ? (
          lists.isPending ? <Skeleton className="h-40 w-full" /> : <p className="text-[13px] text-crit-strong">No active checklist is configured for this inspection.</p>
        ) : (
          <>
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-muted">{list.name}</span>
              <Button size="sm" variant="ghost" onClick={() => setAnswers(Object.fromEntries(list.items.map((i) => [i.key, answers[i.key] ?? 'pass'])))}>
                Mark the rest as pass
              </Button>
            </div>
            <ul className="divide-y divide-line rounded border border-line">
              {list.items.map((i) => (
                <li key={i.key} className="px-3 py-2 text-[13px]">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="min-w-0 flex-1">
                      {i.label}
                      {i.critical && <span className="ml-1.5 text-xs font-semibold text-crit-strong">critical</span>}
                    </span>
                    <span role="radiogroup" aria-label={i.label} className="flex gap-1">
                      {(['pass', 'fail', 'na'] as const).map((r) => (
                        <label
                          key={r}
                          className={`cursor-pointer rounded border px-2 py-0.5 text-xs font-medium ${
                            answers[i.key] === r
                              ? r === 'pass' ? 'border-ok bg-ok-soft text-ok-strong' : r === 'fail' ? 'border-crit bg-crit-soft text-crit-strong' : 'border-line-strong bg-subtle'
                              : 'border-line text-muted hover:border-line-strong'
                          }`}
                        >
                          <input type="radio" className="sr-only" name={i.key} checked={answers[i.key] === r} onChange={() => setAnswers((a) => ({ ...a, [i.key]: r }))} />
                          {r === 'na' ? 'N/A' : r === 'pass' ? 'Pass' : 'Fail'}
                        </label>
                      ))}
                    </span>
                  </div>
                  {answers[i.key] === 'fail' && (
                    <Input aria-label={`Note for ${i.label}`} placeholder="What is wrong?" className="mt-2" value={notes[i.key] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [i.key]: e.target.value }))} />
                  )}
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Odometer (km)">{(p) => <Input {...p} inputMode="decimal" value={odometer} onChange={(e) => setOdometer(e.target.value)} />}</Field>
              {type === 'pre_trip' && (
                <Field label="Cargo seal numbers" hint="Required for closed, container and reefer bodies. Separate with commas.">
                  {(p) => <Input {...p} mono value={seals} onChange={(e) => setSeals(e.target.value)} />}
                </Field>
              )}
              <Field label="Remarks" className="sm:col-span-2">{(p) => <Textarea {...p} value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={500} />}</Field>
            </div>
          </>
        )}
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ dispatch and OTP

export function OtpNotice({ otp }: { otp: OtpIssuedDto }) {
  const tz = useOrgTimezone();
  const toast = useToast();
  const sent = otp.delivery.status === 'sent';
  return (
    <div className="rounded border border-primary/30 bg-primary-soft p-4 text-[13px]">
      <div className="flex items-center gap-2 font-semibold text-primary-strong"><KeyRound className="size-4" aria-hidden /> Delivery OTP</div>
      <div className="mt-2 flex items-center gap-3">
        <span className="font-mono text-2xl font-semibold tracking-[0.3em]">{otp.otp}</span>
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(otp.otp);
            toast.success('OTP copied');
          }}
        >
          <Copy className="size-3.5" aria-hidden /> Copy
        </Button>
      </div>
      <p className="mt-2 text-muted">
        Valid until {fmtDateTime(otp.expiresAt, tz)}.{' '}
        {sent
          ? `Sent by SMS to ${otp.delivery.to}.`
          : `SMS is not configured, so it was not sent${otp.delivery.to ? ` to ${otp.delivery.to}` : ''}. Share it with the consignee by phone.`}{' '}
        The consignee gives it to the driver only when the goods arrive in good condition. It is shown only once.
      </p>
    </div>
  );
}

export function DispatchDialog({ open, onClose, trip }: { open: boolean; onClose: () => void; trip: TripDto }) {
  const [odometer, setOdometer] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [otp, setOtp] = useState<OtpIssuedDto | null>(null);
  const { act } = useTripMutations();
  const toast = useToast();
  useEffect(() => {
    if (open) {
      setOdometer('');
      setErrors({});
      setError(null);
      setOtp(null);
    }
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!odometer.trim()) return setErrors({ odometer: 'Enter the starting odometer reading' });
    try {
      const r = await act.mutateAsync({ id: trip.id, body: { action: 'dispatch', odometer, version: trip.version } });
      toast.success(`${trip.tripNo} dispatched`);
      if (r.otp) setOtp(r.otp);
      else onClose();
    } catch (err) {
      const x = apiFieldErrors(err);
      setErrors(x.fields);
      setError(x.message);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={otp ? `${trip.tripNo} is on its way` : `Dispatch ${trip.tripNo}`}
      description={otp ? undefined : 'Dispatch re-checks documents, licences and clashes, then starts the trip and issues the delivery OTP.'}
      footer={
        otp ? (
          <Button variant="primary" onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" form="dispatch-form" loading={act.isPending}>Dispatch</Button>
          </>
        )
      }
    >
      {otp ? (
        <OtpNotice otp={otp} />
      ) : (
        <form id="dispatch-form" onSubmit={onSubmit} noValidate className="space-y-4">
          <Alert text={error} />
          <Field label="Starting odometer (km)" required error={errors.odometer} hint={`Vehicle ${trip.vehicle.registrationNo}`}>
            {(p) => <Input {...p} inputMode="decimal" autoFocus value={odometer} onChange={(e) => setOdometer(e.target.value)} />}
          </Field>
        </form>
      )}
    </Dialog>
  );
}

export function ReissueOtpDialog({ open, onClose, trip }: { open: boolean; onClose: () => void; trip: TripDto }) {
  const [otp, setOtp] = useState<OtpIssuedDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { reissueOtp } = useTripMutations();
  useEffect(() => {
    if (open) {
      setOtp(null);
      setError(null);
    }
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Reissue delivery OTP: ${trip.tripNo}`}
      description={otp ? undefined : 'The old OTP stops working and the failed-attempt counter resets.'}
      footer={
        otp ? (
          <Button variant="primary" onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              loading={reissueOtp.isPending}
              onClick={async () => {
                try {
                  setOtp(await reissueOtp.mutateAsync({ id: trip.id, body: {} }));
                } catch (err) {
                  setError(apiFieldErrors(err).message);
                }
              }}
            >
              Issue new OTP
            </Button>
          </>
        )
      }
    >
      {otp ? <OtpNotice otp={otp} /> : <Alert text={error} />}
    </Dialog>
  );
}

// ------------------------------------------------------------------ proof of delivery

export function DeliverDialog({ open, onClose, trip }: { open: boolean; onClose: () => void; trip: TripDto }) {
  const { can } = useAuth();
  const canOverride = can('trips:dispatch');
  const [mode, setMode] = useState<'otp' | 'override'>('otp');
  const [form, setForm] = useState({ recipientName: '', recipientPhone: '', otp: '', reason: '', remarks: '' });
  const [flags, setFlags] = useState({ damageReported: false, shortageReported: false });
  const [sealsIntact, setSealsIntact] = useState<'' | 'yes' | 'no'>('');
  const [photos, setPhotos] = useState<{ id: number; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const { deliverOtp, deliverOverride } = useTripMutations();
  const toast = useToast();
  const hasSeals = trip.seals.length > 0;
  useEffect(() => {
    if (open) {
      setMode(trip.otpActive && trip.otpAttemptsLeft > 0 ? 'otp' : canOverride ? 'override' : 'otp');
      setForm({ recipientName: '', recipientPhone: '', otp: '', reason: '', remarks: '' });
      setFlags({ damageReported: false, shortageReported: false });
      setSealsIntact('');
      setPhotos([]);
      setErrors({});
      setError(null);
    }
  }, [open, trip.otpActive, trip.otpAttemptsLeft, canOverride]);

  async function addPhoto(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const f = await uploadFile(file, 'trip_document', { tripId: trip.id });
      setPhotos((p) => [...p, { id: f.id, name: f.originalName }]);
    } catch (err) {
      setError(apiFieldErrors(err).message);
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const fe: FieldErrors = {};
    if (form.recipientName.trim().length < 2) fe.recipientName = 'Enter who received the goods';
    if (mode === 'otp' && !/^\d{6}$/.test(form.otp.trim())) fe.otp = 'The OTP has 6 digits';
    if (mode === 'override' && form.reason.trim().length < 10) fe.reason = 'Explain why OTP verification is being bypassed (10+ characters)';
    if (mode === 'override' && photos.length === 0) fe.photoFileIds = 'Attach at least one delivery photo';
    if (hasSeals && !sealsIntact) fe.sealsIntact = 'Confirm whether the seals were intact';
    if (Object.keys(fe).length) return setErrors(fe);
    setErrors({});
    const body = {
      recipientName: form.recipientName.trim(),
      recipientPhone: form.recipientPhone.trim() || null,
      remarks: form.remarks.trim() || null,
      ...flags,
      ...(hasSeals ? { sealsIntact: sealsIntact === 'yes' } : {}),
      photoFileIds: photos.map((p) => p.id),
    };
    try {
      if (mode === 'otp') await deliverOtp.mutateAsync({ id: trip.id, body: { ...body, otp: form.otp.trim() } });
      else await deliverOverride.mutateAsync({ id: trip.id, body: { ...body, reason: form.reason.trim() } });
      toast.success(`${trip.tripNo} delivered`);
      onClose();
    } catch (err) {
      const x = apiFieldErrors(err);
      setErrors(x.fields);
      setError(x.message);
    }
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="lg"
      title={`Record delivery: ${trip.tripNo}`}
      description={`${trip.destinationCity}${trip.booking ? ` · ${trip.booking.customerName}` : ''}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="pod-form" loading={deliverOtp.isPending || deliverOverride.isPending}>Confirm delivery</Button>
        </>
      }
    >
      <form id="pod-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {canOverride && (
          <Tabs
            active={mode}
            onChange={(m) => setMode(m as 'otp' | 'override')}
            tabs={[{ id: 'otp', label: 'Consignee OTP' }, { id: 'override', label: 'Authorised override' }]}
          />
        )}
        <Alert text={error} />
        {mode === 'otp' && !trip.otpActive && <p className="text-[13px] text-warn-strong">No valid OTP is active for this trip. Reissue one, or use an authorised override.</p>}
        {mode === 'otp' && trip.otpActive && trip.otpAttemptsLeft < 5 && <p className="text-[13px] text-warn-strong">{trip.otpAttemptsLeft} attempt(s) left before the OTP locks.</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Received by" required error={errors.recipientName}>{(p) => <Input {...p} value={form.recipientName} onChange={set('recipientName')} />}</Field>
          <Field label="Receiver’s phone" error={errors.recipientPhone}>{(p) => <Input {...p} value={form.recipientPhone} onChange={set('recipientPhone')} />}</Field>
          {mode === 'otp' ? (
            <Field label="OTP from the consignee" required error={errors.otp} className="sm:col-span-2">
              {(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="font-mono tracking-[0.3em]" value={form.otp} onChange={set('otp')} />}
            </Field>
          ) : (
            <>
              <Field label="Why can’t the OTP be used?" required error={errors.reason} className="sm:col-span-2">
                {(p) => <Textarea {...p} value={form.reason} onChange={set('reason')} maxLength={255} />}
              </Field>
              <div className="sm:col-span-2">
                <span className="mb-1 block text-[13px] font-medium">Delivery photos <span className="text-crit">*</span></span>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded border border-line px-3 py-1.5 text-[13px] hover:bg-canvas">
                  <Upload className="size-4" aria-hidden /> {uploading ? 'Uploading…' : 'Add photo'}
                  <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" disabled={uploading} onChange={(e) => { void addPhoto(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
                {photos.length > 0 && <p className="mt-1 text-xs text-muted">{photos.map((p) => p.name).join(', ')}</p>}
                {errors.photoFileIds && <p className="mt-1 text-xs text-crit-strong">{errors.photoFileIds}</p>}
              </div>
            </>
          )}
          {hasSeals && (
            <fieldset className="sm:col-span-2">
              <legend className="mb-1 text-[13px] font-medium">Seals {trip.seals.map((x) => x.sealNo).join(', ')} intact? <span className="text-crit">*</span></legend>
              <div className="flex gap-4 text-[13px]">
                <label className="flex items-center gap-1.5"><input type="radio" name="seals" checked={sealsIntact === 'yes'} onChange={() => setSealsIntact('yes')} /> Yes, intact</label>
                <label className="flex items-center gap-1.5"><input type="radio" name="seals" checked={sealsIntact === 'no'} onChange={() => setSealsIntact('no')} /> No, broken or missing</label>
              </div>
              {errors.sealsIntact && <p className="mt-1 text-xs text-crit-strong">{errors.sealsIntact}</p>}
            </fieldset>
          )}
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={flags.damageReported} onChange={(e) => setFlags((f) => ({ ...f, damageReported: e.target.checked }))} /> Damage reported</label>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={flags.shortageReported} onChange={(e) => setFlags((f) => ({ ...f, shortageReported: e.target.checked }))} /> Shortage reported</label>
          <Field label="Remarks" className="sm:col-span-2">{(p) => <Textarea {...p} value={form.remarks} onChange={set('remarks')} maxLength={500} />}</Field>
        </div>
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ completion and milestones

export function CompleteDialog({ open, onClose, trip }: { open: boolean; onClose: () => void; trip: TripDto }) {
  const [odometer, setOdometer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { act } = useTripMutations();
  const toast = useToast();
  useEffect(() => {
    if (open) {
      setOdometer('');
      setError(null);
    }
  }, [open]);
  const run = Number(odometer) - (trip.startOdometer ?? 0);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!odometer.trim()) return setError('Enter the closing odometer reading');
    try {
      await act.mutateAsync({ id: trip.id, body: { action: 'complete', odometer, version: trip.version } });
      toast.success(`${trip.tripNo} completed. The vehicle and crew are free again.`);
      onClose();
    } catch (err) {
      setError(apiFieldErrors(err).message);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Complete ${trip.tripNo}`}
      description="Completing releases the vehicle and crew. Expenses and advances are reconciled afterwards by finance."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="complete-form" loading={act.isPending}>Complete trip</Button></>}
    >
      <form id="complete-form" onSubmit={onSubmit} noValidate>
        <Field
          label="Closing odometer (km)"
          required
          error={error ?? undefined}
          hint={trip.startOdometer != null ? `Started at ${fmtNumber(trip.startOdometer)} km${odometer && run >= 0 ? ` · ${fmtNumber(run)} km run` : ''}` : undefined}
        >
          {(p) => <Input {...p} inputMode="decimal" autoFocus value={odometer} onChange={(e) => setOdometer(e.target.value)} />}
        </Field>
      </form>
    </Dialog>
  );
}

export function MilestoneDialog({ open, onClose, trip }: { open: boolean; onClose: () => void; trip: TripDto }) {
  const [form, setForm] = useState({ eventType: 'checkpoint', stopId: '', odometer: '', note: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const { addEvent } = useTripMutations();
  const toast = useToast();
  useEffect(() => {
    if (open) {
      setForm({ eventType: 'checkpoint', stopId: '', odometer: '', note: '' });
      setErrors({});
      setError(null);
    }
  }, [open]);
  const needsStop = form.eventType === 'arrived_stop' || form.eventType === 'departed_stop';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (needsStop && !form.stopId) return setErrors({ stopId: 'Choose the stop' });
    try {
      await addEvent.mutateAsync({
        id: trip.id,
        body: { eventType: form.eventType, stopId: form.stopId || undefined, odometer: form.odometer || undefined, note: form.note || null },
      });
      toast.success(`${EVENT_LABEL[form.eventType as keyof typeof EVENT_LABEL]} recorded`);
      onClose();
    } catch (err) {
      const x = apiFieldErrors(err);
      setErrors(x.fields);
      setError(x.message);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Record a milestone: ${trip.tripNo}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="milestone-form" loading={addEvent.isPending}>Save</Button></>}
    >
      <form id="milestone-form" onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {error && <div className="sm:col-span-2"><Alert text={error} /></div>}
        <Field label="What happened" required>
          {(p) => (
            <Select {...p} value={form.eventType} onChange={(e) => setForm({ ...form, eventType: e.target.value })}>
              {MANUAL_TRIP_EVENTS.map((t) => <option key={t} value={t}>{EVENT_LABEL[t]}</option>)}
            </Select>
          )}
        </Field>
        {needsStop ? (
          <Field label="Stop" required error={errors.stopId}>
            {(p) => (
              <Select {...p} value={form.stopId} onChange={(e) => setForm({ ...form, stopId: e.target.value })}>
                <option value="">Select…</option>
                {trip.stops.map((s) => <option key={s.id} value={s.id}>{s.seq}. {s.name}</option>)}
              </Select>
            )}
          </Field>
        ) : (
          <Field label="Odometer (km)" error={errors.odometer}>{(p) => <Input {...p} inputMode="decimal" value={form.odometer} onChange={(e) => setForm({ ...form, odometer: e.target.value })} />}</Field>
        )}
        <Field label="Note" className="sm:col-span-2" error={errors.note}>{(p) => <Textarea {...p} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={500} />}</Field>
      </form>
    </Dialog>
  );
}
