'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useEffect, useState, type FormEvent } from 'react';
import { AuthCard } from '../../auth-layout';
import { Button, ErrorText, Field, Input } from '@/components/ui';
import { apiFetch, json } from '@/lib/api';
import { validatePassword } from '@/lib/validation';

interface Info {
  nickname: string;
  household: string;
  expiresAt: string;
}

/** A household member opens their invitation link and chooses their own e-mail and password. */
export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [info, setInfo] = useState<Info | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [pwError, setPwError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let live = true;
    apiFetch<Info>(`/auth/invite/${encodeURIComponent(token)}`)
      .then((i) => {
        if (!live) return;
        setInfo(i);
        setForm((f) => ({ ...f, name: i.nickname }));
      })
      .catch(() => live && setInvalid(true));
    return () => {
      live = false;
    };
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const pw = validatePassword(form.password);
    setPwError(pw);
    if (pw) return;
    setLoading(true);
    try {
      await apiFetch('/auth/accept-invite', { method: 'POST', ...json({ token, ...form }) });
      const res = await signIn('credentials', { email: form.email, password: form.password, redirect: false });
      if (!res || res.error) throw new Error('Your sign-in was created, but signing in failed. Please sign in.');
      router.push('/my');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept the invitation');
    } finally {
      setLoading(false);
    }
  }

  if (invalid) {
    return (
      <AuthCard title="This invitation is not valid" subtitle="It may have expired, been used, or been replaced by a newer one." footer={<Link href="/login" className="font-medium text-brand-700 hover:underline">Sign in</Link>}>
        <p className="text-sm text-slate-600" data-testid="invite-invalid">
          Ask the person who invited you for a new link.
        </p>
      </AuthCard>
    );
  }
  if (!info) return <AuthCard title="Checking your invitation…"><p className="text-sm text-slate-500" role="status">One moment.</p></AuthCard>;

  return (
    <AuthCard title={`Welcome, ${info.nickname}`} subtitle={`Choose your own sign-in for ${info.household}.`}>
      <form onSubmit={onSubmit} className="space-y-4" data-testid="join-form">
        <Field label="Your name" htmlFor="join-name">
          <Input id="join-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
        </Field>
        <Field label="Your e-mail" htmlFor="join-email">
          <Input id="join-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
        </Field>
        <Field label="Choose a password" htmlFor="join-password" hint="At least 10 characters, with a letter and a number or symbol." error={pwError ?? undefined}>
          <Input id="join-password" type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
        </Field>
        <ErrorText error={error ? new Error(error) : null} />
        <Button type="submit" loading={loading} className="w-full">
          Create my sign-in
        </Button>
      </form>
    </AuthCard>
  );
}
