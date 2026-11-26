import { createHash, randomBytes } from 'crypto';
import { InvItem } from '../domain/offer-snapshot-diff';
import { ConnectorContext, ConnectorError, Credentials, EnrollRequest, EnrollResponse, InventoryResult, LoginResult, OfferConnector, SessionBlob } from './connector';

/**
 * A mock issuer for tests and demos: an in-memory site with accounts, MFA, offers and enrollment. It behaves like a
 * real issuer would (sessions that expire, MFA codes, offers that change) so the whole pipeline can be exercised
 * without touching any real bank.
 *
 * Special usernames drive failures: "badpass" fails login, "locked" is locked, "mfa" needs the code 123456,
 * "flaky" times out the first inventory read, "enrollfail" fails every enrollment, "partial" clicks but does not
 * confirm. Any other username works with any password that is not "wrong".
 */
export const MOCK_MFA_CODE = '123456';

interface MockSite {
  offers: Array<InvItem>;
  cards: Array<{ cardKey: string; label: string; lastFour: string | null }>;
  flakyDone: boolean;
}

const sites = new Map<string, MockSite>();
const tokens = new Map<string, { username: string; mfaPending: boolean; expiresAt: number }>();

const day = (n: number) => new Date(Date.now() + n * 86_400_000);

/** Resets the mock world; tests call this in beforeEach. */
export function resetMock(): void {
  sites.clear();
  tokens.clear();
}

/** Sets what a mock user's issuer account shows. */
export function setMockOffers(username: string, offers: InvItem[], cards: MockSite['cards'] = [{ cardKey: '', label: 'Card', lastFour: null }]): void {
  sites.set(username, { offers: offers.map((o) => ({ ...o })), cards, flakyDone: false });
}

export function getMockOffers(username: string): InvItem[] {
  return sites.get(username)?.offers ?? [];
}

/** A small default catalogue so a fresh mock account has something to find. */
export function defaultMockOffers(cardKey = ''): InvItem[] {
  const base = { cardKey, category: null, percent: null, points: null, enrolled: false };
  return [
    { ...base, externalId: 'hilton-250', merchantText: 'Hilton', title: 'Spend $500 or more, get $250 back', offerType: 'STATEMENT_CREDIT', valueCents: 25_000, minSpendCents: 50_000, endsAt: day(30) },
    { ...base, externalId: 'coffee-2', merchantText: 'Corner Coffee', title: 'Get $2 back on $10', offerType: 'STATEMENT_CREDIT', valueCents: 200, minSpendCents: 1_000, endsAt: day(60) },
    { ...base, externalId: 'dk-50', merchantText: 'DraftKings', title: 'Spend $50, get $25 back', offerType: 'STATEMENT_CREDIT', valueCents: 2_500, minSpendCents: 5_000, endsAt: day(20) },
  ];
}

const newToken = () => randomBytes(12).toString('hex');

function open(username: string): MockSite {
  let s = sites.get(username);
  if (!s) {
    s = { offers: defaultMockOffers(), cards: [{ cardKey: '', label: 'Card', lastFour: null }], flakyDone: false };
    sites.set(username, s);
  }
  return s;
}

function sessionFor(token: string) {
  const t = tokens.get(token);
  if (!t) throw new ConnectorError('SESSION_TIMEOUT', 'The session has expired.');
  if (t.expiresAt < Date.now()) {
    tokens.delete(token);
    throw new ConnectorError('SESSION_TIMEOUT', 'The session has expired.');
  }
  if (t.mfaPending) throw new ConnectorError('MFA_REQUIRED', 'Waiting for the verification code.');
  return t;
}

/** Test hook: end a session on the "issuer" side. */
export function expireMockSessions(): void {
  tokens.clear();
}

export class MockConnector implements OfferConnector {
  id = 'mock';
  issuers = ['mock bank'];
  verified = true;
  canEnroll = true;

  async login(creds: Credentials, _ctx: ConnectorContext, deviceTrust?: string): Promise<LoginResult> {
    if (creds.username === 'locked') return { ok: false, kind: 'LOCKED', message: 'The issuer has locked this login.' };
    if (creds.username === 'badpass' || creds.password === 'wrong') return { ok: false, kind: 'BAD_CREDENTIALS', message: 'The issuer rejected the username or password.' };
    const token = newToken();
    const trusted = deviceTrust === trustFor(creds.username);
    const needsMfa = creds.username === 'mfa' && !trusted;
    tokens.set(token, { username: creds.username, mfaPending: needsMfa, expiresAt: Date.now() + 30 * 60_000 });
    const session: SessionBlob = { token, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), pendingMfa: needsMfa };
    if (needsMfa) return { ok: false, needsMfa: true, method: 'SMS', session };
    return { ok: true, session };
  }

  async submitMfa(session: SessionBlob, code: string): Promise<LoginResult> {
    const t = tokens.get(session.token);
    if (!t) return { ok: false, kind: 'SESSION_TIMEOUT', message: 'The verification window has closed. Start again.' };
    if (code !== MOCK_MFA_CODE) return { ok: false, kind: 'MFA_FAILED', message: 'That code was not accepted.' };
    t.mfaPending = false;
    return { ok: true, session: { token: session.token, expiresAt: session.expiresAt, deviceTrust: trustFor(t.username) } };
  }

  async fetchInventory(session: SessionBlob): Promise<InventoryResult> {
    const t = sessionFor(session.token);
    const site = open(t.username);
    if (t.username === 'flaky' && !site.flakyDone) {
      site.flakyDone = true;
      throw new ConnectorError('NETWORK', 'The issuer site timed out.');
    }
    return { items: site.offers.map((o) => ({ ...o })), cards: site.cards };
  }

  async fetchEnrollments(session: SessionBlob) {
    const t = sessionFor(session.token);
    return open(t.username)
      .offers.filter((o) => o.enrolled)
      .map((o) => ({ externalId: o.externalId, cardKey: o.cardKey }));
  }

  async enroll(session: SessionBlob, req: EnrollRequest): Promise<EnrollResponse> {
    const base = { externalId: req.externalId, cardKey: req.cardKey };
    let t;
    try {
      t = sessionFor(session.token);
    } catch (e) {
      const kind = (e as ConnectorError).kind;
      return { ...base, outcome: kind === 'MFA_REQUIRED' ? 'MFA_FAILURE' : 'SESSION_TIMEOUT', message: (e as Error).message };
    }
    const offer = open(t.username).offers.find((o) => o.externalId === req.externalId && o.cardKey === req.cardKey);
    if (!offer) return { ...base, outcome: 'FAILURE', message: 'The offer is no longer shown.' };
    if (offer.enrolled) return { ...base, outcome: 'ALREADY_ADDED' };
    if (t.username === 'enrollfail') return { ...base, outcome: 'FAILURE', message: 'The issuer refused the request.' };
    if (t.username === 'partial') return { ...base, outcome: 'PARTIAL', message: 'The button was pressed but the offer is not shown as added.' };
    offer.enrolled = true;
    return { ...base, outcome: 'SUCCESS' };
  }

  async healthCheck() {
    return { ok: true, message: 'The mock issuer is up.' };
  }
}

const trustFor = (username: string) => createHash('sha256').update(`trust:${username}`).digest('hex').slice(0, 16);
