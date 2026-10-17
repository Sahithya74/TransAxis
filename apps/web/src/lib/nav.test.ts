import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, type Permission, type RoleKey } from '@transaxis/shared';
import { NAV, visibleNav } from './nav';

const canFor = (role: RoleKey) => {
  const set = new Set<Permission>(DEFAULT_ROLE_PERMISSIONS[role]);
  return (...anyOf: Permission[]) => anyOf.some((p) => set.has(p));
};
const labels = (role: RoleKey) =>
  visibleNav(canFor(role)).flatMap((s) => s.items.map((i) => i.label));

describe('visibleNav', () => {
  it('hides finance from drivers and dispatchers', () => {
    expect(labels('driver')).not.toContain('Invoices & Collections');
    expect(labels('dispatcher')).not.toContain('Invoices & Collections');
  });

  it('shows finance to accountants and owners', () => {
    expect(labels('accountant')).toContain('Invoices & Collections');
    expect(labels('owner')).toContain('Invoices & Collections');
  });

  it('shows the control room to control-room operators only among ops roles', () => {
    expect(labels('control_room')).toContain('Control Room');
    expect(labels('maintenance_manager')).not.toContain('Control Room');
  });

  it('lets dispatchers claim expenses and see fuel, but not settle crew pay', () => {
    expect(labels('dispatcher')).toEqual(expect.arrayContaining(['Expenses', 'Fuel']));
    expect(labels('dispatcher')).not.toContain('Settlements');
    expect(labels('hr_manager')).toContain('Settlements');
    expect(labels('maintenance_manager')).toEqual(expect.arrayContaining(['Maintenance', 'Fuel']));
  });

  it('never returns an empty section', () => {
    for (const s of visibleNav(canFor('driver'))) expect(s.items.length).toBeGreaterThan(0);
  });

  it('opens administration to owners and the platform admin only', () => {
    expect(labels('owner')).toContain('Audit & Settings');
    expect(labels('super_admin')).toContain('Audit & Settings');
    for (const role of ['dispatcher', 'accountant', 'driver', 'customer'] as const) expect(labels(role)).not.toContain('Audit & Settings');
  });

  it('has no planned placeholders left', () => {
    expect(NAV.flatMap((s) => s.items).filter((i) => i.status === 'planned')).toEqual([]);
  });
});
