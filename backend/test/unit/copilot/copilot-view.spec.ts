import { composeAgenda } from '../../../src/domain/copilot-plan';
import type { StepResult } from '../../../src/domain/answer-compose';
import { allowedNumbers, buildView, cleanName, grounded, Household, leaks, narrationPrompt, rehydrate, roundDollars, roundPoints } from '../../../src/domain/copilot-view';

const NOW = new Date('2026-11-26T15:00:00Z');
const ok = (tool: string, data: unknown): StepResult => ({ tool, label: tool, ok: true, summary: '', data });
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

// synthetic household with awkward names (a short name inside a long one, a name that is also a word)
const H: Household = {
  members: [
    { nickname: 'Zephyr', relationship: 'SELF' },
    { nickname: 'Quill', relationship: 'SPOUSE' },
    { nickname: 'Ann', relationship: 'CHILD' },
    { nickname: 'Annabelle', relationship: 'CHILD' },
  ],
  secrets: ['zephyr.q@example.test', 'zephyr.q', 'Zephyr Quillworth', '4417'],
};

const results = (): StepResult[] => [
  ok('get_expiring_offers', { buckets: [{ items: [{ id: 'o1', label: "Hilton: $100 back on Zephyr's card ending 4417", cardholder: 'Zephyr', card: 'Contoso Gold (Zephyr) ••4417', endsAt: day(2), valueCents: 10234, action: 'Spend $500' }] }] }),
  ok('get_certificates', { certificates: [{ id: 'c1', name: 'Quill free night', member: 'Quill', program: 'World of Hyatt', expiresAt: day(20), potentialValueCents: 24999 }] }),
  ok('get_expiring_loyalty', { items: [{ accountId: 'a1', member: 'Annabelle', program: 'Delta SkyMiles (login zephyr.q@example.test)', unit: 'miles', balance: 40321, valueCents: 48000, prediction: { level: 'HIGH', daysLeft: 12, confidence: 80 }, message: 'x', preservation: [{ label: 'Earn a mile' }] }] }),
  ok('get_five24_status', [{ member: 'Ann', label: '5/24', count: 5, underLimit: false, nextSlotAt: '2027-02-01' }]),
];

