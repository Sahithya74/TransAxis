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
  ReceiptText,
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

/** Opening any administration tab needs one of these (users, roles, settings, audit, health, companies). */
export const ADMIN_AREA_PERMISSIONS: Permission[] = ['users:read', 'users:manage', 'settings:read', 'settings:manage', 'audit:read', 'system:health', 'orgs:manage'];

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', to: '/', icon: LayoutDashboard, anyOf: [], status: 'live' },
      { label: 'Live Fleet Map', to: '/tracking', icon: Map, anyOf: ['tracking:read'], status: 'live' },
      { label: 'Dispatch Board', to: '/dispatch', icon: ClipboardList, anyOf: ['trips:read'], status: 'live' },
      { label: 'Trips', to: '/trips', icon: Route, anyOf: ['trips:read'], status: 'live' },
      { label: 'Calendar', to: '/calendar', icon: CalendarDays, anyOf: ['trips:read'], status: 'live' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Bookings', to: '/bookings', icon: Package, anyOf: ['bookings:read'], status: 'live' },
      { label: 'Vehicles', to: '/vehicles', icon: Truck, anyOf: ['vehicles:read'], status: 'live' },
      { label: 'Drivers & Workforce', to: '/workers', icon: UsersRound, anyOf: ['workers:read'], status: 'live' },
      { label: 'Customers & Vendors', to: '/parties', icon: Users, anyOf: ['customers:read', 'vendors:read'], status: 'live' },
      { label: 'Maintenance', to: '/maintenance', icon: Wrench, anyOf: ['maintenance:read'], status: 'live' },
      { label: 'Fuel', to: '/fuel', icon: Fuel, anyOf: ['fuel:read', 'finance:read'], status: 'live' },
    ],
  },
  {
    title: 'Security & Safety',
    items: [
      { label: 'Control Room', to: '/control-room', icon: ShieldAlert, anyOf: ['alerts:read'], status: 'live' },
      { label: 'Safety Alerts', to: '/alerts', icon: Siren, anyOf: ['alerts:read'], status: 'live' },
      { label: 'Incidents', to: '/incidents', icon: LifeBuoy, anyOf: ['incidents:read'], status: 'live' },
    ],
  },
  {
    title: 'Finance',
    items: [
      { label: 'Overview', to: '/finance', icon: BadgeIndianRupee, anyOf: ['finance:read'], status: 'live' },
      { label: 'Invoices & Collections', to: '/invoices', icon: Receipt, anyOf: ['finance:read'], status: 'live' },
      { label: 'Expenses', to: '/expenses', icon: ReceiptText, anyOf: ['finance:read', 'finance:post', 'expenses:submit'], status: 'live' },
      { label: 'Settlements', to: '/settlements', icon: Wallet, anyOf: ['settlements:read', 'settlements:manage'], status: 'live' },
    ],
  },
  {
    title: 'Insight',
    items: [
      { label: 'Reports', to: '/reports', icon: BarChart3, anyOf: ['reports:read'], status: 'live' },
      { label: 'Documents', to: '/documents', icon: FileText, anyOf: ['documents:read'], status: 'live' },
      { label: 'AI Assistant', to: '/assistant', icon: Bot, anyOf: ['ai:query'], status: 'live' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'Audit & Settings', to: '/admin', icon: Settings, anyOf: ADMIN_AREA_PERMISSIONS, status: 'live' },
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
