import type { ReactNode } from 'react';
import { AlertTriangle, Info } from 'lucide-react';

/** Full-width notice above page content, e.g. why a record is on hold or was overridden. */
export function Banner({ tone, title, children }: { tone: 'warn' | 'crit' | 'info'; title: string; children?: ReactNode }) {
  const cls =
    tone === 'crit'
      ? 'border-crit/30 bg-crit-soft text-crit-strong'
      : tone === 'warn'
        ? 'border-warn/40 bg-warn-soft text-warn-strong'
        : 'border-primary/30 bg-primary-soft text-primary-strong';
  const Icon = tone === 'info' ? Info : AlertTriangle;
  return (
    <div role="status" className={`mb-5 flex items-start gap-2 rounded border px-4 py-3 text-[13px] ${cls}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>
        <span className="font-semibold">{title}{children ? ':' : ''}</span> {children}
      </div>
    </div>
  );
}
