import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdvanceDto,
  CrewBalanceDto,
  DeductionDto,
  EarningDto,
  ExpenseCategoryDto,
  ExpenseDto,
  FinanceSummaryDto,
  FuelLogDto,
  FuelVehicleSummaryDto,
  InvoiceDto,
  Paginated,
  ReceiptDto,
  ReportTableDto,
  SettlementDto,
  TripProfitDto,
  UninvoicedBookingDto,
} from '@transaxis/shared';
import { api } from '../../lib/api';

type Query = Record<string, string | number | undefined>;
const key = (...parts: unknown[]) => ['finance', ...parts] as const;
const list = <T,>(path: string, q: Query = {}) => ({ signal }: { signal: AbortSignal }) => api<{ data: T[] }>(path, { query: q, signal }).then((r) => r.data);

export interface TrialBalanceRow {
  id: number;
  code: string;
  name: string;
  type: string;
  key: string | null;
  debit: string;
  credit: string;
  balance: string;
}

export const useFinanceSummary = (from: string, to: string, enabled = true) =>
  useQuery({
    queryKey: key('summary', from, to),
    queryFn: ({ signal }) => api<FinanceSummaryDto>('/finance/summary', { query: { from, to }, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useTrialBalance = (from: string, to: string, enabled = true) =>
  useQuery({ queryKey: key('trial-balance', from, to), queryFn: list<TrialBalanceRow>('/finance/trial-balance', { from, to }), enabled });

// ------------------------------------------------------------------ expenses and fuel

export const useExpenseCategories = (enabled = true) =>
  useQuery({ queryKey: key('expense-categories'), queryFn: list<ExpenseCategoryDto>('/finance/expense-categories'), staleTime: 10 * 60_000, enabled });

export const useExpenses = (q: Query, enabled = true) =>
  useQuery({
    queryKey: key('expenses', q),
    queryFn: ({ signal }) => api<Paginated<ExpenseDto>>('/finance/expenses', { query: q, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useFuelLogs = (q: Query, enabled = true) =>
  useQuery({
    queryKey: key('fuel', q),
    queryFn: ({ signal }) => api<Paginated<FuelLogDto>>('/finance/fuel', { query: q, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useFuelSummary = (from: string, to: string, enabled = true) =>
  useQuery({ queryKey: key('fuel-summary', from, to), queryFn: list<FuelVehicleSummaryDto>('/finance/fuel/summary', { from, to }), placeholderData: keepPreviousData, enabled });

// ------------------------------------------------------------------ invoices and receipts

export type InvoiceList = Paginated<InvoiceDto> & { totals: { total: string; outstanding: string } };

export const useInvoices = (q: Query, enabled = true) =>
  useQuery({
    queryKey: key('invoices', q),
    queryFn: ({ signal }) => api<InvoiceList>('/finance/invoices', { query: q, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useInvoice = (id: number) =>
  useQuery({ queryKey: key('invoice', id), queryFn: ({ signal }) => api<InvoiceDto>(`/finance/invoices/${id}`, { signal }), enabled: id > 0 });

export const useUninvoiced = (customerId?: number, enabled = true) =>
  useQuery({ queryKey: key('uninvoiced', customerId ?? null), queryFn: list<UninvoicedBookingDto>('/finance/invoices/uninvoiced', { customerId }), enabled });

export const useReceipts = (q: Query, enabled = true) =>
  useQuery({
    queryKey: key('receipts', q),
    queryFn: ({ signal }) => api<Paginated<ReceiptDto>>('/finance/receipts', { query: q, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });

// ------------------------------------------------------------------ crew pay

export const useCrewBalances = (enabled = true) => useQuery({ queryKey: key('crew-balances'), queryFn: list<CrewBalanceDto>('/finance/crew/balances'), enabled });

export const useEarnings = (q: Query, enabled = true) => useQuery({ queryKey: key('earnings', q), queryFn: list<EarningDto>('/finance/crew/earnings', q), enabled });

export const useAdvances = (q: Query, enabled = true) => useQuery({ queryKey: key('advances', q), queryFn: list<AdvanceDto>('/finance/crew/advances', q), enabled });

export const useDeductions = (q: Query, enabled = true) => useQuery({ queryKey: key('deductions', q), queryFn: list<DeductionDto>('/finance/crew/deductions', q), enabled });

export const useSettlements = (q: Query, enabled = true) =>
  useQuery({
    queryKey: key('settlements', q),
    queryFn: ({ signal }) => api<Paginated<SettlementDto>>('/finance/settlements', { query: q, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useSettlement = (id: number) =>
  useQuery({ queryKey: key('settlement', id), queryFn: ({ signal }) => api<SettlementDto>(`/finance/settlements/${id}`, { signal }), enabled: id > 0 });

export const useSettlementPreview = (q: { workerId: number; periodFrom: string; periodTo: string } | null) =>
  useQuery({
    queryKey: key('settlement-preview', q),
    queryFn: ({ signal }) => api<SettlementDto>('/finance/settlements/preview', { query: { ...q }, signal }),
    enabled: !!q && q.periodTo >= q.periodFrom,
    placeholderData: keepPreviousData,
  });

// ------------------------------------------------------------------ reports

export const useReport = (reportKey: string, from: string, to: string, enabled = true) =>
  useQuery({
    queryKey: ['reports', reportKey, from, to],
    queryFn: ({ signal }) => api<ReportTableDto>(`/reports/${reportKey}`, { query: { from, to }, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useTripProfitability = (q: { from: string; to: string; vehicleId?: number; customerId?: number }, enabled = true) =>
  useQuery({
    queryKey: ['reports', 'trip-profitability', q],
    queryFn: list<TripProfitDto>('/reports/trip-profitability', q),
    placeholderData: keepPreviousData,
    enabled,
  });

/**
 * Finance writes move balances, booking statuses (invoiced), reports and notifications, so every one of
 * them refreshes those views when it settles, including after a failure that may mean stale data.
 */
export function useFinanceMutation<V, T = unknown>(fn: (vars: V) => Promise<T>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      for (const k of ['finance', 'reports', 'bookings', 'trips', 'notifications', 'maintenance']) void qc.invalidateQueries({ queryKey: [k] });
    },
  });
}

export const post = <T,>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });
