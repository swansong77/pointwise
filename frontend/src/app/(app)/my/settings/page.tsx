'use client';

import { NotificationPrefs } from '@/components/notification-prefs';
import { PageHeader, Panel, Spinner } from '@/components/ui';
import type { MemberMe } from '@/lib/member';
import { useAuthedQuery } from '@/lib/queries';

/** A household member's own settings: how and when they hear from PointWise. These are theirs alone. */
export default function MySettingsPage() {
  const me = useAuthedQuery<MemberMe>(['member', 'me'], '/member/me');
  if (me.isLoading) return <Spinner label="Loading settings" />;
  return (
    <div className="space-y-6">
      <PageHeader title="My settings" subtitle="How and when you hear from PointWise. Your choices apply only to you; the household owner has their own." />
      {me.data && (
        <Panel title="My sign-in" data-testid="my-signin">
          <p className="text-sm text-slate-700">
            You sign in as <strong>{me.data.email}</strong> in {me.data.household}. To change your password, use <em>Forgot password</em> on the sign-in page.
          </p>
        </Panel>
      )}
      <NotificationPrefs member />
    </div>
  );
}
