import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

interface Health {
  status: 'ok' | 'degraded';
  service: string;
  time: string;
  checks: { database: 'up' | 'down' | 'not_configured' };
}

async function fetchHealth(): Promise<Health> {
  // 503 still carries a useful body ("degraded"), so don't treat it as a network failure.
  const res = await fetch('/api/v1/health');
  return (await res.json()) as Health;
}

const dot = {
  up: 'bg-ok',
  ok: 'bg-ok',
  down: 'bg-crit',
  degraded: 'bg-crit',
  not_configured: 'bg-warn',
} as const;

export function StatusPage() {
  const q = useQuery({ queryKey: ['health'], queryFn: fetchHealth, refetchInterval: 15_000 });

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl">System status</h1>
        <button
          onClick={() => void q.refetch()}
          className="flex h-9 items-center gap-2 rounded border border-line bg-surface px-3 text-[13px] font-medium hover:border-line-strong"
        >
          <RefreshCw className={`size-4 ${q.isFetching ? 'animate-spin' : ''}`} aria-hidden /> Refresh
        </button>
      </div>

      <div className="rounded-lg border border-line bg-surface shadow-card">
        {q.isPending && <div className="p-6 text-muted">Checking services…</div>}
        {q.isError && (
          <div role="alert" className="p-6 text-crit-strong">
            The API is not reachable. Start it with <code>npm run dev</code>.
          </div>
        )}
        {q.data && (
          <ul className="divide-y divide-line">
            <Row label="API" value={q.data.status} />
            <Row label="Database" value={q.data.checks.database} />
            <li className="px-4 py-3 text-xs text-muted">
              Last response {new Date(q.data.time).toLocaleTimeString()}
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: keyof typeof dot }) {
  return (
    <li className="flex items-center justify-between px-4 py-3">
      <span className="font-medium">{label}</span>
      <span className="flex items-center gap-2 text-[13px]">
        <span className={`size-2 rounded-full ${dot[value]}`} aria-hidden />
        {value.replace('_', ' ')}
      </span>
    </li>
  );
}
