import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class RegisterDto {
  @ApiProperty({ example: 'nora@example.com' })
  @Transform(lower) @IsEmail() @MaxLength(254)
  email: string;

  @ApiProperty({ minLength: 10, example: 'correct-horse-battery' })
  @IsString() @MinLength(10) @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*[^A-Za-z]).+$/, { message: 'password must contain a letter and a non-letter' })
  password: string;

  @ApiPropertyOptional({ example: 'Nora' })
  @IsOptional() @IsString() @MaxLength(80)
  name?: string;
}

export class LoginDto {
  @ApiProperty() @Transform(lower) @IsEmail() @MaxLength(254)
  email: string;

  @ApiProperty() @IsString() @MinLength(1) @MaxLength(128)
  password: string;
}

export class RefreshDto {
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(512)
  refreshToken: string;
}

export class OAuthExchangeDto {
  @ApiProperty({ enum: ['google', 'apple'] }) @IsIn(['google', 'apple'])
  provider: 'google' | 'apple';

  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255)
  providerAccountId: string;

  @ApiProperty() @Transform(lower) @IsEmail() @MaxLength(254)
  email: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80)
  name?: string;
}

export class ForgotPasswordDto {
  @ApiProperty() @Transform(lower) @IsEmail() @MaxLength(254)
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(256)
  token: string;

  @ApiProperty() @IsString() @MinLength(10) @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*[^A-Za-z]).+$/, { message: 'password must contain a letter and a non-letter' })
  password: string;
}

export class TokenPairDto {
  @ApiProperty() accessToken: string;
  @ApiProperty() refreshToken: string;
  @ApiProperty() expiresIn: number;
  @ApiProperty() user: { id: string; email: string; name: string | null; role: string };
}
