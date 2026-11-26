import { describe, expect, it } from 'vitest';
import { actionable, centsText, decisionPhrase, describeRule, dollarsToCents, progressLine, RULE_EXAMPLES, scoreTone, syncFinished } from '@/lib/offer-automation';
import { buildPayload, checkPage, hostMatches, issuerForHost, normalizeServer, pageAddScript, pageTextScript, sha256Hex, tokenLooksValid, trimText } from '../../extension-offers/src/capture';

describe('offer automation helpers', () => {
  it('names the decision for a score', () => {
    expect(decisionPhrase(98)).toBe('Should Prioritize');
    expect(decisionPhrase(70)).toBe('Should Add');
    expect(decisionPhrase(40)).toBe('Should Review');
    expect(decisionPhrase(15)).toBe('Should Ignore');
    expect(decisionPhrase(null)).toBe('Not Scored');
    expect(scoreTone(90)).toBe('green');
    expect(scoreTone(40)).toBe('amber');
    expect(scoreTone(10)).toBe('slate');
    expect(scoreTone(null)).toBe('slate');
  });

  it('parses dollars into cents and back', () => {
    expect(dollarsToCents('$25')).toBe(2500);
    expect(dollarsToCents('1,200.50')).toBe(120050);
    expect(dollarsToCents('abc')).toBeNull();
    expect(dollarsToCents('1.234')).toBeNull();
    expect(centsText('2500')).toBe('$25.00');
    expect(centsText('travel')).toBe('travel');
  });

  it('describes rules in plain words', () => {
    expect(describeRule({ kind: 'ALWAYS', matcher: 'MERCHANT', matcherValue: 'Hilton' })).toBe('Always add offers from Hilton');
    expect(describeRule({ kind: 'NEVER', matcher: 'CATEGORY', matcherValue: 'gambling' })).toBe('Never add gambling offers');
    expect(describeRule({ kind: 'ALWAYS', matcher: 'MIN_VALUE', matcherValue: '2500' })).toBe('Always add offers worth $25.00 or more');
    expect(describeRule({ kind: 'ALWAYS', matcher: 'OFFER_TYPE', matcherValue: 'STATEMENT_CREDIT' })).toBe('Always add statement credit offers');
    expect(describeRule({ kind: 'NEVER', matcher: 'KEYWORD', matcherValue: 'lottery' })).toBe('Never add offers mentioning “lottery”');
    expect(describeRule({ kind: 'ALWAYS', matcher: 'SPEND_HISTORY', matcherValue: '' })).toMatch(/already spend/);
    expect(RULE_EXAMPLES.map((r) => r.label)).toEqual(expect.arrayContaining(['Always Add Hilton Offers', 'Never Add Gambling Offers', 'Never Add Crypto Offers', 'Never Add Subscription Offers', 'Always Add Offers Over $25']));
  });

  it('knows when a sync is finished and what can be added', () => {
    expect(syncFinished(undefined)).toBe(true);
    expect(syncFinished({ runs: [], done: false })).toBe(false);
    expect(progressLine({ processed: 2, found: 14, added: 3, errors: 1, warnings: 0 }, 3)).toBe('2 of 3 account(s) processed · 14 offer(s) found · 3 added · 1 error(s) · 0 warning(s)');
    expect(actionable({ status: 'AVAILABLE', decision: 'RECOMMENDED' })).toBe(true);
    expect(actionable({ status: 'AVAILABLE', decision: 'IGNORED' })).toBe(false);
    expect(actionable({ status: 'ENROLLED', decision: 'ENROLLED' })).toBe(false);
  });
});

