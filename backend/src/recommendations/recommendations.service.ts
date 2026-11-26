import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { RankedCard, rankCards } from '../domain/recommendation.engine';
import { DomainWalletCard, PurchaseTarget } from '../domain/types';

export interface CategoryBest {
  category: { id: string; slug: string; name: string; icon: string };
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

  private async context(userId: string) {
    const [cards, valuations, pins, fallbackCategoryId] = await Promise.all([
      this.wallet.domainCards(userId),
      this.wallet.valuations(userId),
      this.prisma.categoryPin.findMany({ where: { userId } }),
      this.fallbackCategoryId(),
    ]);
    return { cards, valuations, pins, fallbackCategoryId };
  }

  async forCategory(userId: string, categoryIdOrSlug: string) {
    const category = await this.prisma.category.findFirst({ where: { OR: [{ id: categoryIdOrSlug }, { slug: categoryIdOrSlug }] } });
    if (!category) throw new NotFoundException('Category not found');
    const ctx = await this.context(userId);
    const target: PurchaseTarget = { categoryId: category.id, parentCategoryId: category.parentId, fallbackCategoryId: ctx.fallbackCategoryId };
    const pinned = ctx.pins.find((p) => p.categoryId === category.id)?.walletCardId ?? null;
    return { category, ranked: rankCards(ctx.cards, target, { valuations: ctx.valuations, pinnedWalletCardId: pinned }) };
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

  /** Best card for every top-level category (dashboard "Best Card Pointers"). */
  async allCategories(userId: string): Promise<CategoryBest[]> {
    const ctx = await this.context(userId);
    const categories = await this.prisma.category.findMany({ where: { parentId: null }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    return categories.map((c) => {
      const pinned = ctx.pins.find((p) => p.categoryId === c.id)?.walletCardId ?? null;
      const ranked = rankCards(
        ctx.cards,
        { categoryId: c.id, parentCategoryId: null, fallbackCategoryId: ctx.fallbackCategoryId },
        { valuations: ctx.valuations, pinnedWalletCardId: pinned },
      );
      return { category: { id: c.id, slug: c.slug, name: c.name, icon: c.icon }, best: ranked[0] ?? null };
    });
  }
}
