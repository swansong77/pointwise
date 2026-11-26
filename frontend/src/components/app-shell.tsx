'use client';

import { Logo } from '@/components/logo';
import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useEffect, useState, type ReactNode } from 'react';
import { useUnreadCount } from '@/lib/queries';
import { initials } from '@/lib/format';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { href: '/assistant', label: 'Assistant', icon: '✨' },
  { href: '/wallet', label: 'Wallet', icon: '💳' },
  { href: '/portfolio', label: 'Portfolio', icon: '📊' },
  { href: '/benefits', label: 'Benefits', icon: '🎁' },
  { href: '/benefits/audit', label: 'Benefit Audit', icon: '🔎' },
  { href: '/benefits/reconciliation', label: 'Reconcile', icon: '⚖️' },
  { href: '/spending', label: 'Spending', icon: '🧾' },
  { href: '/five24', label: '5/24', icon: '⏳' },
  { href: '/next-card', label: 'Next Card', icon: '🧭' },
  { href: '/travel', label: 'Travel', icon: '✈️' },
  { href: '/household', label: 'Household', icon: '👪' },
  { href: '/import', label: 'Import', icon: '📥' },
  { href: '/offers', label: 'Offers', icon: '🏷️' },
  { href: '/offers/market', label: 'Offer Market', icon: '📈' },
  { href: '/offers/intel', label: 'Offer Intelligence', icon: '🎯' },
  { href: '/offers/plan', label: 'Plan a Purchase', icon: '🧭' },
  { href: '/loyalty', label: 'Loyalty Assets', icon: '✈️' },
  { href: '/nearby', label: 'Nearby', icon: '📍' },
  { href: '/merchants', label: 'Merchants', icon: '🏪' },
  { href: '/brands', label: 'Brand Logos', icon: '🖼️' },
  { href: '/calculator', label: 'Calculator', icon: '🧮' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const unread = useUnreadCount();
  const [open, setOpen] = useState(false);
  const isAdmin = session?.user?.role === 'ADMIN';

  useEffect(() => {
    if (session?.error === 'RefreshAccessTokenError') void signOut({ callbackUrl: '/login' });
  }, [session?.error]);
  useEffect(() => setOpen(false), [pathname]);

  const links = isAdmin
    ? [
        ...NAV,
        { href: '/admin', label: 'Admin', icon: '🛠️' },
        { href: '/admin/ai', label: 'AI & MCP', icon: '🤖' },
        { href: '/admin/catalog', label: 'Card Data', icon: '🗂️' },
        { href: '/admin/ops', label: 'Operations', icon: '🩺' },
      ]
    : NAV;

  return (
    <div className="min-h-screen bg-slate-50">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <button className="md:hidden" aria-label="Toggle navigation" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            ☰
          </button>
          <Link href="/dashboard" className="flex items-center" aria-label="PointWise home">
            <Logo size="sm" />
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/notifications"
              className="relative rounded-full p-2 hover:bg-slate-100"
              aria-label={`Notifications (${unread.data?.count ?? 0} unread)`}
              data-testid="nav-notifications"
            >
              🔔
              {!!unread.data?.count && (
                <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold text-white" data-testid="unread-badge">
                  {unread.data.count}
                </span>
              )}
            </Link>
            <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700" title={session?.user?.email}>
              {initials(session?.user?.name, session?.user?.email)}
            </span>
            <button className="text-sm text-slate-600 hover:text-slate-900" onClick={() => signOut({ callbackUrl: '/login' })} data-testid="sign-out">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6">
        <nav aria-label="Main" className={clsx('w-48 shrink-0 md:block', open ? 'fixed inset-x-0 top-14 z-20 block bg-white p-4 shadow-lg' : 'hidden')}>
          <ul className="space-y-1">
            {links.map((l) => {
              const active = pathname === l.href || pathname.startsWith(l.href + '/');
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    aria-current={active ? 'page' : undefined}
                    className={clsx(
                      'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
                      active ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-700 hover:bg-slate-100',
                    )}
                  >
                    <span aria-hidden>{l.icon}</span> {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
