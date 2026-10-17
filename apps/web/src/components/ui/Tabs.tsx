import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabDef {
  id: string;
  label: ReactNode;
  count?: number;
}

/** Accessible tabs (roving focus, arrow keys). The caller renders the active panel. */
export function Tabs({ tabs, active, onChange, className = '' }: { tabs: TabDef[]; active: string; onChange: (id: string) => void; className?: string }) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    refs.current[next]?.focus();
    onChange(tabs[next]!.id);
  };
  return (
    // The baseline is an inset shadow, not a border, so the active underline can cover it without
    // overflowing (overflow-x-auto would otherwise add a vertical scrollbar).
    <div role="tablist" className={`flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-line)] ${className}`}>
      {tabs.map((t, i) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            id={`${id}-${t.id}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(e) => onKey(e, i)}
            onClick={() => onChange(t.id)}
            className={`flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-[13px] font-medium ${
              selected ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t.label}
            {t.count !== undefined && <span className="rounded bg-subtle px-1.5 text-[11px] tabular-nums text-muted">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
