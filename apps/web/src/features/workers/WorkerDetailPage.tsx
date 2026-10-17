import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Pencil, Plus, ShieldCheck } from 'lucide-react';
import {
  LICENCE_CLASSES,
  TRAINING_TYPES,
  licenceInputSchema,
  todayIn,
  trainingInputSchema,
  type Paginated,
  type TripListItemDto,
  type WorkerDto,
} from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { LicenceBadge, TripStatusBadge } from '../../components/StatusBadges';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../components/ui/Layout';
import { Table, THead, Th } from '../../components/ui/Table';
import { useToast } from '../../components/ui/Toast';
import { ApiError, api } from '../../lib/api';
import { apiFieldErrors, blankToNull, zodFieldErrors, type FieldErrors } from '../../lib/forms';
import { daysBetween, fmtDate, fmtDateTime, fmtMoney, titleCase } from '../../lib/format';
import { useWorker, useWorkerDocuments, useWorkerMutations, useWorkerTrainings } from './api';
import { WorkerFormDialog } from './WorkerFormDialog';

export function WorkerDetailPage() {
  const id = Number(useParams().id);
  const { can, organization } = useAuth();
  const worker = useWorker(id);
  const [editing, setEditing] = useState(false);
  const [licenceOpen, setLicenceOpen] = useState(false);
  const today = todayIn(organization?.timezone ?? 'Asia/Kolkata');

  if (worker.isError) {
    const nf = worker.error instanceof ApiError && worker.error.status === 404;
    return (
      <Card>
        {nf ? <EmptyState title="Worker not found" action={<Link className="text-primary hover:underline" to="/workers">Back to workforce</Link>} /> : <ErrorState message={(worker.error as Error).message} />}
      </Card>
    );
  }
  const w = worker.data;

  return (
    <div>
      <Link to="/workers" className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden /> Workforce
      </Link>
      <PageHeader
        title={w?.fullName ?? <Skeleton className="h-7 w-56" />}
        subtitle={w && (
          <span className="flex flex-wrap items-center gap-2">
            <span>{w.employeeCode}</span>
            <span>·</span>
            <span>{titleCase(w.workerType)}</span>
            {w.employmentStatus !== 'active' && <Badge tone="crit">{titleCase(w.employmentStatus)}</Badge>}
            {w.onLeaveToday && <Badge tone="warn">On leave today</Badge>}
            {w.hazmatCertified && <Badge tone="info">Hazmat trained</Badge>}
            {w.hasLogin && <Badge tone="neutral">Has app login</Badge>}
          </span>
        )}
        actions={w && can('workers:write') && (
          <Button onClick={() => setEditing(true)}>
            <Pencil className="size-4" aria-hidden /> Edit
          </Button>
        )}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-base">Profile</h2>
          {w ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
              <Item label="Mobile">{w.phone}</Item>
              <Item label="Alternate">{w.altPhone ?? '—'}</Item>
              <Item label="Branch">{w.branch?.name ?? '—'}</Item>
              <Item label="Joined">{fmtDate(w.joinedOn)}</Item>
              <Item label="Pay policy">{w.compensationPolicy?.name ?? '—'}</Item>
              <Item label="Medical valid until">
                {w.medicalValidUntil ? (
                  <span className={w.medicalValidUntil < today ? 'text-crit-strong' : ''}>{fmtDate(w.medicalValidUntil)}</span>
                ) : '—'}
              </Item>
              <Item label="Current assignment" wide>
                {w.currentTrip ? (
                  <Link to={`/trips/${w.currentTrip.id}`} className="inline-flex items-center gap-2 text-primary hover:underline">
                    <span className="font-mono">{w.currentTrip.tripNo}</span> <TripStatusBadge status={w.currentTrip.status} />
                  </Link>
                ) : 'None'}
              </Item>
              {w.sensitive && (
                <>
                  <Item label="Date of birth">{fmtDate(w.sensitive.dateOfBirth)}</Item>
                  <Item label="Blood group">{w.sensitive.bloodGroup ?? '—'}</Item>
                  <Item label="Address" wide>{w.sensitive.address ?? '—'}</Item>
                  <Item label="Emergency contact">
                    {w.sensitive.emergencyContactName ?? '—'}
                    {w.sensitive.emergencyContactRelation && <span className="text-muted"> ({w.sensitive.emergencyContactRelation})</span>}
                  </Item>
                  <Item label="Emergency phone">{w.sensitive.emergencyContactPhone ?? '—'}</Item>
                  <Item label="Base salary">{fmtMoney(w.sensitive.baseMonthlySalary)}/month</Item>
                </>
              )}
            </dl>
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </Card>

        {w?.workerType === 'driver' && <LicenceCard worker={w} today={today} onRenew={() => setLicenceOpen(true)} />}
        {w && <TrainingsCard workerId={w.id} />}
        {w && can('workers:sensitive') && <DocumentsCard workerId={w.id} />}
        {w && can('trips:read') && <RecentTrips worker={w} />}
      </div>

      {w && <WorkerFormDialog open={editing} onClose={() => setEditing(false)} worker={w} />}
      {w && <LicenceDialog open={licenceOpen} onClose={() => setLicenceOpen(false)} worker={w} />}
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

function LicenceCard({ worker, today, onRenew }: { worker: WorkerDto; today: string; onRenew: () => void }) {
  const { can } = useAuth();
  const { verifyLicence } = useWorkerMutations();
  const toast = useToast();
  const l = worker.licence;
  const days = l ? daysBetween(today, l.validUntil) : null;
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base">Driving licence</h2>
        {can('workers:write') && (
          <Button size="sm" onClick={onRenew}>
            <Plus className="size-4" aria-hidden /> {l ? 'Record renewal' : 'Add licence'}
          </Button>
        )}
      </div>
      {!l ? (
        <p className="text-[13px] text-crit-strong">No licence on file. This driver cannot be assigned until one is recorded.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
          <Item label="Licence number"><span className="font-mono">{l.licenceNo}</span></Item>
          <Item label="State">{l.issuingState ?? '—'}</Item>
          <Item label="Classes">{l.classes.join(', ')}</Item>
          <Item label="Valid until">
            <span className="flex items-center gap-2">
              {fmtDate(l.validUntil)} <LicenceBadge state={worker.licenceState} />
            </span>
            {days !== null && days >= 0 && days <= 30 && <span className="text-xs text-warn-strong">{days} days left</span>}
          </Item>
          <Item label="Verification" wide>
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={l.verification === 'verified' ? 'ok' : l.verification === 'rejected' ? 'crit' : 'warn'}>{titleCase(l.verification)}</Badge>
              {l.verifiedOn && <span className="text-xs text-muted">on {fmtDate(l.verifiedOn)}</span>}
              {can('workers:write') && l.verification !== 'verified' && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={verifyLicence.isPending}
                  onClick={async () => {
                    try {
                      await verifyLicence.mutateAsync({ id: worker.id, licenceId: l.id, verification: 'verified' });
                      toast.success('Licence marked as verified');
                    } catch (err) {
                      toast.error(apiFieldErrors(err).message);
                    }
                  }}
                >
                  <ShieldCheck className="size-4" aria-hidden /> Mark verified
                </Button>
              )}
            </span>
          </Item>
        </dl>
      )}
    </Card>
  );
}

function LicenceDialog({ open, onClose, worker }: { open: boolean; onClose: () => void; worker: WorkerDto }) {
  const [form, setForm] = useState({ licenceNo: '', issuingState: worker.licence?.issuingState ?? '', issuedOn: '', validUntil: '', classes: worker.licence?.classes ?? ([] as string[]) });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { addLicence } = useWorkerMutations();
  const toast = useToast();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = blankToNull({ ...form });
    const parsed = licenceInputSchema.safeParse(body);
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    setErrors({});
    try {
      await addLicence.mutateAsync({ id: worker.id, body: parsed.data });
      toast.success('Licence recorded. Verify it before relying on it.');
      onClose();
    } catch (err) {
      const r = apiFieldErrors(err);
      setErrors(r.fields);
      setFormError(r.message);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={worker.licence ? 'Record licence renewal' : 'Add driving licence'}
      description="The new licence becomes current and starts unverified."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="licence-form" loading={addLicence.isPending}>Save licence</Button>
        </>
      }
    >
      <form id="licence-form" onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {formError && <div role="alert" className="rounded border border-crit/30 bg-crit-soft px-3 py-2 text-[13px] text-crit-strong sm:col-span-2">{formError}</div>}
        <Field label="Licence number" required error={errors.licenceNo}>{(p) => <Input {...p} mono value={form.licenceNo} onChange={(e) => setForm({ ...form, licenceNo: e.target.value })} />}</Field>
        <Field label="Issuing state" error={errors.issuingState}>{(p) => <Input {...p} value={form.issuingState} onChange={(e) => setForm({ ...form, issuingState: e.target.value })} />}</Field>
        <Field label="Issued on" error={errors.issuedOn}>{(p) => <Input {...p} type="date" value={form.issuedOn} onChange={(e) => setForm({ ...form, issuedOn: e.target.value })} />}</Field>
        <Field label="Valid until" required error={errors.validUntil}>{(p) => <Input {...p} type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />}</Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-[13px] font-medium">Classes held <span className="text-crit">*</span></legend>
          <div className="flex flex-wrap gap-2">
            {LICENCE_CLASSES.map((c) => (
              <label key={c} className="flex items-center gap-1.5 rounded border border-line px-2 py-1 text-[13px]">
                <input
                  type="checkbox"
                  checked={form.classes.includes(c)}
                  onChange={(e) => setForm({ ...form, classes: e.target.checked ? [...form.classes, c] : form.classes.filter((x) => x !== c) })}
                />
                {c}
              </label>
            ))}
          </div>
          {errors.classes && <p className="mt-1 text-xs text-crit-strong">{errors.classes}</p>}
          <p className="mt-1 text-xs text-muted">Higher transport classes cover lower ones; a trailer endorsement must be selected explicitly.</p>
        </fieldset>
      </form>
    </Dialog>
  );
}

