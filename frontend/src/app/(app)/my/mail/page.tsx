'use client';

import { AutoCapture } from '@/components/auto-capture';
import { MailboxPanel } from '@/components/mailbox-panel';
import { PageHeader } from '@/components/ui';

/** A household member's own mail channels: their private alert address and their own mailboxes. Everything here feeds only their own cards and points. */
export default function MyMailPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="My mail and alerts" subtitle="Connect your own mailbox or forward your card alerts to your own private address. They update only your cards and points." />
      <AutoCapture member />
      <MailboxPanel />
    </div>
  );
}
