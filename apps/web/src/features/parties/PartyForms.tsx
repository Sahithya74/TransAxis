import { useEffect, useState, type FormEvent } from 'react';
import {
  PARTY_STATUSES,
  RATE_BASES,
  VENDOR_TYPES,
  contactInputSchema,
  customerCreateSchema,
  customerUpdateSchema,
  rateCardInputSchema,
  vendorCreateSchema,
  vendorUpdateSchema,
  type CustomerDto,
  type VendorDto,
} from '@transaxis/shared';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select, Textarea } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { apiFieldErrors, blankToNull, zodFieldErrors, type FieldErrors } from '../../lib/forms';
import { titleCase } from '../../lib/format';
import { useVehicleTypes } from '../vehicles/api';
import { usePartyMutations } from './api';

type Values = Record<string, string>;

/** Shared shell for the small party forms: field errors, server errors, submit state. */
function useForm(initial: Values, open: boolean) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setForm(initial);
      setErrors({});
      setFormError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const fail = (err: unknown) => {
    const r = apiFieldErrors(err);
    setErrors(r.fields);
    setFormError(r.message);
  };
  return { form, set, errors, setErrors, formError, fail };
}

const Alert = ({ text }: { text: string | null }) =>
  text ? <div role="alert" className="rounded border border-crit/30 bg-crit-soft px-3 py-2 text-[13px] text-crit-strong sm:col-span-2">{text}</div> : null;

export function CustomerFormDialog({ open, onClose, customer, onSaved }: { open: boolean; onClose: () => void; customer?: CustomerDto; onSaved?: (c: CustomerDto) => void }) {
  const initial: Values = {
    code: customer?.code ?? '',
    name: customer?.name ?? '',
    legalName: customer?.legalName ?? '',
    gstin: customer?.gstin ?? '',
    pan: customer?.pan ?? '',
    billingAddress: customer?.billingAddress ?? '',
    city: customer?.city ?? '',
    state: customer?.state ?? '',
    pincode: customer?.pincode ?? '',
    phone: customer?.phone ?? '',
    email: customer?.email ?? '',
    paymentTermsDays: String(customer?.paymentTermsDays ?? 30),
    creditLimit: customer?.creditLimit ?? '',
    status: customer?.status ?? 'active',
    notes: customer?.notes ?? '',
  };
  const f = useForm(initial, open);
  const { createCustomer, updateCustomer } = usePartyMutations();
  const toast = useToast();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const values = blankToNull({ ...f.form });
    const body = customer ? Object.fromEntries(Object.entries(values).filter(([k]) => f.form[k] !== initial[k])) : values;
    const parsed = (customer ? customerUpdateSchema : customerCreateSchema).safeParse(body);
    if (!parsed.success) return f.setErrors(zodFieldErrors(parsed.error));
    try {
      const saved = customer ? await updateCustomer.mutateAsync({ id: customer.id, body }) : await createCustomer.mutateAsync(body);
      toast.success(`Saved ${saved.name}`);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      f.fail(err);
    }
  }
  const text = (k: string, label: string, opts: { required?: boolean; mono?: boolean; className?: string; hint?: string } = {}) => (
    <Field label={label} required={opts.required} error={f.errors[k]} className={opts.className} hint={opts.hint}>
      {(p) => <Input {...p} mono={opts.mono} value={f.form[k]} onChange={f.set(k)} />}
    </Field>
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="lg"
      title={customer ? `Edit ${customer.name}` : 'Add customer'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="customer-form" loading={createCustomer.isPending || updateCustomer.isPending}>Save</Button></>}
    >
      <form id="customer-form" onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Alert text={f.formError} />
        {text('name', 'Name', { required: true })}
        {text('code', 'Code', { required: true, mono: true, hint: 'Short unique code, e.g. CCW' })}
        {text('legalName', 'Legal name', { className: 'sm:col-span-2' })}
        {text('gstin', 'GSTIN', { mono: true })}
        {text('pan', 'PAN', { mono: true })}
        {text('billingAddress', 'Billing address', { className: 'sm:col-span-2' })}
        {text('city', 'City')}
        {text('state', 'State')}
        {text('pincode', 'PIN code')}
        {text('phone', 'Phone')}
        {text('email', 'Accounts email')}
        {text('paymentTermsDays', 'Payment terms (days)')}
        {text('creditLimit', 'Credit limit (₹)')}
        <Field label="Status" error={f.errors.status}>
          {(p) => <Select {...p} value={f.form.status} onChange={f.set('status')}>{PARTY_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>}
        </Field>
        <Field label="Notes" error={f.errors.notes} className="sm:col-span-2">{(p) => <Textarea {...p} value={f.form.notes} onChange={f.set('notes')} />}</Field>
      </form>
    </Dialog>
  );
}

