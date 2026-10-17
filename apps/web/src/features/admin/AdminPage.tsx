import { useSearchParams } from 'react-router';
import type { Permission } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/ui/Layout';
import { Tabs } from '../../components/ui/Tabs';
import { AuditTab, HealthTab, TenantsTab } from './OversightTabs';
import { RolesTab } from './RolesTab';
import { ConfigurationTab, SettingsTab } from './SettingsTab';
import { UsersTab } from './UsersTab';

const TABS: { id: string; label: string; anyOf: Permission[]; render: () => React.ReactNode }[] = [
  { id: 'users', label: 'People', anyOf: ['users:read', 'users:manage'], render: () => <UsersTab /> },
  { id: 'roles', label: 'Roles', anyOf: ['users:read', 'users:manage'], render: () => <RolesTab /> },
  { id: 'settings', label: 'Settings', anyOf: ['settings:read', 'settings:manage'], render: () => <SettingsTab /> },
  { id: 'config', label: 'Configuration', anyOf: ['settings:read', 'settings:manage'], render: () => <ConfigurationTab /> },
  { id: 'audit', label: 'Audit log', anyOf: ['audit:read'], render: () => <AuditTab /> },
  { id: 'health', label: 'System health', anyOf: ['system:health'], render: () => <HealthTab /> },
  { id: 'tenants', label: 'Companies', anyOf: ['orgs:manage'], render: () => <TenantsTab /> },
];

export function AdminPage() {
  const { can, organization } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((t) => can(...t.anyOf));
  const active = tabs.find((t) => t.id === params.get('tab')) ?? tabs[0];
  if (!active) return null;

  return (
    <div>
      <PageHeader title="Administration" subtitle={`People, roles, settings and the audit trail for ${organization?.name ?? 'your organisation'}`} />
      {/* Filters belong to one tab, so switching tabs starts with a clean address. */}
      <Tabs tabs={tabs.map(({ id, label }) => ({ id, label }))} active={active.id} onChange={(id) => setParams({ tab: id }, { replace: true })} className="mb-4" />
      <div role="tabpanel" aria-label={active.label}>
        {active.render()}
      </div>
    </div>
  );
}
