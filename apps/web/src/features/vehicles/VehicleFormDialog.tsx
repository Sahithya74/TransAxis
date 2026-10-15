import { useEffect, useState, type FormEvent } from 'react';
import {
  FUEL_TYPES,
  VEHICLE_OWNERSHIP,
  vehicleCreateSchema,
  vehicleUpdateSchema,
  type VehicleDto,
} from '@transaxis/shared';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select, Textarea } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { apiFieldErrors, blankToNull, zodFieldErrors, type FieldErrors } from '../../lib/forms';
import { titleCase } from '../../lib/format';
import { useBranches, useVehicleMutations, useVehicleTypes } from './api';

type FormState = Record<
  | 'registrationNo' | 'vehicleTypeId' | 'branchId' | 'make' | 'model' | 'year' | 'ownership'
  | 'payloadCapacityKg' | 'volumeCapacityCbm' | 'fuelType' | 'odometerKm' | 'fuelEfficiencyKmpl' | 'notes',
  string
>;

const fromVehicle = (v?: VehicleDto): FormState => ({
  registrationNo: v?.registrationNo ?? '',
  vehicleTypeId: v ? String(v.vehicleType.id) : '',
  branchId: v?.branch ? String(v.branch.id) : '',
  make: v?.make ?? '',
  model: v?.model ?? '',
  year: v?.year ? String(v.year) : '',
  ownership: v?.ownership ?? 'owned',
  payloadCapacityKg: v ? String(v.payloadCapacityKg) : '',
  volumeCapacityCbm: v?.volumeCapacityCbm ? String(v.volumeCapacityCbm) : '',
  fuelType: v?.fuelType ?? 'diesel',
  odometerKm: v ? String(v.odometerKm) : '0',
  fuelEfficiencyKmpl: v?.fuelEfficiencyKmpl ? String(v.fuelEfficiencyKmpl) : '',
  notes: v?.notes ?? '',
});

export function VehicleFormDialog({
  open,
  onClose,
  vehicle,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  vehicle?: VehicleDto;
  onSaved?: (v: VehicleDto) => void;
}) {
  const editing = !!vehicle;
  const [form, setForm] = useState<FormState>(() => fromVehicle(vehicle));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const types = useVehicleTypes();
  const branches = useBranches();
  const { create, update } = useVehicleMutations();
  const toast = useToast();
  const dirty = JSON.stringify(form) !== JSON.stringify(fromVehicle(vehicle));

  useEffect(() => {
    if (open) {
      setForm(fromVehicle(vehicle));
      setErrors({});
      setFormError(null);
    }
  }, [open, vehicle]);

  // Warn before losing typed changes on tab close / reload.
  useEffect(() => {
    if (!open || !dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [open, dirty]);

  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const close = () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const payload = blankToNull({ ...form });
    let body: Record<string, unknown>;
    if (editing) {
      // Send only changed fields so concurrent edits to other fields aren't overwritten.
      const original = fromVehicle(vehicle);
      const changed = Object.fromEntries(
        Object.entries(payload).filter(([k]) => form[k as keyof FormState] !== original[k as keyof FormState]),
      );
      const parsed = vehicleUpdateSchema.safeParse(changed);
      if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
      body = changed;
    } else {
      const parsed = vehicleCreateSchema.safeParse(payload);
      if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
      body = payload;
    }
    setErrors({});
    try {
      const saved = editing
        ? await update.mutateAsync({ id: vehicle!.id, body })
        : await create.mutateAsync(body);
      toast.success(editing ? `Saved ${saved.registrationNo}` : `Registered ${saved.registrationNo}`);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      const { fields, message } = apiFieldErrors(err);
      setErrors(fields);
      setFormError(message);
    }
  }

  const pending = create.isPending || update.isPending;

  return (
    <Dialog
      open={open}
      onClose={close}
      width="lg"
      title={editing ? `Edit ${vehicle!.registrationNo}` : 'Register vehicle'}
      description="Capacity and vehicle type are used to check every assignment, so keep them accurate."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="vehicle-form" loading={pending} disabled={editing && !dirty}>
            {editing ? 'Save changes' : 'Register vehicle'}
          </Button>
        </>
      }
    >
      <form id="vehicle-form" onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {formError && (
          <div role="alert" className="rounded border border-crit/30 bg-crit-soft px-3 py-2 text-[13px] text-crit-strong sm:col-span-2">
            {formError}
          </div>
        )}
        <Field label="Registration number" required error={errors.registrationNo} hint="e.g. TN 01 AB 1234">
          {(p) => <Input {...p} mono value={form.registrationNo} onChange={set('registrationNo')} autoComplete="off" />}
        </Field>
        <Field label="Vehicle type" required error={errors.vehicleTypeId}>
          {(p) => (
            <Select {...p} value={form.vehicleTypeId} onChange={set('vehicleTypeId')}>
              <option value="">Select type…</option>
              {types.data?.filter((t) => t.isActive || String(t.id) === form.vehicleTypeId).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.requiredLicenceClass}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Payload capacity (kg)" required error={errors.payloadCapacityKg}>
          {(p) => <Input {...p} inputMode="decimal" value={form.payloadCapacityKg} onChange={set('payloadCapacityKg')} />}
        </Field>
        <Field label="Volume capacity (m³)" error={errors.volumeCapacityCbm}>
          {(p) => <Input {...p} inputMode="decimal" value={form.volumeCapacityCbm} onChange={set('volumeCapacityCbm')} />}
        </Field>
        <Field label="Make" error={errors.make}>
          {(p) => <Input {...p} value={form.make} onChange={set('make')} />}
        </Field>
        <Field label="Model" error={errors.model}>
          {(p) => <Input {...p} value={form.model} onChange={set('model')} />}
        </Field>
        <Field label="Year" error={errors.year}>
          {(p) => <Input {...p} inputMode="numeric" value={form.year} onChange={set('year')} />}
        </Field>
        <Field label="Home branch" error={errors.branchId}>
          {(p) => (
            <Select {...p} value={form.branchId} onChange={set('branchId')}>
              <option value="">None</option>
              {branches.data?.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Ownership" error={errors.ownership}>
          {(p) => (
            <Select {...p} value={form.ownership} onChange={set('ownership')}>
              {VEHICLE_OWNERSHIP.map((o) => <option key={o} value={o}>{titleCase(o)}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Fuel type" error={errors.fuelType}>
          {(p) => (
            <Select {...p} value={form.fuelType} onChange={set('fuelType')}>
              {FUEL_TYPES.map((o) => <option key={o} value={o}>{o === 'cng' || o === 'lng' ? o.toUpperCase() : titleCase(o)}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Odometer (km)" error={errors.odometerKm} hint={editing ? 'Can only increase' : undefined}>
          {(p) => <Input {...p} inputMode="decimal" value={form.odometerKm} onChange={set('odometerKm')} />}
        </Field>
        <Field label="Expected mileage (km/l)" error={errors.fuelEfficiencyKmpl}>
          {(p) => <Input {...p} inputMode="decimal" value={form.fuelEfficiencyKmpl} onChange={set('fuelEfficiencyKmpl')} />}
        </Field>
        <Field label="Notes" error={errors.notes} className="sm:col-span-2">
          {(p) => <Textarea {...p} value={form.notes} onChange={set('notes')} />}
        </Field>
      </form>
    </Dialog>
  );
}
