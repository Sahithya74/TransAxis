import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, type Permission, type RoleKey } from '@transaxis/shared';
import { visibleNav } from './nav';

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

  it('never returns an empty section', () => {
    for (const s of visibleNav(canFor('driver'))) expect(s.items.length).toBeGreaterThan(0);
  });
});
