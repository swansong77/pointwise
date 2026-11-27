/**
 * The annual fee review board (pure): for every card, keep it, call about it, change it, downgrade it, replace it or cancel it, and
 * why, in dollars. The board recommends; the person decides, and nothing is done for them.
 */
export const FEES_VERSION = 'cos-fees/1';
const usd = (c: number) => '$' + Math.round(Math.abs(c) / 100).toLocaleString('en-US');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export type FeeVerdictKind = 'KEEP' | 'RETENTION_CALL' | 'PRODUCT_CHANGE' | 'DOWNGRADE' | 'REPLACE' | 'CANCEL' | 'REVIEW';
export const FEE_VERDICT_LABEL: Record<FeeVerdictKind, string> = { KEEP: 'Keep', RETENTION_CALL: 'Retention call', PRODUCT_CHANGE: 'Product change', DOWNGRADE: 'Downgrade', REPLACE: 'Replace', CANCEL: 'Cancel', REVIEW: 'Review' };

export interface FeeCardInput {
  card: string;
  member: string | null;
  feeCents: number;
  /** credits you used plus rewards earned, last 12 months */
  valueCents: number;
  daysToRenewal: number | null;
  openedMonths: number | null;
  /** another product in the same family, the cheapest one */
  sibling: { name: string; feeCents: number } | null;
  /** what other members reported when they asked this issuer to keep the card */
  retention: { reports: number; accepted: number; sample: string | null } | null;
  /** the best card the owner could open instead, if it is clearly better */
  replacement: { card: string; longTermCents: number } | null;
}

export interface FeeVerdict {
  card: string;
  member: string | null;
  verdict: FeeVerdictKind;
  /** value returned minus the fee, per year */
  netCents: number;
  justification: string;
  alternatives: string[];
  /** what acting is worth per year (0 when nothing needs doing) */
  impactCents: number;
  daysToRenewal: number | null;
  confidence: number;
  evidence: string[];
}

const RETENTION_WINDOW_DAYS = 90;

