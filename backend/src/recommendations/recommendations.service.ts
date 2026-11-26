import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { RankedCard, rankCards } from '../domain/recommendation.engine';
import { DomainWalletCard, PurchaseTarget } from '../domain/types';

export interface CategoryBest {
  category: { id: string; slug: string; name: string; icon: string; parentSlug: string | null };
  best: RankedCard | null;
}

@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  async fallbackCategoryId(): Promise<string | null> {
    const fb = await this.prisma.category.findFirst({ where: { isFallback: true }, select: { id: true } });
    return fb?.id ?? null;
  }

  async context(userId: string) {
    const [cards, valuations, pins, fallbackCategoryId, spend] = await Promise.all([
      this.wallet.domainCards(userId),
      this.wallet.valuations(userId),
      this.prisma.categoryPin.findMany({ where: { userId } }),
      this.fallbackCategoryId(),
      this.prisma.spendProfileEntry.findMany({ where: { userId }, select: { categoryId: true, monthlyCents: true } }),
    ]);
    // what the member spends in a category in a year, when they have told us: used to blend capped rates
    const annualSpend = new Map(spend.map((s) => [s.categoryId, s.monthlyCents * 12]));
    return { cards, valuations, pins, fallbackCategoryId, annualSpend };
  }

  async forCategory(userId: string, categoryIdOrSlug: string) {
    const category = await this.prisma.category.findFirst({ where: { OR: [{ id: categoryIdOrSlug }, { slug: categoryIdOrSlug }] } });
    if (!category) throw new NotFoundException('Category not found');
    const ctx = await this.context(userId);
    const target: PurchaseTarget = { categoryId: category.id, parentCategoryId: category.parentId, fallbackCategoryId: ctx.fallbackCategoryId };
    const pinned = ctx.pins.find((p) => p.categoryId === category.id)?.walletCardId ?? null;
    return { category, ranked: rankCards(ctx.cards, target, { valuations: ctx.valuations, pinnedWalletCardId: pinned, annualSpendCents: ctx.annualSpend.get(category.id) ?? null }) };
  }

  async forMerchant(userId: string, merchantIdOrSlug: string) {
    const merchant = await this.prisma.merchant.findFirst({
      where: { OR: [{ id: merchantIdOrSlug }, { slug: merchantIdOrSlug }] },
      include: { category: true },
    });
    if (!merchant) throw new NotFoundException('Merchant not found');
    const ctx = await this.context(userId);
    const ranked = this.rankForMerchant(ctx.cards, merchant, ctx);
    const offers = await this.userOffersAtMerchant(userId, merchant.id);
    return { merchant, ranked, offers };
  }

  rankForMerchant(
    cards: DomainWalletCard[],
    merchant: { id: string; categoryId: string; category: { parentId: string | null } },
    ctx: { valuations: Record<string, number>; pins: Array<{ merchantId: string | null; categoryId: string | null; walletCardId: string }>; fallbackCategoryId: string | null },
  ): RankedCard[] {
    const pinned =
      ctx.pins.find((p) => p.merchantId === merchant.id)?.walletCardId ??
      ctx.pins.find((p) => p.categoryId === merchant.categoryId)?.walletCardId ??
      null;
    return rankCards(
      cards,
      { categoryId: merchant.categoryId, parentCategoryId: merchant.category.parentId, merchantId: merchant.id, fallbackCategoryId: ctx.fallbackCategoryId },
      { valuations: ctx.valuations, pinnedWalletCardId: pinned },
    );
  }

  async userOffersAtMerchant(userId: string, merchantId: string) {
    return this.prisma.userOffer.findMany({
      where: {
        status: 'ACTIVE',
        walletCard: { wallet: { userId } },
        offer: { merchantId, OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] },
      },
      include: { offer: true, walletCard: { include: { card: { select: { name: true, color: true } } } } },
    });
  }

  /**
   * Best card for every category (dashboard "Best Card by Category"): each top-level category followed by its sub-categories
   * (Travel, then Airlines, Hotels, Car rental, Transit). A sub-category also counts its parent's rates, a parent counts only its own.
   */
  async allCategories(userId: string): Promise<CategoryBest[]> {
    const ctx = await this.context(userId);
    const categories = await this.prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    const byId = new Map(categories.map((c) => [c.id, c]));
    const ordered = [
      ...categories.filter((c) => !c.parentId).flatMap((p) => [p, ...categories.filter((c) => c.parentId === p.id)]),
      ...categories.filter((c) => c.parentId && !byId.has(c.parentId)),
    ];
    return ordered.map((c) => {
      const pinned = ctx.pins.find((p) => p.categoryId === c.id)?.walletCardId ?? null;
      const ranked = rankCards(
        ctx.cards,
        { categoryId: c.id, parentCategoryId: c.parentId, fallbackCategoryId: ctx.fallbackCategoryId },
        { valuations: ctx.valuations, pinnedWalletCardId: pinned, annualSpendCents: ctx.annualSpend.get(c.id) ?? null },
      );
      return { category: { id: c.id, slug: c.slug, name: c.name, icon: c.icon, parentSlug: c.parentId ? (byId.get(c.parentId)?.slug ?? null) : null }, best: ranked[0] ?? null };
    });
  }
}
