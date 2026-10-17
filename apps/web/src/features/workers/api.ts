import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AttendanceRowDto,
  CompensationPolicyDto,
  LeaveDto,
  LicenceDto,
  Paginated,
  TrainingDto,
  WorkerDocumentDto,
  WorkerDto,
} from '@transaxis/shared';
import { api } from '../../lib/api';

export const workerKeys = {
  all: ['workers'] as const,
  list: (q: object) => ['workers', 'list', q] as const,
  detail: (id: number) => ['workers', 'detail', id] as const,
  sub: (id: number, what: string) => ['workers', 'sub', id, what] as const,
  leave: (q: object) => ['leave', q] as const,
  attendance: (date: string) => ['attendance', date] as const,
  policies: ['compensation-policies'] as const,
};

export const useWorkers = (q: Record<string, string | number | undefined>, enabled = true) =>
  useQuery({
    queryKey: workerKeys.list(q),
    queryFn: ({ signal }) => api<Paginated<WorkerDto>>('/workers', { query: q, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useWorker = (id: number) =>
  useQuery({ queryKey: workerKeys.detail(id), queryFn: ({ signal }) => api<WorkerDto>(`/workers/${id}`, { signal }) });

export const useWorkerLicences = (id: number) =>
  useQuery({ queryKey: workerKeys.sub(id, 'licences'), queryFn: ({ signal }) => api<{ data: LicenceDto[] }>(`/workers/${id}/licences`, { signal }).then((r) => r.data) });

export const useWorkerTrainings = (id: number) =>
  useQuery({ queryKey: workerKeys.sub(id, 'trainings'), queryFn: ({ signal }) => api<{ data: TrainingDto[] }>(`/workers/${id}/trainings`, { signal }).then((r) => r.data) });

export const useWorkerDocuments = (id: number, enabled: boolean) =>
  useQuery({
    queryKey: workerKeys.sub(id, 'documents'),
    queryFn: ({ signal }) => api<{ data: WorkerDocumentDto[] }>(`/workers/${id}/documents`, { signal }).then((r) => r.data),
    enabled,
  });

export const useLeave = (q: Record<string, string | number | undefined>, enabled = true) =>
  useQuery({ queryKey: workerKeys.leave(q), queryFn: ({ signal }) => api<{ data: LeaveDto[] }>('/leave', { query: q, signal }).then((r) => r.data), enabled });

export const useAttendance = (date: string) =>
  useQuery({ queryKey: workerKeys.attendance(date), queryFn: ({ signal }) => api<{ data: AttendanceRowDto[] }>('/attendance', { query: { date }, signal }).then((r) => r.data) });

export const usePolicies = () =>
  useQuery({ queryKey: workerKeys.policies, queryFn: ({ signal }) => api<{ data: CompensationPolicyDto[] }>('/compensation-policies', { signal }).then((r) => r.data), staleTime: 300_000 });

export function useWorkerMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: workerKeys.all });
    void qc.invalidateQueries({ queryKey: ['leave'] });
  };
  return {
    create: useMutation({ mutationFn: (body: unknown) => api<WorkerDto>('/workers', { method: 'POST', body }), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, body }: { id: number; body: unknown }) => api<WorkerDto>(`/workers/${id}`, { method: 'PATCH', body }), onSuccess: refresh }),
    addLicence: useMutation({ mutationFn: ({ id, body }: { id: number; body: unknown }) => api<LicenceDto>(`/workers/${id}/licences`, { method: 'POST', body }), onSuccess: refresh }),
    verifyLicence: useMutation({
      mutationFn: ({ id, licenceId, verification }: { id: number; licenceId: number; verification: 'verified' | 'rejected' }) =>
        api<LicenceDto>(`/workers/${id}/licences/${licenceId}/verification`, { method: 'POST', body: { verification } }),
      onSuccess: refresh,
    }),
    addTraining: useMutation({ mutationFn: ({ id, body }: { id: number; body: unknown }) => api<void>(`/workers/${id}/trainings`, { method: 'POST', body }), onSuccess: refresh }),
    requestLeave: useMutation({ mutationFn: (body: unknown) => api<void>('/leave', { method: 'POST', body }), onSuccess: refresh }),
    decideLeave: useMutation({
      mutationFn: ({ id, decision, note }: { id: number; decision: 'approved' | 'rejected' | 'cancelled'; note?: string }) =>
        api<void>(`/leave/${id}/decision`, { method: 'POST', body: { decision, note } }),
      onSuccess: refresh,
    }),
    saveAttendance: useMutation({
      mutationFn: (body: { workDate: string; entries: { workerId: number; status: string }[] }) => api<void>('/attendance', { method: 'PUT', body }),
      onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: workerKeys.attendance(v.workDate) }),
    }),
  };
}
