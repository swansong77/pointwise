import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { MemberContext } from '../domain/member-access';
import { CreateAccountDto, UpdateAccountDto } from '../loyalty/loyalty.dto';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { BenefitsService, UsageDto } from '../portfolio/benefits';
import { AddWalletCardDto, UpdateWalletCardDto } from '../wallet/wallet.dto';
import { WalletService } from '../wallet/wallet.service';

export type MemberCardInput = Omit<AddWalletCardDto, 'profileId'>;
export type MemberCardPatch = Omit<UpdateWalletCardDto, 'profileId'>;
export type MemberAccountInput = Omit<CreateAccountDto, 'profileId'>;

/**
 * What a household member may change when the owner has allowed it (`canEdit`): their OWN cards, loyalty accounts and benefit usage. The
 * existing services do the work against the owner's account; this class pins every write to the member's profile and refuses anything that
 * belongs to somebody else (as a plain "not found", so ids of other people's records are not confirmed). Plan limits are the owner's.
 */
@Injectable()
export class MemberEditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly loyalty: LoyaltyService,
    private readonly benefits: BenefitsService,
  ) {}

  private async audit(ctx: MemberContext, actorId: string, action: string, entity: string, entityId: string) {
    await this.prisma.auditLog.create({ data: { actorId, action, entity, entityId, diff: { profileId: ctx.profileId } } });
  }

  private async myCard(ctx: MemberContext, id: string) {
    const c = await this.prisma.walletCard.findFirst({ where: { id, profileId: ctx.profileId, wallet: { userId: ctx.ownerId } }, select: { id: true } });
    if (!c) throw new NotFoundException('Card not found');
  }
  private async myAccount(ctx: MemberContext, id: string) {
    const a = await this.prisma.loyaltyAccount.findFirst({ where: { id, profileId: ctx.profileId, userId: ctx.ownerId }, select: { id: true } });
    if (!a) throw new NotFoundException('Account not found');
  }
  private async myBenefit(ctx: MemberContext, id: string) {
    const b = await this.prisma.userBenefit.findFirst({ where: { id, walletCard: { profileId: ctx.profileId, wallet: { userId: ctx.ownerId } } }, select: { id: true } });
    if (!b) throw new NotFoundException('Benefit not found');
  }

  // ───────── cards ─────────

  async addCard(ctx: MemberContext, actorId: string, dto: MemberCardInput) {
    const row = await this.wallet.add(ctx.ownerId, { ...dto, profileId: ctx.profileId } as AddWalletCardDto);
    await this.audit(ctx, actorId, 'member.card.added', 'WalletCard', row.id);
    return row;
  }

  async updateCard(ctx: MemberContext, actorId: string, id: string, dto: MemberCardPatch) {
    await this.myCard(ctx, id);
    const row = await this.wallet.update(ctx.ownerId, id, dto as UpdateWalletCardDto);
    await this.audit(ctx, actorId, 'member.card.updated', 'WalletCard', id);
    return row;
  }

  async removeCard(ctx: MemberContext, actorId: string, id: string) {
    await this.myCard(ctx, id);
    await this.wallet.remove(ctx.ownerId, id);
    await this.audit(ctx, actorId, 'member.card.removed', 'WalletCard', id);
  }

  // ───────── loyalty ─────────

  programs() {
    return this.loyalty.registry();
  }

  async addAccount(ctx: MemberContext, actorId: string, dto: MemberAccountInput) {
    const row = await this.loyalty.createAccount(ctx.ownerId, { ...dto, profileId: ctx.profileId } as CreateAccountDto);
    await this.audit(ctx, actorId, 'member.loyalty.added', 'LoyaltyAccount', (row as { id: string }).id);
    return row;
  }

  async updateAccount(ctx: MemberContext, actorId: string, id: string, dto: UpdateAccountDto) {
    await this.myAccount(ctx, id);
    const row = await this.loyalty.updateAccount(ctx.ownerId, id, dto);
    await this.audit(ctx, actorId, 'member.loyalty.updated', 'LoyaltyAccount', id);
    return row;
  }

  async removeAccount(ctx: MemberContext, actorId: string, id: string) {
    await this.myAccount(ctx, id);
    await this.loyalty.deleteAccount(ctx.ownerId, id);
    await this.audit(ctx, actorId, 'member.loyalty.removed', 'LoyaltyAccount', id);
  }

  // ───────── benefit usage ─────────

  async logUsage(ctx: MemberContext, actorId: string, id: string, dto: UsageDto) {
    await this.myBenefit(ctx, id);
    const row = await this.benefits.logUsage(ctx.ownerId, id, dto);
    await this.audit(ctx, actorId, 'member.benefit.used', 'UserBenefit', id);
    return row;
  }

  async removeUsage(ctx: MemberContext, actorId: string, id: string, usageId: string) {
    await this.myBenefit(ctx, id);
    await this.benefits.removeUsage(ctx.ownerId, id, usageId);
    await this.audit(ctx, actorId, 'member.benefit.unused', 'UserBenefit', id);
  }
}
