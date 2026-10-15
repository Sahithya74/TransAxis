import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Paginated,
  VehicleDocumentDto,
  VehicleDto,
  VehicleFleetSummary,
  VehicleTypeDto,
} from '@transaxis/shared';
import { api } from '../../lib/api';

export interface VehicleListParams {
  page: number;
  pageSize: number;
  sort?: string;
  q?: string;
  status?: string;
  vehicleTypeId?: string;
  compliance?: string;
}

export const vehicleKeys = {
  all: ['vehicles'] as const,
  list: (p: VehicleListParams) => ['vehicles', 'list', p] as const,
  detail: (id: number) => ['vehicles', 'detail', id] as const,
  docs: (id: number) => ['vehicles', 'docs', id] as const,
  summary: ['vehicles', 'summary'] as const,
  types: ['vehicle-types'] as const,
  branches: ['branches'] as const,
};

export const useVehicles = (p: VehicleListParams) =>
  useQuery({
    queryKey: vehicleKeys.list(p),
    queryFn: ({ signal }) => api<Paginated<VehicleDto>>('/vehicles', { query: { ...p }, signal }),
    placeholderData: keepPreviousData,
  });

export const useVehicle = (id: number) =>
  useQuery({ queryKey: vehicleKeys.detail(id), queryFn: ({ signal }) => api<VehicleDto>(`/vehicles/${id}`, { signal }) });

export const useVehicleDocuments = (id: number) =>
  useQuery({
    queryKey: vehicleKeys.docs(id),
    queryFn: ({ signal }) => api<{ data: VehicleDocumentDto[] }>(`/vehicles/${id}/documents`, { signal }).then((r) => r.data),
  });

export const useFleetSummary = (enabled = true) =>
  useQuery({
    queryKey: vehicleKeys.summary,
    queryFn: ({ signal }) => api<VehicleFleetSummary>('/vehicles/summary', { signal }),
    enabled,
  });

export const useVehicleTypes = () =>
  useQuery({
    queryKey: vehicleKeys.types,
    queryFn: ({ signal }) => api<{ data: VehicleTypeDto[] }>('/vehicle-types', { signal }).then((r) => r.data),
    staleTime: 5 * 60_000,
  });

export const useBranches = () =>
  useQuery({
    queryKey: vehicleKeys.branches,
    queryFn: ({ signal }) =>
      api<{ data: { id: number; name: string; city: string | null }[] }>('/reference/branches', { signal }).then((r) => r.data),
    staleTime: 5 * 60_000,
  });

/** Any vehicle write invalidates lists, the detail page and the dashboard summary together. */
export function useVehicleMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: vehicleKeys.all });
  return {
    create: useMutation({
      mutationFn: (body: unknown) => api<VehicleDto>('/vehicles', { method: 'POST', body }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: number; body: unknown }) => api<VehicleDto>(`/vehicles/${id}`, { method: 'PATCH', body }),
      onSuccess: refresh,
    }),
    addDoc: useMutation({
      mutationFn: ({ id, body }: { id: number; body: unknown }) =>
        api<VehicleDocumentDto>(`/vehicles/${id}/documents`, { method: 'POST', body }),
      onSuccess: refresh,
    }),
    updateDoc: useMutation({
      mutationFn: ({ id, docId, body }: { id: number; docId: number; body: unknown }) =>
        api<VehicleDocumentDto>(`/vehicles/${id}/documents/${docId}`, { method: 'PUT', body }),
      onSuccess: refresh,
    }),
    deleteDoc: useMutation({
      mutationFn: ({ id, docId }: { id: number; docId: number }) =>
        api<void>(`/vehicles/${id}/documents/${docId}`, { method: 'DELETE' }),
      onSuccess: refresh,
    }),
  };
}
