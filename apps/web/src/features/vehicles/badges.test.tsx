import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Field, Input } from '../../components/ui/Field';
import { ComplianceBadge, VehicleStatusBadge } from './badges';

const base = { nextExpiry: null, expired: [], expiringSoon: [], missing: [] };

describe('ComplianceBadge', () => {
  it('names the expired documents in its title', () => {
    render(<ComplianceBadge today="2026-10-15" compliance={{ ...base, state: 'expired', expired: ['insurance', 'permit'] }} />);
    const badge = screen.getByText('Expired (2)');
    expect(badge.closest('span')).toHaveAttribute('title', 'Expired: Insurance, Goods Carriage Permit');
  });

  it('counts days to expiry from the org-local date', () => {
    render(<ComplianceBadge today="2026-10-15" compliance={{ ...base, state: 'expiring', nextExpiry: '2026-10-20', expiringSoon: ['pollution'] }} />);
    expect(screen.getByText('Expires in 5 d')).toBeInTheDocument();
  });

  it('says "today" on the expiry day', () => {
    render(<ComplianceBadge today="2026-10-15" compliance={{ ...base, state: 'expiring', nextExpiry: '2026-10-15', expiringSoon: ['fitness'] }} />);
    expect(screen.getByText('Expires today')).toBeInTheDocument();
  });

  it('flags missing documents', () => {
    render(<ComplianceBadge today="2026-10-15" compliance={{ ...base, state: 'missing', missing: ['pollution'] }} />);
    expect(screen.getByText('Missing docs (1)')).toBeInTheDocument();
  });
});

describe('VehicleStatusBadge', () => {
  it('renders a human label', () => {
    render(<VehicleStatusBadge status="under_maintenance" />);
    expect(screen.getByText('Under maintenance')).toBeInTheDocument();
  });
});

describe('Field', () => {
  it('links label, control and error message for assistive tech', () => {
    render(<Field label="Registration number" error="Already registered">{(p) => <Input {...p} />}</Field>);
    const input = screen.getByLabelText('Registration number');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Already registered');
  });
});