describe('TC-VIEW: the redacted view', () => {
  const plan = composeAgenda(results(), 'PLANNING', 'What should I do today?', NOW);
  const view = buildView(plan, H);
  const json = JSON.stringify(view);

  it('contains no name, e-mail, card digits or private value', () => {
    for (const s of ['Zephyr', 'Quill', 'Annabelle', 'zephyr.q', '4417', 'example.test', '@']) expect(json.toLowerCase()).not.toContain(s.toLowerCase());
    expect(/\bAnn\b/i.test(json)).toBe(false);
    expect(leaks(view, H)).toEqual([]);
  });

  it('members become labels with a relationship, and only the ones that appear', () => {
    expect(view.members.map((m) => m.label)).toEqual(expect.arrayContaining(['Member A', 'Member B', 'Member C']));
    expect(view.members.every((m) => /^Member [A-Z]$/.test(m.label))).toBe(true);
    expect(view.members.map((m) => m.relationship)).toEqual(expect.arrayContaining(['spouse']));
    const o = view.items.find((i) => i.kind === 'offer_expiring')!;
    expect(o.member).toMatch(/^Member [A-Z]$/);
  });

  it('public product and program names stay; amounts and balances are rounded; dates are day counts', () => {
    const o = view.items.find((i) => i.kind === 'offer_expiring')!;
    expect(o.card).toMatch(/^Contoso Gold/);
    expect(o.amount).toBe('about $100');
    expect(o.inDays).toBe(2);
    const loy = view.items.find((i) => i.kind === 'loyalty_at_risk')!;
    expect(loy.points).toBe('about 40,300');
    expect(JSON.stringify(view)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('only the allowed fields exist (anything else cannot appear)', () => {
    const allowed = new Set(['ref', 'lens', 'horizon', 'kind', 'subject', 'member', 'card', 'program', 'amount', 'points', 'inDays', 'count', 'verdict', 'confidence']);
    for (const i of view.items) for (const k of Object.keys(i)) expect(allowed.has(k)).toBe(true);
    expect(Object.keys(view).sort()).toEqual(['items', 'members', 'mode', 'scope', 'version']);
  });

  it('the prose never goes in: titles, reasons and recommendations are absent', () => {
    for (const i of plan.items) for (const s of [i.title, i.reason, i.recommendation]) expect(json).not.toContain(s);
  });

  it('the leak check catches what slipped through', () => {
    expect(leaks({ x: 'Hello Zephyr' }, H)).toContain('member name');
    expect(leaks({ x: 'mail me at a@b.test' }, H)).toContain('e-mail address');
    expect(leaks({ x: '4111 1111 1111 1111' }, H)).toContain('card-number-like digits');
    expect(leaks({ x: 'ends 4417' }, H)).toContain('private value');
    expect(leaks({ x: 'Annabelle' }, { members: [{ nickname: 'Ann' }] })).toEqual([]);
  });

  it('fuzz: random names and notes never reach the view', () => {
    const names = ['Mira', 'Tobias', 'Wren', 'Ines', 'Bo', 'Cass', 'Dov', 'Elm'];
    for (let n = 0; n < 40; n++) {
      const a = names[n % names.length];
      const b = names[(n * 3 + 1) % names.length];
      const h: Household = { members: [{ nickname: a, relationship: 'SELF' }, ...(a === b ? [] : [{ nickname: b, relationship: 'SPOUSE' }])], secrets: [`${a.toLowerCase()}${n}@mail.test`] };
      const r = [
        ok('get_expiring_offers', { buckets: [{ items: [{ id: 'i' + n, label: `${a}'s ${b} deal, call ${a}${n}@mail.test or 4111 1111 1111 1111`, cardholder: a, card: `Card of ${b} 12${n}34`, endsAt: day(1 + (n % 40)), valueCents: 1000 + n * 137, action: 'x' }] }] }),
        ok('get_certificates', { certificates: [{ id: 'c' + n, name: `${b} night`, member: b, program: `Hyatt ${a}`, expiresAt: day(10), potentialValueCents: 5000 }] }),
      ];
      const v = buildView(composeAgenda(r, 'PLANNING', 'today', NOW), h);
      const t = JSON.stringify(v);
      for (const nm of h.members.map((m) => m.nickname)) expect(new RegExp(`\\b${nm}\\b`, 'i').test(t)).toBe(false);
      expect(t).not.toMatch(/@|4111/);
      expect(leaks(v, h)).toEqual([]);
    }
  });
});

describe('TC-VIEW: grounding and re-hydration', () => {
  const plan = composeAgenda(results(), 'PLANNING', 'What should I do today?', NOW);
  const view = buildView(plan, H);

  it('accepts text whose figures are in the view and rejects invented ones', () => {
    expect(grounded('Start with item 1: about $100 is at stake in 2 days.', view)).toEqual({ ok: true, extra: [] });
    const bad = grounded('About $900 is at stake in 2 days.', view);
    expect(bad.ok).toBe(false);
    expect(bad.extra).toContain('900');
    expect(allowedNumbers(view).has(String(view.items.length))).toBe(true);
  });

  it('puts the real names back for the reader, longest label first', () => {
    const labelA = view.members.find((m) => m.relationship === 'account holder')!.label;
    expect(rehydrate(`${labelA} should call ${view.members[0].label}.`, H)).not.toMatch(/Member [A-Z]/);
    expect(rehydrate('Member A', { members: [{ nickname: 'Zed' }] })).toBe('Zed');
  });

  it('rounds and cleans', () => {
    expect([roundDollars(10234), roundDollars(1840), roundDollars(-5200), roundPoints(40321), roundPoints(480)]).toEqual(['about $100', 'about $20', '-about $50', 'about 40,300', 'about 480']);
    expect(cleanName('Gold (Zephyr) 12345678', H)).toBe('Gold (Member D)');
    expect(cleanName(undefined, H)).toBeUndefined();
  });

  it('the prompt forbids invention and automatic actions, and follows the style', () => {
    const p = narrationPrompt('CONCISE');
    expect(p).toMatch(/do not invent/i);
    expect(p).toMatch(/never tell the reader to apply for, transfer, book or cancel/i);
    expect(p).toMatch(/three short sentences/);
    expect(narrationPrompt('DETAILED')).toMatch(/180 words/);
  });
});
