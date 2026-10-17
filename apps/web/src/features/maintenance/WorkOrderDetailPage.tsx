import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Ban, CheckCircle2, Play, Trash2 } from 'lucide-react';
import { WORK_ITEM_KINDS, type WorkItemKind, type WorkOrderDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { ReasonDialog } from '../../components/ReasonDialog';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Field';
import { Card, ErrorState, PageHeader, Skeleton } from '../../components/ui/Layout';
import { Table, THead, Th } from '../../components/ui/Table';
import { useToast } from '../../components/ui/Toast';
import { apiFieldErrors, type FieldErrors } from '../../lib/forms';
import { fmtDateTime, fmtMoney, fmtNumber } from '../../lib/format';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { send, useMaintenanceMutation, useParts, useWorkOrder } from './api';
import { CompleteWorkOrderDialog } from './MaintenanceDialogs';
import { PriorityBadge, WO_TYPE_LABEL, WorkOrderStatusBadge } from './labels';

const KIND_LABEL: Record<WorkItemKind, string> = { part: 'Part from stock', labour: 'Labour', other: 'Outside work or other' };

export function WorkOrderDetailPage() {
  const id = Number(useParams().id);
  const { can } = useAuth();
  const tz = useOrgTimezone();
  const toast = useToast();
  const q = useWorkOrder(id);
  const [dialog, setDialog] = useState<'complete' | 'cancel' | null>(null);
  const act = useMaintenanceMutation((body: unknown) => send<WorkOrderDto>(`/maintenance/work-orders/${id}/actions`, 'POST', body));
  const remove = useMaintenanceMutation((itemId: number) => send<WorkOrderDto>(`/maintenance/work-orders/${id}/items/${itemId}`, 'DELETE'));

  if (q.isError) return <Card><ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /></Card>;
  if (!q.data) return <Skeleton className="h-64 w-full" />;
  const wo = q.data;
  const write = can('maintenance:write');
  const editable = write && (wo.status === 'open' || wo.status === 'in_progress');

  const start = () =>
    act.mutateAsync({ action: 'start' }).then(
      () => toast.success(`${wo.vehicle.registrationNo} is now in the workshop`),
      (e: Error) => toast.error(e.message),
    );

  return (
    <div>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3"><span className="font-mono">{wo.woNo}</span> <WorkOrderStatusBadge status={wo.status} /> {wo.priority !== 'normal' && <PriorityBadge priority={wo.priority} />}</span>}
        subtitle={
          <>
            {wo.title} · <Link to={`/vehicles/${wo.vehicle.id}`} className="font-mono text-primary hover:underline">{wo.vehicle.registrationNo}</Link>
          </>
        }
        actions={
          editable && (
            <>
              <Button variant="ghost" onClick={() => setDialog('cancel')}><Ban className="size-4" aria-hidden /> Cancel job</Button>
              {wo.status === 'open' && <Button onClick={() => void start()} loading={act.isPending}><Play className="size-4" aria-hidden /> Start work</Button>}
              <Button variant="primary" onClick={() => setDialog('complete')}><CheckCircle2 className="size-4" aria-hidden /> Complete</Button>
            </>
          )
        }
      />
      {wo.status === 'open' && <Banner tone="info" title="Not started">Starting the work marks the vehicle as under maintenance, so it can’t be dispatched until the job is completed.</Banner>}
      {wo.status === 'cancelled' && <Banner tone="warn" title="Cancelled">{wo.cancelReason ?? ''} Parts issued to it went back into stock.</Banner>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <h2 className="border-b border-line px-5 py-3 text-base">Parts and labour</h2>
            <Table minWidth={600}>
              <THead>
                <Th>Item</Th>
                <Th className="text-right">Qty</Th>
                <Th className="text-right">Unit cost</Th>
                <Th className="text-right">Amount</Th>
                {editable && <Th><span className="sr-only">Remove</span></Th>}
              </THead>
              <tbody>
                {wo.items.map((i) => (
                  <tr key={i.id} className="border-b border-subtle">
                    <td className="h-11 px-4">
                      {i.description}
                      <div className="text-xs text-muted">{KIND_LABEL[i.kind]}{i.part ? ` · ${i.part.partNo}` : ''}</div>
                    </td>
                    <td className="px-4 text-right tabular-nums">{fmtNumber(i.quantity)}</td>
                    <td className="px-4 text-right tabular-nums">{fmtMoney(i.unitCost, true)}</td>
                    <td className="px-4 text-right tabular-nums">{fmtMoney(i.amount, true)}</td>
                    {editable && (
                      <td className="px-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove ${i.description}`}
                          loading={remove.isPending && remove.variables === i.id}
                          onClick={() => remove.mutateAsync(i.id).catch((e: Error) => toast.error(e.message))}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
                {wo.items.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-[13px] text-muted">No parts or labour added yet.</td></tr>
                )}
              </tbody>
            </Table>
            {editable && <AddItem wo={wo} />}
          </Card>
          {wo.description && (
            <Card className="p-5 text-[13px]">
              <h2 className="mb-2 text-base">Details</h2>
              <p className="whitespace-pre-line">{wo.description}</p>
            </Card>
          )}
        </div>
        <div className="space-y-5">
          <Card className="p-5 text-[13px]">
            <h2 className="mb-3 text-base">Cost</h2>
            <dl className="space-y-1.5">
              <Row label="Parts" value={fmtMoney(wo.partsCost, true)} />
              <Row label="Labour" value={fmtMoney(wo.labourCost, true)} />
              <Row label="Other" value={fmtMoney(wo.otherCost, true)} />
              <div className="border-t border-line pt-1.5"><Row label="Total" value={fmtMoney(wo.total, true)} strong /></div>
            </dl>
            {wo.status === 'completed' && <p className="mt-3 text-xs text-muted">Posted to repairs and maintenance{wo.paymentMode ? `, paid by ${wo.paymentMode.replace('_', ' ')}` : ''}.</p>}
          </Card>
          <Card className="p-5 text-[13px]">
            <h2 className="mb-3 text-base">Job</h2>
            <Detail label="Type">{WO_TYPE_LABEL[wo.woType]}</Detail>
            {wo.schedule && <Detail label="Scheduled service">{wo.schedule.task}</Detail>}
            <Detail label="Workshop">{wo.vendor?.name ?? 'Own workshop'}</Detail>
            <Detail label="Odometer">{wo.odometerKm !== null ? `${fmtNumber(wo.odometerKm)} km` : '—'}</Detail>
            <Detail label="Opened">{fmtDateTime(wo.openedAt, tz)}{wo.createdBy ? ` by ${wo.createdBy}` : ''}</Detail>
            {wo.startedAt && <Detail label="Started">{fmtDateTime(wo.startedAt, tz)}</Detail>}
            {wo.completedAt && <Detail label="Completed">{fmtDateTime(wo.completedAt, tz)}</Detail>}
            {wo.downtimeHours !== null && <Detail label="Vehicle off the road">{fmtNumber(wo.downtimeHours)} hours</Detail>}
          </Card>
        </div>
      </div>

      <CompleteWorkOrderDialog open={dialog === 'complete'} onClose={() => setDialog(null)} wo={wo} />
      <ReasonDialog
        open={dialog === 'cancel'}
        onClose={() => setDialog(null)}
        title={`Cancel ${wo.woNo}?`}
        description="Parts issued to this job go back into stock, and the vehicle returns to service if it was in the workshop."
        confirmLabel="Cancel job"
        danger
        onConfirm={async (reason) => {
          await act.mutateAsync({ action: 'cancel', reason });
          toast.success(`${wo.woNo} cancelled`);
        }}
      />
    </div>
  );
}

function AddItem({ wo }: { wo: WorkOrderDto }) {
  const toast = useToast();
  const parts = useParts();
  const [v, setV] = useState({ kind: 'part' as WorkItemKind, partId: '', description: '', quantity: '1', unitCost: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const add = useMaintenanceMutation((body: unknown) => send<WorkOrderDto>(`/maintenance/work-orders/${wo.id}/items`, 'POST', body));
  const part = parts.data?.find((p) => String(p.id) === v.partId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    try {
      await add.mutateAsync({
        kind: v.kind,
        partId: v.kind === 'part' && v.partId ? Number(v.partId) : null,
        description: v.description.trim() || part?.name || '',
        quantity: Number(v.quantity),
        unitCost: v.unitCost === '' ? 0 : Number(v.unitCost),
      });
      setV((x) => ({ ...x, partId: '', description: '', quantity: '1', unitCost: '' }));
    } catch (err) {
      const r = apiFieldErrors(err);
      setErrors(r.fields);
      if (!Object.keys(r.fields).length) toast.error(r.message);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-3 border-t border-line bg-canvas p-4 sm:grid-cols-[10rem_1fr_6rem_8rem_auto] sm:items-end">
      <Field label="Add">
        {(p) => (
          <Select {...p} value={v.kind} onChange={(e) => setV((x) => ({ ...x, kind: e.target.value as WorkItemKind, partId: '' }))}>
            {WORK_ITEM_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </Select>
        )}
      </Field>
      {v.kind === 'part' ? (
        <Field label="Part" error={errors.partId ?? errors.description}>
          {(p) => (
            <Select {...p} value={v.partId} onChange={(e) => setV((x) => ({ ...x, partId: e.target.value }))}>
              <option value="">Choose…</option>
              {parts.data?.map((x) => <option key={x.id} value={x.id} disabled={x.stockQty <= 0}>{x.name} ({x.partNo}) · {fmtNumber(x.stockQty)} {x.unit} in stock</option>)}
            </Select>
          )}
        </Field>
      ) : (
        <Field label="Description" error={errors.description}>
          {(p) => <Input {...p} value={v.description} maxLength={160} onChange={(e) => setV((x) => ({ ...x, description: e.target.value }))} placeholder={v.kind === 'labour' ? 'e.g. Mechanic, 3 hours' : 'e.g. Welding at outside shop'} />}
        </Field>
      )}
      <Field label="Qty" error={errors.quantity}>{(p) => <Input {...p} type="number" min="0" step="0.01" value={v.quantity} onChange={(e) => setV((x) => ({ ...x, quantity: e.target.value }))} />}</Field>
      <Field label="Unit cost (₹)" error={errors.unitCost}>
        {(p) => <Input {...p} type="number" min="0" step="0.01" value={v.unitCost} placeholder={part ? part.unitCost : ''} onChange={(e) => setV((x) => ({ ...x, unitCost: e.target.value }))} />}
      </Field>
      <Button type="submit" loading={add.isPending}>Add</Button>
      {v.kind === 'part' && <p className="text-xs text-muted sm:col-span-5">Leave the cost empty to use the stock’s average cost. The part leaves stock now.</p>}
    </form>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'font-semibold' : ''}`}>
      <dt className={strong ? '' : 'text-muted'}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div>{children}</div>
    </div>
  );
}
