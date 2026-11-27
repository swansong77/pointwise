import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../common/decorators';
import { BoardService } from './board.service';
import { HouseholdChiefService } from './household-chief.service';
import { LifeBody, LifeEventsService } from './life-events.service';
import { RoadmapService } from './roadmap.service';
import { ChiefService } from './chief.service';

/** Chief of Staff: one prioritized, explainable view of everything that needs attention. Read-only. */
@ApiTags('chief-of-staff')
@ApiBearerAuth()
@Controller('chief')
export class ChiefController {
  constructor(
    private readonly chief: ChiefService,
    private readonly board: BoardService,
    private readonly household: HouseholdChiefService,
    private readonly roadmap: RoadmapService,
    private readonly life: LifeEventsService,
  ) {}

  /** the greeting, the numbers, the top ten, the Action Center counts and value recovery */
  @Get('overview') overview(@CurrentUser() u: AuthUser) {
    return this.chief.overview(u.sub);
  }
  /** the Action Center in full: today, this week, this month, this quarter, the annual review */
  @Get('actions') async actions(@CurrentUser() u: AuthUser) {
    const { items } = await this.chief.items(u.sub, new Date());
    return this.chief.actionCenter(items);
  }
  @Get('recovery') recovery(@CurrentUser() u: AuthUser) {
    return this.chief.recovery(u.sub);
  }
  /** today's executive briefing, built now (the scheduled one is stored with the other briefings) */
  @Get('briefing') async briefing(@CurrentUser() u: AuthUser) {
    const r = await this.chief.dailyBriefing(u.sub, new Date());
    return r.brief;
  }

  /** values, five scores with reasons, top risks and opportunities, and the annual outlook */
  @Get('command-center') commandCenter(@CurrentUser() u: AuthUser) {
    return this.chief.commandCenter(u.sub);
  }
  /** every card: keep, retention call, product change, downgrade, replace or cancel, with the reason in dollars */
  @Get('fee-review') feeReview(@CurrentUser() u: AuthUser) {
    return this.board.feeReview(u.sub);
  }
  @Get('board') boards(@CurrentUser() u: AuthUser) {
    return this.board.list(u.sub);
  }
  /** write this month's board report now (or a fresh one); it is not sent as a notification */
  @Post('board') makeBoard(@CurrentUser() u: AuthUser, @Query('fresh') fresh?: string) {
    return this.board.generate(u.sub, new Date(), { force: fresh === 'true' });
  }
  @Get('board/:id') getBoard(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.board.get(u.sub, id);
  }

  /** 5/24 per member, the best next card, who should apply, business and elevated offers, and when to wait */
  @Get('governance') governance(@CurrentUser() u: AuthUser) {
    return this.board.governance(u.sub);
  }
  /** the next 90 days (days=90) or the year ahead (days=365) */
  @Get('roadmap') async roadmapFor(@CurrentUser() u: AuthUser, @Query('days') days?: string) {
    return this.roadmap.build(u.sub, days === '365' ? 365 : 90);
  }
  /** what each member should do, authorized-user ideas and the best household card per category */
  @Get('household') householdChief(@CurrentUser() u: AuthUser) {
    return this.household.overview(u.sub);
  }

  // life events
  @Get('life-events') lifeEvents(@CurrentUser() u: AuthUser, @Query('all') all?: string) {
    return this.life.list(u.sub, { all: all === 'true' });
  }
  @Post('life-events') createLife(@CurrentUser() u: AuthUser, @Body() dto: LifeBody) {
    return this.life.create(u.sub, dto);
  }
  @Patch('life-events/:id') updateLife(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: Partial<LifeBody>) {
    return this.life.update(u.sub, id, dto);
  }
  @Delete('life-events/:id') @HttpCode(204) removeLife(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.life.remove(u.sub, id);
  }
  /** work out what your cards, credits, certificates and points can do for this event (read-only) */
  @Post('life-events/:id/estimate') estimateLife(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.life.estimate(u.sub, id);
  }
}
