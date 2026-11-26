import { round } from './recommendation.engine';

/**
 * Travel rewards (pure): transfer-partner value and award planning. See docs/travel-optimization.md.
 *
 *   program points per currency point = ratioTo / ratioFrom × (1 + active bonus %)
 *   value of a currency point via a partner = that × program valuation (¢/pt)
 *
 * The planner covers an award (N program points) for a booking member: their own program balance
 * first, then transfers in order of lowest opportunity cost (currency value given up per program
 * point). Points come only from the booking member, or from other members when the currency or
 * program allows household pooling. Transfers are rounded up to the currency's increment.
 */

export interface Currency {
  id: string;
  code: string;
  name: string;
  centsPerPoint: number;
  isCash: boolean;
  householdPooling: boolean;
  transferIncrement: number;
}

export interface Program {
  id: string;
  code: string;
  name: string;
  kind: 'AIRLINE' | 'HOTEL' | 'OTHER' | 'SHOPPING' | 'DINING' | 'CRUISE' | 'RENTAL_CAR' | 'CASINO' | 'RETAIL';
  centsPerPoint: number;
  householdPooling: boolean;
}

export interface Partner {
  currencyId: string;
  programId: string;
  ratioFrom: number;
  ratioTo: number;
  transferDays: number;
  bonusPercent: number;
  bonusEndsAt: Date | null;
}

export interface Balance {
  profileId: string;
  member: string;
  currencyId: string | null;
  programId: string | null;
  points: number;
}

export function bonusActive(p: Pick<Partner, 'bonusPercent' | 'bonusEndsAt'>, now: Date): boolean {
  return p.bonusPercent > 0 && (p.bonusEndsAt == null || p.bonusEndsAt > now);
}

/** program points received per currency point */
export function transferRate(p: Partner, now: Date): number {
  const base = p.ratioTo / p.ratioFrom;
  return bonusActive(p, now) ? base * (1 + p.bonusPercent / 100) : base;
}

export interface TransferOption {
  program: Program;
  programPointsPerPoint: number;
  /** value of one currency point when transferred (¢) */
  centsPerPoint: number;
  /** ratio to the currency's own value (> 1 = transfer beats cashing out) */
  upliftVsCash: number;
  bonusPercent: number;
  bonusEndsAt: Date | null;
  transferDays: number;
}

/** Ways to use one currency, best value first. */
export function transferOptions(currency: Currency, partners: Partner[], programs: Program[], now: Date): TransferOption[] {
  return partners
    .filter((p) => p.currencyId === currency.id)
    .map((p) => {
      const program = programs.find((x) => x.id === p.programId);
      if (!program) return null;
      const rate = transferRate(p, now);
      const cpp = round(rate * program.centsPerPoint, 3);
      return {
        program,
        programPointsPerPoint: round(rate, 3),
        centsPerPoint: cpp,
        upliftVsCash: currency.centsPerPoint > 0 ? round(cpp / currency.centsPerPoint) : 0,
        bonusPercent: bonusActive(p, now) ? p.bonusPercent : 0,
        bonusEndsAt: bonusActive(p, now) ? p.bonusEndsAt : null,
        transferDays: p.transferDays,
      };
    })
    .filter((o): o is TransferOption => o !== null)
    .sort((a, b) => b.centsPerPoint - a.centsPerPoint || a.program.name.localeCompare(b.program.name));
}

export interface BalanceAdvice {
  profileId: string;
  member: string;
  currency: Currency;
  points: number;
  cashValueCents: number;
  best: TransferOption | null;
  bestValueCents: number;
  advice: string;
}

/** For each currency balance: its cash value and the best transfer, with a one-line recommendation. */
export function adviseBalances(balances: Balance[], currencies: Currency[], partners: Partner[], programs: Program[], now: Date): BalanceAdvice[] {
  return balances
    .filter((b) => b.currencyId && b.points > 0)
    .map((b) => {
      const currency = currencies.find((c) => c.id === b.currencyId)!;
      const options = transferOptions(currency, partners, programs, now);
      const best = options[0] ?? null;
      const cashValueCents = Math.round(b.points * currency.centsPerPoint);
      const bestValueCents = best ? Math.round(b.points * best.centsPerPoint) : cashValueCents;
      let advice: string;
      if (!best) advice = `${currency.name} has no transfer partners — redeem at ${currency.centsPerPoint}¢ per point.`;
      else if (best.upliftVsCash <= 1) advice = `Transfers don't beat ${currency.centsPerPoint}¢ per point — redeem directly.`;
      else
        advice = `Best use: ${best.program.name} at ${best.centsPerPoint}¢ per point (${best.upliftVsCash}× the direct value)${best.bonusPercent ? `, including a ${best.bonusPercent} % transfer bonus${best.bonusEndsAt ? ` until ${best.bonusEndsAt.toISOString().slice(0, 10)}` : ''}` : ''}. Transfer only when you have an award to book — transfers can't be undone.`;
      return { profileId: b.profileId, member: b.member, currency, points: b.points, cashValueCents, best, bestValueCents, advice };
    })
    .sort((a, b) => b.bestValueCents - a.bestValueCents);
}

