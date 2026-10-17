import { useQuery } from '@tanstack/react-query';
import type { OrganizationProfileDto } from '@transaxis/shared';
import { api } from './api';

/** Legal name, GSTIN and address for letterheads and the GST place-of-supply check. */
export const useOrgProfile = () =>
  useQuery({ queryKey: ['org-profile'], queryFn: ({ signal }) => api<OrganizationProfileDto>('/reference/organization', { signal }), staleTime: 3_600_000 });
