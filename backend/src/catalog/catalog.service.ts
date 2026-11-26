import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { Page, paginate } from "../common/pagination";
import { CardSearchQuery, MerchantSearchQuery } from "./catalog.dto";

export const cardListSelect = {
  id: true,
  slug: true,
  name: true,
  network: true,
  type: true,
  annualFeeCents: true,
  color: true,
  bonusDescription: true,
  countryCode: true,
  popularity: true,
  catalogSource: true,
  dataAsOf: true,
  lastVerifiedAt: true,
  verifiedScope: true,
  issuer: { select: { id: true, name: true } },
  currency: {
    select: {
      id: true,
      code: true,
      name: true,
      centsPerPoint: true,
      isCash: true,
    },
  },
} satisfies Prisma.CreditCardSelect;

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async searchCards(q: CardSearchQuery): Promise<Page<unknown>> {
    const where: Prisma.CreditCardWhereInput = {
      isActive: true,
      ownerId: null,
      ...(q.network && { network: q.network }),
      ...(q.type && { type: q.type }),
      ...(q.issuerId && { issuerId: q.issuerId }),
      ...(q.country && { countryCode: q.country.toUpperCase() }),
      ...(q.maxFeeCents !== undefined && {
        annualFeeCents: { lte: q.maxFeeCents },
      }),
      ...(q.q && {
        OR: [
          { name: { contains: q.q, mode: "insensitive" } },
          { issuer: { name: { contains: q.q, mode: "insensitive" } } },
        ],
      }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.creditCard.findMany({
        where,
        select: cardListSelect,
        orderBy: [{ popularity: "desc" }, { name: "asc" }],
        ...paginate(q),
      }),
      this.prisma.creditCard.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async getCard(idOrSlug: string) {
    const card = await this.prisma.creditCard.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }], ownerId: null },
      include: {
        issuer: true,
        currency: true,
        features: { orderBy: { sortOrder: "asc" } },
        rewards: {
          include: { category: true, merchant: true },
          orderBy: { multiplier: "desc" },
        },
      },
    });
    if (!card) throw new NotFoundException("Card not found");
    return card;
  }

  listIssuers() {
    return this.prisma.issuer.findMany({ orderBy: { name: "asc" } });
  }

  listCategories() {
    return this.prisma.category.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { merchants: true } } },
    });
  }

  async getCategory(idOrSlug: string) {
    const cat = await this.prisma.category.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: {
        children: true,
        merchants: { take: 50, orderBy: { name: "asc" } },
      },
    });
    if (!cat) throw new NotFoundException("Category not found");
    return cat;
  }

  async searchMerchants(q: MerchantSearchQuery): Promise<Page<unknown>> {
    const where: Prisma.MerchantWhereInput = {
      ...(q.categoryId && { categoryId: q.categoryId }),
      ...(q.q && {
        OR: [
          { name: { contains: q.q, mode: "insensitive" } },
          { hosts: { has: q.q.toLowerCase() } },
        ],
      }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.merchant.findMany({
        where,
        include: { category: { select: { id: true, name: true, icon: true } } },
        orderBy: [{ isPopular: "desc" }, { name: "asc" }],
        ...paginate(q),
      }),
      this.prisma.merchant.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async getMerchant(idOrSlug: string) {
    const m = await this.prisma.merchant.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: {
        category: true,
        locations: { take: 20 },
        offers: {
          where: { isActive: true, isCustom: false },
          include: { issuer: true, card: { select: { id: true, name: true } } },
        },
      },
    });
    if (!m) throw new NotFoundException("Merchant not found");
    return m;
  }

  /** Lookup merchant by web host, e.g. for a future browser extension. */
  async merchantByHost(host: string) {
    const h = host.toLowerCase().replace(/^www\./, "");
    return this.prisma.merchant.findFirst({
      where: { hosts: { has: h } },
      include: { category: true },
    });
  }
}
