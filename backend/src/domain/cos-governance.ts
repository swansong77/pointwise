/**
 * Application governance (pure): where each member stands on 5/24, when the next slot opens, which application is worth making next,
 * who should make it, and which business or elevated-offer opportunities exist. It advises on timing; it never applies for anything.
 */
export const GOV_VERSION = 'cos-governance/1';
const usd = (c: number) => '$' + Math.round(Math.abs(c) / 100).toLocaleString('en-US');
const day = (d: Date) => d.toISOString().slice(0, 10);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export interface GovMember {
  member: string;
  profileId: string;
  isPrimary: boolean;
  count: number;
  limit: number;
  underLimit: boolean;
  /** the first date the member is under the limit again, if they are not now */
  nextSlotAt: Date | null;
  /** when each counted card stops counting, soonest first */
  drops: Date[];
  /** cards opened in the last 90 days */
  recentApprovals: Array<{ card: string; approvedAt: Date }>;
}

export interface GovPick {
  member: string;
  profileId: string;
  card: string;
  slug: string;
  firstYearCents: number;
  longTermCents: number;
  usesSlot: boolean;
  /** the offer on this card is higher than usual */
  elevated: boolean;
  business: boolean;
}

export type AdviceKind = 'WAIT' | 'APPLY' | 'MOVE' | 'BUSINESS' | 'BONUS' | 'LAST_SLOT';
export interface Advice {
  kind: AdviceKind;
  text: string;
  detail: string;
  member: string;
  valueCents: number | null;
  /** the date it becomes possible, when that is the point */
  date: string | null;
}

export interface MemberStatus {
  member: string;
  label: string;
  state: 'OPEN' | 'ONE_LEFT' | 'AT_LIMIT';
  slots: number;
  nextSlotAt: string | null;
  recentApprovals: Array<{ card: string; approvedAt: string }>;
  upcomingDrops: string[];
}

export interface Governance {
  version: string;
  headline: string;
  members: MemberStatus[];
  advice: Advice[];
}

export function governance(members: GovMember[], picks: GovPick[], now: Date): Governance {
  const statuses: MemberStatus[] = members.map((m) => {
    const slots = Math.max(0, m.limit - m.count);
    return {
      member: m.member,
      label: `${m.count}/24`,
      state: !m.underLimit ? 'AT_LIMIT' : slots === 1 ? 'ONE_LEFT' : 'OPEN',
      slots,
      nextSlotAt: m.nextSlotAt ? day(m.nextSlotAt) : null,
      recentApprovals: m.recentApprovals.map((a) => ({ card: a.card, approvedAt: day(a.approvedAt) })),
      upcomingDrops: m.drops.filter((d) => d.getTime() > now.getTime()).slice(0, 3).map(day),
    };
  });
  const advice: Advice[] = [];
  const byMember = new Map(members.map((m) => [m.profileId, m]));
  const personal = picks.filter((p) => !p.business);

  for (const m of members.filter((x) => !x.underLimit)) {
    advice.push({ kind: 'WAIT', member: m.member, text: `${m.member}: wait${m.nextSlotAt ? ` until ${day(m.nextSlotAt)}` : ''} for Chase eligibility`, detail: `${m.member} is at ${m.count}/24, so Chase would likely decline a new personal card${m.nextSlotAt ? `. The next slot opens ${day(m.nextSlotAt)}` : ''}.`, valueCents: null, date: m.nextSlotAt ? day(m.nextSlotAt) : null });
  }

  // the best personal card across the household, and who should make the application
  const best = [...personal].sort((a, b) => b.firstYearCents - a.firstYearCents)[0];
  if (best && best.firstYearCents > 0) {
    const owner = byMember.get(best.profileId);
    const sameCard = personal.filter((p) => p.slug === best.slug).sort((a, b) => b.firstYearCents - a.firstYearCents);
    const blocked = members.filter((m) => !m.underLimit && m.profileId !== best.profileId);
    advice.push({ kind: 'APPLY', member: best.member, text: `Apply for ${best.card} next (${best.member})`, detail: `About ${usd(best.firstYearCents)} in the first year, then ${usd(best.longTermCents)} a year${best.usesSlot ? `. It uses one of ${best.member}'s 5/24 slots${owner ? ` (${owner.count}/24 → ${owner.count + 1}/24)` : ''}` : '. It does not use a 5/24 slot'}. This is a suggestion; whether and when to apply is yours to decide.`, valueCents: best.firstYearCents, date: null });
    for (const b of blocked) {
      const alt = sameCard.find((p) => p.profileId === b.profileId);
      if (!alt) advice.push({ kind: 'MOVE', member: best.member, text: `Move the ${best.card} application to ${best.member}`, detail: `${b.member} is at ${b.count}/24, so ${best.member} is the better person to apply.`, valueCents: best.firstYearCents, date: null });
    }
  }
  for (const m of members.filter((x) => x.underLimit && x.limit - x.count === 1)) {
    advice.push({ kind: 'LAST_SLOT', member: m.member, text: `${m.member} has one 5/24 slot left`, detail: `Save it for the card that is worth the most to ${m.member}.`, valueCents: null, date: null });
  }
  for (const b of picks.filter((p) => p.business).slice(0, 2)) {
    advice.push({ kind: 'BUSINESS', member: b.member, text: `Apply for ${b.card} (${b.member}), a business card`, detail: `About ${usd(b.firstYearCents)} in the first year${b.usesSlot ? '' : '. Business cards usually do not count toward 5/24'}. Only if it fits a real business.`, valueCents: b.firstYearCents, date: null });
  }
  for (const p of picks.filter((x) => x.elevated).slice(0, 2)) {
    advice.push({ kind: 'BONUS', member: p.member, text: `${p.card} has an elevated welcome offer`, detail: `The current offer is higher than usual. About ${usd(p.firstYearCents)} in the first year for ${p.member}.`, valueCents: p.firstYearCents, date: null });
  }
  const atLimit = statuses.filter((s) => s.state === 'AT_LIMIT').length;
  return {
    version: GOV_VERSION,
    headline: atLimit ? `${plural(atLimit, 'member')} at the 5/24 limit; ${advice.find((a) => a.kind === 'APPLY') ? 'a good next card is ready for someone who is not' : 'no application is worth making right now'}` : advice.find((a) => a.kind === 'APPLY') ? `Everyone is under 5/24. The best next card is ${best!.card} for ${best!.member}` : 'No application is worth making right now',
    members: statuses,
    advice: advice.slice(0, 8),
  };
}