function TrainingsCard({ workerId }: { workerId: number }) {
  const { can } = useAuth();
  const trainings = useWorkerTrainings(workerId);
  const [adding, setAdding] = useState(false);
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-base">Training</h2>
        {can('workers:write') && <Button size="sm" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Add</Button>}
      </div>
      {trainings.data?.length === 0 ? (
        <EmptyState title="No training recorded" />
      ) : (
        <ul className="divide-y divide-line">
          {trainings.data?.map((t) => (
            <li key={t.id} className="flex items-center justify-between px-5 py-2.5 text-[13px]">
              <span className="font-medium">{titleCase(t.trainingType)}</span>
              <span className="text-muted">{fmtDate(t.completedOn)}{t.validUntil ? ` · valid to ${fmtDate(t.validUntil)}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
      <TrainingDialog workerId={workerId} open={adding} onClose={() => setAdding(false)} />
    </Card>
  );
}

function TrainingDialog({ workerId, open, onClose }: { workerId: number; open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ trainingType: 'defensive_driving', completedOn: '', validUntil: '', provider: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const { addTraining } = useWorkerMutations();
  const toast = useToast();
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = trainingInputSchema.safeParse(blankToNull({ ...form }));
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    try {
      await addTraining.mutateAsync({ id: workerId, body: parsed.data });
      toast.success('Training recorded');
      onClose();
    } catch (err) {
      setErrors(apiFieldErrors(err).fields);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Record training" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="training-form" loading={addTraining.isPending}>Save</Button></>}>
      <form id="training-form" onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Training" error={errors.trainingType}>
          {(p) => <Select {...p} value={form.trainingType} onChange={(e) => setForm({ ...form, trainingType: e.target.value })}>{TRAINING_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</Select>}
        </Field>
        <Field label="Provider" error={errors.provider}>{(p) => <Input {...p} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} />}</Field>
        <Field label="Completed on" required error={errors.completedOn}>{(p) => <Input {...p} type="date" value={form.completedOn} onChange={(e) => setForm({ ...form, completedOn: e.target.value })} />}</Field>
        <Field label="Valid until" error={errors.validUntil}>{(p) => <Input {...p} type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />}</Field>
      </form>
    </Dialog>
  );
}

function DocumentsCard({ workerId }: { workerId: number }) {
  const docs = useWorkerDocuments(workerId, true);
  return (
    <Card>
      <div className="border-b border-line px-5 py-3">
        <h2 className="text-base">Personal documents</h2>
        <p className="text-xs text-muted">HR only. Identity numbers should be stored masked.</p>
      </div>
      {docs.data?.length === 0 ? (
        <EmptyState title="No documents" />
      ) : (
        <ul className="divide-y divide-line">
          {docs.data?.map((d) => (
            <li key={d.id} className="flex items-center justify-between px-5 py-2.5 text-[13px]">
              <span className="font-medium">{titleCase(d.docType)}</span>
              <span className="font-mono text-xs text-muted">{d.documentNo ?? '—'}{d.expiresOn ? ` · exp ${fmtDate(d.expiresOn)}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentTrips({ worker }: { worker: WorkerDto }) {
  const trips = useQuery({
    queryKey: ['trips', 'list', { driverId: worker.id, pageSize: 8, sort: '-plannedStart' }],
    queryFn: ({ signal }) => api<Paginated<TripListItemDto>>('/trips', { query: { driverId: worker.id, pageSize: 8, sort: '-plannedStart' }, signal }),
  });
  return (
    <Card className="lg:col-span-2">
      <div className="border-b border-line px-5 py-3"><h2 className="text-base">Recent trips</h2></div>
      {trips.data?.data.length === 0 ? (
        <EmptyState title="No trips yet" />
      ) : (
        <Table minWidth={640}>
          <THead><Th>Trip</Th><Th>Route</Th><Th>Planned start</Th><Th>Status</Th></THead>
          <tbody>
            {trips.data?.data.map((t) => (
              <tr key={t.id} className="border-b border-subtle">
                <td className="h-10 px-4"><Link to={`/trips/${t.id}`} className="font-mono text-primary hover:underline">{t.tripNo}</Link></td>
                <td className="px-4">{t.originCity} → {t.destinationCity}</td>
                <td className="px-4 tabular-nums">{fmtDateTime(t.plannedStart)}</td>
                <td className="px-4"><TripStatusBadge status={t.status} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
