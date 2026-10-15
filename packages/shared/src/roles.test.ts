import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, isPermission, ROLE_KEYS, DEFAULT_ROLE_PERMISSIONS } from './index.js';

describe('role permission matrix', () => {
  it('defines a permission set for every role', () => {
    for (const role of ROLE_KEYS) expect(DEFAULT_ROLE_PERMISSIONS[role]).toBeDefined();
  });

  it('only references permissions that exist', () => {
    for (const role of ROLE_KEYS) {
      for (const p of DEFAULT_ROLE_PERMISSIONS[role]) expect(isPermission(p)).toBe(true);
    }
  });

  it('gives super_admin every permission', () => {
    expect(new Set(DEFAULT_ROLE_PERMISSIONS.super_admin)).toEqual(new Set(ALL_PERMISSIONS));
  });

  it('keeps drivers away from fleet-wide and financial data', () => {
    const driver = new Set<string>(DEFAULT_ROLE_PERMISSIONS.driver);
    for (const forbidden of ['finance:read', 'trips:read', 'vehicles:read', 'workers:read', 'tracking:read']) {
      expect(driver.has(forbidden), forbidden).toBe(false);
    }
    expect(driver.has('trips:update_own')).toBe(true);
  });

  it('limits customers to the portal', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.customer).toEqual(['portal:access']);
  });

  it('keeps sensitive worker data away from dispatchers and owners', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.hr_manager).toContain('workers:sensitive');
    expect(DEFAULT_ROLE_PERMISSIONS.dispatcher).not.toContain('workers:sensitive');
    expect(DEFAULT_ROLE_PERMISSIONS.owner).not.toContain('workers:sensitive');
  });
});
