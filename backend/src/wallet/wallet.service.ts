import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { toDomainWalletCard, walletCardInclude } from '../common/mappers';
import { DomainWalletCard } from '../domain/types';
import { limitsFor } from '../domain/entitlements';
import { AddWalletCardDto, PinDto, UpdateWalletCardDto, ValuationDto } from './wallet.dto';
import { HouseholdsService } from '../portfolio/households';
import { BenefitsService } from '../portfolio/benefits';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async walletId(userId: string): Promise<string> {
    const w = await this.prisma.wallet.upsert({ where: { userId }, update: {}, create: { userId } });
    return w.id;
  }

  async list(userId: string) {
    const walletId = await this.walletId(userId);
    return this.prisma.walletCard.findMany({
      where: { walletId },
      include: { ...walletCardInclude, profile: true, _count: { select: { userOffers: true } } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async domainCards(userId: string): Promise<DomainWalletCard[]> {
    const walletId = await this.walletId(userId);
    const rows = await this.prisma.walletCard.findMany({ where: { walletId }, include: walletCardInclude });
    return rows.map(toDomainWalletCard);
  }

  async valuations(userId: string): Promise<Record<string, number>> {
    const rows = await this.prisma.userValuation.findMany({ where: { userId } });
    return Object.fromEntries(rows.map((r) => [r.currencyId, Number(r.centsPerPoint)]));
  }

  /** Throws if the wallet card does not belong to the user (object-level authorization). */
  async assertOwned(userId: string, walletCardId: string) {
    const wc = await this.prisma.walletCard.findUnique({ where: { id: walletCardId }, include: { wallet: true } });
    if (!wc) throw new NotFoundException('Wallet card not found');
    if (wc.wallet.userId !== userId) throw new ForbiddenException('Not your card');
    return wc;
  }

  async add(userId: string, dto: AddWalletCardDto) {
    const walletId = await this.walletId(userId);
    const [card, count, sub] = await Promise.all([
      this.prisma.creditCard.findUnique({ where: { id: dto.cardId } }),
      this.prisma.walletCard.count({ where: { walletId } }),
      this.prisma.subscription.findUnique({ where: { userId } }),
    ]);
    if (!card || !card.isActive) throw new NotFoundException('Card not found');
    if (count >= limitsFor(sub).maxCards) {
      throw new ForbiddenException('Free plan card limit reached. Upgrade to Pro for unlimited cards.');
    }
    if (dto.profileId) {
      const member = await this.assertProfile(userId, dto.profileId);
      HouseholdsService.assertCardholderAllowed(member, dto.cardholder ?? 'PRIMARY');
    }
    const created = await this.prisma.walletCard.create({
      data: {
        walletId,
        cardId: dto.cardId,
        status: dto.status ?? 'APPROVED',
        cardholder: dto.cardholder ?? 'PRIMARY',
        approvedAt: dto.approvedAt ? new Date(dto.approvedAt) : null,
        nickname: dto.nickname ?? null,
        lastFour: dto.lastFour ?? null,
        profileId: dto.profileId ?? null,
        openDatePrecision: dto.openDatePrecision ?? 'DAY',
        creditLimitCents: dto.creditLimitCents ?? null,
        sortOrder: count,
      },
      include: walletCardInclude,
    });
    if (dto.trackBenefits !== false) await BenefitsService.copyTemplates(this.prisma, created.id, created.cardId);
    return created;
  }

  async update(userId: string, id: string, dto: UpdateWalletCardDto) {
    const current = await this.assertOwned(userId, id);
    const profileId = dto.profileId === undefined ? current.profileId : dto.profileId;
    if (profileId) {
      const member = await this.assertProfile(userId, profileId);
      HouseholdsService.assertCardholderAllowed(member, dto.cardholder ?? current.cardholder);
    }
    const toDate = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(v));
    const approvedAt = toDate(dto.approvedAt);
    const closedAt = toDate(dto.closedAt);
    if (approvedAt && closedAt && closedAt.getTime() < approvedAt.getTime()) {
      throw new BadRequestException('closedAt cannot be before approvedAt');
    }
    return this.prisma.walletCard.update({
      where: { id },
      data: {
        status: dto.status,
        cardholder: dto.cardholder,
        approvedAt,
        closedAt: dto.status === 'CLOSED' && closedAt === undefined ? new Date() : closedAt,
        nickname: dto.nickname,
        notes: dto.notes,
        lastFour: dto.lastFour,
        openDatePrecision: dto.openDatePrecision,
        creditLimitCents: dto.creditLimitCents,
        excludeFrom524: dto.excludeFrom524,
        excludeReason: dto.excludeReason,
        annualFeeOverrideCents: dto.annualFeeOverrideCents,
        bonusEarned: dto.bonusEarned,
        bonusSpendCents: dto.bonusSpendCents,
        selectedCategoryIds: dto.selectedCategoryIds,
        profileId: dto.profileId,
      },
      include: walletCardInclude,
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.assertOwned(userId, id);
    await this.prisma.walletCard.delete({ where: { id } });
  }

  async reorder(userId: string, ids: string[]): Promise<void> {
    const walletId = await this.walletId(userId);
    const owned = await this.prisma.walletCard.findMany({ where: { walletId }, select: { id: true } });
    const ownedSet = new Set(owned.map((o) => o.id));
    if (ids.some((id) => !ownedSet.has(id))) throw new ForbiddenException('Unknown wallet card in order list');
    await this.prisma.$transaction(ids.map((id, i) => this.prisma.walletCard.update({ where: { id }, data: { sortOrder: i } })));
  }

  async pin(userId: string, dto: PinDto) {
    if (!!dto.categoryId === !!dto.merchantId) throw new BadRequestException('Provide exactly one of categoryId or merchantId');
    await this.assertOwned(userId, dto.walletCardId);
    const where = dto.categoryId
      ? { userId_categoryId: { userId, categoryId: dto.categoryId } }
      : { userId_merchantId: { userId, merchantId: dto.merchantId as string } };
    return this.prisma.categoryPin.upsert({
      where,
      update: { walletCardId: dto.walletCardId },
      create: { userId, walletCardId: dto.walletCardId, categoryId: dto.categoryId, merchantId: dto.merchantId },
    });
  }

  async unpin(userId: string, target: { categoryId?: string; merchantId?: string }): Promise<void> {
    await this.prisma.categoryPin.deleteMany({
      where: { userId, ...(target.categoryId ? { categoryId: target.categoryId } : { merchantId: target.merchantId }) },
    });
  }

  async setValuation(userId: string, dto: ValuationDto) {
    return this.prisma.userValuation.upsert({
      where: { userId_currencyId: { userId, currencyId: dto.currencyId } },
      update: { centsPerPoint: dto.centsPerPoint },
      create: { userId, currencyId: dto.currencyId, centsPerPoint: dto.centsPerPoint },
    });
  }

  private async assertProfile(userId: string, profileId: string) {
    const p = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!p || p.userId !== userId) throw new ForbiddenException('Unknown profile');
    return p;
  }
}
