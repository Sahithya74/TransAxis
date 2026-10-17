import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssignmentCheckDto,
  BookingListItemDto,
  CandidatesDto,
  InspectionChecklistDto,
  OtpIssuedDto,
  Paginated,
  TripDto,
  TripListItemDto,
} from '@transaxis/shared';
import { api } from '../../lib/api';

export const tripKeys = {
  all: ['trips'] as const,
  list: (q: object) => ['trips', 'list', q] as const,
  detail: (id: number) => ['trips', 'detail', id] as const,
  backhaul: (id: number) => ['trips', 'backhaul', id] as const,
  candidates: (q: object) => ['trips', 'candidates', q] as const,
  checklists: ['inspection-checklists'] as const,
};

export const useTrips = (q: Record<string, string | number | undefined>, opts: { enabled?: boolean; refetchInterval?: number } = {}) =>
  useQuery({
    queryKey: tripKeys.list(q),
    queryFn: ({ signal }) => api<Paginated<TripListItemDto>>('/trips', { query: q, signal }),
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
    refetchInterval: opts.refetchInterval,
  });

export const useTrip = (id: number, enabled = true) =>
  useQuery({ queryKey: tripKeys.detail(id), queryFn: ({ signal }) => api<TripDto>(`/trips/${id}`, { signal }), enabled: enabled && id > 0 });

export const useBackhaul = (id: number, enabled: boolean) =>
  useQuery({
    queryKey: tripKeys.backhaul(id),
    queryFn: ({ signal }) => api<{ data: BookingListItemDto[] }>(`/trips/${id}/backhaul`, { signal }).then((r) => r.data),
    enabled,
    staleTime: 60_000,
  });

export interface CandidateQuery {
  bookingId?: number;
  tripId?: number;
  vehicleId?: number;
  plannedStart: string;
  plannedEnd: string;
}

export const useCandidates = (q: CandidateQuery | null) =>
  useQuery({
    queryKey: tripKeys.candidates(q ?? {}),
    queryFn: ({ signal }) => api<CandidatesDto>('/trips/candidates', { query: { ...q }, signal }),
    enabled: !!q && !!q.plannedStart && !!q.plannedEnd && Date.parse(q.plannedEnd) > Date.parse(q.plannedStart),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });

export const checkAssignment = (body: unknown) => api<AssignmentCheckDto>('/trips/check', { method: 'POST', body });

export const useChecklists = () =>
  useQuery({
    queryKey: tripKeys.checklists,
    queryFn: ({ signal }) => api<{ data: InspectionChecklistDto[] }>('/reference/inspection-checklists', { signal }).then((r) => r.data),
    staleTime: 10 * 60_000,
  });

/** Trip writes change bookings, vehicle status and worker availability, so refresh those views too. */
export function useTripMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: tripKeys.all });
    void qc.invalidateQueries({ queryKey: ['bookings'] });
    void qc.invalidateQueries({ queryKey: ['vehicles'] });
    void qc.invalidateQueries({ queryKey: ['workers'] });
  };
  // Refresh after failures too: a wrong OTP still uses up an attempt, and a rejected action may mean stale data.
  const usePost = <T,>(path: string) =>
    useMutation({ mutationFn: ({ id, body }: { id: number; body: unknown }) => api<T>(`/trips/${id}${path}`, { method: 'POST', body }), onSettled: refresh });
  return {
    create: useMutation({ mutationFn: (body: unknown) => api<TripDto>('/trips', { method: 'POST', body }), onSuccess: refresh }),
    reassign: useMutation({
      mutationFn: ({ id, body }: { id: number; body: unknown }) => api<TripDto>(`/trips/${id}/assignment`, { method: 'PUT', body }),
      onSuccess: refresh,
    }),
    act: usePost<{ trip: TripDto; otp?: OtpIssuedDto }>('/actions'),
    reissueOtp: usePost<OtpIssuedDto>('/otp'),
    deliverOtp: usePost<TripDto>('/pod'),
    deliverOverride: usePost<TripDto>('/pod/override'),
    inspect: usePost<TripDto>('/inspections'),
    addEvent: usePost<TripDto>('/events'),
  };
}
