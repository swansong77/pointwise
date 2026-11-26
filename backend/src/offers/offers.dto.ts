import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUrl, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { OfferKind, UserOfferStatus } from '@prisma/client';
import { PageQuery } from '../common/pagination';

export class OfferCatalogQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() merchantId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cardId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() issuerId?: string;
}

export class MyOffersQuery {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'REDEEMED', 'EXPIRED', 'ALL'], default: 'ACTIVE' })
  @IsOptional() @IsIn(['ACTIVE', 'REDEEMED', 'EXPIRED', 'ALL'])
  status: UserOfferStatus | 'ALL' = 'ACTIVE';

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  walletCardId?: string;

  @ApiPropertyOptional({ enum: ['endDate', 'value', 'addedDate', 'alphabetical'] })
  @IsOptional() @IsIn(['endDate', 'value', 'addedDate', 'alphabetical'])
  sort: 'endDate' | 'value' | 'addedDate' | 'alphabetical' = 'endDate';

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  q?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Boolean) @IsBoolean()
  favoritesOnly?: boolean;

  @ApiPropertyOptional({ description: 'include snoozed offers' }) @IsOptional() @Type(() => Boolean) @IsBoolean()
  includeSnoozed?: boolean;
}

export class AddOfferToCardDto {
  @ApiProperty() @IsUUID() offerId: string;
  @ApiProperty() @IsUUID() walletCardId: string;
}

export class CustomOfferDto {
  @ApiProperty() @IsUUID() walletCardId: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(140) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiProperty({ enum: OfferKind }) @IsEnum(OfferKind) kind: OfferKind;
  @ApiProperty({ description: 'cash value / max discount (cents)' }) @IsInt() @Min(0) @Max(10_000_000) valueCents: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000_000) points?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) percent?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000_000) minSpendCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isRepeatable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1000) maxTimes?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() merchantId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['https', 'http'], require_protocol: true }) @MaxLength(500) url?: string;
}

export class UpdateUserOfferDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000_000) amountUsedCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) timesUsed?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() redeemed?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isFavorite?: boolean;
  @ApiPropertyOptional({ description: 'ISO date to snooze until; null to unsnooze' }) @IsOptional() @IsDateString() snoozedUntil?: string | null;
}

export class ImportOffersDto {
  @ApiProperty() @IsUUID() walletCardId: string;
  @ApiProperty({ description: 'one offer per line, e.g. "Hilton: spend $500, get $100 back, expires 12/31/2026"' }) @IsString() @MinLength(6) @MaxLength(20_000) text: string;
}

export class SetActivationDto {
  @ApiProperty({ enum: ['ACTIVATED', 'FAILED', 'PENDING'] }) @IsIn(['ACTIVATED', 'FAILED', 'PENDING']) status: 'ACTIVATED' | 'FAILED' | 'PENDING';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class InventoryQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() walletCardId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() source?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['NOT_REQUIRED', 'PENDING', 'ACTIVATED', 'FAILED']) activation?: string;
}

export class OfferInventoryQuery {
  @ApiPropertyOptional({ description: 'free text: merchant, title, card, issuer or cardholder; "amex" reads as American Express' }) @IsOptional() @IsString() @MaxLength(120) q?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() walletCardId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() profileId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) issuer?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ description: 'comma separated lifecycle states, e.g. ADDED,ACTIVATED' }) @IsOptional() @IsString() @MaxLength(200) states?: string;
  @ApiPropertyOptional({ description: 'only offers ending within this many days' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3650) expiresWithinDays?: number;
  @ApiPropertyOptional({ description: 'only offers worth at least this much, in cents' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) minValueCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) source?: string;
  @ApiPropertyOptional({ enum: ['ENDING', 'VALUE', 'EXPECTED', 'ADDED', 'MERCHANT'] }) @IsOptional() @IsIn(['ENDING', 'VALUE', 'EXPECTED', 'ADDED', 'MERCHANT']) sort?: 'ENDING' | 'VALUE' | 'EXPECTED' | 'ADDED' | 'MERCHANT';
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}

export class PlanPurchaseDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() merchantId?: string;
  @ApiPropertyOptional({ description: 'free text, resolved to a merchant (e.g. "Marriott")' }) @IsOptional() @IsString() @MaxLength(120) merchantText?: string;
  @ApiProperty({ description: 'planned spend in cents' }) @IsInt() @Min(1) @Max(100_000_000) amountCents: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() plannedFor?: string;
  @ApiPropertyOptional({ description: 'keep this as a planned purchase' }) @IsOptional() @IsBoolean() save?: boolean;
  @ApiPropertyOptional({ description: 'what is being bought, e.g. "MacBook Pro"; used to guess a merchant or category when none is given' }) @IsOptional() @IsString() @MaxLength(120) item?: string;
  @ApiPropertyOptional({ description: 'spend category slug, e.g. hotels' }) @IsOptional() @IsString() @MaxLength(60) category?: string;
  @ApiPropertyOptional({ enum: ['LOW', 'MEDIUM', 'HIGH'] }) @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH']) priority?: 'LOW' | 'MEDIUM' | 'HIGH';
  @ApiPropertyOptional({ description: 'household member (profile id) who would rather pay; the answer says what that costs' }) @IsOptional() @IsUUID() preferMember?: string;
  @ApiPropertyOptional({ type: [String], description: 'wallet cards to leave out' }) @IsOptional() @IsUUID(undefined, { each: true }) excludeCardIds?: string[];
}

export class UpdatePlannedDto {
  @ApiPropertyOptional({ enum: ['PLANNED', 'DONE', 'CANCELLED'] }) @IsOptional() @IsIn(['PLANNED', 'DONE', 'CANCELLED']) status?: 'PLANNED' | 'DONE' | 'CANCELLED';
  @ApiPropertyOptional({ description: 'what the purchase really returned, in cents' }) @IsOptional() @IsInt() @Min(0) @Max(100_000_000) actualCents?: number;
  @ApiPropertyOptional({ description: 'the card paid with' }) @IsOptional() @IsUUID() chosenWalletCardId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() plannedFor?: string;
  @ApiPropertyOptional({ enum: ['LOW', 'MEDIUM', 'HIGH'] }) @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH']) priority?: 'LOW' | 'MEDIUM' | 'HIGH';
}
