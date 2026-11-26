import { DomainCard, DomainRewardRule, DomainWalletCard } from '../../src/domain/types';

export const CAT = {
  dining: 'cat-dining',
  groceries: 'cat-groceries',
  gas: 'cat-gas',
  travel: 'cat-travel',
  hotels: 'cat-hotels',
  fallback: 'cat-everything',
  coffee: 'cat-coffee', // subcategory of dining
};
export const MER = { shopnow: 'mer-shopnow', freshcart: 'mer-freshcart' };
export const CUR = {
  cash: { id: 'cur-cash', code: 'CASH', centsPerPoint: 1, isCash: true },
  miles: { id: 'cur-miles', code: 'NW_MILES', centsPerPoint: 1.5, isCash: false },
  points: { id: 'cur-pts', code: 'CONTOSO_PTS', centsPerPoint: 1.25, isCash: false },
};

let seq = 0;
export function rule(partial: Partial<DomainRewardRule>): DomainRewardRule {
  seq += 1;
  return {
    id: `rule-${seq}`,
    categoryId: null,
    merchantId: null,
    multiplier: 1,
    description: 'rule',
    isRotating: false,
    startsAt: null,
    endsAt: null,
    ...partial,
  };
}

export function card(partial: Partial<DomainCard> & { id: string }): DomainCard {
  return {
    name: partial.id,
    color: '#000',
    type: 'PERSONAL',
    annualFeeCents: 0,
    bonusSpendCents: null,
    bonusMonths: null,
    bonusPoints: null,
    currency: CUR.cash,
    rewards: [],
    ...partial,
  };
}

export function wc(partial: Partial<DomainWalletCard> & { id: string; card: DomainCard }): DomainWalletCard {
  return {
    nickname: null,
    status: 'APPROVED',
    approvedAt: null,
    closedAt: null,
    annualFeeOverrideCents: null,
    bonusEarned: false,
    bonusSpendCents: 0,
    selectedCategoryIds: [],
    ...partial,
  };
}

/** A realistic 4-card wallet. */
export function sampleWallet(): DomainWalletCard[] {
  const travel = card({
    id: 'voyager',
    name: 'Voyager',
    currency: CUR.miles,
    annualFeeCents: 9500,
    rewards: [
      rule({ categoryId: CAT.travel, multiplier: 3, description: '3X travel' }),
      rule({ categoryId: CAT.dining, multiplier: 3, description: '3X dining' }),
      rule({ categoryId: CAT.fallback, multiplier: 1, description: '1X else' }),
    ],
  });
  const gold = card({
    id: 'gold',
    name: 'Gold',
    currency: CUR.points,
    annualFeeCents: 25000,
    rewards: [
      rule({ categoryId: CAT.dining, multiplier: 4, description: '4X dining' }),
      rule({ categoryId: CAT.groceries, multiplier: 4, description: '4X groceries' }),
      rule({ categoryId: CAT.fallback, multiplier: 1, description: '1X else' }),
    ],
  });
  const flex = card({
    id: 'flex',
    name: 'Flex',
    rewards: [
      rule({ categoryId: CAT.gas, multiplier: 5, isRotating: true, description: '5% gas (rotating)' }),
      rule({ categoryId: CAT.groceries, multiplier: 5, isRotating: true, description: '5% groceries (rotating)' }),
      rule({ categoryId: CAT.fallback, multiplier: 1, description: '1% else' }),
    ],
  });
  const dbl = card({ id: 'double', name: 'Double', rewards: [rule({ categoryId: CAT.fallback, multiplier: 2, description: '2% everything' })] });
  return [
    wc({ id: 'w-voyager', card: travel }),
    wc({ id: 'w-gold', card: gold }),
    wc({ id: 'w-flex', card: flex, selectedCategoryIds: [CAT.gas] }),
    wc({ id: 'w-double', card: dbl }),
  ];
}
