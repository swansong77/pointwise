import { Body, Controller, Delete, Get, HttpCode, HttpException, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { createHash, randomBytes } from 'crypto';
import { AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { TASK_ENDPOINTS } from './agents';
import { AiService, StreamEvent } from './ai.service';
import type { Response } from 'express';

const AI_RATE = Number(process.env.AI_RATE_LIMIT_PER_MIN ?? 20);

export class ChatDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(4000) message: string;
  @ApiPropertyOptional({ example: 'assistant' }) @IsOptional() @Matches(/^[a-z0-9-]{2,40}$/) agent?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() conversationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() modelId?: string;
}

export class TaskDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(4000) message?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() modelId?: string;
}

export class AiSettingsDto {
  @ApiPropertyOptional({ description: 'Consent to send your card data to the selected AI provider' }) @IsOptional() @IsBoolean() consent?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsUUID() preferredModelId?: string | null;
  @ApiPropertyOptional({ description: 'Let the selected model classify cleaned merchant names (no amounts, dates, card digits or names) to detect benefit credits' }) @IsOptional() @IsBoolean() classifyMerchants?: boolean;
}

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('models') models() {
    return this.ai.models();
  }
  @Get('agents') agents() {
    return this.ai.agents();
  }
  @Get('settings') settings(@CurrentUser() u: AuthUser) {
    return this.ai.settings(u.sub);
  }
  @Put('settings') update(@CurrentUser() u: AuthUser, @Body() dto: AiSettingsDto) {
    return this.ai.updateSettings(u.sub, dto);
  }
  @Get('usage') usage(@CurrentUser() u: AuthUser) {
    return this.ai.usage(u.sub);
  }

  @Throttle({ default: { ttl: 60_000, limit: AI_RATE } })
  @Post('chat')
  @HttpCode(200)
  chat(@CurrentUser() u: AuthUser, @Body() dto: ChatDto) {
    return this.ai.run(u.sub, { agentKey: dto.agent, message: dto.message, conversationId: dto.conversationId, modelId: dto.modelId });
  }

  /**
   * Same as POST /ai/chat, streamed as server-sent events: start → delta… (reset on failover) →
   * tool running/done → done {result} | error {status, message}.
   */
  @Throttle({ default: { ttl: 60_000, limit: AI_RATE } })
  @Post('chat/stream')
  @HttpCode(200)
  async chatStream(@CurrentUser() u: AuthUser, @Body() dto: ChatDto, @Res() res: Response) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const send = (e: StreamEvent) => {
      if (!res.writableEnded) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    };
    try {
      const result = await this.ai.run(u.sub, { agentKey: dto.agent, message: dto.message, conversationId: dto.conversationId, modelId: dto.modelId }, new Date(), send);
      send({ type: 'done', result });
    } catch (e) {
      const status = e instanceof HttpException ? e.getStatus() : 500;
      const body = e instanceof HttpException ? e.getResponse() : null;
      const message = typeof body === 'object' && body && 'message' in body ? String((body as { message: unknown }).message) : e instanceof HttpException ? e.message : 'Something went wrong';
      send({ type: 'error', status, message });
    }
    res.end();
  }

  /** Spec task endpoints: analyze, recommend, card-comparison, travel-strategy, portfolio-review. */
  @Throttle({ default: { ttl: 60_000, limit: AI_RATE } })
  @Post(':task')
  @HttpCode(200)
  task(@CurrentUser() u: AuthUser, @Param('task') task: string, @Body() dto: TaskDto) {
    const t = TASK_ENDPOINTS[task];
    if (!t) throw new NotFoundException('Unknown AI task');
    return this.ai.run(u.sub, { agentKey: t.agent, message: dto.message ?? t.prompt, modelId: dto.modelId });
  }

  @Get('conversations') conversations(@CurrentUser() u: AuthUser) {
    return this.ai.conversations(u.sub);
  }
  @Get('conversations/:id') conversation(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ai.conversation(u.sub, id);
  }
  @Delete('conversations/:id') @HttpCode(204) remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ai.deleteConversation(u.sub, id);
  }

  @Get('actions') actions(@CurrentUser() u: AuthUser) {
    return this.ai.pendingActions(u.sub);
  }
  @Post('actions/:id/confirm') @HttpCode(200) confirm(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ai.decide(u.sub, id, true);
  }
  @Post('actions/:id/reject') @HttpCode(200) reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ai.decide(u.sub, id, false);
  }
}

// ───────── personal access tokens (Pointwise MCP server) ─────────

export const PAT_PREFIX = 'pw_pat_';
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export class CreateTokenDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) name: string;
  @ApiPropertyOptional({ default: 90 }) @IsOptional() @IsInt() @Min(1) @Max(365) expiresInDays?: number;
}

@Injectable()
export class TokensService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.personalAccessToken.findMany({
      where: { userId, revokedAt: null },
      select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(userId: string, dto: CreateTokenDto) {
    const count = await this.prisma.personalAccessToken.count({ where: { userId, revokedAt: null } });
    if (count >= 10) throw new NotFoundException('Maximum of 10 active tokens');
    const token = PAT_PREFIX + randomBytes(32).toString('base64url');
    const row = await this.prisma.personalAccessToken.create({
      data: {
        userId,
        name: dto.name,
        prefix: token.slice(0, PAT_PREFIX.length + 6),
        tokenHash: hashToken(token),
        scopes: ['mcp:read'],
        expiresAt: new Date(Date.now() + (dto.expiresInDays ?? 90) * 86_400_000),
      },
    });
    // the plain token is shown once and never stored
    return { id: row.id, name: row.name, token, expiresAt: row.expiresAt, scopes: row.scopes };
  }

  async revoke(userId: string, id: string) {
    const r = await this.prisma.personalAccessToken.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (r.count === 0) throw new NotFoundException('Token not found');
  }

  /** Resolves a bearer token to a user id (or null). Updates lastUsedAt at most once a minute. */
  async verify(token: string | undefined, scope = 'mcp:read'): Promise<string | null> {
    if (!token || !token.startsWith(PAT_PREFIX) || token.length > 200) return null;
    const row = await this.prisma.personalAccessToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { select: { deletedAt: true } } } });
    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt < new Date()) || row.user.deletedAt || !row.scopes.includes(scope)) return null;
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
      await this.prisma.personalAccessToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    }
    return row.userId;
  }
}

@ApiTags('ai')
@ApiBearerAuth()
@Controller('me/tokens')
export class TokensController {
  constructor(private readonly tokens: TokensService) {}
  @Get() list(@CurrentUser() u: AuthUser) {
    return this.tokens.list(u.sub);
  }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateTokenDto) {
    return this.tokens.create(u.sub, dto);
  }
  @Delete(':id') @HttpCode(204) revoke(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tokens.revoke(u.sub, id);
  }
}
