import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContactDto, CustomerDto, LocationDto, Paginated, QuoteDto, RateCardDto, RouteDto, VendorDto } from '@transaxis/shared';
import { api } from '../../lib/api';

export type CustomerDetail = CustomerDto & { contacts: ContactDto[]; rateCards: RateCardDto[]; locations: LocationDto[] };

export const partyKeys = {
  customers: (q: object) => ['customers', q] as const,
  customer: (id: number) => ['customers', 'detail', id] as const,
  vendors: (q: object) => ['vendors', q] as const,
  routes: ['routes'] as const,
  locations: (q: object) => ['locations', q] as const,
};

export const useCustomers = (q: Record<string, string | number | undefined>) =>
  useQuery({ queryKey: partyKeys.customers(q), queryFn: ({ signal }) => api<Paginated<CustomerDto>>('/customers', { query: q, signal }), placeholderData: keepPreviousData });

export const useCustomer = (id: number | null) =>
  useQuery({ queryKey: partyKeys.customer(id ?? 0), queryFn: ({ signal }) => api<CustomerDetail>(`/customers/${id}`, { signal }), enabled: !!id });

export const useVendors = (q: Record<string, string | number | undefined>) =>
  useQuery({ queryKey: partyKeys.vendors(q), queryFn: ({ signal }) => api<Paginated<VendorDto>>('/vendors', { query: q, signal }), placeholderData: keepPreviousData });

export const useRoutes = () =>
  useQuery({ queryKey: partyKeys.routes, queryFn: ({ signal }) => api<{ data: RouteDto[] }>('/routes', { signal }).then((r) => r.data), staleTime: 300_000 });

export const useLocations = (q: Record<string, string | number | undefined>, enabled = true) =>
  useQuery({ queryKey: partyKeys.locations(q), queryFn: ({ signal }) => api<{ data: LocationDto[] }>('/locations', { query: q, signal }).then((r) => r.data), enabled, staleTime: 60_000 });

export const fetchQuote = (body: { customerId: number; originCity: string; destinationCity: string; totalWeightKg: number; vehicleTypeId?: number }) =>
  api<QuoteDto>('/quotes', { method: 'POST', body });

export function usePartyMutations() {
  const qc = useQueryClient();
  const refresh = (key: string) => () => qc.invalidateQueries({ queryKey: [key] });
  return {
    createCustomer: useMutation({ mutationFn: (body: unknown) => api<CustomerDto>('/customers', { method: 'POST', body }), onSuccess: refresh('customers') }),
    updateCustomer: useMutation({ mutationFn: ({ id, body }: { id: number; body: unknown }) => api<CustomerDto>(`/customers/${id}`, { method: 'PATCH', body }), onSuccess: refresh('customers') }),
    addContact: useMutation({ mutationFn: ({ id, body }: { id: number; body: unknown }) => api<void>(`/customers/${id}/contacts`, { method: 'POST', body }), onSuccess: refresh('customers') }),
    addRateCard: useMutation({ mutationFn: ({ id, body }: { id: number; body: unknown }) => api<void>(`/customers/${id}/rate-cards`, { method: 'POST', body }), onSuccess: refresh('customers') }),
    createVendor: useMutation({ mutationFn: (body: unknown) => api<VendorDto>('/vendors', { method: 'POST', body }), onSuccess: refresh('vendors') }),
    updateVendor: useMutation({ mutationFn: ({ id, body }: { id: number; body: unknown }) => api<VendorDto>(`/vendors/${id}`, { method: 'PATCH', body }), onSuccess: refresh('vendors') }),
  };
}
