import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

const KINDS = ['MOCK', 'EXTENSION', 'EMAIL', 'MANUAL', 'ISSUER_LOGIN'] as const;
const MFA = ['NONE', 'SMS', 'APP', 'AUTHENTICATOR', 'PASSKEY'] as const;
const CADENCE = ['DAILY', 'WEEKLY', 'MONTHLY', 'MANUAL'] as const;

export class CreateOfferAccountDto {
  @ApiProperty() @IsUUID() issuerId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() profileId?: string;
  @ApiProperty({ description: 'who the account belongs to, e.g. "Alex - Platinum"' }) @IsString() @MinLength(1) @MaxLength(80) holderLabel: string;
  @ApiProperty({ enum: KINDS }) @IsIn(KINDS) connectorKind: (typeof KINDS)[number];
  @ApiPropertyOptional({ description: 'write-only; encrypted at rest, never returned' }) @IsOptional() @IsString() @MaxLength(200) username?: string;
  @ApiPropertyOptional({ description: 'write-only; encrypted at rest, never returned' }) @IsOptional() @IsString() @MaxLength(200) password?: string;
  @ApiPropertyOptional({ enum: MFA }) @IsOptional() @IsIn(MFA) mfaMethod?: (typeof MFA)[number];
  @ApiPropertyOptional({ enum: CADENCE }) @IsOptional() @IsIn(CADENCE) cadence?: (typeof CADENCE)[number];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(23) syncHour?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) timezone?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) walletCardIds?: string[];
  @ApiPropertyOptional({ description: 'opt in to server-side login; requires ackTermsRisk' }) @IsOptional() @IsBoolean() automationOptIn?: boolean;
  @ApiPropertyOptional({ description: 'the member has read the terms-risk note for this issuer' }) @IsOptional() @IsBoolean() ackTermsRisk?: boolean;
}

export class UpdateOfferAccountDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(80) holderLabel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) username?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) password?: string;
  @ApiPropertyOptional({ enum: MFA }) @IsOptional() @IsIn(MFA) mfaMethod?: (typeof MFA)[number];
  @ApiPropertyOptional({ enum: CADENCE }) @IsOptional() @IsIn(CADENCE) cadence?: (typeof CADENCE)[number];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(23) syncHour?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) timezone?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) walletCardIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() automationOptIn?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() ackTermsRisk?: boolean;
  @ApiPropertyOptional({ description: 'clear the lock after repeated login failures' }) @IsOptional() @IsBoolean() unlock?: boolean;
}

export class MfaDto {
  @ApiProperty() @IsString() @MinLength(4) @MaxLength(12) code: string;
}

export class SyncDto {
  @ApiPropertyOptional({ description: 'one account; omit to sync the whole household' }) @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional({ description: 'wait for the runs to finish before answering (default: answer at once and poll)' }) @IsOptional() @IsBoolean() wait?: boolean;
}

export class ItemIdsDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) itemIds: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class RuleDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) label: string;
  @ApiProperty({ enum: ['ALWAYS', 'NEVER'] }) @IsIn(['ALWAYS', 'NEVER']) kind: 'ALWAYS' | 'NEVER';
  @ApiProperty({ enum: ['MERCHANT', 'CATEGORY', 'MIN_VALUE', 'OFFER_TYPE', 'KEYWORD', 'SPEND_HISTORY'] }) @IsIn(['MERCHANT', 'CATEGORY', 'MIN_VALUE', 'OFFER_TYPE', 'KEYWORD', 'SPEND_HISTORY']) matcher: 'MERCHANT' | 'CATEGORY' | 'MIN_VALUE' | 'OFFER_TYPE' | 'KEYWORD' | 'SPEND_HISTORY';
  @ApiProperty({ description: 'merchant or keyword text, a category, a value in cents, or an offer type' }) @IsString() @MaxLength(100) matcherValue: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() walletCardId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1000) priority?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
}

export class AutoFilterDto {
  @IsOptional() @IsBoolean() allOffers?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) categories?: string[];
  @IsOptional() @IsInt() @Min(0) minValueCents?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) preferredMerchants?: string[];
  @IsOptional() @IsBoolean() matchSpendHistory?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100) minScore?: number;
}

export class PolicyDto {
  @ApiProperty({ enum: ['RECOMMEND', 'BULK_APPROVAL', 'AUTO'] }) @IsEnum({ RECOMMEND: 'RECOMMEND', BULK_APPROVAL: 'BULK_APPROVAL', AUTO: 'AUTO' }) mode: 'RECOMMEND' | 'BULK_APPROVAL' | 'AUTO';
  @ApiPropertyOptional() @IsOptional() @IsObject() @ValidateNested() @Type(() => AutoFilterDto) autoFilter?: AutoFilterDto;
}

export class InboxQuery {
  @ApiPropertyOptional({ enum: ['all', 'new', 'review', 'enrolled', 'auto', 'expiring', 'redeemed', 'history', 'queued'] }) @IsOptional() @IsIn(['all', 'new', 'review', 'enrolled', 'auto', 'expiring', 'redeemed', 'history', 'queued']) tab?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() profileId?: string;
}

export class IngestSnapshotDto {
  @ApiPropertyOptional({ description: 'the offer account this page belongs to; otherwise matched by issuer name' }) @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional({ description: 'issuer name when no account id is given' }) @IsOptional() @IsString() @MaxLength(80) issuer?: string;
  @ApiPropertyOptional({ description: 'last four digits of the card the page shows, to tie offers to the right card' }) @IsOptional() @IsString() @MaxLength(5) lastFour?: string;
  @ApiProperty({ description: 'the visible text of the offers page; parsed then discarded' }) @IsString() @MinLength(10) @MaxLength(60_000) text: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) pageHash?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() capturedAt?: string;
}

export class EnrollResultDto {
  @IsString() @MaxLength(120) externalId: string;
  @IsString() @MaxLength(120) cardKey: string;
  @IsIn(['SUCCESS', 'FAILURE', 'ALREADY_ADDED']) outcome: 'SUCCESS' | 'FAILURE' | 'ALREADY_ADDED';
  @IsOptional() @IsString() @MaxLength(200) message?: string;
}

export class EnrollResultsDto {
  @ApiProperty({ description: 'the account the extension worked on' }) @IsUUID() accountId: string;
  @ApiProperty({ type: [EnrollResultDto] }) @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => EnrollResultDto) results: EnrollResultDto[];
}

export class PasteDto {
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(60_000) text: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5) lastFour?: string;
}
