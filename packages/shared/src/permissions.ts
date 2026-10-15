/**
 * Permission catalogue. A permission is `<resource>:<action>`.
 * This file is the single source of truth: the database `permissions` table is seeded
 * from it, the API enforces it server-side, and the web app only uses it to shape navigation.
 */
export const PERMISSIONS = {
  // Platform / admin
  'orgs:manage': 'Manage company tenants',
  'settings:read': 'View organisation settings',
  'settings:manage': 'Change organisation settings and configuration',
  'users:read': 'View users',
  'users:manage': 'Create, edit and deactivate users and roles',
  'audit:read': 'View audit logs',
  'system:health': 'View system health',

  // Fleet
  'vehicles:read': 'View vehicles',
  'vehicles:write': 'Create and edit vehicles',
  'vehicle_documents:write': 'Manage vehicle documents',

  // People
  'workers:read': 'View drivers and workers',
  'workers:write': 'Create and edit drivers and workers',
  'workers:sensitive': 'View sensitive worker data (licence, emergency contacts, pay)',
  'attendance:manage': 'Manage attendance, leave and rosters',

  // Commercial
  'customers:read': 'View customers',
  'customers:write': 'Create and edit customers',
  'vendors:read': 'View vendors',
  'vendors:write': 'Create and edit vendors',

  // Bookings and trips
  'bookings:read': 'View bookings',
  'bookings:write': 'Create and edit bookings',
  'bookings:approve': 'Approve quotations and bookings',
  'trips:read': 'View trips',
  'trips:assign': 'Assign vehicles and drivers',
  'trips:dispatch': 'Dispatch and manage trip lifecycle',
  'trips:override_warnings': 'Override non-blocking eligibility warnings',
  'trips:update_own': 'Update milestones on own assigned trips',

  // Tracking and safety
  'tracking:read': 'View live tracking',
  'alerts:read': 'View safety alerts',
  'alerts:manage': 'Acknowledge and resolve safety alerts',
  'incidents:read': 'View incidents',
  'incidents:manage': 'Manage and assign incidents',
  'incidents:report': 'Report incidents and trigger SOS',

  // Maintenance and fuel
  'maintenance:read': 'View maintenance records',
  'maintenance:write': 'Manage maintenance and work orders',
  'fuel:read': 'View fuel logs',
  'fuel:write': 'Record fuel fill-ups',

  // Finance
  'finance:read': 'View financial data',
  'finance:post': 'Post invoices, receipts and expenses',
  'finance:approve': 'Approve sensitive financial actions',
  'settlements:read': 'View settlements',
  'settlements:manage': 'Create and pay settlements',
  'settlements:read_own': 'View own earnings and settlements',
  'expenses:submit': 'Submit trip expenses',

  // Reports, notifications, documents, AI
  'reports:read': 'View reports',
  'reports:export': 'Export reports',
  'notifications:read': 'View notifications',
  'documents:read': 'View documents',
  'documents:write': 'Upload and manage documents',
  'ai:query': 'Use the AI assistant',

  // Customer portal
  'portal:access': 'Access the customer portal',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}
