import { PrismaClient } from '@prisma/client';
import { daysLeftInQuarter, nextQuarter, quarterBounds, quarterOf } from '../domain/rotating-calendar';
import { ROTATING_CALENDAR } from '../seed/rotating-calendar';
import { applyRotating } from '../seed/rotating.apply';
import { ROTATING_SOURCES, RotatingSource } from '../seed/rotating-sources';
import { parseRotating } from '../domain/rotating-parse';
import { htmlToText } from '../domain/card-extract';
import type { FetchResult } from '../catalog-refresh/fetcher';

export interface RotatingFetcher {
  fetch(url: string): Promise<FetchResult>;
}
export interface FetchSummary {
  fetched: number;
  applied: number;
  problems: string[];
}

/** When the scheduled refresh runs (UTC cron); jobs.module uses it for the schedule. */
export const ROTATING_SCHEDULE = '0 4 * * *';

/** Days before a quarter ends from which the next quarter is looked for. */
export const LOOK_AHEAD_DAYS = 45;

/**
 * Reads the public announcement page of each source whose card lacks the current quarter, or the next one when the quarter is
 * nearly over, and applies it when the page states it unambiguously. Anything else becomes a problem for the admin notice.
 */
export async function fetchRotating(prisma: PrismaClient, fetcher: RotatingFetcher, now: Date, sources: RotatingSource[] = ROTATING_SOURCES): Promise<FetchSummary> {
  const out: FetchSummary = { fetched: 0, applied: 0, problems: [] };
  const current = quarterOf(now);
  const wanted = daysLeftInQuarter(now) <= LOOK_AHEAD_DAYS ? [current, nextQuarter(current)] : [current];
  for (const src of sources) {
    if (src.unreadable) continue;
    const have = await prisma.reward.findMany({ where: { isRotating: true, startsAt: { not: null }, card: { slug: { in: src.cards } } }, select: { startsAt: true, card: { select: { slug: true } } } });
    const missing = wanted.filter((q) => !src.cards.every((c) => have.some((r) => r.card.slug === c && quarterOf(r.startsAt!) === q)));
    if (!missing.length) continue;
    let page: FetchResult;
    try {
      page = await fetcher.fetch(src.url);
    } catch (e) {
      out.problems.push(`${src.url}: ${(e as Error).message}`);
      continue;
    }
    out.fetched++;
    if (page.status !== 'OK' || !page.body) {
      out.problems.push(`${src.url}: ${page.reason ?? page.status}`);
      continue;
    }
    const r = parseRotating(htmlToText(page.body), now);
    if (!r.ok) {
      out.problems.push(`${src.url}: ${r.reason}`);
      continue;
    }
    if (!missing.includes(r.parsed.quarter)) continue; // the page shows a quarter we already have (or one too far ahead)
    const res = await applyRotating(prisma, [{ cards: src.cards, quarter: r.parsed.quarter, capDollars: r.parsed.capDollars, sourceUrl: src.url, checkedOn: now.toISOString().slice(0, 10), categories: r.parsed.categories.map((c) => ({ cat: c.cat, mult: r.parsed.mult, desc: c.desc })) }]);
    if (res.problems.length) out.problems.push(`${src.url}: ${res.problems.join('; ')}`);
    else out.applied++;
  }
  return out;
}

type Notify = (userId: string, type: 'SYSTEM', title: string, body: string, link?: string, dedupeKey?: string) => Promise<unknown>;

/** The days before a quarter ends when an admin is told the next quarter is not in the calendar yet. */
export const WARN_DAYS = 21;

/**
 * Daily: applies the committed rotating-category calendar, tells each member who holds a rotating card what the quarter's
 * categories are (once per card per quarter; they still have to activate with the issuer), and tells admins when the next
 * quarter is missing close to quarter end. Contacts no issuer.
 */
export async function runRotatingJob(prisma: PrismaClient, notify: Notify, now: Date, fetcher?: RotatingFetcher): Promise<number> {
  await applyRotating(prisma, ROTATING_CALENDAR);
  const quarter = quarterOf(now);
  const { startsAt } = quarterBounds(quarter);
  let n = 0;
  if (fetcher && process.env.ROTATING_AUTO_FETCH !== 'false') {
    const f = await fetchRotating(prisma, fetcher, now);
    if (f.problems.length) {
      for (const a of await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } })) {
        await notify(a.id, 'SYSTEM', 'Rotating categories could not be read automatically', `${f.problems.join(' | ')}. Add the quarter in Admin, rotating categories.`, '/admin', `rotating-fetch:${quarter}:${now.toISOString().slice(0, 10)}`);
        n++;
      }
    }
  }
  const cards = await prisma.creditCard.findMany({
    where: { rewards: { some: { isRotating: true, startsAt } } },
    select: { id: true, name: true, rewards: { where: { isRotating: true, startsAt }, select: { multiplier: true, capCents: true, category: { select: { name: true } } } } },
  });
  for (const c of cards) {
    const names = c.rewards.map((r) => r.category?.name).filter(Boolean).join(', ');
    const cap = c.rewards[0]?.capCents ? ` on up to $${Math.round(c.rewards[0].capCents / 100).toLocaleString('en-US')} a quarter` : '';
    const holders = await prisma.walletCard.findMany({ where: { cardId: c.id, status: 'APPROVED', closedAt: null }, select: { id: true, wallet: { select: { userId: true } } } });
    for (const h of holders) {
      await notify(h.wallet.userId, 'SYSTEM', `${c.name}: ${quarter.replace('-', ' ')} categories`, `${names} earn ${Number(c.rewards[0].multiplier)}x${cap} this quarter. Activate them with the issuer, then select them on the card in your wallet so the app counts them.`, '/wallet', `rotating:${h.id}:${quarter}`);
      n++;
    }
  }
  if (daysLeftInQuarter(now) <= WARN_DAYS) {
    const next = quarterBounds(nextQuarter(quarter)).startsAt;
    const rotating = await prisma.creditCard.findMany({ where: { rewards: { some: { isRotating: true, startsAt } } }, select: { name: true, rewards: { where: { isRotating: true, startsAt: next }, select: { id: true }, take: 1 } } });
    const missing = rotating.filter((c) => !c.rewards.length).map((c) => c.name);
    if (missing.length) {
      for (const a of await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } })) {
        await notify(a.id, 'SYSTEM', `Rotating categories for ${nextQuarter(quarter).replace('-', ' ')} are missing`, `${missing.join(', ')}. Add the quarter from the issuer's announcement in Admin, rotating categories.`, '/admin', `rotating-missing:${nextQuarter(quarter)}`);
        n++;
      }
    }
  }
  return n;
}
