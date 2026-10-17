import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CircleUser, FileText, Package, Receipt, Route, Search, Truck, Users, UsersRound, type LucideIcon } from 'lucide-react';
import type { SearchResultDto } from '@transaxis/shared';
import { useAuth } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { visibleNav } from '../lib/nav';

const TYPE_ICON: Record<SearchResultDto['type'], LucideIcon> = {
  vehicle: Truck,
  worker: UsersRound,
  customer: Users,
  booking: Package,
  trip: Route,
  invoice: Receipt,
  document: FileText,
};
const TYPE_LABEL: Record<SearchResultDto['type'], string> = {
  vehicle: 'Vehicle',
  worker: 'Person',
  customer: 'Customer',
  booking: 'Booking',
  trip: 'Trip',
  invoice: 'Invoice',
  document: 'Document',
};

interface Item {
  key: string;
  title: string;
  subtitle: string | null;
  kind: string;
  icon: LucideIcon;
  link: string;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** True when the key press is going into a text field, where "/" must type a slash. */
const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/**
 * Ctrl+K (or ⌘K, or "/") jumps to any page or record: vehicles by plate, trips and bookings by number,
 * people, customers, invoices and documents. Results follow the person's own permissions.
 */
export function CommandPalette() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const term = useDebounced(q.trim(), 200);

  // Each opening starts with an empty box.
  const show = () => {
    setQ('');
    setActive(0);
    setOpen(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const shortcut = ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey);
      if (!shortcut) return;
      e.preventDefault();
      setQ('');
      setActive(0);
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      inputRef.current?.focus();
    }
    if (!open && el.open) el.close();
  }, [open]);

  const results = useQuery({
    queryKey: ['search', term],
    queryFn: ({ signal }) => api<{ data: SearchResultDto[] }>('/search', { query: { q: term }, signal }).then((r) => r.data),
    enabled: open && term.length >= 2,
    staleTime: 30_000,
  });

  const pages = useMemo<Item[]>(() => {
    const all = visibleNav(can).flatMap((s) => s.items.filter((i) => i.status === 'live').map((i) => ({ ...i, section: s.title })));
    const needle = q.trim().toLowerCase();
    const matches = all.filter((i) => !needle || i.label.toLowerCase().includes(needle) || i.section.toLowerCase().includes(needle));
    const account = 'my account password two-step'.includes(needle) || !needle;
    return [
      ...matches.map((i) => ({ key: `page:${i.to}`, title: i.label, subtitle: i.section, kind: 'Page', icon: i.icon, link: i.to })),
      ...(account ? [{ key: 'page:/account', title: 'My account', subtitle: 'Password and two-step verification', kind: 'Page', icon: CircleUser, link: '/account' }] : []),
    ].slice(0, needle ? 6 : 8);
  }, [can, q]);

  const records = useMemo<Item[]>(
    () =>
      (term.length >= 2 ? (results.data ?? []) : []).map((r) => ({
        key: `${r.type}:${r.id}`,
        title: r.title,
        subtitle: r.subtitle,
        kind: TYPE_LABEL[r.type],
        icon: TYPE_ICON[r.type],
        link: r.link,
      })),
    [results.data, term],
  );

  // Records first once the person has typed something specific; pages first otherwise.
  const items = q.trim().length >= 2 ? [...records, ...pages] : pages;
  const current = Math.min(active, Math.max(0, items.length - 1));

  const go = (item: Item | undefined) => {
    if (!item) return;
    setOpen(false);
    navigate(item.link);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (items.length ? (Math.min(a, items.length - 1) + 1) % items.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (items.length ? (Math.min(a, items.length - 1) - 1 + items.length) % items.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(items[current]);
    }
  };

  useEffect(() => {
    document.getElementById(`${listId}-${current}`)?.scrollIntoView({ block: 'nearest' });
  }, [current, listId]);

  const searching = term.length >= 2 && results.isFetching && !results.data;

  return (
    <>
      <button
        onClick={show}
        className="flex h-9 items-center gap-2 rounded border border-line bg-canvas px-2.5 text-[13px] text-muted hover:border-line-strong hover:text-ink"
        aria-label="Search (Ctrl+K)"
      >
        <Search className="size-4" aria-hidden />
        <span className="hidden lg:inline">Search…</span>
        <kbd className="hidden rounded border border-line bg-surface px-1 text-[11px] lg:inline">Ctrl K</kbd>
      </button>
      <dialog
        ref={dialogRef}
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
        onClick={(e) => {
          // A click on the backdrop (the dialog element itself) closes it.
          if (e.target === dialogRef.current) setOpen(false);
        }}
        aria-label="Search"
        className="mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl rounded-lg border border-line bg-surface p-0 text-ink shadow-[0_20px_25px_-5px_rgb(15_23_42/0.18)] backdrop:bg-chrome/40"
      >
        {open && (
          <div>
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search className="size-4 shrink-0 text-muted" aria-hidden />
              <input
                ref={inputRef}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={items.length ? `${listId}-${current}` : undefined}
                aria-autocomplete="list"
                aria-label="Search pages and records"
                placeholder="Search pages, plates, trip or invoice numbers, people…"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70"
              />
              <kbd className="rounded border border-line px-1 text-[11px] text-muted">Esc</kbd>
            </div>
            <ul id={listId} role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto p-1.5">
              {items.map((item, i) => {
                const Icon = item.icon;
                return (
                  <li
                    key={item.key}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === current}
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(item)}
                    className={`flex cursor-pointer items-center gap-3 rounded px-2.5 py-2 text-[13px] ${i === current ? 'bg-primary-soft' : ''}`}
                  >
                    <Icon className="size-4 shrink-0 text-muted" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.title}</span>
                      {item.subtitle && <span className="block truncate text-xs text-muted">{item.subtitle}</span>}
                    </span>
                    <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted">{item.kind}</span>
                  </li>
                );
              })}
              {items.length === 0 && (
                <li role="presentation" className="px-3 py-6 text-center text-[13px] text-muted">
                  {searching ? 'Searching…' : `Nothing found for “${q.trim()}”`}
                </li>
              )}
            </ul>
            <div aria-live="polite" className="border-t border-line px-3 py-1.5 text-[11px] text-muted">
              {searching ? 'Searching…' : '↑↓ to move · Enter to open'}
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
