import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { ROLE_LABELS } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { visibleNav } from '../../lib/nav';
import { NotificationBell } from '../../features/live/NotificationBell';
import { CommandPalette } from '../CommandPalette';

const COLLAPSE_KEY = 'transaxis.sidebar.collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function AppShell() {
  const { user, organization, can, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const sections = useMemo(() => visibleNav(can), [can]);

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* storage unavailable (private mode): the preference just won't persist */
    }
  }, [collapsed]);

  const roleLabel = user?.roles[0] ? ROLE_LABELS[user.roles[0]] : 'User';
  const rail = collapsed && !mobileOpen;

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {mobileOpen && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-chrome/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        aria-label="Primary"
        className={[
          'fixed inset-y-0 left-0 z-40 flex flex-col bg-chrome text-chrome-text transition-[width,transform] duration-150',
          rail ? 'md:w-16' : 'md:w-[260px]',
          'w-[260px]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        ].join(' ')}
      >
        <div className="flex h-14 items-center gap-2 border-b border-chrome-2 px-4">
          <span className="grid size-8 shrink-0 place-items-center rounded bg-primary font-display text-sm font-bold text-white">
            TX
          </span>
          {!rail && (
            <div className="min-w-0 leading-tight">
              <div className="font-display text-sm font-semibold text-white">TransAxis</div>
              <div className="truncate text-[11px] text-chrome-text/70">{organization?.name}</div>
            </div>
          )}
          <button
            className="ml-auto rounded p-1 text-chrome-text hover:bg-chrome-2 md:hidden"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {sections.map((section) => (
            <div key={section.title} className="mb-4">
              {!rail && (
                <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-chrome-text/50">
                  {section.title}
                </div>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const base = 'flex h-9 items-center gap-3 rounded px-2.5 text-[13px] font-medium';
                  if (item.status === 'planned') {
                    return (
                      <li key={item.to}>
                        <span
                          aria-disabled="true"
                          title={`${item.label} is planned and not available yet`}
                          className={`${base} cursor-not-allowed text-chrome-text/40`}
                        >
                          <Icon className="size-4 shrink-0" aria-hidden />
                          {!rail && <span className="truncate">{item.label}</span>}
                          {!rail && (
                            <span className="ml-auto rounded bg-chrome-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                              Soon
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  }
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === '/'}
                        title={rail ? item.label : undefined}
                        className={({ isActive }) =>
                          `${base} ${isActive ? 'bg-primary text-white' : 'hover:bg-chrome-2 hover:text-white'}`
                        }
                      >
                        <Icon className="size-4 shrink-0" aria-hidden />
                        {!rail && <span className="truncate">{item.label}</span>}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="hidden border-t border-chrome-2 p-2 md:block">
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex h-9 w-full items-center gap-3 rounded px-2.5 text-[13px] hover:bg-chrome-2 hover:text-white"
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <div className={rail ? 'md:pl-16' : 'md:pl-[260px]'}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface px-4 md:px-6">
          <button
            className="rounded p-2 hover:bg-subtle md:hidden"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1 truncate text-[13px] text-muted">
            {organization?.name}
            <span className="mx-2 text-line-strong">/</span>
            <span className="text-ink">{roleLabel}</span>
          </div>
          <CommandPalette />
          <NotificationBell />
          <Link to="/account" className="hidden rounded px-1.5 py-1 text-right leading-tight hover:bg-subtle sm:block" title="My account">
            <div className="text-[13px] font-medium">{user?.fullName}</div>
            <div className="text-[11px] text-muted">{user?.email}</div>
          </Link>
          <button
            onClick={() => void logout()}
            className="flex h-9 items-center gap-2 rounded border border-line bg-surface px-3 text-[13px] font-medium hover:border-line-strong hover:bg-canvas"
          >
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </header>
        <main className="px-4 py-6 md:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
