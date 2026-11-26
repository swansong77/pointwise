import Link from 'next/link';
import { Logo } from '@/components/logo';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (session) redirect('/dashboard');
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
      <Logo size="xl" className="mb-6" />
      <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">Use the right card. Every time.</h1>
      <p className="mt-4 text-lg text-slate-600">
        Pointwise shows your best card for every store and category, tracks card-linked offers before they expire, and keeps
        welcome bonuses and annual fees on schedule.
      </p>
      <div className="mt-8 flex gap-3">
        <Link href="/signup" className="rounded-lg bg-brand-600 px-5 py-2.5 font-medium text-white hover:bg-brand-700">
          Get started — free
        </Link>
        <Link href="/login" className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 font-medium text-slate-800 hover:bg-slate-50">
          Sign in
        </Link>
      </div>
      <p className="mt-10 text-xs text-slate-500">We never ask for card numbers or bank logins.</p>
    </main>
  );
}
