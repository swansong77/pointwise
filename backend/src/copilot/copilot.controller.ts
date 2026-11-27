import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AiCoreModule } from '../ai/ai.module';
import { AuthUser, CurrentUser } from '../common/decorators';
import { LoyaltyCoreModule } from '../loyalty/loyalty.module';
import { OffersModule } from '../offers/offers.module';
import { PortfolioModule } from '../portfolio/portfolio';
import { SearchModule } from '../search/search.controller';
import { StrategyCoreModule } from '../strategy/strategy.module';
import { WalletModule } from '../wallet/wallet.module';
import { CopilotService } from './copilot.service';
import { GoalsService } from './goals.service';
import { MemoryService } from './memory.service';
import { WhatIfService } from './what-if.service';

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

export class GoalCreateBody {
  @ApiProperty({ enum: ['STATUS', 'FIVE24', 'TRIP', 'CASHBACK', 'FEES', 'MILES', 'CUSTOM'] }) @IsString() @MaxLength(12) kind: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) title: string;
  @ApiPropertyOptional({ description: 'by kind: {program, level} · {max} · {destination, pointsNeeded, program?} · {annualCents} · {maxCents} · {program, points}' }) @IsOptional() @IsObject() target?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) dueAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() profileId?: string;
}

export class GoalPatchBody {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120) title?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'DONE', 'DROPPED'] }) @IsOptional() @IsString() @MaxLength(10) status?: 'ACTIVE' | 'DONE' | 'DROPPED';
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(0) @Max(100) manualProgress?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(40) dueAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsObject() target?: Record<string, unknown>;
}

export class PreferencesBody {
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) airlines?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) hotels?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) destinations?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) merchants?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) priorities?: string[];
}

export class DecisionBody {
  @ApiProperty({ description: 'a plan item id, as returned by /copilot/ask' }) @IsString() @MinLength(1) @MaxLength(160) itemId: string;
  @ApiProperty({ enum: ['DISMISS', 'SNOOZE', 'DONE'] }) @IsString() @MaxLength(10) action: string;
  @ApiPropertyOptional({ description: 'snooze for this many days (1-90)' }) @IsOptional() @IsInt() @Min(1) @Max(90) days?: number;
}

@ApiTags('copilot')
@ApiBearerAuth()
@Controller('copilot')
export class CopilotController {
  constructor(
    private readonly svc: CopilotService,
    private readonly goals: GoalsService,
    private readonly memory: MemoryService,
  ) {}

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

  // goals
  @Get('goals') listGoals(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    return this.goals.list(u.sub, new Date(), { status: status === 'all' ? 'ALL' : 'ACTIVE' });
  }
  @Post('goals') createGoal(@CurrentUser() u: AuthUser, @Body() dto: GoalCreateBody) {
    return this.goals.create(u.sub, dto);
  }
  @Patch('goals/:id') updateGoal(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GoalPatchBody) {
    return this.goals.update(u.sub, id, dto);
  }
  @Delete('goals/:id') @HttpCode(204) removeGoal(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.goals.remove(u.sub, id);
  }

  // what Copilot remembers
  @Get('memory') memories(@CurrentUser() u: AuthUser) {
    return this.memory.list(u.sub);
  }
  @Get('memory/preferences') prefs(@CurrentUser() u: AuthUser) {
    return this.memory.preferences(u.sub);
  }
  @Put('memory/preferences') setPrefs(@CurrentUser() u: AuthUser, @Body() dto: PreferencesBody) {
    return this.memory.setPreferences(u.sub, dto);
  }
  @Post('memory/decisions') decide(@CurrentUser() u: AuthUser, @Body() dto: DecisionBody) {
    return this.memory.decide(u.sub, dto);
  }
  @Delete('memory/:id') @HttpCode(204) forget(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.memory.forget(u.sub, id);
  }
  @Delete('memory') forgetAll(@CurrentUser() u: AuthUser, @Query('kind') kind?: string) {
    return this.memory.forgetAll(u.sub, kind === 'PREFERENCE' || kind === 'DECISION' || kind === 'RECOMMENDATION' ? kind : undefined);
  }
}

@Module({
  imports: [AiCoreModule, SearchModule, StrategyCoreModule, PortfolioModule, WalletModule, OffersModule, LoyaltyCoreModule],
  controllers: [CopilotController],
  providers: [CopilotService, WhatIfService, GoalsService, MemoryService],
  exports: [CopilotService],
})
export class CopilotModule {}
