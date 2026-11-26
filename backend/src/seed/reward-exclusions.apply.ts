import { PrismaClient } from '@prisma/client';
import { excludedMerchantSlugs } from '../domain/reward-exclusions';

/** Sets each grocery rate's excluded merchants (Walmart, Target, clubs) from the rule text and issuer wording. Idempotent. */
export async function applyRewardExclusions(prisma: PrismaClient) {
  const merchants = new Map((await prisma.merchant.findMany({ select: { id: true, slug: true } })).map((m) => [m.slug, m.id]));
  const rewards = await prisma.reward.findMany({
    where: { merchantId: null, category: { slug: 'groceries' } },
    select: { id: true, description: true, excludedMerchantIds: true, category: { select: { slug: true } }, card: { select: { slug: true, issuer: { select: { name: true } } } } },
  });
  let updated = 0;
  for (const r of rewards) {
    const slugs = excludedMerchantSlugs({ cardSlug: r.card.slug, issuerName: r.card.issuer.name, categorySlug: r.category!.slug, description: r.description });
    const ids = slugs.map((s) => merchants.get(s)).filter((x): x is string => !!x);
    if (ids.length === 0 || [...ids].sort().join() === [...r.excludedMerchantIds].sort().join()) continue;
    await prisma.reward.update({ where: { id: r.id }, data: { excludedMerchantIds: ids } });
    updated++;
  }
  return { grocery: rewards.length, updated };
}
