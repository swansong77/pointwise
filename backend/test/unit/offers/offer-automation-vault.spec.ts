import { ConnectorError, ConnectorRegistry } from '../../../src/offer-automation/connector';
import { credentialHint, openCredentials, openSession, openText, redact, sealCredentials, sealSession, sealText, sessionUsable } from '../../../src/offer-automation/credential-vault';
import { FlowConnector, ISSUER_FLOWS } from '../../../src/offer-automation/issuer-flows';
import { defaultMockOffers, expireMockSessions, MockConnector, MOCK_MFA_CODE, resetMock, setMockOffers } from '../../../src/offer-automation/mock-connector';
import { defaultRegistry } from '../../../src/offer-automation/offer-automation.module';

process.env.TOKEN_ENC_KEY = 'unit-test-token-encryption-key-0123456789';

describe('credential vault', () => {
  it('round-trips a login, session and text without storing plaintext', () => {
    const enc = sealCredentials({ username: 'alex@example.test', password: 'p@ss word' });
    expect(enc).toMatch(/^v1\./);
    expect(enc).not.toContain('alex');
    expect(enc).not.toContain('word');
    expect(openCredentials(enc)).toEqual({ username: 'alex@example.test', password: 'p@ss word' });
    expect(sealCredentials({ username: 'a', password: 'b' })).not.toBe(sealCredentials({ username: 'a', password: 'b' }));
    const s = { token: 't1', expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
    expect(openSession(sealSession(s))).toEqual(s);
    expect(openText(sealText('trust-marker'))).toBe('trust-marker');
  });

  it('a tampered ciphertext does not decrypt', () => {
    const enc = sealText('secret');
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => openText(parts.join('.'))).toThrow();
  });

  it('hints show almost nothing', () => {
    expect(credentialHint('alexander')).toBe('a••••••r');
    expect(credentialHint('ab')).toBe('••');
    expect(credentialHint('abc')).toBe('a•c');
    expect(credentialHint('a-very-long-user-name')).toBe('a••••••e');
  });

  it('redacts anything secret-looking, at any depth', () => {
    const out = redact({ merchant: 'Hilton', password: 'x', nested: { sessionToken: 'y', ok: 1, list: [{ otpCode: '123', n: 2 }] }, authorization: 'Bearer z' });
    expect(JSON.stringify(out)).not.toMatch(/"x"|"y"|123|Bearer/);
    expect(out.merchant).toBe('Hilton');
    expect((out.nested as { ok: number }).ok).toBe(1);
    expect(redact('plain')).toBe('plain');
    expect(redact(null)).toBeNull();
  });

  it('judges whether a session can still be used', () => {
    const now = new Date();
    const good = { token: 't', expiresAt: new Date(now.getTime() + 3_600_000).toISOString() };
    expect(sessionUsable(good, now)).toBe(true);
    expect(sessionUsable({ ...good, pendingMfa: true }, now)).toBe(false);
    expect(sessionUsable({ ...good, expiresAt: new Date(now.getTime() + 10_000).toISOString() }, now)).toBe(false);
    expect(sessionUsable(null, now)).toBe(false);
  });
});

describe('connector registry and flows', () => {
  it('ships the mock plus six unverified issuer flows, found by issuer name', () => {
    const r = defaultRegistry();
    expect(r.list()).toHaveLength(7);
    for (const name of ['American Express', 'Chase', 'Citi', 'Bank of America', 'Capital One', 'Wells Fargo']) {
      const c = r.forIssuer(name);
      expect(c?.verified).toBe(false);
    }
    expect(r.forIssuer(' chase ')?.id).toBe('chase');
    expect(r.forIssuer('Mock Bank')).toBeUndefined();
    expect(r.get('mock')?.verified).toBe(true);
    expect(ISSUER_FLOWS.every((f) => f.unverified && f.termsNote.length > 10)).toBe(true);
    expect(new ConnectorRegistry().forIssuer('x')).toBeUndefined();
  });

  it('an issuer flow without the browser add-on reports disabled instead of guessing', async () => {
    const c = new FlowConnector(ISSUER_FLOWS[0], null);
    const ctx = { accountLabel: 'x', offersUrl: null };
    await expect(c.login({ username: 'u', password: 'p' }, ctx)).rejects.toMatchObject({ kind: 'DISABLED' });
    await expect(c.fetchInventory({ token: 't', expiresAt: '' }, ctx)).rejects.toBeInstanceOf(ConnectorError);
    await expect(c.enroll({ token: 't', expiresAt: '' }, { externalId: 'a', cardKey: '' }, ctx)).rejects.toBeInstanceOf(ConnectorError);
    expect((await c.healthCheck()).ok).toBe(false);
    expect(c.id).toBe('amex');
    expect(c.issuers).toContain('Amex');
  });

  it('an issuer flow delegates to an installed runner', async () => {
    const calls: string[] = [];
    const runner = {
      login: async () => (calls.push('login'), { ok: true as const, session: { token: 't', expiresAt: '' } }),
      submitMfa: async () => (calls.push('mfa'), { ok: true as const, session: { token: 't', expiresAt: '' } }),
      read: async () => (calls.push('read'), { items: defaultMockOffers().map((o, i) => ({ ...o, enrolled: i === 0 })), cards: [] }),
      add: async (_f: unknown, _s: unknown, req: { externalId: string; cardKey: string }) => (calls.push('add'), { ...req, outcome: 'SUCCESS' as const }),
    };
    const c = new FlowConnector(ISSUER_FLOWS[1], runner);
    const ctx = { accountLabel: 'x', offersUrl: null };
    await c.login({ username: 'u', password: 'p' }, ctx);
    await c.submitMfa({ token: 't', expiresAt: '' }, '123456', ctx);
    await c.fetchInventory({ token: 't', expiresAt: '' }, ctx);
    expect(await c.fetchEnrollments({ token: 't', expiresAt: '' }, ctx)).toHaveLength(1);
    expect((await c.enroll({ token: 't', expiresAt: '' }, { externalId: 'a', cardKey: '' }, ctx)).outcome).toBe('SUCCESS');
    expect((await c.healthCheck()).ok).toBe(true);
    expect(calls).toEqual(['login', 'mfa', 'read', 'read', 'add']);
  });
});

