import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ChevronLeft, Paperclip, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  MANDATORY_VEHICLE_DOCS,
  MANUAL_VEHICLE_STATUSES,
  VEHICLE_DOC_LABELS,
  VEHICLE_DOC_TYPES,
  todayIn,
  vehicleDocumentInputSchema,
  type VehicleDocumentDto,
  type VehicleDto,
} from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../components/ui/Layout';
import { useToast } from '../../components/ui/Toast';
import { ApiError, downloadFile, uploadFile } from '../../lib/api';

const MAX_SCAN_BYTES = 20 * 1024 * 1024;
import { daysBetween, fmtDate, fmtNumber, fmtWeight, titleCase } from '../../lib/format';
import { apiFieldErrors, blankToNull, zodFieldErrors, type FieldErrors } from '../../lib/forms';
import { useVehicle, useVehicleDocuments, useVehicleMutations } from './api';
import { ComplianceBadge, VEHICLE_STATUS_LABEL, VehicleStatusBadge } from './badges';
import { VehicleFormDialog } from './VehicleFormDialog';

export function VehicleDetailPage() {
  const id = Number(useParams().id);
  const { can, organization } = useAuth();
  const vehicle = useVehicle(id);
  const [editing, setEditing] = useState(false);
  const today = todayIn(organization?.timezone ?? 'Asia/Kolkata');

  if (vehicle.isError) {
    const notFound = vehicle.error instanceof ApiError && vehicle.error.status === 404;
    return (
      <Card>
        {notFound ? (
          <EmptyState title="Vehicle not found" body="It may have been removed, or it belongs to another organisation." action={<Link className="text-primary hover:underline" to="/vehicles">Back to vehicles</Link>} />
        ) : (
          <ErrorState message={(vehicle.error as Error).message} onRetry={() => void vehicle.refetch()} />
        )}
      </Card>
    );
  }

  const v = vehicle.data;
  return (
    <div>
      <Link to="/vehicles" className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden /> Vehicles
      </Link>
      <PageHeader
        title={v ? <span className="font-mono tracking-wide">{v.registrationNo}</span> : <Skeleton className="h-7 w-48" />}
        subtitle={v && (
          <span className="flex flex-wrap items-center gap-2">
            <VehicleStatusBadge status={v.status} />
            <ComplianceBadge compliance={v.compliance} today={today} />
            <span>{v.vehicleType.name}</span>
          </span>
        )}
        actions={v && can('vehicles:write') && (
          <>
            <StatusControl vehicle={v} />
            <Button onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden /> Edit
            </Button>
          </>
        )}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="p-5">
          <h2 className="mb-3 text-base">Specification</h2>
          {v ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
              <Item label="Make / model">{[v.make, v.model].filter(Boolean).join(' ') || '—'}</Item>
              <Item label="Year">{v.year ?? '—'}</Item>
              <Item label="Payload capacity">{fmtWeight(v.payloadCapacityKg)}</Item>
              <Item label="Volume">{v.volumeCapacityCbm ? `${v.volumeCapacityCbm} m³` : '—'}</Item>
              <Item label="Body type">{titleCase(v.vehicleType.bodyType)}</Item>
              <Item label="Licence class required">{v.vehicleType.requiredLicenceClass}</Item>
              <Item label="Ownership">{titleCase(v.ownership)}</Item>
              <Item label="Fuel">{titleCase(v.fuelType)}</Item>
              <Item label="Odometer">{fmtNumber(v.odometerKm)} km</Item>
              <Item label="Expected mileage">{v.fuelEfficiencyKmpl ? `${v.fuelEfficiencyKmpl} km/l` : '—'}</Item>
              <Item label="Home branch">{v.branch?.name ?? '—'}</Item>
              <Item label="Registered on">{fmtDate(v.createdAt)}</Item>
              {v.notes && <Item label="Notes" wide>{v.notes}</Item>}
            </dl>
          ) : (
            <div className="space-y-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-4 w-full" />)}</div>
          )}
        </Card>

        <DocumentsPanel vehicleId={id} today={today} />
      </div>

      {v && <VehicleFormDialog open={editing} onClose={() => setEditing(false)} vehicle={v} />}
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

