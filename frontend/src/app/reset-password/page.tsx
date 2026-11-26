'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { AuthCard } from '../auth-layout';
import { Button, ErrorText, Field, Input } from '@/components/ui';
import { apiFetch, json } from '@/lib/api';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/auth/reset-password', { method: 'POST', ...json({ token, password }) });
      setDone(true);
    } catch (err) {
      setError(err);
    }
  }

  if (done)
    return (
      <p role="status" className="text-sm text-emerald-700">
        Password updated.{' '}
        <Link href="/login" className="font-medium underline">
          Sign in
        </Link>
      </p>
    );
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="New password" htmlFor="password">
        <Input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <ErrorText error={error} />
      <Button type="submit" className="w-full" disabled={!token}>
        Update password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthCard title="Choose a new password">
      <Suspense>
        <ResetForm />
      </Suspense>
    </AuthCard>
  );
}
