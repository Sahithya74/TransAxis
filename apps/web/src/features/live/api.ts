import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CheckinDto,
  IncidentDto,
  LiveSummaryDto,
  LiveVehicleDto,
  NotificationDto,
  Paginated,
  SafetyAlertDto,
  TripTrackDto,
} from '@transaxis/shared';
import { api } from '../../lib/api';
import type { LivePosition } from '../../lib/realtime';

/** Live vehicles, with any newer pushed positions merged over the last fetched ones. */
export function useLiveVehicles(enabled = true) {
  const list = useQuery({
    queryKey: ['tracking', 'vehicles'],
    queryFn: ({ signal }) => api<{ data: LiveVehicleDto[]; simulated: boolean }>('/tracking/vehicles', { signal }),
    refetchInterval: 30_000,
    enabled,
  });
  const pushed = useQuery<Map<number, LivePosition>>({ queryKey: ['tracking', 'positions'], queryFn: () => new Map(), staleTime: Infinity, enabled });
  const data = list.data?.data.map((v) => {
    const p = pushed.data?.get(v.vehicleId);
    if (!p || (v.position && Date.parse(v.position.recordedAt) >= Date.parse(p.recordedAt))) return v;
    return {
      ...v,
      freshness: 'live' as const,
      position: { lat: p.lat, lng: p.lng, speedKmph: p.speedKmph, headingDeg: p.headingDeg, recordedAt: p.recordedAt, source: p.isSimulated ? ('simulated' as const) : ('device' as const), isSimulated: p.isSimulated },
    };
  });
  return { ...list, vehicles: data, simulated: list.data?.simulated ?? false };
}

export const useLiveSummary = (enabled = true) =>
  useQuery({ queryKey: ['tracking', 'summary'], queryFn: ({ signal }) => api<LiveSummaryDto>('/tracking/summary', { signal }), refetchInterval: 30_000, enabled });

export const useTripTrack = (tripId: number, enabled = true) =>
  useQuery({ queryKey: ['tracking', 'trip', tripId], queryFn: ({ signal }) => api<TripTrackDto>(`/tracking/trips/${tripId}`, { signal }), refetchInterval: 20_000, enabled });

export const useAlerts = (q: Record<string, string | number | undefined>, opts: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: ['alerts', 'list', q],
    queryFn: ({ signal }) => api<Paginated<SafetyAlertDto>>('/alerts', { query: q, signal }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
    enabled: opts.enabled ?? true,
  });

export const useIncidents = (q: Record<string, string | number | undefined>, enabled = true) =>
  useQuery({
    queryKey: ['incidents', 'list', q],
    queryFn: ({ signal }) => api<Paginated<IncidentDto>>('/incidents', { query: q, signal }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    enabled,
  });

export const useIncident = (id: number) =>
  useQuery({ queryKey: ['incidents', 'detail', id], queryFn: ({ signal }) => api<IncidentDto>(`/incidents/${id}`, { signal }) });

export const useCheckins = (q: { status?: string; tripId?: number }, enabled = true) =>
  useQuery({
    queryKey: ['checkins', q],
    queryFn: ({ signal }) => api<{ data: CheckinDto[] }>('/checkins', { query: q, signal }).then((r) => r.data),
    refetchInterval: 60_000,
    enabled,
  });

export const useColleagues = (permission: string, enabled = true) =>
  useQuery({
    queryKey: ['colleagues', permission],
    queryFn: ({ signal }) => api<{ data: { id: number; fullName: string }[] }>('/reference/users', { query: { permission }, signal }).then((r) => r.data),
    staleTime: 300_000,
    enabled,
  });

export const useNotifications = (q: { unread?: string; page?: number; pageSize?: number }, enabled = true) =>
  useQuery({
    queryKey: ['notifications', q],
    queryFn: ({ signal }) => api<Paginated<NotificationDto> & { unread: number }>('/notifications', { query: q, signal }),
    refetchInterval: 60_000,
    enabled,
  });

export function useSafetyMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    for (const key of ['alerts', 'incidents', 'checkins', 'tracking', 'trips', 'notifications']) void qc.invalidateQueries({ queryKey: [key] });
  };
  return {
    ackAlert: useMutation({ mutationFn: ({ id, note }: { id: number; note?: string }) => api<SafetyAlertDto>(`/alerts/${id}/acknowledge`, { method: 'POST', body: { note } }), onSuccess: refresh }),
    resolveAlert: useMutation({ mutationFn: ({ id, note }: { id: number; note: string }) => api<SafetyAlertDto>(`/alerts/${id}/resolve`, { method: 'POST', body: { note } }), onSuccess: refresh }),
    createIncident: useMutation({ mutationFn: (body: unknown) => api<IncidentDto>('/incidents', { method: 'POST', body }), onSuccess: refresh }),
    changeIncident: useMutation({ mutationFn: ({ id, body }: { id: number; body: unknown }) => api<IncidentDto>(`/incidents/${id}`, { method: 'PATCH', body }), onSuccess: refresh }),
    checkIn: useMutation({ mutationFn: ({ tripId, body }: { tripId: number; body: unknown }) => api<CheckinDto>(`/trips/${tripId}/checkins`, { method: 'POST', body }), onSuccess: refresh }),
    sos: useMutation({
      mutationFn: ({ tripId, body }: { tripId: number; body: unknown }) => api<{ incident: IncidentDto; message: string }>(`/trips/${tripId}/sos`, { method: 'POST', body }),
      onSuccess: refresh,
    }),
  };
}

export function useNotificationMutations() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['notifications'] });
  return {
    read: useMutation({ mutationFn: (id: number) => api<NotificationDto>(`/notifications/${id}/read`, { method: 'POST' }), onSuccess: refresh }),
    acknowledge: useMutation({ mutationFn: (id: number) => api<NotificationDto>(`/notifications/${id}/acknowledge`, { method: 'POST' }), onSuccess: refresh }),
    readAll: useMutation({ mutationFn: () => api<{ updated: number }>('/notifications/read-all', { method: 'POST' }), onSuccess: refresh }),
  };
}
