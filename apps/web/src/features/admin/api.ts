import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminExpenseCategoryDto,
  AdminUserDto,
  AuditLogDto,
  OrgSettingsDto,
  Paginated,
  Permission,
  RoleDto,
  SystemHealthDto,
  TenantDto,
} from '@transaxis/shared';
import { api } from '../../lib/api';

type Query = Record<string, string | number | undefined>;
const key = (...parts: unknown[]) => ['admin', ...parts] as const;

export interface PermissionInfo {
  key: Permission;
  description: string;
  group: string;
}

export interface LinkOptions {
  workers: { id: number; fullName: string; employeeCode: string; workerType: string; linkedUserId: number | null }[];
  customers: { id: number; name: string; code: string }[];
}

export const useAdminUsers = (q: Query, enabled = true) =>
  useQuery({
    queryKey: key('users', q),
    queryFn: ({ signal }) => api<Paginated<AdminUserDto>>('/admin/users', { query: q, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useLinkOptions = (enabled: boolean) =>
  useQuery({ queryKey: key('link-options'), queryFn: ({ signal }) => api<LinkOptions>('/admin/users/link-options', { signal }), enabled, staleTime: 60_000 });

export const useRoles = (enabled = true) =>
  useQuery({ queryKey: key('roles'), queryFn: ({ signal }) => api<{ data: RoleDto[] }>('/admin/roles', { signal }).then((r) => r.data), enabled });

export const usePermissionCatalogue = (enabled = true) =>
  useQuery({
    queryKey: key('permissions'),
    queryFn: ({ signal }) => api<{ data: PermissionInfo[] }>('/admin/permissions', { signal }).then((r) => r.data),
    staleTime: Infinity,
    enabled,
  });

export const useOrgSettings = (enabled = true) =>
  useQuery({ queryKey: key('settings'), queryFn: ({ signal }) => api<OrgSettingsDto>('/admin/settings', { signal }), enabled });

export const useAdminExpenseCategories = (enabled = true) =>
  useQuery({
    queryKey: key('expense-categories'),
    queryFn: ({ signal }) => api<{ data: AdminExpenseCategoryDto[] }>('/admin/expense-categories', { signal }).then((r) => r.data),
    enabled,
  });

export const useAuditLog = (q: Query, enabled = true) =>
  useQuery({
    queryKey: key('audit', q),
    queryFn: ({ signal }) => api<Paginated<AuditLogDto>>('/admin/audit', { query: q, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useSystemHealth = (enabled = true) =>
  useQuery({ queryKey: key('health'), queryFn: ({ signal }) => api<SystemHealthDto>('/admin/health', { signal }), enabled, refetchInterval: 30_000 });

export const useTenants = (enabled = true) =>
  useQuery({ queryKey: key('tenants'), queryFn: ({ signal }) => api<{ data: TenantDto[] }>('/admin/tenants', { signal }).then((r) => r.data), enabled });

/** Admin changes can touch the organisation profile, expense categories and the people lists elsewhere. */
export function useAdminMutation<V, T = unknown>(fn: (vars: V) => Promise<T>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      for (const k of ['admin', 'org-profile', 'finance']) void qc.invalidateQueries({ queryKey: [k] });
    },
  });
}

export const send = <T,>(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => api<T>(path, { method, body });