export interface PlanStep {
  kind: 'USE_BALANCE' | 'TRANSFER';
  member: string;
  profileId: string;
  /** currency code for transfers, program code for balances */
  from: string;
  pointsUsed: number;
  programPoints: number;
  /** value given up (currency points × their ¢/pt) */
  costCents: number;
  transferDays: number;
}

export interface AwardPlan {
  program: Program;
  pointsNeeded: number;
  steps: PlanStep[];
  covered: number;
  shortfall: number;
  totalCostCents: number;
  /** award value at the program's valuation (¢) */
  awardValueCents: number;
  /** cash price comparison: ¢ per program point actually paid */
  costCentsPerProgramPoint: number | null;
  maxTransferDays: number;
  warnings: string[];
  summary: string;
}

export interface PlanInput {
  programId: string;
  pointsNeeded: number;
  /** member who books (their program account receives transfers); default: first member */
  bookerProfileId?: string;
}

export function planAward(input: PlanInput, balances: Balance[], currencies: Currency[], partners: Partner[], programs: Program[], now: Date): AwardPlan {
  const program = programs.find((p) => p.id === input.programId);
  if (!program) throw new Error('Unknown loyalty program');
  const booker = input.bookerProfileId ?? balances[0]?.profileId ?? null;
  const bookerName = balances.find((b) => b.profileId === booker)?.member ?? 'the booking member';
  const steps: PlanStep[] = [];
  const warnings: string[] = [];
  let remaining = Math.max(0, Math.round(input.pointsNeeded));

  // 1. program balances already in the program (booker; others only if the program pools)
  const programBalances = balances
    .filter((b) => b.programId === program.id && b.points > 0 && (b.profileId === booker || program.householdPooling))
    .sort((a, b) => (a.profileId === booker ? -1 : b.profileId === booker ? 1 : b.points - a.points));
  for (const b of programBalances) {
    if (remaining <= 0) break;
    const use = Math.min(b.points, remaining);
    steps.push({ kind: 'USE_BALANCE', member: b.member, profileId: b.profileId, from: program.code, pointsUsed: use, programPoints: use, costCents: Math.round(use * program.centsPerPoint), transferDays: 0 });
    remaining -= use;
  }

  // 2. transfers, cheapest opportunity cost first
  const sources = balances
    .filter((b) => b.currencyId && b.points > 0)
    .map((b) => {
      const currency = currencies.find((c) => c.id === b.currencyId)!;
      const partner = partners.find((p) => p.currencyId === currency.id && p.programId === program.id);
      if (!partner) return null;
      if (b.profileId !== booker && !currency.householdPooling) return null;
      const rate = transferRate(partner, now);
      return { b, currency, partner, rate, costPerProgramPoint: currency.centsPerPoint / rate };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => a.costPerProgramPoint - b.costPerProgramPoint || (a.b.profileId === booker ? -1 : 1));
  for (const s of sources) {
    if (remaining <= 0) break;
    const inc = Math.max(1, s.currency.transferIncrement);
    let pts = Math.ceil(remaining / s.rate / inc) * inc;
    if (pts > s.b.points) pts = Math.floor(s.b.points / inc) * inc;
    if (pts <= 0) continue;
    const received = Math.floor(pts * s.rate);
    steps.push({
      kind: 'TRANSFER',
      member: s.b.member,
      profileId: s.b.profileId,
      from: s.currency.code,
      pointsUsed: pts,
      programPoints: received,
      costCents: Math.round(pts * s.currency.centsPerPoint),
      transferDays: s.partner.transferDays,
    });
    remaining -= received;
    if (s.b.profileId !== booker) warnings.push(`${s.b.member}'s ${s.currency.name} are combined into ${bookerName}'s account first (household pooling).`);
  }

  const covered = steps.reduce((s, x) => s + x.programPoints, 0);
  const shortfall = Math.max(0, input.pointsNeeded - covered);
  const totalCostCents = steps.reduce((s, x) => s + x.costCents, 0);
  const maxTransferDays = steps.reduce((m, x) => Math.max(m, x.transferDays), 0);
  if (steps.some((s) => s.kind === 'TRANSFER')) warnings.push('Transfers are one-way: confirm award availability before moving points.');
  if (maxTransferDays > 0) warnings.push(`The slowest transfer takes up to ${maxTransferDays} day(s) — the award may disappear meanwhile.`);
  if (shortfall > 0) warnings.push(`Short by ${shortfall.toLocaleString('en-US')} ${program.name} points.`);
  const awardValueCents = Math.round(input.pointsNeeded * program.centsPerPoint);
  const summary = shortfall
    ? `You can cover ${covered.toLocaleString('en-US')} of ${input.pointsNeeded.toLocaleString('en-US')} ${program.name} points; ${shortfall.toLocaleString('en-US')} short.`
    : `Covered: ${steps.map((s) => (s.kind === 'TRANSFER' ? `transfer ${s.pointsUsed.toLocaleString('en-US')} ${s.from} from ${s.member}` : `use ${s.pointsUsed.toLocaleString('en-US')} ${program.code} from ${s.member}`)).join(', then ')}.`;
  return {
    program,
    pointsNeeded: input.pointsNeeded,
    steps,
    covered,
    shortfall,
    totalCostCents,
    awardValueCents,
    costCentsPerProgramPoint: covered > 0 ? round(totalCostCents / covered, 3) : null,
    maxTransferDays,
    warnings: [...new Set(warnings)],
    summary,
  };
}
