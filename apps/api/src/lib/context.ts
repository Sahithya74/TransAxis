import type { Permission, RoleKey } from '@transaxis/shared';

/**
 * Who is making the request and what they may see. Built once per request from the verified
 * access token, then passed to every repository so org and row scoping cannot be forgotten.
 */
export interface RequestContext {
  userId: number;
  orgId: number;
  roles: RoleKey[];
  permissions: ReadonlySet<Permission>;
  /** Present for driver/helper accounts: restricts trip queries to their own assignments. */
  workerId: number | null;
  /** Present for customer-portal accounts: restricts bookings and invoices to their own. */
  customerId: number | null;
  /** Signed in with a temporary password: only the account endpoints work until it is changed. */
  mustChangePassword?: boolean;
}

export function hasPermission(ctx: RequestContext, permission: Permission): boolean {
  return ctx.permissions.has(permission);
}