export function feeVerdict(c: FeeCardInput): FeeVerdict {
  const net = c.valueCents - c.feeCents;
  const evidence = [`Portfolio: returned ${usd(c.valueCents)} against a ${usd(c.feeCents)} fee over 12 months`];
  const when = c.daysToRenewal != null ? ` It renews in ${plural(c.daysToRenewal, 'day')}.` : '';
  const base = { card: c.card, member: c.member, netCents: net, daysToRenewal: c.daysToRenewal, evidence };
  if (c.feeCents === 0) return { ...base, verdict: 'KEEP', justification: 'No annual fee. Keeping it preserves your credit history and any benefits it has.', alternatives: [], impactCents: 0, confidence: 90 };
  if (net >= 0) return { ...base, verdict: 'KEEP', justification: `Benefits and rewards exceed the annual fee by ${usd(net)}.`, alternatives: ['Ask for a retention offer anyway if you want more value.'], impactCents: 0, confidence: 85 };

  const shortfall = -net;
  const accepted = c.retention?.accepted ?? 0;
  const soon = c.daysToRenewal != null && c.daysToRenewal <= RETENTION_WINDOW_DAYS;
  if (soon && accepted > 0) {
    evidence.push(`Retention reports: ${accepted} of ${c.retention!.reports} accepted an offer`);
    return {
      ...base,
      verdict: 'RETENTION_CALL',
      justification: `It returned ${usd(c.valueCents)} against a ${usd(c.feeCents)} fee, ${usd(shortfall)} short. ${plural(accepted, 'member')} who reported one accepted a retention offer${c.retention!.sample ? ` (for example: ${c.retention!.sample})` : ''}. Call before it renews.${when}`,
      alternatives: ['If there is no offer, change to a cheaper product in the same family.', 'Cancel if you no longer use its benefits.'],
      impactCents: shortfall,
      confidence: 70,
    };
  }
  if (c.sibling && c.sibling.feeCents === 0) {
    evidence.push(`Catalog: ${c.sibling.name} has no annual fee`);
    return { ...base, verdict: 'DOWNGRADE', justification: `The annual fee (${usd(c.feeCents)}) exceeds the value you realized (${usd(c.valueCents)}). A product change to ${c.sibling.name}, which has no fee, keeps the account open.${when}`, alternatives: ['Ask for a retention offer first.', 'Cancel if you do not want the card at all.'], impactCents: shortfall, confidence: 75 };
  }
  if (c.sibling && c.sibling.feeCents < c.feeCents) {
    evidence.push(`Catalog: ${c.sibling.name} costs ${usd(c.sibling.feeCents)}`);
    return { ...base, verdict: 'PRODUCT_CHANGE', justification: `${c.sibling.name} in the same family costs ${usd(c.sibling.feeCents)} instead of ${usd(c.feeCents)}, a saving of up to ${usd(c.feeCents - c.sibling.feeCents)} a year, against a ${usd(shortfall)} shortfall today.${when}`, alternatives: ['Ask for a retention offer first.', 'Check which benefits you would lose.'], impactCents: c.feeCents - c.sibling.feeCents, confidence: 65 };
  }
  // a replacement has to earn something of its own, and clearly beat what this card costs; otherwise cancelling is simpler
  if (c.replacement && c.replacement.longTermCents > 0 && c.replacement.longTermCents - net >= 15_000) {
    evidence.push(`Next-card scorer: ${c.replacement.card} about ${usd(c.replacement.longTermCents)} a year`);
    return { ...base, verdict: 'REPLACE', justification: `A better fit exists: ${c.replacement.card} is worth about ${usd(c.replacement.longTermCents)} a year for you, versus ${usd(net)} lost here. Replacing means a new application and, for some issuers, a 5/24 slot.`, alternatives: ['Keep this card until the new one is approved.', 'Ask for a retention offer instead.'], impactCents: c.replacement.longTermCents - net, confidence: 55 };
  }
  if (c.valueCents * 2 < c.feeCents && (c.openedMonths ?? 0) >= 12) {
    return { ...base, verdict: 'CANCEL', justification: `It returned less than half its ${usd(c.feeCents)} fee (${usd(c.valueCents)}). Cancelling saves about ${usd(shortfall)} a year. Ask for a retention offer first.${when}`, alternatives: ['Ask for a retention offer.', 'Cancelling can lower your available credit and, over time, your average account age.'], impactCents: shortfall, confidence: 70 };
  }
  if (shortfall * 2 <= c.feeCents) {
    return { ...base, verdict: 'RETENTION_CALL', justification: `It returned ${usd(c.valueCents)} against a ${usd(c.feeCents)} fee, ${usd(shortfall)} short. That is close enough that a retention offer could tip it.${when}`, alternatives: ['Change to a cheaper product if there is none.', 'Cancel if you will not use the benefits.'], impactCents: shortfall, confidence: 60 };
  }
  return { ...base, verdict: 'REVIEW', justification: `It returned ${usd(c.valueCents)} against a ${usd(c.feeCents)} fee. Decide whether you will use its benefits this year.${when}`, alternatives: ['Ask for a retention offer.'], impactCents: shortfall, confidence: 50 };
}

/** actions first (soonest renewal, then the most to gain), keeps last */
export function feeBoard(cards: FeeCardInput[]): FeeVerdict[] {
  return cards
    .map(feeVerdict)
    .sort((a, b) => Number(a.verdict === 'KEEP') - Number(b.verdict === 'KEEP') || (a.daysToRenewal ?? 9999) - (b.daysToRenewal ?? 9999) || b.impactCents - a.impactCents || a.card.localeCompare(b.card));
}

export interface FeeTotals {
  version: string;
  cards: number;
  feesCents: number;
  valueCents: number;
  /** what acting on every non-keep recommendation would save or gain per year */
  impactCents: number;
  counts: Record<FeeVerdictKind, number>;
}

export function feeTotals(cards: FeeCardInput[], verdicts: FeeVerdict[]): FeeTotals {
  const counts = { KEEP: 0, RETENTION_CALL: 0, PRODUCT_CHANGE: 0, DOWNGRADE: 0, REPLACE: 0, CANCEL: 0, REVIEW: 0 } as Record<FeeVerdictKind, number>;
  for (const v of verdicts) counts[v.verdict]++;
  return { version: FEES_VERSION, cards: cards.length, feesCents: cards.reduce((s, c) => s + c.feeCents, 0), valueCents: cards.reduce((s, c) => s + c.valueCents, 0), impactCents: verdicts.filter((v) => v.verdict !== 'KEEP').reduce((s, v) => s + v.impactCents, 0), counts };
}