describe('mock issuer', () => {
  const ctx = { accountLabel: 'x', offersUrl: null };
  const mock = new MockConnector();
  beforeEach(() => resetMock());

  it('logs in, lists, enrolls and reports already added', async () => {
    const r = await mock.login({ username: 'u1', password: 'ok' }, ctx);
    if (!r.ok) throw new Error('login failed');
    const inv = await mock.fetchInventory(r.session);
    expect(inv.items).toHaveLength(3);
    expect((await mock.enroll(r.session, { externalId: 'hilton-250', cardKey: '' })).outcome).toBe('SUCCESS');
    expect((await mock.enroll(r.session, { externalId: 'hilton-250', cardKey: '' })).outcome).toBe('ALREADY_ADDED');
    expect((await mock.enroll(r.session, { externalId: 'gone', cardKey: '' })).outcome).toBe('FAILURE');
    expect(await mock.fetchEnrollments(r.session)).toEqual([{ externalId: 'hilton-250', cardKey: '' }]);
    expect((await mock.healthCheck()).ok).toBe(true);
  });

  it('simulates bad passwords, locked logins, MFA and expiry', async () => {
    expect(await mock.login({ username: 'badpass', password: 'x' }, ctx)).toMatchObject({ ok: false, kind: 'BAD_CREDENTIALS' });
    expect(await mock.login({ username: 'u', password: 'wrong' }, ctx)).toMatchObject({ ok: false, kind: 'BAD_CREDENTIALS' });
    expect(await mock.login({ username: 'locked', password: 'x' }, ctx)).toMatchObject({ ok: false, kind: 'LOCKED' });
    const m = await mock.login({ username: 'mfa', password: 'x' }, ctx);
    if (m.ok || !m.needsMfa) throw new Error('expected an MFA step');
    await expect(mock.fetchInventory(m.session)).rejects.toMatchObject({ kind: 'MFA_REQUIRED' });
    expect((await mock.enroll(m.session, { externalId: 'a', cardKey: '' })).outcome).toBe('MFA_FAILURE');
    expect(await mock.submitMfa(m.session, '000000')).toMatchObject({ ok: false, kind: 'MFA_FAILED' });
    const ok = await mock.submitMfa(m.session, MOCK_MFA_CODE);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.session.deviceTrust).toBeTruthy();
    const trusted = await mock.login({ username: 'mfa', password: 'x' }, ctx, ok.session.deviceTrust);
    expect(trusted.ok).toBe(true);
    expireMockSessions();
    await expect(mock.fetchInventory(ok.session)).rejects.toMatchObject({ kind: 'SESSION_TIMEOUT' });
    expect((await mock.enroll(ok.session, { externalId: 'a', cardKey: '' })).outcome).toBe('SESSION_TIMEOUT');
    expect(await mock.submitMfa({ token: 'unknown', expiresAt: '' }, '1')).toMatchObject({ ok: false, kind: 'SESSION_TIMEOUT' });
  });

  it('simulates a flaky site and refused or half-done enrollments', async () => {
    setMockOffers('flaky', defaultMockOffers());
    const f = await mock.login({ username: 'flaky', password: 'x' }, ctx);
    if (!f.ok) throw new Error('login');
    await expect(mock.fetchInventory(f.session)).rejects.toMatchObject({ kind: 'NETWORK' });
    expect((await mock.fetchInventory(f.session)).items).toHaveLength(3);
    for (const [user, outcome] of [['enrollfail', 'FAILURE'], ['partial', 'PARTIAL']] as const) {
      const s = await mock.login({ username: user, password: 'x' }, ctx);
      if (!s.ok) throw new Error('login');
      expect((await mock.enroll(s.session, { externalId: 'hilton-250', cardKey: '' })).outcome).toBe(outcome);
    }
  });
});
