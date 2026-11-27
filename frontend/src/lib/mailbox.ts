export interface MailboxView {
  id: string;
  /** the household member this mailbox feeds; null = the whole household */
  profile?: { id: string; nickname: string } | null;
  kind: 'IMAP' | 'GMAIL' | 'GRAPH';
  label: string;
  host: string | null;
  port: number | null;
  username: string;
  folder: string;
  active: boolean;
  lastSyncAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  processed: number;
}

/** Host and port hints for common providers (the user still needs an app password). */
export const MAILBOX_PRESETS: Array<{ id: string; label: string; host: string; hint: string }> = [
  { id: 'gmail', label: 'Gmail', host: 'imap.gmail.com', hint: 'Turn on 2-step verification, then create an app password in your Google account.' },
  { id: 'outlook', label: 'Outlook.com', host: 'outlook.office365.com', hint: 'Use an app password if your account has two-step verification; some accounts require OAuth, which is not supported yet.' },
  { id: 'yahoo', label: 'Yahoo', host: 'imap.mail.yahoo.com', hint: 'Create an app password under Account security.' },
  { id: 'icloud', label: 'iCloud', host: 'imap.mail.me.com', hint: 'Create an app-specific password at appleid.apple.com.' },
  { id: 'other', label: 'Other (IMAP)', host: '', hint: 'Enter your provider’s IMAP server (port 993).' },
];

export interface MailboxProviders {
  gmail: boolean;
  outlook: boolean;
  redirectUri: string;
}

export const KIND_LABEL: Record<MailboxView['kind'], string> = { IMAP: 'IMAP', GMAIL: 'Gmail', GRAPH: 'Outlook' };

/** Message shown after the provider sends the browser back (query string of /spending). */
export function oauthBanner(search: string): { tone: 'ok' | 'error'; text: string } | null {
  const q = new URLSearchParams(search);
  const v = q.get('mailbox');
  if (v === 'connected') return { tone: 'ok', text: 'Mailbox connected. It will sync every 15 minutes, or use Sync now.' };
  if (v === 'error') return { tone: 'error', text: q.get('reason') || 'The mailbox could not be connected.' };
  return null;
}

export function syncLabel(m: Pick<MailboxView, 'lastStatus' | 'lastSyncAt' | 'lastError'>): string {
  if (m.lastStatus === 'RECONNECT') return 'Reconnect needed — access was revoked or expired';
  if (!m.lastSyncAt) return 'Not synced yet';
  if (m.lastStatus === 'ERROR') return `Last sync failed: ${m.lastError ?? 'unknown error'}`;
  return 'Synced';
}
