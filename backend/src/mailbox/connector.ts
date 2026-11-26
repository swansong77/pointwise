/**
 * Mailbox connector abstraction (ADR-002): read-only access to a mailbox, provider-neutral. Adapters
 * return only messages from allow-listed senders and never write, move or delete mail.
 */
export interface RawMessage {
  /** provider-unique id (IMAP UID) */
  id: string;
  /** the full RFC 5322 message, processed in memory and never stored */
  raw: Buffer;
}

export interface FetchResult {
  messages: RawMessage[];
  /** opaque cursor to resume from (IMAP: "uidValidity:lastUid") */
  cursor: string;
  /** more mail is waiting beyond this batch */
  more: boolean;
}

export interface MailboxConnector {
  /** Verifies the login and the folder; throws a user-presentable Error on failure. */
  verify(): Promise<void>;
  /** New messages since `cursor` (or the last `sinceDays` days on first sync) from the allowed sender domains. */
  fetchNew(cursor: string | null, opts: { allowedDomains: string[]; sinceDays: number; max: number }): Promise<FetchResult>;
}

export interface MailboxConfig {
  kind: 'IMAP' | 'GMAIL' | 'GRAPH';
  host: string | null;
  port: number | null;
  username: string;
  password: string;
  folder: string;
}

/** Authentication-Results id each known provider stamps, so DKIM/DMARC results can be trusted. */
export function authservIdFor(host: string | null): string | undefined {
  const h = (host ?? '').toLowerCase();
  if (h.endsWith('gmail.com') || h.endsWith('googlemail.com')) return 'mx.google.com';
  return undefined; // unknown provider: senders cannot be verified, records are marked unverified
}
