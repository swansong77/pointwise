import { ImapFlow } from 'imapflow';
import { domainOf, senderAllowed } from '../domain/email-alerts';
import { FetchResult, MailboxConfig, MailboxConnector, RawMessage } from './connector';

/** The slice of ImapFlow this adapter uses (so tests can supply a fake). */
export interface ImapClientLike {
  connect(): Promise<void>;
  logout(): Promise<void>;
  getMailboxLock(path: string, opts?: { readOnly?: boolean }): Promise<{ release(): void }>;
  mailbox: { uidValidity?: bigint | number; uidNext?: number } | false;
  search(query: Record<string, unknown>, opts?: { uid?: boolean }): Promise<number[] | false>;
  fetch(range: string | number[], query: Record<string, unknown>, opts?: { uid?: boolean }): AsyncIterable<{ uid: number; envelope?: { from?: Array<{ address?: string }> }; source?: Buffer }>;
}

export type ImapClientFactory = (cfg: MailboxConfig) => ImapClientLike;

export const defaultImapClient: ImapClientFactory = (cfg) =>
  new ImapFlow({
    host: cfg.host ?? '',
    port: cfg.port ?? 993,
    secure: (cfg.port ?? 993) !== 143,
    auth: { user: cfg.username, pass: cfg.password },
    logger: false,
    // read-only use: no IDLE, short timeouts
    socketTimeout: 30_000,
  }) as unknown as ImapClientLike;

export function parseCursor(c: string | null): { validity: string; last: number } | null {
  const m = /^(\d+):(\d+)$/.exec(c ?? '');
  return m ? { validity: m[1], last: Number(m[2]) } : null;
}

const CONNECT_CODES: Record<string, string> = {
  ENOTFOUND: 'the server name was not found',
  ECONNREFUSED: 'the server refused the connection (check the port)',
  ETIMEDOUT: 'the server did not answer in time',
  ECONNRESET: 'the connection was closed by the server',
};

/** Why the sign-in failed, in words: the library's own message is only "Command failed". Never includes the password. */
export function signInReason(e: unknown): string {
  const x = e as { authenticationFailed?: boolean; responseText?: string; serverResponseCode?: string; code?: string; message?: string };
  const said = (x.responseText ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (x.authenticationFailed || /^AUTHENTICATIONFAILED$/i.test(x.serverResponseCode ?? ''))
    return `the server rejected the user name or password${said ? ` (it said: ${said})` : ''}`;
  if (x.code && CONNECT_CODES[x.code]) return CONNECT_CODES[x.code];
  return said || x.message || 'unknown error';
}

/** IMAP over TLS, read-only (`EXAMINE`): lists new UIDs, checks the sender from the envelope, then fetches only matching messages. */
export class ImapConnector implements MailboxConnector {
  constructor(
    private readonly cfg: MailboxConfig,
    private readonly make: ImapClientFactory = defaultImapClient,
  ) {}

  private async withClient<T>(fn: (c: ImapClientLike) => Promise<T>): Promise<T> {
    const c = this.make(this.cfg);
    try {
      await c.connect();
    } catch (e) {
      throw new Error(`Could not sign in to the mailbox: ${signInReason(e)}`.slice(0, 240));
    }
    try {
      return await fn(c);
    } finally {
      await c.logout().catch(() => undefined);
    }
  }

  async verify(): Promise<void> {
    await this.withClient(async (c) => {
      const lock = await c.getMailboxLock(this.cfg.folder, { readOnly: true }).catch(() => {
        throw new Error(`Folder "${this.cfg.folder}" was not found`);
      });
      lock.release();
    });
  }

  async fetchNew(cursor: string | null, opts: { allowedDomains: string[]; sinceDays: number; max: number }): Promise<FetchResult> {
    return this.withClient(async (c) => {
      const lock = await c.getMailboxLock(this.cfg.folder, { readOnly: true });
      try {
        const validity = String(c.mailbox ? (c.mailbox.uidValidity ?? 0) : 0);
        const prev = parseCursor(cursor);
        // a changed UIDVALIDITY invalidates old UIDs: start over from the recent window
        const resume = prev && prev.validity === validity ? prev.last : null;
        const query = resume != null ? { uid: `${resume + 1}:*` } : { since: new Date(Date.now() - opts.sinceDays * 86_400_000) };
        const uids = ((await c.search(query, { uid: true })) || []).filter((u) => resume == null || u > resume).sort((a, b) => a - b);
        const batch = uids.slice(0, opts.max);
        const wanted: number[] = [];
        // headers first: only the envelope, to check the sender before reading any body
        if (batch.length)
          for await (const m of c.fetch(batch, { uid: true, envelope: true }, { uid: true })) {
            const from = m.envelope?.from?.[0]?.address ?? '';
            if (senderAllowed(domainOf(`<${from}>`), opts.allowedDomains)) wanted.push(m.uid);
          }
        const messages: RawMessage[] = [];
        if (wanted.length)
          for await (const m of c.fetch(wanted, { uid: true, source: true }, { uid: true }))
            if (m.source) messages.push({ id: String(m.uid), raw: m.source });
        // nothing new: remember where the mailbox ends so older mail is never read later
        const end = c.mailbox && c.mailbox.uidNext ? c.mailbox.uidNext - 1 : 0;
        const last = batch.length ? batch[batch.length - 1] : (resume ?? end);
        return { messages, cursor: `${validity}:${last}`, more: uids.length > batch.length };
      } finally {
        lock.release();
      }
    });
  }
}
