'use client';

import { Logo } from '@/components/logo';
import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useEffect, useState, type ReactNode } from 'react';
import { CommandBar } from '@/components/command-bar';
import { ADMIN_NAV, MEMBER_HOUSEHOLD_NAV, MEMBER_NAV, NAV } from '@/lib/nav';
import { ASK_EVENT, isOpenShortcut } from '@/lib/search';
import { useUnreadCount } from '@/lib/queries';
import { initials } from '@/lib/format';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const member = session?.user?.member;
  const unread = useUnreadCount();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [seed, setSeed] = useState<{ q: string; nonce: number } | null>(null);
  const [mac, setMac] = useState(false);
  const isAdmin = session?.user?.role === 'ADMIN';

  useEffect(() => {
    if (session?.error === 'RefreshAccessTokenError') void signOut({ callbackUrl: '/login' });
  }, [session?.error]);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => setSearchOpen(false), [pathname]);
  // Ctrl+K or Cmd+K opens the search bar from any page; the platform decides which key the hint shows
  useEffect(() => {
    setMac(/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent));
    const onKey = (e: KeyboardEvent) => {
      if (!isOpenShortcut(e)) return;
      e.preventDefault();
      setSearchOpen((v) => !v);
    };
    // any page can ask the bar a question (the search history page's "run again")
    const onAsk = (e: Event) => {
      const q = (e as CustomEvent<string>).detail;
      if (typeof q === 'string' && q.trim()) {
        setSeed({ q, nonce: Date.now() });
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(ASK_EVENT, onAsk);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(ASK_EVENT, onAsk);
    };
  }, []);

  // a member's own sign-in sees only their own pages; the server denies the rest as well
  const links = member ? (member.visibility === 'HOUSEHOLD' ? [...MEMBER_NAV, MEMBER_HOUSEHOLD_NAV] : MEMBER_NAV) : isAdmin ? [...NAV, ...ADMIN_NAV] : NAV;

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
          <Link href={member ? '/my' : '/dashboard'} className="flex items-center" aria-label="PointWise home">
            <Logo size="sm" />
          </Link>
          <div className="ml-auto flex items-center gap-3">
            {!member && (<><button
              type="button"
              onClick={() => setSearchOpen(true)}
              data-testid="search-trigger"
              aria-label="Search or ask a question"
              aria-keyshortcuts="Control+K Meta+K"
              className="hidden items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500 md:flex"
            >
              <span aria-hidden>🔍</span>
              <span>Search or ask…</span>
              <kbd className="rounded border border-slate-300 px-1.5 text-xs text-slate-600">{mac ? '⌘K' : 'Ctrl K'}</kbd>
            </button>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Search or ask a question"
              data-testid="search-trigger-mobile"
              className="rounded-full p-2 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand-500 md:hidden"
            >
              <span aria-hidden>🔍</span>
            </button></>)}
            <Link
              href={member ? '/my/notifications' : '/notifications'}
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
      {!member && <button
        type="button"
        onClick={() => setSearchOpen(true)}
        aria-label="Search or ask a question"
        data-testid="search-fab"
        className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-40 grid h-12 w-12 place-items-center rounded-full bg-brand-600 text-xl text-white shadow-lg hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 md:hidden"
      >
        <span aria-hidden>🔍</span>
      </button>}
      {!member && <CommandBar open={searchOpen} onClose={() => setSearchOpen(false)} isAdmin={isAdmin} seed={seed} />}
    </div>
  );
}
