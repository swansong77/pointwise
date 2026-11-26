import { PrismaClient } from '@prisma/client';
import { nextQuarter, quarterBounds, quarterOf, RotatingEntry, validateEntry } from '../domain/rotating-calendar';

export interface RotatingResult {
  entries: number;
  created: number;
  updated: number;
  removed: number;
  problems: string[];
}

/**
 * Writes each entry as rotating rewards for its quarter: one row per category, active between the quarter's first and last
 * day, quarterly cap, needs selection on the wallet card. Rows of the same card and quarter that the entry no longer lists
 * are removed, so a corrected entry replaces the old one. Idempotent. Cards an admin edited are left alone.
 */
export async function applyRotating(prisma: PrismaClient, entries: RotatingEntry[]): Promise<RotatingResult> {
  const out: RotatingResult = { entries: 0, created: 0, updated: 0, removed: 0, problems: [] };
  const categories = Object.fromEntries((await prisma.category.findMany({ select: { id: true, slug: true } })).map((c) => [c.slug, c.id]));
  const known = new Set(Object.keys(categories));
  for (const e of entries) {
    const bad = validateEntry(e, known);
    if (bad.length) {
      out.problems.push(`${e.quarter} ${e.cards.join(',')}: ${bad.join('; ')}`);
      continue;
    }
    const { startsAt, endsAt } = quarterBounds(e.quarter);
    const verifiedAt = new Date(`${e.checkedOn}T00:00:00Z`);
    for (const slug of e.cards) {
      const card = await prisma.creditCard.findUnique({ where: { slug }, include: { rewards: true } });
      if (!card) {
        out.problems.push(`${slug}: no such card`);
        continue;
      }
      if (card.catalogSource === 'ADMIN') continue;
      out.entries++;
      const inQuarter = card.rewards.filter((r) => r.isRotating && r.startsAt?.getTime() === startsAt.getTime());
      const keep = new Set<string>();
      for (const c of e.categories) {
        const categoryId = categories[c.cat];
        const data = {
          multiplier: c.mult,
          description: c.desc,
          capCents: e.capDollars ? e.capDollars * 100 : null,
          capPeriod: e.capDollars ? ('QUARTER' as const) : null,
          isRotating: true,
          conditional: false,
          startsAt,
          endsAt,
          verifiedAt,
          sourceUrl: e.sourceUrl,
        };
        const existing = inQuarter.find((r) => r.categoryId === categoryId && !r.merchantId);
        if (existing) {
          keep.add(existing.id);
          await prisma.reward.update({ where: { id: existing.id }, data });
          out.updated++;
        } else {
          const row = await prisma.reward.create({ data: { cardId: card.id, categoryId, ...data } });
          keep.add(row.id);
          out.created++;
        }
      }
      for (const r of inQuarter) {
        if (keep.has(r.id)) continue;
        await prisma.reward.delete({ where: { id: r.id } });
        out.removed++;
      }
    }
  }
  return out;
}

/** Cards that earn rotating categories (they have rotating rewards or a calendar entry) and the quarters they have. */
export async function rotatingCoverage(prisma: PrismaClient, now: Date) {
  const rows = await prisma.reward.findMany({ where: { isRotating: true, startsAt: { not: null } }, select: { cardId: true, startsAt: true, card: { select: { slug: true, name: true } } } });
  const byCard = new Map<string, { slug: string; name: string; quarters: Set<string> }>();
  for (const r of rows) {
    const e = byCard.get(r.cardId) ?? { slug: r.card.slug, name: r.card.name, quarters: new Set<string>() };
    e.quarters.add(quarterOf(r.startsAt!));
    byCard.set(r.cardId, e);
  }
  const current = quarterOf(now);
  return [...byCard.values()].map((c) => ({ slug: c.slug, name: c.name, hasCurrent: c.quarters.has(current), hasNext: c.quarters.has(nextQuarter(current)) }));
}
