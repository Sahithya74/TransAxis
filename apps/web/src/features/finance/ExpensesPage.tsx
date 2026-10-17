import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { Check, Paperclip, Plus, X } from 'lucide-react';
import type { ExpenseDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { ReasonDialog } from '../../components/ReasonDialog';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '../../components/ui/Layout';
import { SortTh, Table, THead, Th, nextSort } from '../../components/ui/Table';
import { Tabs } from '../../components/ui/Tabs';
import { useToast } from '../../components/ui/Toast';
import { downloadFile } from '../../lib/api';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from '../../lib/format';
import { useListParams } from '../../lib/useListParams';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { post, useExpenseCategories, useExpenses, useFinanceMutation } from './api';
import { ExpenseDialog } from './ExpenseDialog';
import { ExpenseStatusBadge, PAYMENT_MODE_LABEL } from './labels';

const TABS = [
  { id: 'submitted', label: 'Awaiting approval' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all', label: 'All' },
];

export function ExpensesPage() {
  const { can } = useAuth();
  const tz = useOrgTimezone();
  const toast = useToast();
  const lp = useListParams(['status', 'categoryId'] as const);
  const [adding, setAdding] = useState(false);
  const [rejecting, setRejecting] = useState<ExpenseDto | null>(null);
  // Decided rows lose their buttons at once, before the list refreshes, so nothing is decided twice.
  const [decided, setDecided] = useState<Set<number>>(new Set());
  const markDecided = (id: number) => setDecided((d) => new Set(d).add(id));
  const approver = can('finance:post');
  const status = lp.values.status ?? (approver ? 'submitted' : 'all');
  const categories = useExpenseCategories();
  const list = useExpenses({ page: lp.page, pageSize: 25, sort: lp.sort, status: status === 'all' ? undefined : status, categoryId: lp.values.categoryId });
  const decide = useFinanceMutation(({ id, decision, reason }: { id: number; decision: 'approve' | 'reject'; reason?: string }) => post<ExpenseDto>(`/finance/expenses/${id}/decision`, { decision, reason }));
  const sortBy = (f: string) => lp.update({ sort: nextSort(lp.sort, f) });

  // Crew keep their claims in the driver app.
  if (can('trips:update_own') && !can('trips:read')) return <Navigate to="/driver/pay" replace />;

  async function approve(e: ExpenseDto) {
    try {
      await decide.mutateAsync({ id: e.id, decision: 'approve' });
      markDecided(e.id);
      toast.success(`Approved ${fmtMoney(e.amount, true)} ${e.category.name}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle={approver ? 'Trip and vehicle expenses claimed by crew and staff. Approving one posts it to the books.' : 'Expenses you have claimed and their approval status'}
        actions={can('finance:post', 'expenses:submit') && <Button variant="primary" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Record expense</Button>}
      />
      <Tabs className="mb-4" active={status} onChange={(t) => lp.update({ status: t === (approver ? 'submitted' : 'all') ? undefined : t })} tabs={TABS} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Select aria-label="Category" className="w-auto" value={lp.values.categoryId ?? ''} onChange={(e) => lp.update({ categoryId: e.target.value || undefined })}>
            <option value="">All categories</option>
            {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        {list.isError ? (
          <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
        ) : (
          <Table minWidth={1000}>
            <THead>
              <SortTh field="expenseDate" label="Date" sort={lp.sort} onSort={sortBy} />
              <Th>Expense</Th>
              <Th>Trip / vehicle</Th>
              <Th>Claimed by</Th>
              <SortTh field="amount" label="Amount" sort={lp.sort} onSort={sortBy} align="right" />
              <Th>Status</Th>
              {approver && <Th><span className="sr-only">Actions</span></Th>}
            </THead>
            <tbody aria-busy={list.isFetching}>
              {list.isPending &&
                Array.from({ length: 8 }, (_, i) => (
                  <tr key={i} className="border-b border-subtle">
                    {Array.from({ length: approver ? 7 : 6 }, (__, j) => <td key={j} className="h-11 px-4"><Skeleton className="h-3.5 w-20" /></td>)}
                  </tr>
                ))}
              {list.data?.data.map((e) => (
                <tr key={e.id} className="border-b border-subtle align-top">
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">{fmtDate(e.expenseDate)}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{e.category.name}</div>
                    <div className="text-muted">{e.description}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                      {PAYMENT_MODE_LABEL[e.paymentMode]}
                      {e.receiptFileId && (
                        <button className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => void downloadFile(e.receiptFileId!, `receipt-${e.id}`)}>
                          <Paperclip className="size-3" aria-hidden /> Receipt
                        </button>
                      )}
                      {e.settled && <span>Reimbursed in a settlement</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {e.trip ? <Link to={`/trips/${e.trip.id}`} className="whitespace-nowrap font-mono text-primary hover:underline">{e.trip.tripNo}</Link> : <span className="text-muted">No trip</span>}
                    {e.vehicle && <div className="font-mono text-xs text-muted">{e.vehicle.registrationNo}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {e.worker?.fullName ?? e.submittedBy ?? '—'}
                    <div className="text-xs text-muted">{fmtDateTime(e.createdAt, tz)}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(e.amount, true)}</td>
                  <td className="px-4 py-3">
                    <ExpenseStatusBadge status={e.status} />
                    {e.status !== 'submitted' && e.decidedBy && <div className="mt-1 text-xs text-muted">by {e.decidedBy}</div>}
                    {e.rejectionReason && <div className="mt-1 max-w-48 text-xs text-crit-strong">{e.rejectionReason}</div>}
                  </td>
                  {approver && (
                    <td className="px-4 py-3">
                      {e.status === 'submitted' && !decided.has(e.id) && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setRejecting(e)} aria-label={`Reject expense ${e.id}`}><X className="size-4" aria-hidden /> Reject</Button>
                          <Button size="sm" onClick={() => void approve(e)} loading={decide.isPending && decide.variables?.id === e.id} aria-label={`Approve expense ${e.id}`}>
                            <Check className="size-4" aria-hidden /> Approve
                          </Button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.data && list.data.data.length === 0 && (
          <EmptyState title={status === 'submitted' ? 'Nothing waiting for approval' : 'No expenses match'} body="Crew add expenses from the driver app; office staff record them here." />
        )}
        {list.data && list.data.meta.total > 0 && (
          <>
            <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={list.data.meta.pageSize} onPage={(p) => lp.update({ page: String(p) })} />
            <p className="px-4 pb-3 text-xs text-muted">{fmtNumber(list.data.meta.total)} expenses.</p>
          </>
        )}
      </Card>
      <ExpenseDialog open={adding} onClose={() => setAdding(false)} />
      <ReasonDialog
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Reject this expense?"
        description={rejecting ? `${fmtMoney(rejecting.amount, true)} ${rejecting.category.name}: ${rejecting.description}. The person who claimed it is told why.` : undefined}
        confirmLabel="Reject"
        danger
        onConfirm={async (reason) => {
          await decide.mutateAsync({ id: rejecting!.id, decision: 'reject', reason });
          markDecided(rejecting!.id);
          toast.success('Expense rejected');
        }}
      />
    </div>
  );
}
