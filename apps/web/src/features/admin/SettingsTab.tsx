import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Pencil, Plus } from 'lucide-react';
import {
  EXPENSE_ACCOUNT_KEYS,
  ORG_SETTINGS,
  SYSTEM_ACCOUNTS,
  type AdminExpenseCategoryDto,
  type OrgSettingKey,
  type OrgSettingsDto,
} from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, Skeleton } from '../../components/ui/Layout';
import { Table, Th, THead } from '../../components/ui/Table';
import { useToast } from '../../components/ui/Toast';
import { fmtMoney } from '../../lib/format';
import { apiFieldErrors, type FieldErrors } from '../../lib/forms';
import { send, useAdminExpenseCategories, useAdminMutation, useOrgSettings } from './api';

const SETTING_KEYS = Object.keys(ORG_SETTINGS) as OrgSettingKey[];
const PROFILE_FIELDS = ['name', 'legalName', 'gstin', 'addressLine', 'city', 'state', 'timezone'] as const;
type ProfileField = (typeof PROFILE_FIELDS)[number];

function timezones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
}

function SettingsForm({ data }: { data: OrgSettingsDto }) {
  const { can, reloadUser } = useAuth();
  const toast = useToast();
  const editable = can('settings:manage');
  const [profile, setProfile] = useState<Record<ProfileField, string>>(() =>
    Object.fromEntries(PROFILE_FIELDS.map((k) => [k, data.profile[k] ?? ''])) as Record<ProfileField, string>,
  );
  const [rules, setRules] = useState<Record<OrgSettingKey, string>>(() =>
    Object.fromEntries(SETTING_KEYS.map((k) => [k, String(data.settings[k])])) as Record<OrgSettingKey, string>,
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const save = useAdminMutation((body: object) => send<OrgSettingsDto>('/admin/settings', 'PATCH', body));
  const zones = useMemo(timezones, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next: FieldErrors = {};
    if (profile.name.trim().length < 2) next['profile.name'] = 'Enter the organisation name';
    for (const k of SETTING_KEYS) {
      const n = Number(rules[k]);
      const { min, max } = ORG_SETTINGS[k];
      if (!Number.isInteger(n) || n < min || n > max) next[`settings.${k}`] = `Whole number from ${min} to ${max}`;
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    try {
      await save.mutateAsync({
        profile: Object.fromEntries(PROFILE_FIELDS.map((k) => [k, k === 'name' || k === 'timezone' ? profile[k].trim() : profile[k].trim() || null])),
        settings: Object.fromEntries(SETTING_KEYS.map((k) => [k, Number(rules[k])])),
      });
      // The timezone and name in the session come from the profile.
      await reloadUser();
      toast.success('Settings saved');
    } catch (err) {
      const { fields, message } = apiFieldErrors(err);
      setErrors(Object.keys(fields).length ? fields : { _form: message });
    }
  }

  const text = (k: ProfileField, label: string, extra: { hint?: string; mono?: boolean; required?: boolean } = {}) => (
    <Field label={label} error={errors[`profile.${k}`]} hint={extra.hint} required={extra.required}>
      {(p) => <Input {...p} mono={extra.mono} value={profile[k]} disabled={!editable} onChange={(e) => setProfile((v) => ({ ...v, [k]: e.target.value }))} />}
    </Field>
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {errors._form && (
        <p role="alert" className="rounded border border-crit/30 bg-crit-soft px-3 py-2 text-[13px] text-crit-strong">
          {errors._form}
        </p>
      )}
      <Card className="p-5">
        <h2 className="mb-1 text-base">Organisation</h2>
        <p className="mb-4 text-[13px] text-muted">Printed on invoices, lorry receipts and payslips. Code {data.profile.code} · currency {data.profile.currency}.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {text('name', 'Trading name', { required: true })}
          {text('legalName', 'Legal name')}
          {text('gstin', 'GSTIN', { mono: true, hint: '15 characters; leave blank if not registered' })}
          {text('addressLine', 'Address')}
          {text('city', 'City')}
          {text('state', 'State', { hint: 'Used for the GST place-of-supply check' })}
          <Field label="Timezone" error={errors['profile.timezone']} hint="Trip times, reports and “today” use this timezone.">
            {(p) =>
              zones.length ? (
                <Select {...p} value={profile.timezone} disabled={!editable} onChange={(e) => setProfile((v) => ({ ...v, timezone: e.target.value }))}>
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input {...p} value={profile.timezone} disabled={!editable} onChange={(e) => setProfile((v) => ({ ...v, timezone: e.target.value }))} />
              )
            }
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-1 text-base">Rules</h2>
        <p className="mb-4 text-[13px] text-muted">Thresholds the system checks when it warns about documents and assigns crews.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {SETTING_KEYS.map((k) => (
            <Field key={k} label={ORG_SETTINGS[k].label} error={errors[`settings.${k}`]} hint={`${ORG_SETTINGS[k].description} (${ORG_SETTINGS[k].min}–${ORG_SETTINGS[k].max})`}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min={ORG_SETTINGS[k].min}
                  max={ORG_SETTINGS[k].max}
                  value={rules[k]}
                  disabled={!editable}
                  onChange={(e) => setRules((v) => ({ ...v, [k]: e.target.value }))}
                  className="w-28"
                />
              )}
            </Field>
          ))}
        </div>
      </Card>
      {editable && (
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={save.isPending}>
            Save settings
          </Button>
        </div>
      )}
    </form>
  );
}

