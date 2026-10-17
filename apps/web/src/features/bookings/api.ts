import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookingDto, BookingListItemDto, Paginated } from '@transaxis/shared';
import { api } from '../../lib/api';

export const bookingKeys = {
  all: ['bookings'] as const,
  list: (q: object) => ['bookings', 'list', q] as const,
  detail: (id: number) => ['bookings', 'detail', id] as const,
};

export const useBookings = (q: Record<string, string | number | undefined>, enabled = true) =>
  useQuery({
    queryKey: bookingKeys.list(q),
    queryFn: ({ signal }) => api<Paginated<BookingListItemDto>>('/bookings', { query: q, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useBooking = (id: number | null) =>
  useQuery({
    queryKey: bookingKeys.detail(id ?? 0),
    queryFn: ({ signal }) => api<BookingDto>(`/bookings/${id}`, { signal }),
    enabled: !!id,
  });

/** Booking writes also move trips and dispatch queues, so refresh those views too. */
export function useBookingMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: bookingKeys.all });
    void qc.invalidateQueries({ queryKey: ['trips'] });
    void qc.invalidateQueries({ queryKey: ['customers'] });
  };
  return {
    create: useMutation({ mutationFn: (body: unknown) => api<BookingDto>('/bookings', { method: 'POST', body }), onSuccess: refresh }),
    replace: useMutation({
      // If-Match carries the version that was loaded, so a concurrent edit is reported instead of overwritten.
      mutationFn: ({ id, version, body }: { id: number; version: number; body: unknown }) =>
        api<BookingDto>(`/bookings/${id}`, { method: 'PUT', body, headers: { 'if-match': `"${version}"` } }),
      onSuccess: refresh,
    }),
    quote: useMutation({
      mutationFn: ({ id, body }: { id: number; body: unknown }) => api<BookingDto>(`/bookings/${id}/quote`, { method: 'POST', body }),
      onSuccess: refresh,
    }),
    act: useMutation({
      mutationFn: ({ id, body }: { id: number; body: { action: string; reason?: string; approvedAmount?: number } }) =>
        api<BookingDto>(`/bookings/${id}/actions`, { method: 'POST', body }),
      onSuccess: refresh,
    }),
  };
}
