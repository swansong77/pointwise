import { PrismaService } from '../common/prisma.service';
import { Advice, daysUntil, offerAdvice, offerStats, OfferVerdict } from '../domain/offer-intel';

export interface PublicOffer {
  slug: string;
  card: string;
  issuer: string;
  valuationCents: number | null;
  bonusAmount: number | null;
  verdict: OfferVerdict;
  bestEverCents: number | null;
  daysToExpiry: number | null;
  advice: Advice[];
}

/** Current welcome offers with their position in each card's own history (public catalog data only). */
export async function currentPublicOffers(prisma: PrismaService, now: Date, limit = 50): Promise<PublicOffer[]> {
  const open = await prisma.cardOffer.findMany({
    where: { kind: 'WELCOME', validTo: null, card: { ownerId: null, isActive: true } },
    include: { card: { select: { name: true, slug: true, offerExpiresAt: true, issuer: { select: { name: true } } } } },
    orderBy: [{ valuationCents: 'desc' }],
    take: limit,
  });
  const history = await prisma.cardOffer.findMany({
    where: { kind: 'WELCOME', cardId: { in: open.map((o) => o.cardId) } },
    select: { cardId: true, bonusAmount: true, valuationCents: true, validFrom: true, validTo: true },
    orderBy: { validFrom: 'asc' },
  });
  return open.map((o) => {
    const stats = offerStats(history.filter((h) => h.cardId === o.cardId), now);
    const days = daysUntil(o.card.offerExpiresAt, now);
    return {
      slug: o.card.slug,
      card: o.card.name,
      issuer: o.card.issuer.name,
      valuationCents: o.valuationCents,
      bonusAmount: o.bonusAmount,
      verdict: stats.verdict,
      bestEverCents: stats.bestEverCents,
      daysToExpiry: days,
      advice: offerAdvice({ verdict: stats.verdict, daysToExpiry: days, bestEverCents: stats.bestEverCents, currentValueCents: stats.currentValueCents }),
    };
  });
}
