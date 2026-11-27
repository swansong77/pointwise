'use client';

import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import Link from 'next/link';
import { Button, EmptyState, ErrorText, PageHeader, Spinner } from '@/components/ui';
import { qk, useApiMutation, useNotifications } from '@/lib/queries';
import { shortDate } from '@/lib/format';

const ICON: Record<string, string> = { OFFER_EXPIRING: '⏰', CARD_RENEWAL: '💳', BONUS_DEADLINE: '🎯', OFFER_ALERT: '🔔', SYSTEM: 'ℹ️' };

export default function NotificationsPage() {
  const list = useNotifications();
  const qc = useQueryClient();
  const invalidate = [qk.notifications] as const; // prefix also matches the unread-count key
  const readOne = useApiMutation<string>((id) => ({ path: `/notifications/${id}/read`, method: 'POST' }), invalidate);
  const readAll = useApiMutation<void>(() => ({ path: '/notifications/read-all', method: 'POST' }), invalidate);
  // Update the header badge immediately and deterministically (no dependence on refetch timing).
  const setUnread = (fn: (n: number) => number) =>
    qc.setQueryData<{ count: number }>(qk.unread, (old) => ({ count: Math.max(0, fn(old?.count ?? 0)) }));
  const markOne = (id: string) => readOne.mutate(id, { onSuccess: () => setUnread((n) => n - 1) });
  const markAll = () => readAll.mutate(undefined, { onSuccess: () => setUnread(() => 0) });
  const hasUnread = list.data?.some((n) => !n.readAt);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        action={
          hasUnread && (
            <Button variant="secondary" onClick={markAll} loading={readAll.isPending} data-testid="read-all">
              Mark all read
            </Button>
          )
        }
      />
      {list.isLoading && <Spinner />}
      <ErrorText error={list.error} />
      {list.data?.length === 0 && <EmptyState title="You're all caught up" />}
      <ul className="space-y-2" data-testid="notification-list">
        {list.data?.map((n) => (
          <li key={n.id} className={clsx('flex gap-3 rounded-xl border p-4', n.readAt ? 'border-slate-200 bg-white' : 'border-brand-200 bg-brand-50/50')} data-testid="notification">
            <span className="text-xl" aria-hidden>
              {ICON[n.type] ?? '•'}
            </span>
            <div className="min-w-0 flex-1">
              <p className={clsx('text-sm', !n.readAt && 'font-semibold')}>{n.title}</p>
              <p className="text-sm text-slate-600">{n.body}</p>
              <p className="mt-1 text-xs text-slate-600">{shortDate(n.createdAt)}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              {n.link && (
                <Link href={n.link} className="text-sm text-brand-700 hover:underline" onClick={() => !n.readAt && markOne(n.id)}>
                  View
                </Link>
              )}
              {!n.readAt && (
                <button className="text-xs text-slate-700 underline hover:text-slate-900" onClick={() => markOne(n.id)}>
                  Mark read
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
