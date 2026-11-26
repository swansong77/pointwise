import { PrismaClient } from "@prisma/client";
import { RATES_VERIFIED_ON, RATE_CORRECTIONS, RATE_VERIFICATIONS } from "./rate-verification";

export interface RateVerificationResult {
  cards: number;
  updated: number;
  added: number;
  fees: number;
  skippedEdited: number;
  missing: string[];
}

/**
 * Applies the rates in rate-verification.ts: each rate updates the matching reward of the card (same category or
 * merchant, same conditional and rotating flags) or is added, and is stamped with the date and the issuer page. Cards an admin
 * has edited are left alone. Idempotent.
 */
export async function applyRateVerifications(prisma: PrismaClient): Promise<RateVerificationResult> {
  const out: RateVerificationResult = { cards: 0, updated: 0, added: 0, fees: 0, skippedEdited: 0, missing: [] };
  const at = new Date(`${RATES_VERIFIED_ON}T00:00:00Z`);
  const categories = Object.fromEntries((await prisma.category.findMany({ select: { id: true, slug: true } })).map((c) => [c.slug, c.id]));
  const merchants = Object.fromEntries((await prisma.merchant.findMany({ select: { id: true, slug: true } })).map((m) => [m.slug, m.id]));
  for (const v of RATE_VERIFICATIONS) {
    const card = await prisma.creditCard.findUnique({ where: { slug: v.slug }, include: { rewards: true } });
    if (!card) {
      out.missing.push(v.slug);
      continue;
    }
    if (card.catalogSource !== "SEED") {
      out.skippedEdited++;
      continue;
    }
    out.cards++;
    for (const r of v.rates) {
      const categoryId = r.cat ? (categories[r.cat] ?? null) : null;
      const merchantId = r.merchant ? (merchants[r.merchant] ?? null) : null;
      if ((r.cat && !categoryId) || (r.merchant && !merchantId)) {
        out.missing.push(`${v.slug}:${r.cat ?? r.merchant}`);
        continue;
      }
      const data = {
        multiplier: r.mult,
        description: r.desc,
        capCents: r.cap ? r.cap * 100 : null,
        capPeriod: r.cap ? (r.capPeriod ?? "YEAR") : null,
        conditional: !!r.conditional,
        isRotating: !!r.rotating,
        startsAt: r.startsAt ? new Date(`${r.startsAt}T00:00:00Z`) : null,
        endsAt: r.endsAt ? new Date(`${r.endsAt}T00:00:00Z`) : null,
        verifiedAt: at,
        sourceUrl: v.url,
      };
      const existing = card.rewards.find((x) => x.categoryId === categoryId && x.merchantId === merchantId && x.conditional === !!r.conditional && x.isRotating === !!r.rotating && (r.rotating ? x.startsAt?.getTime() === (data.startsAt?.getTime() ?? -1) || x.startsAt === null : true));
      if (existing) {
        await prisma.reward.update({ where: { id: existing.id }, data });
        out.updated++;
      } else {
        await prisma.reward.create({ data: { cardId: card.id, categoryId, merchantId, ...data } });
        out.added++;
      }
    }
    const facts: { lastVerifiedAt: Date; verifiedScope: string; annualFeeCents?: number } = { lastVerifiedAt: at, verifiedScope: "ISSUER_PAGE" };
    if (v.feeDollars !== undefined && card.annualFeeCents !== v.feeDollars * 100) {
      facts.annualFeeCents = v.feeDollars * 100;
      out.fees++;
    }
    await prisma.creditCard.update({ where: { id: card.id }, data: facts });
    const source = await prisma.cardDataSource.findFirst({ where: { cardId: card.id, url: v.url } });
    if (!source) await prisma.cardDataSource.create({ data: { cardId: card.id, url: v.url } });
  }
  for (const c of RATE_CORRECTIONS) {
    const card = await prisma.creditCard.findUnique({ where: { slug: c.slug }, select: { id: true, catalogSource: true } });
    const cat = await prisma.category.findUnique({ where: { slug: c.cat }, select: { id: true } });
    if (!card || !cat || card.catalogSource !== "SEED") continue;
    const rows = await prisma.reward.findMany({ where: { cardId: card.id, categoryId: cat.id, merchantId: null, conditional: false, verifiedAt: null } });
    for (const r of rows) await prisma.reward.update({ where: { id: r.id }, data: { conditional: true, description: `${r.description} (unconfirmed: ${c.why})` } });
  }
  return out;
}
