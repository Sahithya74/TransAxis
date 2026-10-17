import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

/** Dense data table shell matching the design system (36px header, 44px rows). */
export function Table({ children, minWidth = 760 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
      <tr>{children}</tr>
    </thead>
  );
}

export function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`h-9 px-4 font-semibold ${className}`}>{children}</th>;
}

export function SortTh({
  field,
  label,
  sort,
  onSort,
  align = 'left',
}: {
  field: string;
  label: ReactNode;
  sort?: string;
  onSort: (f: string) => void;
  align?: 'left' | 'right';
}) {
  const state = sort === field ? 'ascending' : sort === `-${field}` ? 'descending' : 'none';
  const Icon = state === 'ascending' ? ArrowUp : state === 'descending' ? ArrowDown : ArrowUpDown;
  return (
    <th aria-sort={state} className={`h-9 px-4 font-semibold ${align === 'right' ? 'text-right' : ''}`}>
      <button onClick={() => onSort(field)} className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {label}
        <Icon className={`size-3 ${state === 'none' ? 'opacity-40' : 'text-primary'}`} aria-hidden />
      </button>
    </th>
  );
}

/** Cycles a list sort: none → asc → desc → none. */
export const nextSort = (current: string | undefined, field: string) =>
  current === field ? `-${field}` : current === `-${field}` ? undefined : field;