export function SettingsTab() {
  const settings = useOrgSettings();
  if (settings.isError) return <ErrorState message={apiFieldErrors(settings.error).message} onRetry={() => void settings.refetch()} />;
  if (settings.isPending) return <Skeleton className="h-96" />;
  // Keyed by the saved values so a save (or another admin's change) starts the form afresh.
  return <SettingsForm key={JSON.stringify(settings.data)} data={settings.data} />;
}

// ------------------------------------------------------------------ expense categories

interface CategoryValues {
  name: string;
  accountKey: string;
  isTripExpense: boolean;
  requiresReceiptAbove: string;
  isActive: boolean;
}

function CategoryDialog({ open, category, onClose }: { open: boolean; category: AdminExpenseCategoryDto | null; onClose: () => void }) {
  const toast = useToast();
  const [values, setValues] = useState<CategoryValues>({ name: '', accountKey: 'trip_expense', isTripExpense: true, requiresReceiptAbove: '', isActive: true });
  const [errors, setErrors] = useState<FieldErrors>({});
  const wasOpen = useRef(false);
  const save = useAdminMutation((body: object) =>
    category ? send(`/admin/expense-categories/${category.id}`, 'PUT', body) : send('/admin/expense-categories', 'POST', body),
  );

  useEffect(() => {
    if (open && !wasOpen.current) {
      setErrors({});
      setValues(
        category
          ? {
              name: category.name,
              accountKey: category.accountKey,
              isTripExpense: category.isTripExpense,
              requiresReceiptAbove: category.requiresReceiptAbove ? String(Number(category.requiresReceiptAbove)) : '',
              isActive: category.isActive,
            }
          : { name: '', accountKey: 'trip_expense', isTripExpense: true, requiresReceiptAbove: '', isActive: true },
      );
    }
    wasOpen.current = open;
  }, [open, category]);

  async function submit() {
    const next: FieldErrors = {};
    if (values.name.trim().length < 3) next.name = 'Name the category';
    if (values.requiresReceiptAbove && !(Number(values.requiresReceiptAbove) >= 0)) next.requiresReceiptAbove = 'Enter an amount, or leave blank';
    setErrors(next);
    if (Object.keys(next).length) return;
    try {
      await save.mutateAsync({ ...values, name: values.name.trim(), requiresReceiptAbove: values.requiresReceiptAbove === '' ? null : Number(values.requiresReceiptAbove) });
      toast.success(category ? 'Category saved' : 'Category added');
      onClose();
    } catch (err) {
      const { fields, message } = apiFieldErrors(err);
      setErrors(Object.keys(fields).length ? fields : { _form: message });
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={category ? `Edit ${category.name}` : 'Add an expense category'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {errors._form && (
          <p role="alert" className="text-[13px] text-crit-strong">
            {errors._form}
          </p>
        )}
        <Field label="Name" error={errors.name} required>
          {(p) => <Input {...p} value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} placeholder="e.g. Weighbridge fees" />}
        </Field>
        <Field label="Booked to ledger account" error={errors.accountKey} hint="Approved expenses in this category are posted to this account.">
          {(p) => (
            <Select {...p} value={values.accountKey} onChange={(e) => setValues((v) => ({ ...v, accountKey: e.target.value }))}>
              {EXPENSE_ACCOUNT_KEYS.map((k) => (
                <option key={k} value={k}>
                  {SYSTEM_ACCOUNTS[k].code} · {SYSTEM_ACCOUNTS[k].name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Receipt needed above (₹)" error={errors.requiresReceiptAbove} hint="Leave blank if a receipt is never required.">
          {(p) => (
            <Input
              {...p}
              type="number"
              min={0}
              inputMode="decimal"
              value={values.requiresReceiptAbove}
              onChange={(e) => setValues((v) => ({ ...v, requiresReceiptAbove: e.target.value }))}
              className="w-40"
            />
          )}
        </Field>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={values.isTripExpense} onChange={(e) => setValues((v) => ({ ...v, isTripExpense: e.target.checked }))} />
          Claimed against a trip (counts in trip profit)
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={values.isActive} onChange={(e) => setValues((v) => ({ ...v, isActive: e.target.checked }))} />
          Available for new expenses
        </label>
      </div>
    </Dialog>
  );
}

export function ConfigurationTab() {
  const { can } = useAuth();
  const editable = can('settings:manage');
  const categories = useAdminExpenseCategories();
  const [editing, setEditing] = useState<AdminExpenseCategoryDto | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-base">Expense categories</h2>
          <p className="text-[13px] text-muted">What drivers and staff can claim, where it’s booked, and when a receipt is needed.</p>
        </div>
        {editable && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add category
          </Button>
        )}
      </div>
      {categories.isError ? (
        <ErrorState message={apiFieldErrors(categories.error).message} onRetry={() => void categories.refetch()} />
      ) : categories.isPending ? (
        <Skeleton className="m-4 h-40" />
      ) : categories.data.length === 0 ? (
        <EmptyState title="No categories yet" />
      ) : (
        <Table minWidth={720}>
          <THead>
            <Th>Category</Th>
            <Th>Ledger account</Th>
            <Th>Receipt above</Th>
            <Th>Status</Th>
            <Th className="text-right">Used</Th>
            <Th className="w-14" />
          </THead>
          <tbody>
            {categories.data.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted">{c.isTripExpense ? 'Trip expense' : 'Office or general'}</div>
                </td>
                <td className="px-4 py-2.5 text-muted">
                  {SYSTEM_ACCOUNTS[c.accountKey as keyof typeof SYSTEM_ACCOUNTS]?.name ?? c.accountKey}
                </td>
                <td className="px-4 py-2.5 tabular-nums">{c.requiresReceiptAbove ? fmtMoney(c.requiresReceiptAbove) : 'Never'}</td>
                <td className="px-4 py-2.5">{c.isActive ? <Badge tone="ok">Active</Badge> : <Badge>Retired</Badge>}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{c.used}</td>
                <td className="px-4 py-2.5 text-right">
                  {editable && (
                    <Button size="sm" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                      <Pencil className="size-4" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <CategoryDialog
        open={adding || !!editing}
        category={editing}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
      />
    </Card>
  );
}
