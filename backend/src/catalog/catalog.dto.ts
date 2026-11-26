import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CardNetwork, CardType } from '@prisma/client';
import { PageQuery } from '../common/pagination';

export class CardSearchQuery extends PageQuery {
  @ApiPropertyOptional({ enum: CardNetwork }) @IsOptional() @IsEnum(CardNetwork)
  network?: CardNetwork;

  @ApiPropertyOptional({ enum: CardType }) @IsOptional() @IsEnum(CardType)
  type?: CardType;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 64)
  issuerId?: string;

  @ApiPropertyOptional({ description: 'max annual fee in cents' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000_00)
  maxFeeCents?: number;

  @ApiPropertyOptional({ example: 'US' }) @IsOptional() @IsString() @Length(2, 2)
  country?: string;
}

export class MerchantSearchQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 64)
  categoryId?: string;
}
