import { useEffect, useState, type FormEvent } from 'react';
import { EMPLOYMENT_STATUSES, WORKER_TYPES, workerCreateSchema, workerUpdateSchema, type WorkerDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select, Textarea } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { apiFieldErrors, blankToNull, zodFieldErrors, type FieldErrors } from '../../lib/forms';
import { titleCase } from '../../lib/format';
import { useBranches } from '../vehicles/api';
import { usePolicies, useWorkerMutations } from './api';

type Form = Record<
  | 'employeeCode' | 'workerType' | 'fullName' | 'phone' | 'altPhone' | 'branchId' | 'employmentStatus' | 'joinedOn'
  | 'compensationPolicyId' | 'medicalValidUntil' | 'notes' | 'dateOfBirth' | 'address' | 'bloodGroup'
  | 'emergencyContactName' | 'emergencyContactPhone' | 'emergencyContactRelation' | 'baseMonthlySalary',
  string
>;

const SENSITIVE: (keyof Form)[] = ['dateOfBirth', 'address', 'bloodGroup', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelation', 'baseMonthlySalary'];

const fromWorker = (w?: WorkerDto): Form => ({
  employeeCode: w?.employeeCode ?? '',
  workerType: w?.workerType ?? 'driver',
  fullName: w?.fullName ?? '',
  phone: w?.phone ?? '',
  altPhone: w?.altPhone ?? '',
  branchId: w?.branch ? String(w.branch.id) : '',
  employmentStatus: w?.employmentStatus ?? 'active',
  joinedOn: w?.joinedOn ?? '',
  compensationPolicyId: w?.compensationPolicy ? String(w.compensationPolicy.id) : '',
  medicalValidUntil: w?.medicalValidUntil ?? '',
  notes: w?.notes ?? '',
  dateOfBirth: w?.sensitive?.dateOfBirth ?? '',
  address: w?.sensitive?.address ?? '',
  bloodGroup: w?.sensitive?.bloodGroup ?? '',
  emergencyContactName: w?.sensitive?.emergencyContactName ?? '',
  emergencyContactPhone: w?.sensitive?.emergencyContactPhone ?? '',
  emergencyContactRelation: w?.sensitive?.emergencyContactRelation ?? '',
  baseMonthlySalary: w?.sensitive?.baseMonthlySalary != null ? String(w.sensitive.baseMonthlySalary) : '',
});

export function WorkerFormDialog({ open, onClose, worker, onSaved }: { open: boolean; onClose: () => void; worker?: WorkerDto; onSaved?: (w: WorkerDto) => void }) {
  const { can } = useAuth();
  const sensitive = can('workers:sensitive');
  const [form, setForm] = useState<Form>(() => fromWorker(worker));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const branches = useBranches();
  const policies = usePolicies();
  const { create, update } = useWorkerMutations();
  const toast = useToast();
  const original = fromWorker(worker);
  const dirty = JSON.stringify(form) !== JSON.stringify(original);

  useEffect(() => {
    if (open) {
      setForm(fromWorker(worker));
      setErrors({});
      setFormError(null);
    }
  }, [open, worker]);

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const close = () => (!dirty || window.confirm('Discard unsaved changes?')) && onClose();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const keys = (Object.keys(form) as (keyof Form)[]).filter((k) => sensitive || !SENSITIVE.includes(k));
    const values = blankToNull(Object.fromEntries(keys.map((k) => [k, form[k]])));
    const body = worker ? Object.fromEntries(Object.entries(values).filter(([k]) => form[k as keyof Form] !== original[k as keyof Form])) : values;
    const parsed = (worker ? workerUpdateSchema : workerCreateSchema).safeParse(body);
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    setErrors({});
    try {
      const saved = worker ? await update.mutateAsync({ id: worker.id, body }) : await create.mutateAsync(body);
      toast.success(worker ? `Saved ${saved.fullName}` : `Added ${saved.fullName}`);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      const r = apiFieldErrors(err);
      setErrors(r.fields);
      setFormError(r.message);
    }
  }

  const text = (k: keyof Form, label: string, props: { required?: boolean; type?: string; hint?: string; mono?: boolean; className?: string } = {}) => (
    <Field label={label} required={props.required} error={errors[k]} hint={props.hint} className={props.className}>
      {(p) => <Input {...p} type={props.type ?? 'text'} mono={props.mono} value={form[k]} onChange={set(k)} />}
    </Field>
  );

  return (
    <Dialog
      open={open}
      onClose={close}
      width="lg"
      title={worker ? `Edit ${worker.fullName}` : 'Add worker'}
      description={sensitive ? 'Personal and pay details are visible only to HR.' : 'Personal and pay details can be added by HR.'}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="worker-form" loading={create.isPending || update.isPending} disabled={!!worker && !dirty}>
            {worker ? 'Save changes' : 'Add worker'}
          </Button>
        </>
      }
    >
      <form id="worker-form" onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {formError && <div role="alert" className="rounded border border-crit/30 bg-crit-soft px-3 py-2 text-[13px] text-crit-strong sm:col-span-2">{formError}</div>}
        {text('fullName', 'Full name', { required: true })}
        {text('employeeCode', 'Employee code', { required: true, mono: true, hint: 'e.g. KRL-DRV-031' })}
        <Field label="Role" required error={errors.workerType}>
          {(p) => (
            <Select {...p} value={form.workerType} onChange={set('workerType')}>
              {WORKER_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Employment status" error={errors.employmentStatus}>
          {(p) => (
            <Select {...p} value={form.employmentStatus} onChange={set('employmentStatus')}>
              {EMPLOYMENT_STATUSES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </Select>
          )}
        </Field>
        {text('phone', 'Mobile', { required: true })}
        {text('altPhone', 'Alternate phone')}
        <Field label="Branch" error={errors.branchId}>
          {(p) => (
            <Select {...p} value={form.branchId} onChange={set('branchId')}>
              <option value="">None</option>
              {branches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Pay policy" error={errors.compensationPolicyId}>
          {(p) => (
            <Select {...p} value={form.compensationPolicyId} onChange={set('compensationPolicyId')}>
              <option value="">None</option>
              {policies.data?.filter((x) => x.isActive && x.appliesTo === (form.workerType === 'helper' ? 'helper' : 'driver')).map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </Select>
          )}
        </Field>
        {text('joinedOn', 'Joined on', { type: 'date' })}
        {text('medicalValidUntil', 'Medical fitness valid until', { type: 'date' })}
        {sensitive && (
          <fieldset className="grid grid-cols-1 gap-4 rounded border border-line p-4 sm:col-span-2 sm:grid-cols-2">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">HR only</legend>
            {text('dateOfBirth', 'Date of birth', { type: 'date' })}
            {text('bloodGroup', 'Blood group', { hint: 'e.g. O+' })}
            {text('address', 'Address', { className: 'sm:col-span-2' })}
            {text('emergencyContactName', 'Emergency contact')}
            {text('emergencyContactPhone', 'Emergency phone')}
            {text('emergencyContactRelation', 'Relation')}
            {text('baseMonthlySalary', 'Base monthly salary (₹)')}
          </fieldset>
        )}
        <Field label="Notes" error={errors.notes} className="sm:col-span-2">
          {(p) => <Textarea {...p} value={form.notes} onChange={set('notes')} />}
        </Field>
      </form>
    </Dialog>
  );
}