function StatusControl({ vehicle }: { vehicle: VehicleDto }) {
  const { update } = useVehicleMutations();
  const toast = useToast();
  const lifecycle = vehicle.status === 'assigned' || vehicle.status === 'on_trip';
  return (
    <Select
      aria-label="Change status"
      className="w-auto"
      value={lifecycle ? '' : vehicle.status}
      disabled={lifecycle || update.isPending}
      title={lifecycle ? 'Status is managed by the active trip' : undefined}
      onChange={async (e) => {
        const status = e.target.value;
        if (status === 'retired' && !window.confirm(`Retire ${vehicle.registrationNo}? It will no longer be available for trips.`)) return;
        try {
          await update.mutateAsync({ id: vehicle.id, body: { status } });
          toast.success(`${vehicle.registrationNo} is now ${VEHICLE_STATUS_LABEL[status as keyof typeof VEHICLE_STATUS_LABEL].toLowerCase()}`);
        } catch (err) {
          toast.error(apiFieldErrors(err).message);
        }
      }}
    >
      {lifecycle && <option value="">{VEHICLE_STATUS_LABEL[vehicle.status]} (trip)</option>}
      {MANUAL_VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{VEHICLE_STATUS_LABEL[s]}</option>)}
    </Select>
  );
}

function DocumentsPanel({ vehicleId, today }: { vehicleId: number; today: string }) {
  const { can } = useAuth();
  const docs = useVehicleDocuments(vehicleId);
  const { deleteDoc } = useVehicleMutations();
  const toast = useToast();
  const [editing, setEditing] = useState<VehicleDocumentDto | 'new' | null>(null);
  const canWrite = can('vehicle_documents:write');
  const present = new Set(docs.data?.map((d) => d.docType));
  const missing = MANDATORY_VEHICLE_DOCS.filter((t) => !present.has(t));

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-base">Compliance documents</h2>
        {canWrite && (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden /> Add document
          </Button>
        )}
      </div>
      {missing.length > 0 && docs.data && (
        <div className="border-b border-line bg-crit-soft px-5 py-2 text-[13px] text-crit-strong">
          Missing mandatory: {missing.map((t) => VEHICLE_DOC_LABELS[t]).join(', ')}. The vehicle cannot be dispatched until these are on file.
        </div>
      )}
      {docs.isError ? (
        <ErrorState message={(docs.error as Error).message} onRetry={() => void docs.refetch()} />
      ) : docs.isPending ? (
        <div className="space-y-3 p-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-4 w-full" />)}</div>
      ) : docs.data.length === 0 ? (
        <EmptyState title="No documents on file" body="Add the RC, insurance, fitness, permit and PUC certificates with their expiry dates." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="h-9 px-4 font-semibold">Document</th>
                <th className="h-9 px-4 font-semibold">Number</th>
                <th className="h-9 px-4 font-semibold">Expires</th>
                <th className="h-9 px-4 font-semibold">State</th>
                <th className="h-9 w-28 px-4"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {docs.data.map((d) => {
                const days = d.expiresOn ? daysBetween(today, d.expiresOn) : null;
                return (
                  <tr key={d.id} className="border-b border-subtle">
                    <td className="h-11 px-4 font-medium">{VEHICLE_DOC_LABELS[d.docType]}</td>
                    <td className="px-4 font-mono text-xs text-muted">{d.documentNo ?? '—'}</td>
                    <td className="px-4 tabular-nums">{fmtDate(d.expiresOn)}</td>
                    <td className="px-4">
                      {days === null ? (
                        <Badge tone="neutral">No expiry</Badge>
                      ) : days < 0 ? (
                        <Badge tone="crit">Expired {-days} d ago</Badge>
                      ) : days <= 15 ? (
                        <Badge tone="warn">{days === 0 ? 'Expires today' : `${days} d left`}</Badge>
                      ) : (
                        <Badge tone="ok">Valid</Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 text-right">
                      {d.fileId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Download scan of ${VEHICLE_DOC_LABELS[d.docType]}`}
                          title="Download scan"
                          onClick={() => downloadFile(d.fileId!).catch((err) => toast.error(apiFieldErrors(err).message))}
                        >
                          <Paperclip className="size-3.5" />
                        </Button>
                      )}
                      {canWrite && (
                        <>
                        <Button size="sm" variant="ghost" aria-label={`Edit ${VEHICLE_DOC_LABELS[d.docType]}`} onClick={() => setEditing(d)}>
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Delete ${VEHICLE_DOC_LABELS[d.docType]}`}
                          onClick={async () => {
                            if (!window.confirm(`Delete this ${VEHICLE_DOC_LABELS[d.docType]} record?`)) return;
                            try {
                              await deleteDoc.mutateAsync({ id: vehicleId, docId: d.id });
                              toast.success('Document deleted');
                            } catch (err) {
                              toast.error(apiFieldErrors(err).message);
                            }
                          }}
                        >
                          <Trash2 className="size-3.5 text-crit" />
                        </Button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <DocumentDialog vehicleId={vehicleId} doc={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

function DocumentDialog({ vehicleId, doc, onClose }: { vehicleId: number; doc: VehicleDocumentDto | 'new' | null; onClose: () => void }) {
  const existing = doc && doc !== 'new' ? doc : null;
  const initial = {
    docType: existing?.docType ?? 'insurance',
    documentNo: existing?.documentNo ?? '',
    issuedOn: existing?.issuedOn ?? '',
    expiresOn: existing?.expiresOn ?? '',
    notes: existing?.notes ?? '',
  };
  const [form, setForm] = useState(initial);
  const [scan, setScan] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [lastDoc, setLastDoc] = useState(doc);
  const { addDoc, updateDoc } = useVehicleMutations();
  const toast = useToast();

  // Reset the form whenever a different document is opened.
  if (doc !== lastDoc) {
    setLastDoc(doc);
    setForm(initial);
    setScan(null);
    setErrors({});
    setFormError(null);
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const draft = blankToNull({ ...form, fileId: existing?.fileId ?? null });
    const parsed = vehicleDocumentInputSchema.safeParse(draft);
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    if (scan && scan.size > MAX_SCAN_BYTES) return setErrors({ file: 'The scan is larger than 20 MB' });
    setErrors({});
    setFormError(null);
    try {
      let fileId = draft.fileId;
      if (scan) {
        setUploading(true);
        fileId = (await uploadFile(scan, 'vehicle_document')).id;
      }
      const body = { ...draft, fileId };
      if (existing) await updateDoc.mutateAsync({ id: vehicleId, docId: existing.id, body });
      else await addDoc.mutateAsync({ id: vehicleId, body });
      toast.success(existing ? 'Document updated' : 'Document added');
      onClose();
    } catch (err) {
      const r = apiFieldErrors(err);
      setErrors(r.fields);
      setFormError(r.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog
      open={doc !== null}
      onClose={onClose}
      title={existing ? `Edit ${VEHICLE_DOC_LABELS[existing.docType]}` : 'Add compliance document'}
      description="Renewals: add a new record with the new expiry; the latest expiry for each type is what counts."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="doc-form" loading={uploading || addDoc.isPending || updateDoc.isPending}>
            {uploading ? 'Uploading…' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="doc-form" onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {formError && <div role="alert" className="rounded border border-crit/30 bg-crit-soft px-3 py-2 text-[13px] text-crit-strong sm:col-span-2">{formError}</div>}
        <Field label="Document type" required error={errors.docType}>
          {(p) => (
            <Select {...p} value={form.docType} onChange={set('docType')}>
              {VEHICLE_DOC_TYPES.map((t) => <option key={t} value={t}>{VEHICLE_DOC_LABELS[t]}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Document number" error={errors.documentNo}>
          {(p) => <Input {...p} value={form.documentNo} onChange={set('documentNo')} />}
        </Field>
        <Field label="Issued on" error={errors.issuedOn}>
          {(p) => <Input {...p} type="date" value={form.issuedOn} onChange={set('issuedOn')} />}
        </Field>
        <Field label="Expires on" error={errors.expiresOn} hint="Leave empty for lifetime documents">
          {(p) => <Input {...p} type="date" value={form.expiresOn} onChange={set('expiresOn')} />}
        </Field>
        <Field label="Notes" error={errors.notes} className="sm:col-span-2">
          {(p) => <Input {...p} value={form.notes} onChange={set('notes')} />}
        </Field>
        <Field
          label={existing?.fileId ? 'Replace scan' : 'Attach scan'}
          error={errors.file ?? errors.fileId}
          hint={existing?.fileId ? 'A scan is already attached. Choose a file only to replace it.' : 'PDF, JPG, PNG or WebP, up to 20 MB'}
          className="sm:col-span-2"
        >
          {(p) => (
            <Input
              {...p}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="py-1.5 file:mr-3 file:rounded file:border-0 file:bg-subtle file:px-2 file:py-1 file:text-[13px]"
              onChange={(e) => setScan(e.target.files?.[0] ?? null)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
