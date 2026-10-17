import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  TYRE_POSITIONS,
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_TYPES,
  type PartDto,
  type ScheduleDto,
  type TyreDto,
  type TyrePosition,
  type WorkOrderDto,
  type WorkOrderPriority,
  type WorkOrderType,
} from '@transaxis/shared';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select, Textarea } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { apiFieldErrors, type FieldErrors } from '../../lib/forms';
import { fmtMoney, fmtNumber } from '../../lib/format';
import { useVendors } from '../parties/api';
import { useVehicles } from '../vehicles/api';
import { send, useMaintenanceMutation, useSchedules } from './api';
import { TYRE_POSITION_LABEL, WO_TYPE_LABEL } from './labels';

type Values = Record<string, string>;

/** Form state that resets only when the dialog opens, so background refetches never wipe typing. */
function useDialogForm(open: boolean, initial: () => Values) {
  const [v, setV] = useState<Values>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    setV(initial());
    setErrors({});
    setMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial values are read once, when opening
  }, [open]);
  const set = (k: string) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const fail = (err: unknown) => {
    const r = apiFieldErrors(err);
    setErrors(r.fields);
    setMessage(Object.keys(r.fields).length ? null : r.message);
  };
  return { v, setV, set, errors, message, fail, clear: () => (setErrors({}), setMessage(null)) };
}

const num = (s: string | undefined) => (s === undefined || s === '' ? undefined : Number(s));
const opt = (s: string | undefined) => (s === undefined || s === '' ? null : Number(s));

