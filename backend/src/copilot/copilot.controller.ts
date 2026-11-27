import { Body, Controller, Delete, Get, Module, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AiCoreModule } from '../ai/ai.module';
import { AuthUser, CurrentUser } from '../common/decorators';
import { SearchModule } from '../search/search.controller';
import { CopilotService } from './copilot.service';

export class CopilotAskDto {
  @ApiProperty({ description: 'a question, or "What should I do today?"' }) @IsString() @MinLength(1) @MaxLength(300) q: string;
  @ApiPropertyOptional({ description: 'QUICK | PLANNING | RESEARCH | TRAVEL | CARD_STRATEGY | AUDIT (default: your setting)' }) @IsOptional() @IsString() @MaxLength(20) mode?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sessionId?: string;
}

export class CopilotSettingsBody {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() aiModeEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) mode?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() @Min(0) @Max(1) temperature?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(10) reasoningDepth?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(12) responseStyle?: string;
  @ApiPropertyOptional({ description: 'share a redacted, pseudonymized view with the cloud providers you allow' }) @IsOptional() @IsBoolean() cloudShare?: boolean;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(80, { each: true }) cloudProviders?: string[];
}

@ApiTags('copilot')
@ApiBearerAuth()
@Controller('copilot')
export class CopilotController {
  constructor(private readonly svc: CopilotService) {}

  @Post('ask') ask(@CurrentUser() u: AuthUser, @Body() dto: CopilotAskDto) {
    return this.svc.ask(u.sub, dto.q, { mode: dto.mode, sessionId: dto.sessionId });
  }
  @Get('agenda') agenda(@CurrentUser() u: AuthUser, @Query('mode') mode?: string, @Query('when') when?: string) {
    const q = when === 'month' ? 'What should I do this month?' : when === 'week' ? 'What should I do this week?' : 'What should I do today?';
    return this.svc.ask(u.sub, q, { mode });
  }
  @Get('settings') settings(@CurrentUser() u: AuthUser) {
    return this.svc.settings(u.sub);
  }
  @Put('settings') update(@CurrentUser() u: AuthUser, @Body() dto: CopilotSettingsBody) {
    return this.svc.updateSettings(u.sub, dto);
  }
  @Get('disclosures') disclosures(@CurrentUser() u: AuthUser, @Query('limit') limit?: string) {
    return this.svc.disclosures(u.sub, limit ? Number(limit) : 50);
  }
  @Delete('disclosures') clear(@CurrentUser() u: AuthUser) {
    return this.svc.clearDisclosures(u.sub);
  }
}

@Module({
  imports: [AiCoreModule, SearchModule],
  controllers: [CopilotController],
  providers: [CopilotService],
  exports: [CopilotService],
})
export class CopilotModule {}
