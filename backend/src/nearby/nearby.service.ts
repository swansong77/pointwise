import { BadRequestException, Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { WalletService } from '../wallet/wallet.service';
import { boundingBox, haversineMeters, isValidCoordinate } from '../domain/geo';

export class NearbyQuery {
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(-90) @Max(90)
  lat: number;

  @ApiProperty() @Type(() => Number) @IsNumber() @Min(-180) @Max(180)
  lng: number;

  @ApiPropertyOptional({ default: 1500, description: 'meters (max 25km)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(50) @Max(25_000)
  radius = 1500;

  @ApiPropertyOptional({ default: 25 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 25;
}

@Injectable()
export class NearbyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recs: RecommendationsService,
    private readonly wallet: WalletService,
  ) {}

  /** Location is used for this request only and is never persisted (privacy requirement). */
  async nearby(userId: string, q: NearbyQuery) {
    if (!isValidCoordinate(q.lat, q.lng)) throw new BadRequestException('Invalid coordinates');
    const box = boundingBox(q.lat, q.lng, q.radius);
    const locations = await this.prisma.location.findMany({
      where: { latitude: { gte: box.minLat, lte: box.maxLat }, longitude: { gte: box.minLng, lte: box.maxLng } },
      include: { merchant: { include: { category: true } } },
      take: 500,
    });
    const [cards, valuations, pins, fallbackCategoryId] = await Promise.all([
      this.wallet.domainCards(userId),
      this.wallet.valuations(userId),
      this.prisma.categoryPin.findMany({ where: { userId } }),
      this.recs.fallbackCategoryId(),
    ]);
    const merchantIds = [...new Set(locations.map((l) => l.merchantId))];
    const offers = merchantIds.length
      ? await this.prisma.userOffer.findMany({
          where: {
            status: 'ACTIVE',
            walletCard: { wallet: { userId } },
            offer: { merchantId: { in: merchantIds }, OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] },
          },
          include: { offer: true },
        })
      : [];
    return locations
      .map((l) => ({ l, distanceM: Math.round(haversineMeters(q.lat, q.lng, l.latitude, l.longitude)) }))
      .filter((x) => x.distanceM <= q.radius)
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, q.limit)
      .map(({ l, distanceM }) => {
        const ranked = this.recs.rankForMerchant(cards, l.merchant, { valuations, pins, fallbackCategoryId });
        return {
          locationId: l.id,
          name: l.name,
          address: l.address,
          latitude: l.latitude,
          longitude: l.longitude,
          distanceM,
          merchant: { id: l.merchant.id, slug: l.merchant.slug, name: l.merchant.name, category: l.merchant.category.name, icon: l.merchant.category.icon },
          bestCard: ranked[0] ?? null,
          offers: offers.filter((o) => o.offer.merchantId === l.merchantId).map((o) => ({ id: o.id, title: o.offer.title, valueCents: o.offer.valueCents, endsAt: o.offer.endsAt })),
        };
      });
  }
}

@ApiTags('nearby')
@ApiBearerAuth()
@Controller('nearby')
export class NearbyController {
  constructor(private readonly nearby: NearbyService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: NearbyQuery) {
    return this.nearby.nearby(u.sub, q);
  }
}

@Module({ controllers: [NearbyController], providers: [NearbyService] })
export class NearbyModule {}