function FormDialog({ open, onClose, title, description, submitLabel, busy, onSubmit, message, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  submitLabel: string;
  busy: boolean;
  onSubmit: (e: FormEvent) => void;
  message: string | null;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="mx-form" loading={busy}>{submitLabel}</Button>
        </>
      }
    >
      <form id="mx-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        {message && <div className="sm:col-span-2"><Banner tone="crit" title="Couldn’t save">{message}</Banner></div>}
        {children}
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ work orders

export function WorkOrderDialog({ open, onClose, preset }: { open: boolean; onClose: () => void; preset?: { vehicleId?: number; schedule?: ScheduleDto } }) {
  const toast = useToast();
  const navigate = useNavigate();
  const f = useDialogForm(open, () => ({
    vehicleId: preset?.vehicleId ? String(preset.vehicleId) : preset?.schedule ? String(preset.schedule.vehicle.id) : '',
    woType: preset?.schedule ? 'preventive' : 'breakdown',
    priority: 'normal',
    title: preset?.schedule ? preset.schedule.task : '',
    description: '',
    vendorId: '',
    scheduleId: preset?.schedule ? String(preset.schedule.id) : '',
    odometerKm: '',
  }));
  const vehicles = useVehicles({ page: 1, pageSize: 100, sort: 'registrationNo' }, open);
  const vendors = useVendors({ pageSize: 100, sort: 'name' });
  const schedules = useSchedules({ vehicleId: Number(f.v.vehicleId) || undefined, due: 'all' }, open && !!f.v.vehicleId);
  const create = useMaintenanceMutation((body: unknown) => send<WorkOrderDto>('/maintenance/work-orders', 'POST', body));

  async function submit(e: FormEvent) {
    e.preventDefault();
    f.clear();
    try {
      const wo = await create.mutateAsync({
        vehicleId: num(f.v.vehicleId),
        woType: f.v.woType as WorkOrderType,
        priority: f.v.priority as WorkOrderPriority,
        title: f.v.title!.trim(),
        description: f.v.description!.trim() || null,
        vendorId: opt(f.v.vendorId),
        scheduleId: opt(f.v.scheduleId),
        odometerKm: opt(f.v.odometerKm),
      });
      toast.success(`Work order ${wo.woNo} opened`);
      onClose();
      navigate(`/maintenance/work-orders/${wo.id}`);
    } catch (err) {
      f.fail(err);
    }
  }

  return (
    <FormDialog open={open} onClose={onClose} title="Open a work order" description="Starting the work takes the vehicle off the road until it is completed." submitLabel="Open work order" busy={create.isPending} onSubmit={submit} message={f.message}>
      <Field label="Vehicle" required error={f.errors.vehicleId} className="sm:col-span-2">
        {(p) => (
          <Select {...p} value={f.v.vehicleId} onChange={(e) => f.setV((x) => ({ ...x, vehicleId: e.target.value, scheduleId: '' }))}>
            <option value="">Choose…</option>
            {vehicles.data?.data.map((x) => <option key={x.id} value={x.id}>{x.registrationNo} · {x.vehicleType.name}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Type" required error={f.errors.woType}>
        {(p) => (
          <Select {...p} value={f.v.woType} onChange={f.set('woType')}>
            {WORK_ORDER_TYPES.map((t) => <option key={t} value={t}>{WO_TYPE_LABEL[t]}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Priority" required error={f.errors.priority}>
        {(p) => (
          <Select {...p} value={f.v.priority} onChange={f.set('priority')}>
            {WORK_ORDER_PRIORITIES.map((t) => <option key={t} value={t} className="capitalize">{t[0]!.toUpperCase() + t.slice(1)}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Title" required error={f.errors.title} className="sm:col-span-2">
        {(p) => <Input {...p} value={f.v.title} maxLength={160} onChange={f.set('title')} placeholder="e.g. Clutch slipping on climbs" />}
      </Field>
      <Field label="Details" error={f.errors.description} className="sm:col-span-2">
        {(p) => <Textarea {...p} value={f.v.description} maxLength={2000} onChange={f.set('description')} />}
      </Field>
      {(schedules.data?.length ?? 0) > 0 && (
        <Field label="Scheduled service" error={f.errors.scheduleId} hint="Completing the job resets this schedule">
          {(p) => (
            <Select {...p} value={f.v.scheduleId} onChange={f.set('scheduleId')}>
              <option value="">Not a scheduled service</option>
              {schedules.data!.map((s) => <option key={s.id} value={s.id}>{s.task}</option>)}
            </Select>
          )}
        </Field>
      )}
      <Field label="Workshop" error={f.errors.vendorId} hint="Leave empty for your own workshop">
        {(p) => (
          <Select {...p} value={f.v.vendorId} onChange={f.set('vendorId')}>
            <option value="">Own workshop</option>
            {vendors.data?.data.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Odometer (km)" error={f.errors.odometerKm} hint="Defaults to the vehicle’s last reading">
        {(p) => <Input {...p} type="number" min="0" value={f.v.odometerKm} onChange={f.set('odometerKm')} />}
      </Field>
    </FormDialog>
  );
}

export function CompleteWorkOrderDialog({ open, onClose, wo }: { open: boolean; onClose: () => void; wo: WorkOrderDto }) {
  const toast = useToast();
  const f = useDialogForm(open, () => ({ odometerKm: wo.odometerKm !== null ? String(wo.odometerKm) : '', paymentMode: wo.vendor ? 'vendor_credit' : 'cash' }));
  const act = useMaintenanceMutation((body: unknown) => send<WorkOrderDto>(`/maintenance/work-orders/${wo.id}/actions`, 'POST', body));
  const hasCost = Number(wo.total) > 0;
  async function submit(e: FormEvent) {
    e.preventDefault();
    f.clear();
    try {
      await act.mutateAsync({ action: 'complete', odometerKm: num(f.v.odometerKm), paymentMode: hasCost ? f.v.paymentMode : undefined });
      toast.success(`${wo.woNo} completed; ${wo.vehicle.registrationNo} is back in service`);
      onClose();
    } catch (err) {
      f.fail(err);
    }
  }
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={`Complete ${wo.woNo}`}
      description={hasCost ? `${fmtMoney(wo.total, true)} is posted to repairs and maintenance; parts come out of stock value.` : 'There are no costs on this job.'}
      submitLabel="Complete job"
      busy={act.isPending}
      onSubmit={submit}
      message={f.message}
    >
      <Field label="Odometer at completion (km)" error={f.errors.odometerKm}>{(p) => <Input {...p} type="number" min="0" value={f.v.odometerKm} onChange={f.set('odometerKm')} />}</Field>
      {hasCost && (
        <Field label="Paid by" required error={f.errors.paymentMode} hint="For the labour and outside costs; parts were already bought">
          {(p) => (
            <Select {...p} value={f.v.paymentMode} onChange={f.set('paymentMode')}>
              <option value="cash">Cash</option>
              <option value="bank">Bank transfer</option>
              <option value="upi">UPI</option>
              <option value="vendor_credit">On the workshop’s credit</option>
            </Select>
          )}
        </Field>
      )}
    </FormDialog>
  );
}

// ------------------------------------------------------------------ schedules

export function ScheduleDialog({ open, onClose, schedule }: { open: boolean; onClose: () => void; schedule?: ScheduleDto }) {
  const toast = useToast();
  const f = useDialogForm(open, () => ({
    vehicleId: schedule ? String(schedule.vehicle.id) : '',
    task: schedule?.task ?? '',
    everyKm: schedule?.everyKm ? String(schedule.everyKm) : '',
    everyDays: schedule?.everyDays ? String(schedule.everyDays) : '',
    lastDoneKm: schedule?.lastDoneKm !== null && schedule?.lastDoneKm !== undefined ? String(schedule.lastDoneKm) : '',
    lastDoneOn: schedule?.lastDoneOn ?? '',
  }));
  const vehicles = useVehicles({ page: 1, pageSize: 100, sort: 'registrationNo' }, open && !schedule);
  const save = useMaintenanceMutation((body: unknown) => send<ScheduleDto>(schedule ? `/maintenance/schedules/${schedule.id}` : '/maintenance/schedules', schedule ? 'PUT' : 'POST', body));
  async function submit(e: FormEvent) {
    e.preventDefault();
    f.clear();
    try {
      await save.mutateAsync({ vehicleId: num(f.v.vehicleId), task: f.v.task!.trim(), everyKm: opt(f.v.everyKm), everyDays: opt(f.v.everyDays), lastDoneKm: opt(f.v.lastDoneKm), lastDoneOn: f.v.lastDoneOn || null });
      toast.success('Service schedule saved');
      onClose();
    } catch (err) {
      f.fail(err);
    }
  }
  return (
    <FormDialog open={open} onClose={onClose} title={schedule ? `Edit ${schedule.task}` : 'Add a service schedule'} description="Due by distance or time, whichever comes first." submitLabel="Save schedule" busy={save.isPending} onSubmit={submit} message={f.message}>
      {schedule ? (
        <p className="text-[13px] sm:col-span-2">Vehicle <span className="font-mono">{schedule.vehicle.registrationNo}</span></p>
      ) : (
        <Field label="Vehicle" required error={f.errors.vehicleId} className="sm:col-span-2">
          {(p) => (
            <Select {...p} value={f.v.vehicleId} onChange={f.set('vehicleId')}>
              <option value="">Choose…</option>
              {vehicles.data?.data.map((x) => <option key={x.id} value={x.id}>{x.registrationNo}</option>)}
            </Select>
          )}
        </Field>
      )}
      <Field label="Task" required error={f.errors.task} className="sm:col-span-2">{(p) => <Input {...p} value={f.v.task} maxLength={120} onChange={f.set('task')} placeholder="e.g. Engine oil and filter" />}</Field>
      <Field label="Every (km)" error={f.errors.everyKm}>{(p) => <Input {...p} type="number" min="0" value={f.v.everyKm} onChange={f.set('everyKm')} />}</Field>
      <Field label="Every (days)" error={f.errors.everyDays}>{(p) => <Input {...p} type="number" min="0" value={f.v.everyDays} onChange={f.set('everyDays')} />}</Field>
      <Field label="Last done at (km)" error={f.errors.lastDoneKm}>{(p) => <Input {...p} type="number" min="0" value={f.v.lastDoneKm} onChange={f.set('lastDoneKm')} />}</Field>
      <Field label="Last done on" error={f.errors.lastDoneOn}>{(p) => <Input {...p} type="date" value={f.v.lastDoneOn} onChange={f.set('lastDoneOn')} />}</Field>
    </FormDialog>
  );
}

// ------------------------------------------------------------------ parts and tyres

export function PartDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const f = useDialogForm(open, () => ({ partNo: '', name: '', unit: 'pcs', reorderLevel: '0', unitCost: '0' }));
  const save = useMaintenanceMutation((body: unknown) => send<PartDto>('/maintenance/parts', 'POST', body));
  async function submit(e: FormEvent) {
    e.preventDefault();
    f.clear();
    try {
      const p = await save.mutateAsync({ partNo: f.v.partNo, name: f.v.name, unit: f.v.unit, reorderLevel: num(f.v.reorderLevel), unitCost: num(f.v.unitCost) });
      toast.success(`${p.name} added; record a purchase to put it in stock`);
      onClose();
    } catch (err) {
      f.fail(err);
    }
  }
  return (
    <FormDialog open={open} onClose={onClose} title="Add a spare part" submitLabel="Add part" busy={save.isPending} onSubmit={submit} message={f.message}>
      <Field label="Part number" required error={f.errors.partNo}>{(p) => <Input {...p} mono value={f.v.partNo} maxLength={40} onChange={f.set('partNo')} />}</Field>
      <Field label="Unit" required error={f.errors.unit}>{(p) => <Input {...p} value={f.v.unit} maxLength={16} onChange={f.set('unit')} />}</Field>
      <Field label="Name" required error={f.errors.name} className="sm:col-span-2">{(p) => <Input {...p} value={f.v.name} maxLength={120} onChange={f.set('name')} />}</Field>
      <Field label="Reorder at" error={f.errors.reorderLevel} hint="Flagged as low stock at or below this">{(p) => <Input {...p} type="number" min="0" value={f.v.reorderLevel} onChange={f.set('reorderLevel')} />}</Field>
      <Field label="Usual unit cost (₹)" error={f.errors.unitCost}>{(p) => <Input {...p} type="number" min="0" step="0.01" value={f.v.unitCost} onChange={f.set('unitCost')} />}</Field>
    </FormDialog>
  );
}

export function PurchaseDialog({ part, onClose }: { part: PartDto | null; onClose: () => void }) {
  const toast = useToast();
  const open = !!part;
  const f = useDialogForm(open, () => ({ quantity: '', unitCost: part ? part.unitCost : '', paymentMode: 'vendor_credit', vendorId: '', note: '' }));
  const vendors = useVendors({ pageSize: 100, sort: 'name' });
  const buy = useMaintenanceMutation((body: unknown) => send<PartDto>(`/maintenance/parts/${part?.id}/purchases`, 'POST', body));
  async function submit(e: FormEvent) {
    e.preventDefault();
    f.clear();
    try {
      const p = await buy.mutateAsync({ quantity: num(f.v.quantity), unitCost: num(f.v.unitCost), paymentMode: f.v.paymentMode, vendorId: opt(f.v.vendorId), note: f.v.note!.trim() || null });
      toast.success(`Stock of ${p.name} is now ${fmtNumber(p.stockQty)} ${p.unit}`);
      onClose();
    } catch (err) {
      f.fail(err);
    }
  }
  return (
    <FormDialog open={open} onClose={onClose} title={`Buy ${part?.name ?? ''}`} description="Stock is valued at the weighted average cost of what you hold." submitLabel="Record purchase" busy={buy.isPending} onSubmit={submit} message={f.message}>
      <Field label={`Quantity (${part?.unit ?? ''})`} required error={f.errors.quantity}>{(p) => <Input {...p} type="number" min="0" step="0.01" value={f.v.quantity} onChange={f.set('quantity')} />}</Field>
      <Field label="Unit cost (₹)" required error={f.errors.unitCost}>{(p) => <Input {...p} type="number" min="0" step="0.01" value={f.v.unitCost} onChange={f.set('unitCost')} />}</Field>
      <Field label="Paid by" required error={f.errors.paymentMode}>
        {(p) => (
          <Select {...p} value={f.v.paymentMode} onChange={f.set('paymentMode')}>
            <option value="vendor_credit">On the supplier’s credit</option>
            <option value="cash">Cash</option>
            <option value="bank">Bank transfer</option>
            <option value="upi">UPI</option>
          </Select>
        )}
      </Field>
      <Field label="Supplier" error={f.errors.vendorId}>
        {(p) => (
          <Select {...p} value={f.v.vendorId} onChange={f.set('vendorId')}>
            <option value="">Not recorded</option>
            {vendors.data?.data.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Note" error={f.errors.note} className="sm:col-span-2">{(p) => <Input {...p} value={f.v.note} maxLength={255} onChange={f.set('note')} placeholder="Bill number, if any" />}</Field>
    </FormDialog>
  );
}

export function TyreDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const f = useDialogForm(open, () => ({ serialNo: '', brand: '', size: '', purchaseCost: '', purchasedOn: '', expectedLifeKm: '' }));
  const save = useMaintenanceMutation((body: unknown) => send<TyreDto>('/maintenance/tyres', 'POST', body));
  async function submit(e: FormEvent) {
    e.preventDefault();
    f.clear();
    try {
      const t = await save.mutateAsync({ serialNo: f.v.serialNo, brand: f.v.brand, size: f.v.size, purchaseCost: opt(f.v.purchaseCost), purchasedOn: f.v.purchasedOn || null, expectedLifeKm: opt(f.v.expectedLifeKm) });
      toast.success(`Tyre ${t.serialNo} added to stock`);
      onClose();
    } catch (err) {
      f.fail(err);
    }
  }
  return (
    <FormDialog open={open} onClose={onClose} title="Add a tyre" submitLabel="Add tyre" busy={save.isPending} onSubmit={submit} message={f.message}>
      <Field label="Serial number" required error={f.errors.serialNo}>{(p) => <Input {...p} mono value={f.v.serialNo} maxLength={40} onChange={f.set('serialNo')} />}</Field>
      <Field label="Brand" required error={f.errors.brand}>{(p) => <Input {...p} value={f.v.brand} maxLength={60} onChange={f.set('brand')} />}</Field>
      <Field label="Size" required error={f.errors.size}>{(p) => <Input {...p} value={f.v.size} maxLength={40} onChange={f.set('size')} placeholder="e.g. 295/80 R22.5" />}</Field>
      <Field label="Expected life (km)" error={f.errors.expectedLifeKm}>{(p) => <Input {...p} type="number" min="0" value={f.v.expectedLifeKm} onChange={f.set('expectedLifeKm')} />}</Field>
      <Field label="Cost (₹)" error={f.errors.purchaseCost}>{(p) => <Input {...p} type="number" min="0" step="0.01" value={f.v.purchaseCost} onChange={f.set('purchaseCost')} />}</Field>
      <Field label="Bought on" error={f.errors.purchasedOn}>{(p) => <Input {...p} type="date" value={f.v.purchasedOn} onChange={f.set('purchasedOn')} />}</Field>
    </FormDialog>
  );
}

export function TyreActionDialog({ tyre, onClose }: { tyre: TyreDto | null; onClose: () => void }) {
  const toast = useToast();
  const open = !!tyre;
  const fitting = tyre?.status !== 'fitted';
  const f = useDialogForm(open, () => ({ vehicleId: '', position: 'FL', odometerKm: '', scrap: '', notes: '' }));
  const vehicles = useVehicles({ page: 1, pageSize: 100, sort: 'registrationNo' }, open && fitting);
  const act = useMaintenanceMutation((body: unknown) => send<TyreDto>(`/maintenance/tyres/${tyre?.id}/actions`, 'POST', body));
  async function submit(e: FormEvent) {
    e.preventDefault();
    f.clear();
    try {
      const t = await act.mutateAsync(
        fitting
          ? { action: 'fit', vehicleId: num(f.v.vehicleId), position: f.v.position as TyrePosition, odometerKm: num(f.v.odometerKm) }
          : { action: 'remove', odometerKm: num(f.v.odometerKm), scrap: f.v.scrap === 'yes', notes: f.v.notes!.trim() || null },
      );
      toast.success(fitting ? `Tyre ${t.serialNo} fitted to ${t.vehicle?.registrationNo}` : `Tyre ${t.serialNo} ${t.status === 'scrapped' ? 'scrapped' : 'removed'} after ${fmtNumber(t.kmRun)} km`);
      onClose();
    } catch (err) {
      f.fail(err);
    }
  }
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={fitting ? `Fit tyre ${tyre?.serialNo ?? ''}` : `Remove tyre ${tyre?.serialNo ?? ''} from ${tyre?.vehicle?.registrationNo ?? ''}`}
      description="The odometer reading is used to work out how far the tyre has run."
      submitLabel={fitting ? 'Fit tyre' : 'Remove tyre'}
      busy={act.isPending}
      onSubmit={submit}
      message={f.message}
    >
      {fitting ? (
        <>
          <Field label="Vehicle" required error={f.errors.vehicleId}>
            {(p) => (
              <Select {...p} value={f.v.vehicleId} onChange={f.set('vehicleId')}>
                <option value="">Choose…</option>
                {vehicles.data?.data.map((x) => <option key={x.id} value={x.id}>{x.registrationNo}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Position" required error={f.errors.position}>
            {(p) => (
              <Select {...p} value={f.v.position} onChange={f.set('position')}>
                {TYRE_POSITIONS.map((x) => <option key={x} value={x}>{TYRE_POSITION_LABEL[x]}</option>)}
              </Select>
            )}
          </Field>
        </>
      ) : (
        <Field label="What next" error={f.errors.scrap}>
          {(p) => (
            <Select {...p} value={f.v.scrap} onChange={f.set('scrap')}>
              <option value="">Keep for reuse or retreading</option>
              <option value="yes">Scrap it</option>
            </Select>
          )}
        </Field>
      )}
      <Field label="Odometer (km)" required error={f.errors.odometerKm}>{(p) => <Input {...p} type="number" min="0" value={f.v.odometerKm} onChange={f.set('odometerKm')} />}</Field>
      {!fitting && <Field label="Notes" error={f.errors.notes} className="sm:col-span-2">{(p) => <Input {...p} value={f.v.notes} maxLength={255} onChange={f.set('notes')} placeholder="e.g. Sidewall cut" />}</Field>}
    </FormDialog>
  );
}
