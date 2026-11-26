import { Suspense } from 'react';
import Link from 'next/link';
import { AuthCard } from '../auth-layout';
import { LoginForm } from './login-form';
import { enabledOAuthProviders } from '@/lib/auth';

export const metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <AuthCard
      title="Sign in"
      subtitle="Welcome back."
      footer={
        <>
          New here?{' '}
          <Link className="font-medium text-brand-700 hover:underline" href="/signup">
            Create an account
          </Link>
        </>
      }
    >
      <Suspense>
        <LoginForm providers={enabledOAuthProviders()} />
      </Suspense>
    </AuthCard>
  );
}
