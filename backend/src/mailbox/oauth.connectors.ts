import { domainOf, senderAllowed } from '../domain/email-alerts';
import { FetchResult, MailboxConnector, RawMessage } from './connector';
import { FetchLike, OAuthError, OAuthKind, refreshAccess } from './oauth';

/** An authorised mailbox: turns the stored refresh token into short-lived access tokens, saving a rotated refresh token. */
export interface OAuthSession {
  kind: OAuthKind;
  refreshToken: string;
  creds: { clientId: string; clientSecret: string };
  fetch: FetchLike;
  /** called when the provider issues a new refresh token (Microsoft rotates them) */
  onRotate?: (token: string) => Promise<void>;
}

async function accessToken(s: OAuthSession): Promise<string> {
  const t = await refreshAccess(s.kind, s.refreshToken, s.creds, s.fetch);
  if (t.refreshToken && t.refreshToken !== s.refreshToken) {
    s.refreshToken = t.refreshToken;
    await s.onRotate?.(t.refreshToken);
  }
  return t.accessToken;
}

async function getJson<T>(s: OAuthSession, token: string, url: string): Promise<T> {
  const res = await s.fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
  if (res.status === 401 || res.status === 403) throw new OAuthError('The provider refused access — connect the mailbox again', true);
  if (res.status === 429) throw new Error('The provider is rate-limiting requests; will retry on the next sync');
  if (!res.ok) throw new Error(`Mail request failed (${res.status})`);
  return (await res.json()) as T;
}

const DAY = 86_400_000;
const ymd = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
};

// ───────────── Gmail ─────────────

interface GmailList {
  messages?: Array<{ id: string }>;
  nextPageToken?: string;
}
interface GmailRaw {
  id: string;
  raw?: string;
  internalDate?: string;
}

/** Gmail API, read-only (gmail.readonly). Searches by sender with `q`, then fetches each message as raw RFC 2822. */
export class GmailConnector implements MailboxConnector {
  private readonly base = 'https://gmail.googleapis.com/gmail/v1/users/me';
  constructor(private readonly s: OAuthSession) {}

  async verify(): Promise<void> {
    const t = await accessToken(this.s);
    await getJson(this.s, t, `${this.base}/profile`);
  }

  /** The signed-in address (used as the mailbox's name). */
  async address(): Promise<string> {
    const t = await accessToken(this.s);
    return (await getJson<{ emailAddress: string }>(this.s, t, `${this.base}/profile`)).emailAddress;
  }

  async fetchNew(cursor: string | null, opts: { allowedDomains: string[]; sinceDays: number; max: number }): Promise<FetchResult> {
    const t = await accessToken(this.s);
    const since = /^\d+$/.test(cursor ?? '') ? Number(cursor) : Date.now() - opts.sinceDays * DAY;
    // Gmail's date operators are day-granular: ask from the day before, then keep only newer internalDate
    const q = `from:(${opts.allowedDomains.join(' OR ')}) after:${ymd(since - DAY)}`;
    const ids: string[] = [];
    let page: string | undefined;
    for (let i = 0; i < 3; i++) {
      const params = new URLSearchParams({ q, maxResults: '100', ...(page ? { pageToken: page } : {}) });
      const list = await getJson<GmailList>(this.s, t, `${this.base}/messages?${params}`);
      ids.push(...(list.messages ?? []).map((m) => m.id));
      page = list.nextPageToken;
      if (!page) break;
    }
    const found: Array<{ id: string; at: number; raw: Buffer }> = [];
    for (const id of ids) {
      const m = await getJson<GmailRaw>(this.s, t, `${this.base}/messages/${id}?format=raw`);
      const at = Number(m.internalDate ?? 0);
      if (at > since && m.raw) found.push({ id, at, raw: Buffer.from(m.raw, 'base64url') });
    }
    found.sort((a, b) => a.at - b.at);
    const batch = found.slice(0, opts.max);
    const messages: RawMessage[] = batch.map((m) => ({ id: m.id, raw: m.raw }));
    // nothing new: move the window to just before now so old mail is never re-read
    const next = batch.length ? batch[batch.length - 1].at : Math.max(since, Date.now() - 5 * 60_000);
    return { messages, cursor: String(next), more: found.length > batch.length };
  }
}

// ───────────── Microsoft Graph ─────────────

interface GraphList {
  value: Array<{ id: string; receivedDateTime: string; from?: { emailAddress?: { address?: string } } }>;
  '@odata.nextLink'?: string;
}

/** Microsoft Graph, read-only (Mail.Read). Lists new messages, checks the sender, then fetches the MIME of matches. */
export class GraphConnector implements MailboxConnector {
  private readonly base = 'https://graph.microsoft.com/v1.0/me';
  constructor(private readonly s: OAuthSession) {}

  async verify(): Promise<void> {
    const t = await accessToken(this.s);
    await getJson(this.s, t, `${this.base}?$select=mail,userPrincipalName`);
  }

  async address(): Promise<string> {
    const t = await accessToken(this.s);
    const me = await getJson<{ mail?: string; userPrincipalName?: string }>(this.s, t, `${this.base}?$select=mail,userPrincipalName`);
    return me.mail ?? me.userPrincipalName ?? 'microsoft-account';
  }

  async fetchNew(cursor: string | null, opts: { allowedDomains: string[]; sinceDays: number; max: number }): Promise<FetchResult> {
    const t = await accessToken(this.s);
    const since = cursor && !Number.isNaN(Date.parse(cursor)) ? cursor : new Date(Date.now() - opts.sinceDays * DAY).toISOString();
    // the order-by property comes first in the filter, as Graph requires
    const first = `${this.base}/messages?${new URLSearchParams({
      $filter: `receivedDateTime gt ${since}`,
      $orderby: 'receivedDateTime asc',
      $select: 'id,receivedDateTime,from',
      $top: '50',
    })}`;
    const scanned: GraphList['value'] = [];
    let url: string | undefined = first;
    let more = false;
    for (let i = 0; url; i++) {
      if (i >= 3) {
        more = true;
        break;
      }
      const page: GraphList = await getJson<GraphList>(this.s, t, url);
      scanned.push(...page.value);
      url = page['@odata.nextLink'];
    }
    const messages: RawMessage[] = [];
    for (const m of scanned) {
      if (!senderAllowed(domainOf(`<${m.from?.emailAddress?.address ?? ''}>`), opts.allowedDomains)) continue; // headers first: strangers' mail is never opened
      if (messages.length >= opts.max) {
        more = true;
        break;
      }
      const res = await this.s.fetch(`${this.base}/messages/${m.id}/$value`, { headers: { authorization: `Bearer ${t}` } });
      if (!res.ok) throw new Error(`Mail request failed (${res.status})`);
      messages.push({ id: m.id, raw: Buffer.from(await res.arrayBuffer()) });
    }
    // advance past everything scanned (matched or not); if the batch was cut short, stop at the last one read
    const lastRead = messages.length && more ? scanned[scanned.findIndex((m) => m.id === messages[messages.length - 1].id)] : scanned[scanned.length - 1];
    return { messages, cursor: lastRead?.receivedDateTime ?? since, more };
  }
}
