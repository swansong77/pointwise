/**
 * The household chief (pure): what each member should do, who could be added as an authorized user, and which household card is best
 * for the categories the household spends most on. It suggests; it moves no spend and adds no one.
 */
import type { ExecItem } from './cos-score';

export const HOUSEHOLD_VERSION = 'cos-household/1';
const usd = (c: number) => '$' + Math.round(c / 100).toLocaleString('en-US');

export interface HouseholdMember {
  profileId: string;
  member: string;
  relationship: string;
  isPrimary: boolean;
  /** age, when a birth year is recorded */
  age: number | null;
  five24: { count: number; underLimit: boolean } | null;
  /** primary cards this member holds */
  cardsHeld: number;
  /** cards this member is an authorized user on */
  authorizedOn: number;
}

export interface AuCandidate {
  card: string;
  holder: string;
  /** the issuer charges nothing to add an authorized user */
  feeCents: number;
}

export interface CategoryBest {
  category: string;
  card: string;
  holder: string | null;
  centsPerDollar: number;
  annualSpendCents: number;
}

export interface MemberPlan {
  member: string;
  relationship: string;
  isPrimary: boolean;
  five24: string | null;
  cardsHeld: number;
  actions: Array<{ id: string; title: string; recommendation: string; band: string; score: number; valueCents: number | null; href: string }>;
}

export interface AuSuggestion {
  member: string;
  card: string;
  holder: string;
  text: string;
}

export interface HouseholdChief {
  version: string;
  headline: string;
  members: MemberPlan[];
  /** things that belong to the household as a whole, not one person */
  shared: MemberPlan['actions'];
  authorizedUsers: AuSuggestion[];
  bestCardByCategory: Array<CategoryBest & { text: string }>;
}

const slim = (i: ExecItem) => ({ id: i.id, title: i.title, recommendation: i.recommendation, band: i.band, score: i.score, valueCents: i.expectedValueCents, href: i.href });

export function householdChief(members: HouseholdMember[], items: ExecItem[], au: AuCandidate[], categories: CategoryBest[]): HouseholdChief {
  const names = new Map(members.map((m) => [m.member.toLowerCase(), m.member]));
  const own = (i: ExecItem) => (i.facts.member ? names.get(i.facts.member.toLowerCase()) ?? null : null);
  const plans: MemberPlan[] = members.map((m) => ({
    member: m.member,
    relationship: m.relationship,
    isPrimary: m.isPrimary,
    five24: m.five24 ? `${m.five24.count}/24` : null,
    cardsHeld: m.cardsHeld,
    actions: items.filter((i) => own(i) === m.member).slice(0, 5).map(slim),
  }));
  const shared = items.filter((i) => own(i) == null).slice(0, 5).map(slim);
  // a child who is not yet an authorized user on a card that charges nothing for one
  const suggestions: AuSuggestion[] = [];
  for (const m of members.filter((x) => x.relationship === 'CHILD' && x.authorizedOn === 0)) {
    const pick = au.filter((a) => a.feeCents === 0).sort((a, b) => a.card.localeCompare(b.card))[0];
    if (pick) suggestions.push({ member: m.member, card: pick.card, holder: pick.holder, text: `${m.member} could be added as an authorized user on ${pick.holder}'s ${pick.card}, which charges nothing for one${m.age != null && m.age < 18 ? ' (an authorized-user card is the usual way to start building credit before 18)' : ''}.` });
  }
  const best = categories.slice(0, 6).map((c) => ({ ...c, text: `${c.category}: ${c.card}${c.holder ? ` (${c.holder}'s)` : ''} earns ${c.centsPerDollar}¢ per dollar on about ${usd(c.annualSpendCents)} a year` }));
  const busy = plans.filter((p) => p.actions.length).length;
  return {
    version: HOUSEHOLD_VERSION,
    headline: `${busy} of ${members.length} member${members.length === 1 ? '' : 's'} ${busy === 1 ? 'has' : 'have'} something to do${shared.length ? `, and ${shared.length} thing${shared.length === 1 ? '' : 's'} belong to the household` : ''}`,
    members: plans,
    shared,
    authorizedUsers: suggestions,
    bestCardByCategory: best,
  };
}
