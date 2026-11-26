import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CertificateCategory, LoyaltyEventKind, LoyaltyKind, LoyaltySource, MembershipKind, StatusKind } from '@prisma/client';

const str = (max: number) => [IsString(), MaxLength(max)];
void str;

export class CreateAccountDto {
  @ApiProperty() @IsUUID() profileId: string;
  @ApiPropertyOptional({ description: 'registry program code, e.g. AA_AADVANTAGE' }) @IsOptional() @IsString() @MaxLength(40) programCode?: string;
  @ApiPropertyOptional({ description: 'bank currency code, e.g. AMEX_MR' }) @IsOptional() @IsString() @MaxLength(40) currencyCode?: string;
  @ApiPropertyOptional({ description: 'a program that is not in the registry' }) @IsOptional() @IsString() @MinLength(2) @MaxLength(80) customName?: string;
  @ApiPropertyOptional({ enum: LoyaltyKind }) @IsOptional() @IsEnum(LoyaltyKind) customKind?: LoyaltyKind;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) customCentsPerPoint?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) nickname?: string;
  @ApiPropertyOptional({ description: 'stored encrypted; only the last 4 characters are shown' }) @IsOptional() @IsString() @MaxLength(40) accountNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() memberSince?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) balance?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) pendingBalance?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(2_000_000_000) lifetimePoints?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) statusLevel?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() statusDeadline?: string;
  @ApiPropertyOptional({ description: 'expiry date you know from the program (overrides the prediction)' }) @IsOptional() @IsDateString() expiresAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() lastActivityAt?: string;
  @ApiPropertyOptional({ enum: LoyaltySource }) @IsOptional() @IsEnum(LoyaltySource) source?: LoyaltySource;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() transferable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class UpdateAccountDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) nickname?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) accountNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) balance?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) pendingBalance?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(2_000_000_000) lifetimePoints?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) statusLevel?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() statusDeadline?: string;
  @ApiPropertyOptional({ description: 'null clears the override' }) @IsOptional() @IsDateString() expiresAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() lastActivityAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() transferable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @ApiPropertyOptional({ description: 'replace a higher-confidence stored value with this manual entry' }) @IsOptional() @IsBoolean() force?: boolean;
}

export class AccountEventDto {
  @ApiProperty({ enum: LoyaltyEventKind }) @IsEnum(LoyaltyEventKind) kind: LoyaltyEventKind;
  @ApiProperty({ description: 'points moved (positive); ignored for SNAPSHOT, where balance is the new balance' }) @IsInt() @Min(0) @Max(1_000_000_000) points: number;
  @ApiPropertyOptional({ description: 'SNAPSHOT / ADJUST: the balance after this event' }) @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) balance?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() occurredAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class CertificateDto {
  @ApiProperty() @IsUUID() profileId: string;
  @ApiProperty({ enum: CertificateCategory }) @IsEnum(CertificateCategory) category: CertificateCategory;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) subtype?: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) programCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) number?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() issuedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiresAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(99) quantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000) pointCap?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) restrictions?: string;
  @ApiPropertyOptional({ description: 'eligible hotels / brands or routes' }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(80, { each: true }) eligible?: string[];
  @ApiPropertyOptional({ description: 'e.g. 2026-12-18..2027-01-02; 2027-03-01..2027-03-10' }) @IsOptional() @IsString() @MaxLength(500) blackout?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) fareClasses?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() transferable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000_000) potentialValueCents?: number;
}

export class UpdateCertificateDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiresAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(99) quantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000_000) potentialValueCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) restrictions?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) blackout?: string;
  @ApiPropertyOptional({ enum: ['AVAILABLE', 'USED', 'EXPIRED', 'CANCELLED'] }) @IsOptional() @IsIn(['AVAILABLE', 'USED', 'EXPIRED', 'CANCELLED']) status?: 'AVAILABLE' | 'USED' | 'EXPIRED' | 'CANCELLED';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) usageNote?: string;
}

export class CertificateQuery {
  @ApiPropertyOptional({ enum: CertificateCategory }) @IsOptional() @IsEnum(CertificateCategory) category?: CertificateCategory;
}

export class StayDto {
  @ApiProperty() @IsString() @MaxLength(120) hotel: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) brand?: string;
  @ApiProperty() @IsInt() @Min(0) @Max(1_000_000) pointsPerNight: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100_000_000) cashRateCents: number;
  @ApiProperty() @IsDateString() checkIn: string;
}

export class RedemptionCheckDto {
  @ApiProperty({ type: [StayDto] }) @IsArray() @ArrayMaxSize(20) @Type(() => StayDto) stays: StayDto[];
}

export class StatusDto {
  @ApiProperty() @IsUUID() profileId: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) programName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) programCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;
  @ApiProperty({ enum: StatusKind }) @IsEnum(StatusKind) kind: StatusKind;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) level: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() periodStart?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiresAt?: string;
  @ApiPropertyOptional({ description: 'nights, segments, PQP, points, spend' }) @IsOptional() @IsString() @MaxLength(40) metric?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000_000) progress?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000_000) required?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() maintained?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) renewalRequirement?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(120, { each: true }) benefits?: string[];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000_000) valueCents?: number;
}

export class UpdateStatusDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) level?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiresAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000_000) progress?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000_000) required?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() maintained?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000_000) valueCents?: number;
}

export class MembershipDto {
  @ApiProperty() @IsUUID() profileId: string;
  @ApiProperty({ enum: MembershipKind }) @IsEnum(MembershipKind) kind: MembershipKind;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) name: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() joinedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() renewalAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiresAt?: string;
  @ApiPropertyOptional({ description: 'stored encrypted; only the last 4 characters are shown' }) @IsOptional() @IsString() @MaxLength(40) memberNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(120, { each: true }) benefits?: string[];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000_000) renewalCostCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) renewalMethod?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoRenew?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsUUID() linkedWalletCardId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000_000) annualValueCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class UpdateMembershipDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() renewalAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiresAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000_000) renewalCostCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoRenew?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000_000) annualValueCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() linkedWalletCardId?: string;
}

export class BonusRecordDto {
  @ApiProperty() @IsString() @MaxLength(40) currency: string;
  @ApiProperty() @IsString() @MaxLength(40) program: string;
  @ApiProperty() @IsInt() @Min(1) @Max(500) bonusPercent: number;
  @ApiProperty() @IsDateString() startsAt: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) source?: string;
}

export class AwardTripDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) destination: string;
  @ApiProperty() @IsDateString() dateFrom: string;
  @ApiProperty() @IsDateString() dateTo: string;
  @ApiProperty({ enum: ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'] }) @IsIn(['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']) cabin: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
  @ApiPropertyOptional({ enum: ['DOMESTIC', 'SHORT_INTERNATIONAL', 'LONG_HAUL'] }) @IsOptional() @IsIn(['DOMESTIC', 'SHORT_INTERNATIONAL', 'LONG_HAUL']) region?: 'DOMESTIC' | 'SHORT_INTERNATIONAL' | 'LONG_HAUL';
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(9) travelers?: number;
  @ApiPropertyOptional({ description: 'exact points for the award if you know them (otherwise a coarse estimate is used)' }) @IsOptional() @IsInt() @Min(1) @Max(5_000_000) pointsNeeded?: number;
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(60, { each: true }) airlinePrefs?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(60, { each: true }) hotelPrefs?: string[];
  @ApiPropertyOptional() @IsOptional() @IsUUID() bookerProfileId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() save?: boolean;
}
