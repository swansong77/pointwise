import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { AuthUser, CurrentUser } from "../common/decorators";
import { PrismaService } from "../common/prisma.service";
import { WalletService } from "../wallet/wallet.service";
import { SpendCoreModule } from "../spend/spend.module";
import { SpendService } from "../spend/spend.service";
import { addMonths } from "../domain/dates";

export class CreateTransactionDto {
  @ApiProperty() @IsUUID() walletCardId: string;
  @ApiProperty() @IsInt() @Min(1) @Max(100_000_000) amountCents: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() merchantId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() occurredAt?: string;
  @ApiPropertyOptional({
    enum: ["PURCHASE", "CREDIT"],
    default: "PURCHASE",
    description: "CREDIT = a statement credit from the issuer",
  })
  @IsOptional()
  @IsIn(["PURCHASE", "CREDIT"])
  kind?: "PURCHASE" | "CREDIT";
}

export class TxQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() walletCardId?: string;
  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit = 100;
}

/** Manually logged spend (purchases count toward welcome-bonus progress); benefits are updated automatically. */
@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly spend: SpendService,
  ) {}

  list(userId: string, q: TxQuery) {
    return this.prisma.transaction.findMany({
      where: {
        userId,
        ...(q.walletCardId && { walletCardId: q.walletCardId }),
      },
      orderBy: { occurredAt: "desc" },
      take: q.limit,
    });
  }

  async create(userId: string, dto: CreateTransactionDto) {
    await this.wallet.assertOwned(userId, dto.walletCardId);
    if (
      dto.categoryId &&
      !(await this.prisma.category.findUnique({
        where: { id: dto.categoryId },
        select: { id: true },
      }))
    )
      throw new BadRequestException("Unknown category");
    if (
      dto.merchantId &&
      !(await this.prisma.merchant.findUnique({
        where: { id: dto.merchantId },
        select: { id: true },
      }))
    )
      throw new BadRequestException("Unknown merchant");
    const kind = dto.kind ?? "PURCHASE";
    const [tx] = await this.prisma.$transaction([
      this.prisma.transaction.create({
        data: {
          userId,
          walletCardId: dto.walletCardId,
          amountCents: dto.amountCents,
          kind,
          merchantId: dto.merchantId,
          categoryId: dto.categoryId,
          description: dto.description,
          occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
        },
      }),
      this.prisma.walletCard.update({
        where: { id: dto.walletCardId },
        data: {
          bonusSpendCents: {
            increment: kind === "PURCHASE" ? dto.amountCents : 0,
          },
        },
      }),
    ]);
    const benefitUpdates = await this.spend.autoTrack(userId, [tx.id]);
    return { ...tx, benefitUpdates };
  }

  async remove(userId: string, id: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id },
      include: {
        walletCard: {
          select: { approvedAt: true, card: { select: { bonusMonths: true } } },
        },
      },
    });
    if (!tx || tx.userId !== userId)
      throw new NotFoundException("Transaction not found");
    // imported purchases counted toward the welcome bonus only inside the bonus window (see SpendService.ingest)
    const { approvedAt } = tx.walletCard;
    const months = tx.walletCard.card.bonusMonths;
    const inWindow =
      !!approvedAt &&
      !!months &&
      tx.occurredAt >= approvedAt &&
      tx.occurredAt < addMonths(approvedAt, months);
    const counted =
      tx.kind === "PURCHASE" && (tx.source === "MANUAL" || inWindow);
    await this.prisma.$transaction([
      this.prisma.transaction.delete({ where: { id } }),
      this.prisma.walletCard.update({
        where: { id: tx.walletCardId },
        data: { bonusSpendCents: { decrement: counted ? tx.amountCents : 0 } },
      }),
      // usage created by this transaction goes with it (FK cascade); usage this credit confirmed goes back to expected
      this.prisma.benefitUsage.updateMany({
        where: {
          creditTransactionId: null,
          status: "CONFIRMED",
          source: "AUTO_PURCHASE",
          userBenefit: { walletCardId: tx.walletCardId },
        },
        data: { status: "EXPECTED" },
      }),
    ]);
  }
}

@ApiTags("transactions")
@ApiBearerAuth()
@Controller("transactions")
export class TransactionsController {
  constructor(private readonly tx: TransactionsService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query() q: TxQuery) {
    return this.tx.list(u.sub, q);
  }
  @Post() create(
    @CurrentUser() u: AuthUser,
    @Body() dto: CreateTransactionDto,
  ) {
    return this.tx.create(u.sub, dto);
  }
  @Delete(":id") @HttpCode(204) remove(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.tx.remove(u.sub, id);
  }
}

@Module({
  imports: [SpendCoreModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
})
export class TransactionsModule {}
