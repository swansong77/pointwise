import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { RolesGuard } from '../common/guards';
import { OrchestratorService } from './orchestrator.service';
import { PromptsService } from './prompts.service';
import { WORKFLOW_KEYS } from './workflows';

export class RunWorkflowDto {
  @ApiPropertyOptional({ description: 'The question being answered (kept in the run log)' }) @IsOptional() @IsString() @MaxLength(500) question?: string;
  @ApiPropertyOptional({ description: 'Let a permitted model rewrite the answer. Your own data is only ever shown to a local model.' }) @IsOptional() @IsBoolean() narrate?: boolean;
}

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class WorkflowsController {
  constructor(private readonly orch: OrchestratorService) {}

  @Get('workflows') list() {
    return this.orch.list();
  }
  @Post('workflows/:key') @HttpCode(200) run(@CurrentUser() u: AuthUser, @Param('key') key: string, @Body() dto: RunWorkflowDto) {
    return this.orch.run(u.sub, key, dto);
  }
  @Get('runs') runs(@CurrentUser() u: AuthUser) {
    return this.orch.runs(u.sub);
  }
  @Get('runs/:id') detail(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orch.runDetail(u.sub, id);
  }
}

export class PublishPromptDto {
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(4000) body: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) note?: string;
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@UseGuards(RolesGuard)
@Controller('admin/ai/prompts')
export class PromptsAdminController {
  constructor(private readonly prompts: PromptsService) {}

  @Get() async keys() {
    const keys = await this.prompts.keys();
    return Promise.all(keys.map(async (k) => ({ key: k, current: await this.prompts.current(k).catch(() => null) })));
  }
  @Get(':key') versions(@Param('key') key: string) {
    return this.prompts.versions(key);
  }
  @Put(':key') publish(@CurrentUser() u: AuthUser, @Param('key') key: string, @Body() dto: PublishPromptDto) {
    return this.prompts.publish(key, dto.body, u.sub, dto.note);
  }
  @Post(':key/rollback/:version') @HttpCode(200) rollback(@CurrentUser() u: AuthUser, @Param('key') key: string, @Param('version', ParseIntPipe) version: number) {
    return this.prompts.rollback(key, version, u.sub);
  }
}

export const WORKFLOW_KEYS_LIST = WORKFLOW_KEYS;
