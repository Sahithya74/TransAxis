import type { ReactNode } from 'react';

export type Tone = 'ok' | 'warn' | 'crit' | 'ai' | 'info' | 'neutral';

const tones: Record<Tone, { box: string; pip: string }> = {
  ok: { box: 'bg-ok-soft text-ok-strong', pip: 'bg-ok' },
  warn: { box: 'bg-warn-soft text-warn-strong', pip: 'bg-warn' },
  crit: { box: 'bg-crit-soft text-crit-strong', pip: 'bg-crit' },
  ai: { box: 'bg-ai-soft text-ai-strong', pip: 'bg-ai' },
  info: { box: 'bg-primary-soft text-primary-strong', pip: 'bg-primary' },
  neutral: { box: 'bg-subtle text-muted', pip: 'bg-muted' },
};

/** Compact status chip. Colour follows the strict status taxonomy; text always carries the meaning. */
export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  const t = tones[tone];
  return (
    <span title={title} className={`inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded px-1.5 text-xs font-medium ${t.box}`}>
      <span className={`size-1.5 rounded-full ${t.pip}`} aria-hidden />
      {children}
    </span>
  );
}