describe('offers extension helpers', () => {
  it('matches issuer domains and subdomains only', () => {
    expect(hostMatches('www.chase.com', ['chase.com'])).toBe(true);
    expect(hostMatches('secure.bankofamerica.com', ['bankofamerica.com'])).toBe(true);
    expect(hostMatches('chase.com.evil.test', ['chase.com'])).toBe(false);
    expect(hostMatches('notchase.com', ['chase.com'])).toBe(false);
    expect(issuerForHost('global.americanexpress.com')?.name).toBe('American Express');
    expect(issuerForHost('example.com')).toBeNull();
  });

  it('only reads secure pages on a supported issuer, and warns about Chase', () => {
    expect(checkPage('https://secure.chase.com/offers')).toMatchObject({ ok: true });
    const chase = checkPage('https://www.chase.com/x');
    if (chase.ok) expect(chase.issuer.note).toMatch(/robots, spiders, scripts/);
    expect(checkPage('http://www.chase.com/')).toMatchObject({ ok: false });
    expect(checkPage('https://example.com/')).toMatchObject({ ok: false });
    expect(checkPage('not a url')).toMatchObject({ ok: false, reason: 'This page cannot be read.' });
  });

  it('accepts https servers (and http only for localhost) and plausible tokens', () => {
    expect(normalizeServer('https://pointwise.example/anything')).toBe('https://pointwise.example');
    expect(normalizeServer('http://localhost:4000/x')).toBe('http://localhost:4000');
    expect(normalizeServer('http://pointwise.example')).toBeNull();
    expect(normalizeServer('nonsense')).toBeNull();
    expect(tokenLooksValid('pw_pat_' + 'a'.repeat(30))).toBe(true);
    expect(tokenLooksValid('pw_pat_short')).toBe(false);
    expect(tokenLooksValid('other_' + 'a'.repeat(30))).toBe(false);
  });

  it('trims and hashes page text and builds the payload', async () => {
    expect(trimText('  a  b \n\n  c  ')).toBe('a b\nc');
    expect(trimText('x'.repeat(70_000))).toHaveLength(60_000);
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const id = '11111111-1111-4111-8111-111111111111';
    const ok = await buildPayload(id, 'Hilton: Spend $500, get $100 back', new Date('2026-11-26T00:00:00Z'), '1234');
    expect(ok).toMatchObject({ accountId: id, lastFour: '1234', capturedAt: '2026-11-26T00:00:00.000Z' });
    expect('error' in ok).toBe(false);
    expect(await buildPayload('nope', 'Hilton: Spend $500, get $100 back', new Date())).toMatchObject({ error: expect.stringMatching(/Choose the PointWise account/) });
    expect(await buildPayload(id, 'tiny', new Date())).toMatchObject({ error: expect.stringMatching(/no readable text/) });
    expect(await buildPayload(id, 'Hilton: Spend $500, get $100 back', new Date(), 'abc')).not.toHaveProperty('lastFour');
  });

  it('reads visible text only: no form fields, scripts or passwords', () => {
    document.body.innerHTML = '<div>Hilton: Spend $500, get $100 back</div><input type="password" value="hunter2"><script>secret()</script><textarea>private</textarea>';
    const text = pageTextScript();
    expect(text).toContain('Hilton');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('private');
  });

  it('presses only the Add button of the approved offer and reports the rest', () => {
    document.body.innerHTML = `
      <section><p>Hilton - Spend $500, get $100</p><button id="h">Add to Card</button></section>
      <section><p>Corner Coffee - $2 back</p><button id="c">Add to Card</button></section>
      <section><p>Marriott - $50 back</p><button id="m">Added</button></section>
      <section><p>Twin Shop - $5</p><button>Add</button></section><section><p>Twin Shop - $9</p><button>Add</button></section>`;
    const clicked: string[] = [];
    document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => clicked.push(b.id || b.parentElement!.textContent!.slice(0, 8))));
    const r = pageAddScript([
      { externalId: 'a', cardKey: 'k', merchantText: 'Hilton' },
      { externalId: 'b', cardKey: 'k', merchantText: 'Marriott' },
      { externalId: 'c', cardKey: 'k', merchantText: 'Nowhere' },
      { externalId: 'd', cardKey: 'k', merchantText: 'Twin Shop' },
      { externalId: 'e', cardKey: 'k', merchantText: ' ' },
    ]);
    expect(r.map((x) => x.outcome)).toEqual(['SUCCESS', 'ALREADY_ADDED', 'FAILURE', 'FAILURE', 'FAILURE']);
    expect(clicked).toEqual(['h']);
    expect(r[3].message).toMatch(/More than one/);
    expect(r[2].message).toMatch(/not found/);
  });
});
