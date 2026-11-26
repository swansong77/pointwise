import { Body, Controller, ForbiddenException, Injectable, Module, NotFoundException, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { toDomainCard } from '../common/mappers';
import { WalletService } from '../wallet/wallet.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { calculateWalletValue, compareCandidate } from '../domain/calculator';
import { limitsFor } from '../domain/entitlements';

export class SpendLineDto {
  @ApiProperty() @IsUUID()
  categoryId: string;

  @ApiProperty({ description: 'annual spend in cents' }) @IsInt() @Min(0) @Max(10_000_000_000)
  annualSpendCents: number;
}

export class CalculateDto {
  @ApiProperty({ type: [SpendLineDto] })
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => SpendLineDto)
  spend: SpendLineDto[];

  @ApiPropertyOptional({ description: 'catalog card to compare against the current wallet (Pro)' })
  @IsOptional() @IsUUID()
  candidateCardId?: string;
}

@Injectable()
export class CalculatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly recs: RecommendationsService,
  ) {}

  async calculate(userId: string, dto: CalculateDto) {
    const [cards, valuations, fallbackCategoryId, categories] = await Promise.all([
      this.wallet.domainCards(userId),
      this.wallet.valuations(userId),
      this.recs.fallbackCategoryId(),
      this.prisma.category.findMany({ select: { id: true, parentId: true } }),
    ]);
    const parentOf = Object.fromEntries(categories.map((c) => [c.id, c.parentId]));
    const opts = { fallbackCategoryId, valuations, parentOf };
    if (!dto.candidateCardId) return { result: calculateWalletValue(cards, dto.spend, opts) };

    const sub = await this.prisma.subscription.findUnique({ where: { userId } });
    if (!limitsFor(sub).calculatorCompare) throw new ForbiddenException('Card comparison requires Pro');
    const card = await this.prisma.creditCard.findUnique({ where: { id: dto.candidateCardId }, include: { currency: true, rewards: true } });
    if (!card) throw new NotFoundException('Candidate card not found');
    const candidate = {
      id: 'candidate', nickname: null, status: 'APPROVED' as const, approvedAt: null, closedAt: null,
      annualFeeOverrideCents: null, bonusEarned: false, bonusSpendCents: 0, selectedCategoryIds: [],
      card: toDomainCard(card),
    };
    return { comparison: compareCandidate(cards, candidate, dto.spend, opts) };
  }
}

@ApiTags('calculator')
@ApiBearerAuth()
@Controller('calculator')
export class CalculatorController {
  constructor(private readonly calc: CalculatorService) {}

  @Post()
  calculate(@CurrentUser() u: AuthUser, @Body() dto: CalculateDto) {
    return this.calc.calculate(u.sub, dto);
  }
}

@Module({ controllers: [CalculatorController], providers: [CalculatorService] })
export class CalculatorModule {}
