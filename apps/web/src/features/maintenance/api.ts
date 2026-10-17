import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Paginated, PartDto, ScheduleDto, TyreDto, WorkOrderDto } from '@transaxis/shared';
import { api } from '../../lib/api';

type Query = Record<string, string | number | undefined>;
const key = (...parts: unknown[]) => ['maintenance', ...parts] as const;

export interface InsightDto {
  vehicle: { id: number; registrationNo: string };
  signal: string;
  detail: string;
}

export const useWorkOrders = (q: Query, enabled = true) =>
  useQuery({
    queryKey: key('work-orders', q),
    queryFn: ({ signal }) => api<Paginated<WorkOrderDto>>('/maintenance/work-orders', { query: q, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useWorkOrder = (id: number) =>
  useQuery({ queryKey: key('work-order', id), queryFn: ({ signal }) => api<WorkOrderDto>(`/maintenance/work-orders/${id}`, { signal }), enabled: id > 0 });

export const useSchedules = (q: { vehicleId?: number; due?: 'due' | 'all' }, enabled = true) =>
  useQuery({
    queryKey: key('schedules', q),
    queryFn: ({ signal }) => api<{ data: ScheduleDto[] }>('/maintenance/schedules', { query: q, signal }).then((r) => r.data),
    enabled,
  });

export const useParts = (enabled = true) =>
  useQuery({ queryKey: key('parts'), queryFn: ({ signal }) => api<{ data: PartDto[] }>('/maintenance/parts', { signal }).then((r) => r.data), enabled });

export const useTyres = (q: { vehicleId?: number; status?: string }, enabled = true) =>
  useQuery({ queryKey: key('tyres', q), queryFn: ({ signal }) => api<{ data: TyreDto[] }>('/maintenance/tyres', { query: q, signal }).then((r) => r.data), enabled });

export const useInsights = (enabled = true) =>
  useQuery({ queryKey: key('insights'), queryFn: ({ signal }) => api<{ data: InsightDto[] }>('/maintenance/insights', { signal }).then((r) => r.data), enabled, staleTime: 60_000 });

/** Workshop changes move vehicle status, stock and the books, so those views refresh too. */
export function useMaintenanceMutation<V, T = unknown>(fn: (vars: V) => Promise<T>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      for (const k of ['maintenance', 'vehicles', 'finance', 'reports', 'notifications']) void qc.invalidateQueries({ queryKey: [k] });
    },
  });
}

export const send = <T,>(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown) => api<T>(path, { method, body });
