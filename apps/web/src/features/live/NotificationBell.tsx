import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Bell, CheckCheck } from 'lucide-react';
import type { NotificationDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../../components/ui/Button';
import { Card, EmptyState, PageHeader, Pagination, Skeleton } from '../../components/ui/Layout';
import { Tabs } from '../../components/ui/Tabs';
import { fmtDateTime, fmtRelative } from '../../lib/format';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { useListParams } from '../../lib/useListParams';
import { useNotificationMutations, useNotifications } from './api';

const dot: Record<NotificationDto['priority'], string> = { critical: 'bg-crit', high: 'bg-warn', normal: 'bg-primary', low: 'bg-line-strong' };

function NotificationItem({ n, onOpen }: { n: NotificationDto; onOpen: (n: NotificationDto) => void }) {
  return (
    <button onClick={() => onOpen(n)} className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-[13px] hover:bg-canvas ${n.readAt ? '' : 'bg-primary-soft/50'}`}>
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : dot[n.priority]}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className={`block ${n.readAt ? '' : 'font-semibold'}`}>{n.title}</span>
        {n.body && <span className="block truncate text-xs text-muted">{n.body}</span>}
        <span className="block text-xs text-muted">{fmtRelative(n.createdAt)}{n.escalatedAt ? ' · escalated' : ''}</span>
      </span>
    </button>
  );
}

/** Header bell with unread count and the latest notifications. */
export function NotificationBell() {
  const { can } = useAuth();
  const enabled = can('notifications:read');
  const latest = useNotifications({ pageSize: 8 }, enabled);
  const { read, readAll } = useNotificationMutations();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  if (!enabled) return null;
  const unread = latest.data?.unread ?? 0;
  const openItem = (n: NotificationDto) => {
    if (!n.readAt) read.mutate(n.id);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen((o) => !o)} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} className="relative rounded p-2 hover:bg-subtle">
        <Bell className="size-5" aria-hidden />
        {unread > 0 && <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-crit px-1 text-[10px] font-semibold text-white">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-line bg-surface shadow-raised">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-[13px] font-semibold">Notifications</span>
            {unread > 0 && <Button size="sm" variant="ghost" onClick={() => readAll.mutate()}><CheckCheck className="size-3.5" aria-hidden /> Mark all read</Button>}
          </div>
          <div className="max-h-96 divide-y divide-line overflow-y-auto">
            {latest.isPending ? <div className="p-3"><Skeleton className="h-16 w-full" /></div> : latest.data?.data.length ? latest.data.data.map((n) => <NotificationItem key={n.id} n={n} onOpen={openItem} />) : <p className="p-4 text-[13px] text-muted">Nothing yet.</p>}
          </div>
          <Link to="/notifications" onClick={() => setOpen(false)} className="block border-t border-line px-3 py-2 text-center text-[13px] text-primary hover:bg-canvas">See all</Link>
        </div>
      )}
    </div>
  );
}

export function NotificationsPage() {
  const tz = useOrgTimezone();
  const lp = useListParams(['tab'] as const);
  const unreadOnly = lp.values.tab === 'unread';
  const list = useNotifications({ unread: unreadOnly ? 'true' : undefined, page: lp.page, pageSize: 30 });
  const { read, acknowledge, readAll } = useNotificationMutations();
  const navigate = useNavigate();
  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Alerts, incidents and reminders addressed to you. Critical ones escalate to management if nobody acknowledges them within 10 minutes."
        actions={(list.data?.unread ?? 0) > 0 && <Button onClick={() => readAll.mutate()}><CheckCheck className="size-4" aria-hidden /> Mark all read</Button>}
      />
      <Tabs className="mb-4" active={unreadOnly ? 'unread' : 'all'} onChange={(t) => lp.update({ tab: t === 'unread' ? 'unread' : undefined })} tabs={[{ id: 'all', label: 'All' }, { id: 'unread', label: 'Unread', count: list.data?.unread }]} />
      <Card>
        {list.isPending ? (
          <div className="space-y-2 p-4">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : list.data?.data.length ? (
          <ul className="divide-y divide-line">
            {list.data.data.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-3 pr-4">
                <div className="min-w-0 flex-1">
                  <NotificationItem n={n} onOpen={(x) => { if (!x.readAt) read.mutate(x.id); if (x.link) navigate(x.link); }} />
                </div>
                <span className="text-xs text-muted">{fmtDateTime(n.createdAt, tz)}</span>
                {n.priority === 'critical' && !n.acknowledgedAt && (
                  <Button size="sm" onClick={() => acknowledge.mutate(n.id)}>Acknowledge</Button>
                )}
                {n.acknowledgedAt && <span className="text-xs text-ok-strong">Acknowledged</span>}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={unreadOnly ? 'All caught up' : 'No notifications yet'} />
        )}
        {list.data && list.data.meta.total > 30 && (
          <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={list.data.meta.pageSize} onPage={(p) => lp.update({ page: String(p) })} />
        )}
      </Card>
    </div>
  );
}
