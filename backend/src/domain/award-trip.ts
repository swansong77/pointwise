/**
 * Award trip evaluation (pure). The service computes, for each candidate program, how the household's balances
 * and transfers cover the award (travel.planAward); this module ranks those options with the trip's preferences,
 * expiring assets, transfer-bonus advice and free night certificates, and explains each ranking.
 *
 * Award prices are estimates from a coarse table (programs publish different charts and many are dynamic), flagged
 * as such; users can enter the exact points needed.
 */
import { BonusAdvice } from './transfer-bonus';
import { Cert, certState } from './loyalty-assets';

export type Cabin = 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
export type Region = 'DOMESTIC' | 'SHORT_INTERNATIONAL' | 'LONG_HAUL';

/** one-way saver award, in miles/points — rough planning numbers, not any program's chart */
export const AWARD_ESTIMATE: Record<Region, Record<Cabin, number>> = {
  DOMESTIC: { ECONOMY: 12_500, PREMIUM_ECONOMY: 20_000, BUSINESS: 30_000, FIRST: 40_000 },
  SHORT_INTERNATIONAL: { ECONOMY: 25_000, PREMIUM_ECONOMY: 40_000, BUSINESS: 60_000, FIRST: 80_000 },
  LONG_HAUL: { ECONOMY: 40_000, PREMIUM_ECONOMY: 70_000, BUSINESS: 85_000, FIRST: 120_000 },
};

export function estimateAwardPoints(cabin: Cabin, region: Region, travelers = 1, roundTrip = true): number {
  return AWARD_ESTIMATE[region][cabin] * travelers * (roundTrip ? 2 : 1);
}

export interface AwardOption {
  programCode: string;
  programName: string;
  kind: string;
  pointsNeeded: number;
  covered: number;
  shortfall: number;
  /** value given up by using the household's currencies and balances */
  costCents: number;
  maxTransferDays: number;
  usesTransfer: boolean;
  /** transfer bonus currently active on the route used, percent */
  activeBonusPercent: number | null;
  bonusAdvice: BonusAdvice | null;
  /** points in this program (or sent to it) that are about to expire */
  expiringPoints: number;
  summary: string;
}

export interface TripInput {
  destination: string;
  departs: Date;
  returns: Date;
  cabin: Cabin;
  airlinePrefs: string[];
  hotelPrefs: string[];
  now: Date;
}

export interface RankedOption extends AwardOption {
  score: number;
  reasons: string[];
  warnings: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Best option first: fully covered, cheapest, uses expiring points, matches preferences, arrives before departure. */
export function rankAwardOptions(options: AwardOption[], trip: TripInput): RankedOption[] {
  const daysToDeparture = Math.ceil((trip.departs.getTime() - trip.now.getTime()) / 86_400_000);
  const prefs = [...trip.airlinePrefs, ...trip.hotelPrefs].map(norm).filter(Boolean);
  return options
    .map((o): RankedOption => {
      const reasons: string[] = [];
      const warnings: string[] = [];
      let score = 0;
      if (o.shortfall === 0) {
        score += 100;
        reasons.push('Your balances fully cover this award.');
      } else {
        score -= Math.min(80, Math.round((o.shortfall / Math.max(o.pointsNeeded, 1)) * 100));
        warnings.push(`${o.shortfall.toLocaleString('en-US')} points short.`);
      }
      score -= Math.min(40, Math.round(o.costCents / 1000));
      if (o.costCents > 0) reasons.push(`Uses about $${Math.round(o.costCents / 100)} of points value.`);
      if (o.expiringPoints > 0) {
        score += Math.min(30, 10 + Math.round(o.expiringPoints / 5000));
        reasons.push(`Uses ${o.expiringPoints.toLocaleString('en-US')} points that are about to expire.`);
      }
      if (prefs.length && prefs.some((p) => norm(`${o.programName} ${o.programCode}`).includes(p) || p.includes(norm(o.programName)))) {
        score += 25;
        reasons.push('Matches your preferred program.');
      }
      if (o.usesTransfer && o.maxTransferDays > daysToDeparture) {
        score -= 60;
        warnings.push(`Transfers take up to ${o.maxTransferDays} day(s); the trip is in ${Math.max(daysToDeparture, 0)}.`);
      }
      if (o.activeBonusPercent) {
        score += 10;
        reasons.push(`A ${o.activeBonusPercent}% transfer bonus is active on this route.`);
      }
      if (o.bonusAdvice?.verdict === 'WAIT' && daysToDeparture > 60) warnings.push(o.bonusAdvice.text);
      if (o.bonusAdvice?.verdict === 'TRANSFER_NOW' && o.usesTransfer) reasons.push(o.bonusAdvice.text);
      return { ...o, score, reasons, warnings };
    })
    .sort((a, b) => b.score - a.score || a.costCents - b.costCents || a.programName.localeCompare(b.programName));
}

export interface TripCertificateMatch {
  certId: string;
  name: string;
  member: string;
  usable: boolean;
  note: string;
}

/** Free night certificates whose hotel brand matches a preference, and whether they are still valid for the stay dates. */
export function matchCertificates(certs: Cert[], trip: TripInput): TripCertificateMatch[] {
  const prefs = trip.hotelPrefs.map(norm).filter(Boolean);
  const out: TripCertificateMatch[] = [];
  for (const c of certs) {
    if (c.category !== 'FREE_NIGHT') continue;
    const v = certState(c, trip.now);
    if (v.effectiveStatus !== 'AVAILABLE') continue;
    const hay = norm(`${c.name} ${c.program ?? ''} ${c.eligible.join(' ')}`);
    if (prefs.length && !prefs.some((p) => hay.includes(p) || p.includes(norm(c.program ?? '')))) continue;
    const validOnStay = !c.expiresAt || trip.departs <= c.expiresAt;
    out.push({
      certId: c.id,
      name: c.name,
      member: c.member,
      usable: validOnStay,
      note: validOnStay ? `Valid for a stay starting ${trip.departs.toISOString().slice(0, 10)}${v.state === 'EXPIRING' && v.daysLeft != null ? ` — use it soon, it expires in ${v.daysLeft} days` : ''}.` : `Expires ${c.expiresAt!.toISOString().slice(0, 10)}, before the stay.`,
    });
  }
  return out;
}
