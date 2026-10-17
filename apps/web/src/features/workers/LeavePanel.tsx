import { useState, type FormEvent } from 'react';
import { LEAVE_TYPES, leaveRequestSchema, type LeaveDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Badge, type Tone } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, Skeleton } from '../../components/ui/Layout';
import { Table, THead, Th } from '../../components/ui/Table';
import { useToast } from '../../components/ui/Toast';
import { apiFieldErrors, zodFieldErrors, type FieldErrors } from '../../lib/forms';
import { fmtDate, titleCase } from '../../lib/format';
import { useLeave, useWorkerMutations, useWorkers } from './api';

const tone: Record<LeaveDto['status'], Tone> = { pending: 'warn', approved: 'ok', rejected: 'crit', cancelled: 'neutral' };

export function LeavePanel() {
  const { can } = useAuth();
  const manage = can('attendance:manage');
  const [status, setStatus] = useState<string>('pending');
  const [requesting, setRequesting] = useState(false);
  const leave = useLeave({ status: status || undefined });
  const { decideLeave } = useWorkerMutations();
  const toast = useToast();

  const decide = async (l: LeaveDto, decision: 'approved' | 'rejected' | 'cancelled') => {
    try {
      await decideLeave.mutateAsync({ id: l.id, decision });
      toast.success(`${l.worker.fullName}: leave ${decision}`);
    } catch (err) {
      toast.error(apiFieldErrors(err).message);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <Select aria-label="Leave status" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </Select>
        <span className="flex-1 text-xs text-muted">Approving leave that clashes with a planned trip is refused until the trip is reassigned.</span>
        {manage && <Button size="sm" variant="primary" onClick={() => setRequesting(true)}>Record leave</Button>}
      </div>
      {leave.isError ? (
        <ErrorState message={(leave.error as Error).message} />
      ) : leave.isPending ? (
        <div className="space-y-2 p-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
      ) : leave.data.length === 0 ? (
        <EmptyState title={status === 'pending' ? 'No leave waiting for a decision' : 'No leave records'} />
      ) : (
        <Table minWidth={760}>
          <THead>
            <Th>Worker</Th>
            <Th>Type</Th>
            <Th>Dates</Th>
            <Th>Reason</Th>
            <Th>Status</Th>
            {manage && <Th><span className="sr-only">Actions</span></Th>}
          </THead>
          <tbody>
            {leave.data.map((l) => (
              <tr key={l.id} className="border-b border-subtle">
                <td className="h-11 px-4">
                  <div className="font-medium">{l.worker.fullName}</div>
                  <div className="text-xs text-muted">{l.worker.employeeCode} · {titleCase(l.worker.workerType)}</div>
                </td>
                <td className="px-4">{titleCase(l.leaveType)}</td>
                <td className="px-4 tabular-nums">{fmtDate(l.fromDate)} – {fmtDate(l.toDate)}</td>
                <td className="px-4 text-muted">{l.reason ?? '—'}</td>
                <td className="px-4">
                  <Badge tone={tone[l.status]}>{titleCase(l.status)}</Badge>
                  {l.decidedBy && <div className="text-xs text-muted">by {l.decidedBy}</div>}
                </td>
                {manage && (
                  <td className="whitespace-nowrap px-4 text-right">
                    {l.status === 'pending' && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => void decide(l, 'rejected')}>Reject</Button>
                        <Button size="sm" onClick={() => void decide(l, 'approved')}>Approve</Button>
                      </>
                    )}
                    {l.status === 'approved' && <Button size="sm" variant="ghost" onClick={() => void decide(l, 'cancelled')}>Cancel</Button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <LeaveDialog open={requesting} onClose={() => setRequesting(false)} />
    </Card>
  );
}

function LeaveDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ workerId: '', leaveType: 'casual', fromDate: '', toDate: '', reason: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const workers = useWorkers({ pageSize: 100, status: 'active', sort: 'fullName' });
  const { requestLeave } = useWorkerMutations();
  const toast = useToast();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = leaveRequestSchema.safeParse({ ...form, reason: form.reason || null });
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    setErrors({});
    try {
      await requestLeave.mutateAsync(parsed.data);
      toast.success('Leave recorded as pending');
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
      title="Record leave"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="leave-form" loading={requestLeave.isPending}>Save</Button>
        </>
      }
    >
      <form id="leave-form" onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {formError && <div role="alert" className="rounded border border-crit/30 bg-crit-soft px-3 py-2 text-[13px] text-crit-strong sm:col-span-2">{formError}</div>}
        <Field label="Worker" required error={errors.workerId} className="sm:col-span-2">
          {(p) => (
            <Select {...p} value={form.workerId} onChange={set('workerId')}>
              <option value="">Select…</option>
              {workers.data?.data.map((w) => <option key={w.id} value={w.id}>{w.fullName} ({w.employeeCode})</option>)}
            </Select>
          )}
        </Field>
        <Field label="Type" error={errors.leaveType}>
          {(p) => (
            <Select {...p} value={form.leaveType} onChange={set('leaveType')}>
              {LEAVE_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </Select>
          )}
        </Field>
        <div className="hidden sm:block" />
        <Field label="From" required error={errors.fromDate}>{(p) => <Input {...p} type="date" value={form.fromDate} onChange={set('fromDate')} />}</Field>
        <Field label="To" required error={errors.toDate}>{(p) => <Input {...p} type="date" value={form.toDate} onChange={set('toDate')} />}</Field>
        <Field label="Reason" error={errors.reason} className="sm:col-span-2">{(p) => <Input {...p} value={form.reason} onChange={set('reason')} />}</Field>
      </form>
    </Dialog>
  );
}
