import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BadgeIndianRupee,
  BarChart3,
  Bot,
  CalendarDays,
  ClipboardList,
  FileText,
  Fuel,
  LayoutDashboard,
  LifeBuoy,
  Map,
  Package,
  Receipt,
  Route,
  ShieldAlert,
  Siren,
  Truck,
  Users,
  UsersRound,
  Wallet,
  Wrench,
  Settings,
} from 'lucide-react';
import type { Permission } from '@transaxis/shared';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** The user needs at least one of these. Empty = any signed-in user. */
  anyOf: Permission[];
  /** `planned` items render disabled so the shell stays honest about what exists. */
  status: 'live' | 'planned';
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', to: '/', icon: LayoutDashboard, anyOf: [], status: 'live' },
      { label: 'Live Fleet Map', to: '/tracking', icon: Map, anyOf: ['tracking:read'], status: 'planned' },
      { label: 'Dispatch Board', to: '/dispatch', icon: ClipboardList, anyOf: ['trips:read'], status: 'planned' },
      { label: 'Trips', to: '/trips', icon: Route, anyOf: ['trips:read'], status: 'planned' },
      { label: 'Calendar', to: '/calendar', icon: CalendarDays, anyOf: ['trips:read'], status: 'planned' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Bookings', to: '/bookings', icon: Package, anyOf: ['bookings:read'], status: 'planned' },
      { label: 'Vehicles', to: '/vehicles', icon: Truck, anyOf: ['vehicles:read'], status: 'live' },
      { label: 'Drivers & Workforce', to: '/workers', icon: UsersRound, anyOf: ['workers:read'], status: 'planned' },
      { label: 'Customers & Vendors', to: '/parties', icon: Users, anyOf: ['customers:read', 'vendors:read'], status: 'planned' },
      { label: 'Maintenance', to: '/maintenance', icon: Wrench, anyOf: ['maintenance:read'], status: 'planned' },
      { label: 'Fuel', to: '/fuel', icon: Fuel, anyOf: ['fuel:read'], status: 'planned' },
    ],
  },
  {
    title: 'Security & Safety',
    items: [
      { label: 'Control Room', to: '/control-room', icon: ShieldAlert, anyOf: ['alerts:read'], status: 'planned' },
      { label: 'Safety Alerts', to: '/alerts', icon: Siren, anyOf: ['alerts:read'], status: 'planned' },
      { label: 'Incidents', to: '/incidents', icon: LifeBuoy, anyOf: ['incidents:read'], status: 'planned' },
    ],
  },
  {
    title: 'Finance',
    items: [
      { label: 'Overview', to: '/finance', icon: BadgeIndianRupee, anyOf: ['finance:read'], status: 'planned' },
      { label: 'Invoices & Collections', to: '/invoices', icon: Receipt, anyOf: ['finance:read'], status: 'planned' },
      { label: 'Settlements', to: '/settlements', icon: Wallet, anyOf: ['settlements:read'], status: 'planned' },
    ],
  },
  {
    title: 'Insight',
    items: [
      { label: 'Reports', to: '/reports', icon: BarChart3, anyOf: ['reports:read'], status: 'planned' },
      { label: 'Documents', to: '/documents', icon: FileText, anyOf: ['documents:read'], status: 'planned' },
      { label: 'AI Assistant', to: '/assistant', icon: Bot, anyOf: ['ai:query'], status: 'planned' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'Audit & Settings', to: '/admin', icon: Settings, anyOf: ['settings:read', 'audit:read', 'users:read'], status: 'planned' },
      { label: 'System Status', to: '/status', icon: Activity, anyOf: [], status: 'live' },
    ],
  },
];

/** Drops items the user may not see, then drops sections left empty. */
export function visibleNav(can: (...anyOf: Permission[]) => boolean): NavSection[] {
  return NAV.map((section) => ({
    ...section,
    items: section.items.filter((i) => i.anyOf.length === 0 || can(...i.anyOf)),
  })).filter((s) => s.items.length > 0);
}
