import { ALL_PERMISSIONS, type Permission } from './permissions.js';

export const ROLE_KEYS = [
  'super_admin',
  'owner',
  'dispatcher',
  'accountant',
  'maintenance_manager',
  'control_room',
  'hr_manager',
  'driver',
  'customer',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  super_admin: 'Super Admin',
  owner: 'Company Owner / Director',
  dispatcher: 'Transport Manager / Dispatcher',
  accountant: 'Accountant / Finance Manager',
  maintenance_manager: 'Fleet Maintenance Manager',
  control_room: 'Security / Control Room Operator',
  hr_manager: 'HR / Driver Manager',
  driver: 'Driver / Field Worker',
  customer: 'Customer / Client',
};

const read = (...p: Permission[]) => p;

/** Default role -> permission mapping used by the seed. Orgs may adjust it via the roles editor. */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  super_admin: [...ALL_PERMISSIONS],

  owner: read(
    'settings:read', 'users:read', 'audit:read',
    'vehicles:read', 'workers:read', 'customers:read', 'vendors:read',
    'bookings:read', 'bookings:approve', 'trips:read', 'tracking:read',
    'alerts:read', 'incidents:read', 'maintenance:read', 'fuel:read',
    'finance:read', 'finance:approve', 'settlements:read',
    'reports:read', 'reports:export', 'notifications:read',
    'documents:read', 'documents:write', 'ai:query',
  ),

  dispatcher: read(
    'vehicles:read', 'workers:read', 'customers:read', 'customers:write', 'vendors:read',
    'bookings:read', 'bookings:write', 'bookings:approve',
    'trips:read', 'trips:assign', 'trips:dispatch', 'trips:override_warnings',
    'tracking:read', 'alerts:read', 'alerts:manage', 'incidents:read',
    'maintenance:read', 'fuel:read', 'reports:read', 'notifications:read',
    'documents:read', 'documents:write', 'ai:query',
  ),

  accountant: read(
    'customers:read', 'vendors:read', 'vendors:write', 'vehicles:read', 'workers:read',
    'bookings:read', 'trips:read', 'fuel:read', 'maintenance:read',
    'finance:read', 'finance:post', 'settlements:read', 'settlements:manage',
    'reports:read', 'reports:export', 'notifications:read',
    'documents:read', 'documents:write', 'ai:query',
  ),

  maintenance_manager: read(
    'vehicles:read', 'vehicles:write', 'vehicle_documents:write', 'vendors:read',
    'trips:read', 'maintenance:read', 'maintenance:write', 'fuel:read', 'fuel:write',
    'reports:read', 'notifications:read', 'documents:read', 'documents:write', 'ai:query',
  ),

  control_room: read(
    'vehicles:read', 'workers:read', 'trips:read', 'tracking:read',
    'alerts:read', 'alerts:manage', 'incidents:read', 'incidents:manage',
    'reports:read', 'notifications:read', 'documents:read', 'ai:query',
  ),

  hr_manager: read(
    'workers:read', 'workers:write', 'workers:sensitive', 'attendance:manage',
    'trips:read', 'settlements:read', 'reports:read', 'notifications:read',
    'documents:read', 'documents:write',
  ),

  driver: read(
    'trips:update_own', 'incidents:report', 'expenses:submit',
    'settlements:read_own', 'notifications:read',
  ),

  customer: read('portal:access'),
};
