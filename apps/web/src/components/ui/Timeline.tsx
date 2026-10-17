import type { ReactNode } from 'react';

export interface TimelineItem {
  id: string | number;
  title: ReactNode;
  meta?: ReactNode;
  body?: ReactNode;
  tone?: 'default' | 'ok' | 'warn' | 'crit' | 'info';
}

const dot = { default: 'bg-line-strong', ok: 'bg-ok', warn: 'bg-warn', crit: 'bg-crit', info: 'bg-primary' } as const;

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="relative ml-1.5 border-l border-line">
      {items.map((it) => (
        <li key={it.id} className="mb-4 ml-4 last:mb-0">
          <span className={`absolute -left-[5px] mt-1.5 size-2.5 rounded-full ring-2 ring-surface ${dot[it.tone ?? 'default']}`} aria-hidden />
          <div className="text-[13px] font-medium">{it.title}</div>
          {it.meta && <div className="text-xs text-muted">{it.meta}</div>}
          {it.body && <div className="mt-1 text-[13px] text-ink/80">{it.body}</div>}
        </li>
      ))}
    </ol>
  );
}
