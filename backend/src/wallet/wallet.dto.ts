import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { Cardholder, CardStatus, OpenDatePrecision } from '@prisma/client';

export class AddWalletCardDto {
  @ApiProperty() @IsUUID()
  cardId: string;

  @ApiPropertyOptional({ enum: CardStatus, default: 'APPROVED' }) @IsOptional() @IsEnum(CardStatus)
  status?: CardStatus;

  @ApiPropertyOptional({ enum: Cardholder }) @IsOptional() @IsEnum(Cardholder)
  cardholder?: Cardholder;

  @ApiPropertyOptional({ example: '2025-03-15' }) @IsOptional() @IsDateString()
  approvedAt?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60)
  nickname?: string;

  @ApiPropertyOptional({ description: 'last 4 digits (5 for Amex) — never a full card number' })
  @IsOptional() @Matches(/^\d{4,5}$/)
  lastFour?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  profileId?: string;

  @ApiPropertyOptional({ enum: OpenDatePrecision, description: 'MONTH when only the month is known (credit reports)' })
  @IsOptional() @IsEnum(OpenDatePrecision)
  openDatePrecision?: OpenDatePrecision;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000_000_00)
  creditLimitCents?: number;

  @ApiPropertyOptional({ default: true, description: 'copy the card product\'s catalog benefits' })
  @IsOptional() @IsBoolean()
  trackBenefits?: boolean;
}

export class UpdateWalletCardDto {
  @ApiPropertyOptional({ enum: CardStatus }) @IsOptional() @IsEnum(CardStatus)
  status?: CardStatus;

  @ApiPropertyOptional({ enum: Cardholder }) @IsOptional() @IsEnum(Cardholder)
  cardholder?: Cardholder;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  approvedAt?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  closedAt?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60)
  nickname?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4,5}$/)
  lastFour?: string | null;

  @ApiPropertyOptional({ enum: OpenDatePrecision }) @IsOptional() @IsEnum(OpenDatePrecision)
  openDatePrecision?: OpenDatePrecision;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000_000_00)
  creditLimitCents?: number | null;

  @ApiPropertyOptional({ description: 'manually exclude from 5/24 (e.g. AU card removed on reconsideration)' })
  @IsOptional() @IsBoolean()
  excludeFrom524?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  excludeReason?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000_00)
  annualFeeOverrideCents?: number | null;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  bonusEarned?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000_000)
  bonusSpendCents?: number;

  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true })
  selectedCategoryIds?: string[];

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  profileId?: string | null;
}

export class ReorderDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true })
  walletCardIds: string[];
}

export class PinDto {
  @ApiProperty() @IsUUID()
  walletCardId: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  merchantId?: string;
}

export class ValuationDto {
  @ApiProperty() @IsUUID()
  currencyId: string;

  @ApiProperty({ description: 'cents per point, 0–10' }) @Min(0) @Max(10)
  centsPerPoint: number;
}

export class RelinkDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) walletCardIds!: string[];
}
