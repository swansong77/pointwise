'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useState, type FormEvent } from 'react';
import { AuthCard } from '../auth-layout';
import { Button, ErrorText, Field, Input } from '@/components/ui';
import { apiFetch, json } from '@/lib/api';
import { validatePassword } from '@/lib/validation';

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const pw = validatePassword(form.password);
    setPwError(pw);
    if (pw) return;
    setLoading(true);
    try {
      await apiFetch('/auth/register', { method: 'POST', ...json(form) });
      const res = await signIn('credentials', { email: form.email, password: form.password, redirect: false });
      if (!res || res.error) throw new Error('Account created, but sign-in failed. Please sign in.');
      router.push('/wallet?welcome=1');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-up failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Free forever for up to 5 cards."
      footer={
        <>
          Already have an account?{' '}
          <Link className="font-medium text-brand-700 hover:underline" href="/login">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Name" htmlFor="name">
          <Input id="name" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters with a letter and a number or symbol." error={pwError ?? undefined}>
          <Input id="password" type="password" autoComplete="new-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        {error && <ErrorText error={error} />}
        <Button type="submit" className="w-full" loading={loading} data-testid="signup-submit">
          Create account
        </Button>
        <p className="text-xs text-slate-500">By continuing you agree to the Terms and Privacy Policy. We never store card numbers.</p>
      </form>
    </AuthCard>
  );
}
