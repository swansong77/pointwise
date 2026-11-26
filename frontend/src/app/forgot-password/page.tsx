'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { AuthCard } from '../auth-layout';
import { Button, ErrorText, Field, Input } from '@/components/ui';
import { apiFetch, json } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiFetch('/auth/forgot-password', { method: 'POST', ...json({ email }) });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title="Reset your password"
      footer={
        <Link href="/login" className="text-brand-700 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          If an account exists for that email, we sent a reset link. It expires in 1 hour.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <ErrorText error={error} />
          <Button type="submit" className="w-full" loading={loading}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
