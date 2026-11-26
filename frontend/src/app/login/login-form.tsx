'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useState, type FormEvent } from 'react';
import { Button, ErrorText, Field, Input } from '@/components/ui';

/** Only allow same-origin relative callback paths (prevents open redirects). */
export function safeCallback(raw: string | null): string {
  if (!raw) return '/dashboard';
  try {
    const u = new URL(raw, 'http://local');
    if (u.origin !== 'http://local' && typeof window !== 'undefined' && u.origin !== window.location.origin) return '/dashboard';
    const path = u.pathname + u.search;
    return path.startsWith('/') && !path.startsWith('//') && path !== '/login' ? path : '/dashboard';
  } catch {
    return '/dashboard';
  }
}

export function LoginForm({ providers }: { providers: { google: boolean; apple: boolean } }) {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = safeCallback(params.get('callbackUrl'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(params.get('error') ? 'Sign-in failed. Please try again.' : null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await signIn('credentials', { email, password, redirect: false });
    setLoading(false);
    if (!res || res.error) {
      setError('Invalid email or password');
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <ErrorText error={error} />}
        <Button type="submit" className="w-full" loading={loading} data-testid="login-submit">
          Sign in
        </Button>
      </form>
      <div className="flex justify-end text-sm">
        <Link href="/forgot-password" className="text-brand-700 hover:underline">
          Forgot password?
        </Link>
      </div>
      {(providers.google || providers.apple) && (
        <div className="space-y-2 border-t border-slate-200 pt-5">
          {providers.google && (
            <Button variant="secondary" className="w-full" onClick={() => signIn('google', { callbackUrl })}>
              Continue with Google
            </Button>
          )}
          {providers.apple && (
            <Button variant="secondary" className="w-full" onClick={() => signIn('apple', { callbackUrl })}>
              Continue with Apple
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
