import { memberBrief, memberBriefNotice, MemberBriefInput } from '../../src/domain/member-brief';
import { memberWants, TYPE_SWITCH } from '../../src/domain/member-access';
import { SEVERITY } from '../../src/domain/notification-severity';

const NOW = new Date('2026-12-07T12:00:00Z'); // a Monday
const EMPTY: MemberBriefInput = { name: 'Riley', benefits: [], offers: [], loyalty: [], certificates: [], renewals: [], bonuses: [], spend: null, held: 0 };
const lines = (b: ReturnType<typeof memberBrief>, key: string) => b!.sections.find((s) => s.key === key)!.lines;

describe('TC-MBRIEF-DOM: a member briefing', () => {
  it('says nothing on a quiet day instead of sending an empty briefing', () => {
    expect(memberBrief('DAILY', EMPTY, NOW)).toBeNull();
    expect(memberBrief('WEEKLY', EMPTY, NOW)).toBeNull();
    // far-off items are not worth a daily
    expect(memberBrief('DAILY', { ...EMPTY, benefits: [{ name: 'Travel credit', card: 'Gold', remainingCents: 5000, daysLeft: 90 }] }, NOW)).toBeNull();
  });

  it('puts what is due now first, then what is coming, then fees and bonuses', () => {
    const b = memberBrief(
      'DAILY',
      {
        ...EMPTY,
        benefits: [
          { name: 'Dining credit', card: 'Gold', remainingCents: 2500, daysLeft: 2 },
          { name: 'Travel credit', card: 'Gold', remainingCents: 30000, daysLeft: 10 },
          { name: 'Used up', card: 'Gold', remainingCents: 0, daysLeft: 1 },
        ],
        offers: [{ title: 'Hilton $100', card: 'Gold', daysLeft: 1, valueCents: 10000 }],
        renewals: [{ name: 'Gold Card', daysUntil: 5, feeCents: 25000 }],
        bonuses: [{ name: 'Gold Card', spentCents: 100000, requiredCents: 400000, daysLeft: 9 }],
      },
      NOW,
    )!;
    expect(b.kind).toBe('DAILY');
    expect(b.periodKey).toBe('2026-12-07');
    expect(lines(b, 'today').map((l) => l.text)).toEqual(['Hilton $100 on Gold', 'Dining credit: $25 left on Gold']);
    expect(lines(b, 'today').every((l) => l.tone === 'urgent')).toBe(true);
    expect(lines(b, 'soon').map((l) => l.text)).toEqual(['Travel credit: $300 left on Gold']);
    expect(lines(b, 'money').map((l) => l.text)).toEqual(['Gold Card renews in 5 days', 'Welcome bonus at risk: Gold Card']);
    expect(b.headline).toBe('Riley: 2 things to do now');
    expect(b.summary).toContain('About $');
    // a credit with nothing left is not a to-do
    expect(JSON.stringify(b)).not.toContain('Used up');
  });

  it('the weekly summary adds spending and balances and looks further ahead', () => {
    const b = memberBrief(
      'WEEKLY',
      { ...EMPTY, loyalty: [{ name: 'Test Air', balance: 45000, expiresInDays: 20 }], spend: { count: 6, totalCents: 41234 }, certificates: [{ name: 'Free night', daysLeft: 6 }] },
      NOW,
    )!;
    expect(b.kind).toBe('WEEKLY');
    expect(b.periodKey).toBe('2026-12-07');
    expect(lines(b, 'today').map((l) => l.text)).toEqual(['Free night expires']);
    expect(lines(b, 'soon').map((l) => l.text)).toEqual(['45,000 Test Air points may expire']);
    expect(lines(b, 'week').map((l) => l.text)).toEqual(['6 transactions on your cards, $412 in total', 'Test Air: 45,000 points']);
  });

  it('a weekly with only spending is still worth sending; a held count is mentioned', () => {
    const b = memberBrief('WEEKLY', { ...EMPTY, spend: { count: 2, totalCents: 5000 }, held: 3 }, NOW)!;
    expect(b.headline).toBe('Riley: A quiet week');
    expect(b.summary).toContain('3 updates held by Quiet Mode');
  });

  it('is announced with its own wording, short enough for a notification', () => {
    const b = memberBrief('DAILY', { ...EMPTY, renewals: [{ name: 'Gold Card', daysUntil: 5, feeCents: 25000 }] }, NOW)!;
    const n = memberBriefNotice(b);
    expect(n.title).toBe('Your daily briefing');
    expect(n.body.length).toBeLessThanOrEqual(220);
    expect(memberBriefNotice({ ...b, kind: 'WEEKLY' }).title).toBe('Your weekly briefing');
  });

  it('never suggests applying, transferring, booking or cancelling', () => {
    const b = memberBrief('WEEKLY', { ...EMPTY, renewals: [{ name: 'Gold Card', daysUntil: 5, feeCents: 25000 }], bonuses: [{ name: 'Gold', spentCents: 1, requiredCents: 4000, daysLeft: 20 }] }, NOW)!;
    expect(JSON.stringify(b)).not.toMatch(/\b(apply now|transfer now|book now|cancel now|cancel it)\b/i);
  });
});

describe('TC-MNOTE-DOM: which notifications follow the member\'s own switches', () => {
  it('a switch that is off blocks only its own kind; no preferences means everything on', () => {
    expect(memberWants('CARD_RENEWAL', null)).toBe(true);
    expect(memberWants('CARD_RENEWAL', { cardRenewal: false })).toBe(false);
    expect(memberWants('OFFER_EXPIRING', { cardRenewal: false })).toBe(true);
    // several kinds share a switch
    for (const t of ['OFFER_NEW_HIGH_VALUE', 'OFFER_AUTO_ENROLLED', 'OFFER_ENROLL_FAILED', 'OFFER_SYNC_FAILED', 'OFFER_SAVINGS_DIGEST'] as const) expect(memberWants(t, { offerAutomation: false })).toBe(false);
  });

  it('reminders, briefings and system notices have no switch and always arrive', () => {
    for (const t of ['REMINDER', 'COPILOT', 'SYSTEM', 'BACKUP_FAILED'] as const) {
      expect(TYPE_SWITCH[t]).toBeUndefined();
      expect(memberWants(t, { cardRenewal: false, offerExpiring: false, offerAutomation: false, loyaltyExpiring: false })).toBe(true);
    }
  });

  it('every switch named here belongs to a known notification type', () => {
    for (const t of Object.keys(TYPE_SWITCH)) expect(Object.keys(SEVERITY)).toContain(t);
  });
});