export function VendorFormDialog({ open, onClose, vendor }: { open: boolean; onClose: () => void; vendor?: VendorDto }) {
  const initial: Values = {
    code: vendor?.code ?? '',
    name: vendor?.name ?? '',
    vendorType: vendor?.vendorType ?? 'workshop',
    gstin: vendor?.gstin ?? '',
    pan: vendor?.pan ?? '',
    address: vendor?.address ?? '',
    city: vendor?.city ?? '',
    state: vendor?.state ?? '',
    contactName: vendor?.contactName ?? '',
    phone: vendor?.phone ?? '',
    email: vendor?.email ?? '',
    paymentTermsDays: String(vendor?.paymentTermsDays ?? 30),
    status: vendor?.status ?? 'active',
    notes: vendor?.notes ?? '',
  };
  const f = useForm(initial, open);
  const { createVendor, updateVendor } = usePartyMutations();
  const toast = useToast();
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const values = blankToNull({ ...f.form });
    const body = vendor ? Object.fromEntries(Object.entries(values).filter(([k]) => f.form[k] !== initial[k])) : values;
    const parsed = (vendor ? vendorUpdateSchema : vendorCreateSchema).safeParse(body);
    if (!parsed.success) return f.setErrors(zodFieldErrors(parsed.error));
    try {
      const saved = vendor ? await updateVendor.mutateAsync({ id: vendor.id, body }) : await createVendor.mutateAsync(body);
      toast.success(`Saved ${saved.name}`);
      onClose();
    } catch (err) {
      f.fail(err);
    }
  }
  const text = (k: string, label: string, opts: { required?: boolean; mono?: boolean; className?: string } = {}) => (
    <Field label={label} required={opts.required} error={f.errors[k]} className={opts.className}>{(p) => <Input {...p} mono={opts.mono} value={f.form[k]} onChange={f.set(k)} />}</Field>
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="lg"
      title={vendor ? `Edit ${vendor.name}` : 'Add vendor'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="vendor-form" loading={createVendor.isPending || updateVendor.isPending}>Save</Button></>}
    >
      <form id="vendor-form" onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Alert text={f.formError} />
        {text('name', 'Name', { required: true })}
        {text('code', 'Code', { required: true, mono: true })}
        <Field label="Type" required error={f.errors.vendorType}>
          {(p) => <Select {...p} value={f.form.vendorType} onChange={f.set('vendorType')}>{VENDOR_TYPES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>}
        </Field>
        <Field label="Status" error={f.errors.status}>
          {(p) => <Select {...p} value={f.form.status} onChange={f.set('status')}>{PARTY_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>}
        </Field>
        {text('gstin', 'GSTIN', { mono: true })}
        {text('pan', 'PAN', { mono: true })}
        {text('address', 'Address', { className: 'sm:col-span-2' })}
        {text('city', 'City')}
        {text('state', 'State')}
        {text('contactName', 'Contact person')}
        {text('phone', 'Phone')}
        {text('email', 'Email')}
        {text('paymentTermsDays', 'Payment terms (days)')}
      </form>
    </Dialog>
  );
}

export function ContactDialog({ open, onClose, customerId }: { open: boolean; onClose: () => void; customerId: number }) {
  const f = useForm({ name: '', designation: '', phone: '', email: '', isPrimary: '' }, open);
  const { addContact } = usePartyMutations();
  const toast = useToast();
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = contactInputSchema.safeParse({ ...blankToNull({ ...f.form }), isPrimary: f.form.isPrimary === 'yes' });
    if (!parsed.success) return f.setErrors(zodFieldErrors(parsed.error));
    try {
      await addContact.mutateAsync({ id: customerId, body: parsed.data });
      toast.success('Contact added');
      onClose();
    } catch (err) {
      f.fail(err);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Add contact" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="contact-form" loading={addContact.isPending}>Save</Button></>}>
      <form id="contact-form" onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Alert text={f.formError} />
        <Field label="Name" required error={f.errors.name}>{(p) => <Input {...p} value={f.form.name} onChange={f.set('name')} />}</Field>
        <Field label="Designation" error={f.errors.designation}>{(p) => <Input {...p} value={f.form.designation} onChange={f.set('designation')} />}</Field>
        <Field label="Phone" error={f.errors.phone}>{(p) => <Input {...p} value={f.form.phone} onChange={f.set('phone')} />}</Field>
        <Field label="Email" error={f.errors.email}>{(p) => <Input {...p} value={f.form.email} onChange={f.set('email')} />}</Field>
        <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
          <input type="checkbox" checked={f.form.isPrimary === 'yes'} onChange={(e) => f.set('isPrimary')({ target: { value: e.target.checked ? 'yes' : '' } })} />
          Primary contact
        </label>
      </form>
    </Dialog>
  );
}

export function RateCardDialog({ open, onClose, customerId, today }: { open: boolean; onClose: () => void; customerId: number; today: string }) {
  const f = useForm(
    { originCity: '', destinationCity: '', vehicleTypeId: '', rateBasis: 'per_tonne', rate: '', loadingCharge: '0', unloadingCharge: '0', detentionFreeHours: '24', detentionRatePerHour: '0', validFrom: today, validTo: '', notes: '' },
    open,
  );
  const types = useVehicleTypes();
  const { addRateCard } = usePartyMutations();
  const toast = useToast();
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = rateCardInputSchema.safeParse(blankToNull({ ...f.form }));
    if (!parsed.success) return f.setErrors(zodFieldErrors(parsed.error));
    try {
      await addRateCard.mutateAsync({ id: customerId, body: parsed.data });
      toast.success('Rate card added');
      onClose();
    } catch (err) {
      f.fail(err);
    }
  }
  const text = (k: string, label: string, required = false, type = 'text') => (
    <Field label={label} required={required} error={f.errors[k]}>{(p) => <Input {...p} type={type} value={f.form[k]} onChange={f.set(k)} />}</Field>
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="lg"
      title="Add rate card"
      description="Quotes for this customer use the matching active card; a card for a specific vehicle type wins over a generic one."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="rate-form" loading={addRateCard.isPending}>Save</Button></>}
    >
      <form id="rate-form" onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Alert text={f.formError} />
        {text('originCity', 'From city', true)}
        {text('destinationCity', 'To city', true)}
        <Field label="Vehicle type" error={f.errors.vehicleTypeId}>
          {(p) => <Select {...p} value={f.form.vehicleTypeId} onChange={f.set('vehicleTypeId')}><option value="">Any</option>{types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}
        </Field>
        <Field label="Rate basis" required error={f.errors.rateBasis}>
          {(p) => <Select {...p} value={f.form.rateBasis} onChange={f.set('rateBasis')}>{RATE_BASES.map((b) => <option key={b} value={b}>{titleCase(b)}</option>)}</Select>}
        </Field>
        {text('rate', 'Rate (₹)', true)}
        {text('loadingCharge', 'Loading charge (₹)')}
        {text('unloadingCharge', 'Unloading charge (₹)')}
        {text('detentionFreeHours', 'Free hours before detention')}
        {text('detentionRatePerHour', 'Detention ₹/hour')}
        {text('validFrom', 'Valid from', true, 'date')}
        {text('validTo', 'Valid to', false, 'date')}
      </form>
    </Dialog>
  );
}
