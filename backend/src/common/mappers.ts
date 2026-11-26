import { Prisma } from '@prisma/client';
import { DomainCard, DomainWalletCard } from '../domain/types';

/** Prisma include shape needed to build domain wallet cards. */
export const walletCardInclude = {
  card: { include: { currency: true, rewards: true, issuer: true } },
} satisfies Prisma.WalletCardInclude;

export type WalletCardWithCard = Prisma.WalletCardGetPayload<{ include: typeof walletCardInclude }>;
export type CardWithRewards = Prisma.CreditCardGetPayload<{ include: { currency: true; rewards: true } }> & {
  issuer?: { name: string; businessReportsToPersonal: boolean } | null;
};

export function toDomainCard(c: CardWithRewards): DomainCard {
  return {
    id: c.id,
    name: c.name,
    color: c.color,
    type: c.type,
    annualFeeCents: c.annualFeeCents,
    bonusSpendCents: c.bonusSpendCents,
    bonusMonths: c.bonusMonths,
    bonusPoints: c.bonusPoints,
    currency: {
      id: c.currency.id,
      code: c.currency.code,
      centsPerPoint: Number(c.currency.centsPerPoint),
      isCash: c.currency.isCash,
    },
    rewards: c.rewards.map((r) => ({
      id: r.id,
      categoryId: r.categoryId,
      merchantId: r.merchantId,
      multiplier: Number(r.multiplier),
      description: r.description,
      isRotating: r.isRotating,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      capCents: r.capCents,
      capPeriod: r.capPeriod,
      conditional: r.conditional,
      verifiedAt: r.verifiedAt,
    })),
    ...(c.issuer && { issuerName: c.issuer.name, businessReportsToPersonal: c.issuer.businessReportsToPersonal }),
  };
}

export function toDomainWalletCard(wc: WalletCardWithCard): DomainWalletCard {
  return {
    id: wc.id,
    nickname: wc.nickname,
    status: wc.status,
    approvedAt: wc.approvedAt,
    closedAt: wc.closedAt,
    annualFeeOverrideCents: wc.annualFeeOverrideCents,
    bonusEarned: wc.bonusEarned,
    bonusSpendCents: wc.bonusSpendCents,
    selectedCategoryIds: wc.selectedCategoryIds,
    card: toDomainCard(wc.card),
    cardholder: wc.cardholder,
    profileId: wc.profileId,
    openDatePrecision: wc.openDatePrecision,
    excludeFrom524: wc.excludeFrom524,
    excludeReason: wc.excludeReason,
  };
}
