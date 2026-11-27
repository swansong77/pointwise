import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AiCoreModule } from '../ai/ai.module';
import { AuthUser, CurrentUser } from '../common/decorators';
import { BenefitsModule } from '../portfolio/benefits';
import { LoyaltyCoreModule } from '../loyalty/loyalty.module';
import { OffersModule } from '../offers/offers.module';
import { SearchAskService } from './search-ask.service';
import { SearchMemoryService } from './search-memory.service';
import { SearchService } from './search.service';

export class SuggestQuery {
  @ApiPropertyOptional({ description: 'what has been typed so far' }) @IsOptional() @IsString() @MaxLength(200) q?: string;
}

export class AskDto {
  @ApiProperty({ description: 'the question, in plain language' }) @IsString() @MinLength(1) @MaxLength(300) q: string;
  @ApiPropertyOptional({ description: 'the conversation returned with the previous answer; the server remembers what "it" is' }) @IsOptional() @IsUUID() sessionId?: string;
  @ApiPropertyOptional({ description: 'fallback: the slots returned with the previous answer, used when there is no conversation' }) @IsOptional() @IsObject() slots?: Record<string, unknown>;
}

export class SaveSearchDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(300) query: string;
  @ApiPropertyOptional({ description: 'a name for the saved search' }) @IsOptional() @IsString() @MaxLength(80) name?: string;
}

/** Universal search: suggestions as you type, and answers to questions in plain language. Everything is the caller's own data. */
@ApiTags('search')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly asks: SearchAskService,
    private readonly memory: SearchMemoryService,
  ) {}

  @Get('suggest')
  suggest(@CurrentUser() u: AuthUser, @Query() q: SuggestQuery) {
    return this.search.suggest(u.sub, q.q ?? '');
  }

  @Post('ask')
  ask(@CurrentUser() u: AuthUser, @Body() dto: AskDto) {
    return this.asks.ask(u.sub, dto.q, dto.slots, dto.sessionId);
  }

  /** Most common, recent, saved, favourite merchants, recent cards and recommendations, recent plans and trips. */
  @Get('dashboard')
  dashboard(@CurrentUser() u: AuthUser) {
    return this.memory.dashboard(u.sub);
  }

  @Get('saved')
  async saved(@CurrentUser() u: AuthUser) {
    return (await this.memory.entries(u.sub)).filter((e) => e.kind === 'SAVED');
  }

  @Post('saved')
  save(@CurrentUser() u: AuthUser, @Body() dto: SaveSearchDto) {
    return this.memory.save(u.sub, dto.query, dto.name, new Date());
  }

  /** Whether this question is already saved (for the star). */
  @Get('saved/check')
  async check(@CurrentUser() u: AuthUser, @Query('q') q?: string) {
    return { saved: await this.memory.isSaved(u.sub, q ?? '') };
  }

  @Delete('entries/:id')
  @HttpCode(204)
  removeEntry(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.memory.removeEntry(u.sub, id);
  }

  /** Clears the question history (saved searches stay). */
  @Delete('history')
  clear(@CurrentUser() u: AuthUser) {
    return this.memory.clearHistory(u.sub);
  }
}

@Module({
  imports: [AiCoreModule, OffersModule, BenefitsModule, LoyaltyCoreModule],
  controllers: [SearchController],
  providers: [SearchService, SearchAskService, SearchMemoryService],
  exports: [SearchService, SearchAskService, SearchMemoryService],
})
export class SearchModule {}
