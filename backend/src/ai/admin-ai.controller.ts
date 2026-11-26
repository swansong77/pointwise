import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AiProviderKind, AiStatus, McpAuthType } from '@prisma/client';
import { encryptSecret } from '../common/crypto';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { RolesGuard } from '../common/guards';
import { PrismaService } from '../common/prisma.service';
import { McpClientService, validateMcpUrl } from './mcp-client';
import { isUsable } from './providers';
import { modelInclude, ModelRouter, ModelRow } from './router';
import { ToolRegistry } from './tools';

// ───────── DTOs ─────────

export class ProviderDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(60) name: string;
  @ApiProperty({ enum: AiProviderKind }) @IsEnum(AiProviderKind) kind: AiProviderKind;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true }) baseUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) apiVersion?: string | null;
  @ApiPropertyOptional({ description: 'Environment variable holding the key, e.g. OPENAI_API_KEY' }) @IsOptional() @Matches(/^[A-Z][A-Z0-9_]{1,63}$/) apiKeyEnv?: string | null;
  @ApiPropertyOptional({ enum: AiStatus }) @IsOptional() @IsEnum(AiStatus) status?: AiStatus;
}
export class UpdateProviderDto extends PartialType(ProviderDto) {}

export class ProviderKeyDto {
  @ApiProperty({ description: 'Write-only; stored encrypted' }) @IsString() @MinLength(8) @MaxLength(400) apiKey: string;
}

const CAPS = ['tools', 'vision', 'thinking', 'effort', 'fallbacks', 'streaming', 'caching'] as const;

export class ModelDto {
  @ApiProperty() @IsString() providerId: string;
  @ApiProperty({ example: 'claude-opus-5-5' }) @IsString() @MinLength(1) @MaxLength(120) modelId: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) displayName: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) contextWindow?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) maxOutputTokens?: number | null;
  @ApiPropertyOptional({ description: 'USD per 1M input tokens' }) @IsOptional() @IsNumber() @Min(0) @Max(10_000) inputPrice?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(10_000) outputPrice?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(10_000) cacheReadPrice?: number | null;
  @ApiPropertyOptional({ enum: CAPS, isArray: true }) @IsOptional() @IsArray() @IsIn(CAPS as unknown as string[], { each: true }) capabilities?: string[];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) rateLimitRpm?: number | null;
  @ApiPropertyOptional({ enum: AiStatus }) @IsOptional() @IsEnum(AiStatus) status?: AiStatus;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
}
export class UpdateModelDto extends PartialType(ModelDto) {}

export class AgentUpdateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(10) @MaxLength(4000) systemPrompt?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) tools?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) mcpToolIds?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) modelChain?: string[];
  @ApiPropertyOptional({ enum: ['low', 'medium', 'high'] }) @IsOptional() @IsIn(['low', 'medium', 'high']) effort?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(12) maxSteps?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(256) @Max(64_000) maxTokens?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
}

export class McpServerDto {
  @ApiProperty() @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/) name: string;
  @ApiProperty() @IsString() @MaxLength(500) url: string;
  @ApiPropertyOptional({ enum: McpAuthType }) @IsOptional() @IsEnum(McpAuthType) authType?: McpAuthType;
  @ApiPropertyOptional({ description: 'Write-only bearer token' }) @IsOptional() @IsString() @MaxLength(2000) authSecret?: string;
  @ApiPropertyOptional({ enum: AiStatus }) @IsOptional() @IsEnum(AiStatus) status?: AiStatus;
}
export class UpdateMcpServerDto extends PartialType(McpServerDto) {}

export class McpToolDto {
  @ApiPropertyOptional({ description: 'Approve the current description/schema' }) @IsOptional() @IsBoolean() approve?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() readOnly?: boolean;
}

export class UsageQuery {
  @ApiPropertyOptional({ default: 30 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(366) days = 30;
}

// ───────── service ─────────

@Injectable()
export class AiAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly router: ModelRouter,
    private readonly registry: ToolRegistry,
    private readonly mcp: McpClientService,
  ) {}

  private audit(actorId: string, action: string, entity: string, entityId: string, diff?: unknown) {
    // never log secrets
    const clean = diff && typeof diff === 'object' ? Object.fromEntries(Object.entries(diff as object).filter(([k]) => !/key|secret/i.test(k))) : diff;
    return this.prisma.auditLog.create({ data: { actorId, action, entity, entityId, diff: (clean ?? undefined) as object | undefined } });
  }

  async providers() {
    const rows = await this.prisma.aiProvider.findMany({ include: { _count: { select: { models: true } } }, orderBy: { name: 'asc' } });
    return rows.map(({ apiKeyEnc, ...p }) => ({ ...p, hasStoredKey: !!apiKeyEnc, usable: isUsable({ ...p, apiKeyEnc }) }));
  }

  async createProvider(actor: string, dto: ProviderDto) {
    const p = await this.prisma.aiProvider.create({ data: { ...dto, status: dto.status ?? 'DISABLED' } });
    await this.audit(actor, 'create', 'AiProvider', p.id, dto);
    return { ...p, apiKeyEnc: undefined, hasStoredKey: false };
  }

  async updateProvider(actor: string, id: string, dto: UpdateProviderDto) {
    await this.exists('aiProvider', id);
    const p = await this.prisma.aiProvider.update({ where: { id }, data: dto });
    await this.audit(actor, 'update', 'AiProvider', id, dto);
    return { ...p, apiKeyEnc: undefined, hasStoredKey: !!p.apiKeyEnc };
  }

  async setKey(actor: string, id: string, apiKey: string | null) {
    await this.exists('aiProvider', id);
    await this.prisma.aiProvider.update({ where: { id }, data: { apiKeyEnc: apiKey ? encryptSecret(apiKey) : null } });
    await this.audit(actor, apiKey ? 'set-key' : 'clear-key', 'AiProvider', id);
  }

  async deleteProvider(actor: string, id: string) {
    await this.exists('aiProvider', id);
    await this.prisma.aiProvider.delete({ where: { id } });
    await this.audit(actor, 'delete', 'AiProvider', id);
  }

  /** Sends a one-line prompt through the provider (costs a few tokens). */
  async testModel(actor: string, id: string) {
    const m = (await this.prisma.aiModel.findUnique({ where: { id }, include: modelInclude })) as unknown as ModelRow | null;
    if (!m) throw new NotFoundException('Model not found');
    if (!isUsable(m.provider)) throw new BadRequestException('Provider is disabled or has no API key');
    const started = Date.now();
    const r = await this.router.chat([m], { system: 'Reply with the single word: pong', messages: [{ role: 'user', text: 'ping' }], tools: [], maxTokens: 512 }, { userId: actor, agentKey: 'admin-test' });
    return { ok: true, model: m.displayName, reply: r.response.text.slice(0, 200), latencyMs: Date.now() - started, usage: r.response.usage };
  }

  models() {
    return this.prisma.aiModel.findMany({ include: { provider: { select: { id: true, name: true, kind: true, status: true } } }, orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }] });
  }

  async createModel(actor: string, dto: ModelDto) {
    await this.exists('aiProvider', dto.providerId);
    const m = await this.prisma.aiModel.create({ data: { ...dto, capabilities: dto.capabilities ?? [] } });
    await this.audit(actor, 'create', 'AiModel', m.id, dto);
    return m;
  }

  async updateModel(actor: string, id: string, dto: UpdateModelDto) {
    await this.exists('aiModel', id);
    const m = await this.prisma.aiModel.update({ where: { id }, data: dto });
    await this.audit(actor, 'update', 'AiModel', id, dto);
    return m;
  }

  async deleteModel(actor: string, id: string) {
    await this.exists('aiModel', id);
    await this.prisma.aiModel.delete({ where: { id } });
    await this.audit(actor, 'delete', 'AiModel', id);
  }

  agents() {
    return this.prisma.agentProfile.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async updateAgent(actor: string, key: string, dto: AgentUpdateDto) {
    const a = await this.prisma.agentProfile.findUnique({ where: { key } });
    if (!a) throw new NotFoundException('Agent not found');
    if (dto.tools) {
      const unknown = dto.tools.filter((t) => !this.registry.names().includes(t));
      if (unknown.length) throw new BadRequestException(`Unknown tools: ${unknown.join(', ')}`);
    }
    if (dto.modelChain?.length) {
      const n = await this.prisma.aiModel.count({ where: { id: { in: dto.modelChain } } });
      if (n !== new Set(dto.modelChain).size) throw new BadRequestException('Unknown model in modelChain');
    }
    if (dto.mcpToolIds?.length) {
      const tools = await this.prisma.mcpTool.findMany({ where: { id: { in: dto.mcpToolIds } } });
      if (tools.length !== new Set(dto.mcpToolIds).size) throw new BadRequestException('Unknown MCP tool');
      if (tools.some((t) => !t.readOnly)) throw new BadRequestException('Only read-only MCP tools can be attached to agents');
    }
    const updated = await this.prisma.agentProfile.update({ where: { key }, data: dto });
    await this.audit(actor, 'update', 'AgentProfile', a.id, dto);
    return updated;
  }

  tools() {
    return this.registry.tools.map((t) => ({ name: t.name, description: t.description, readOnly: t.readOnly, requiresConfirmation: !!t.requiresConfirmation }));
  }

  async usage(q: UsageQuery) {
    const since = new Date(Date.now() - q.days * 86_400_000);
    const where = { createdAt: { gte: since } };
    const [byModel, byAgent, totals, failures, daily] = await Promise.all([
      this.prisma.aiUsage.groupBy({ by: ['modelId'], where, _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, costMicroUsd: true }, _count: true }),
      this.prisma.aiUsage.groupBy({ by: ['agentKey'], where, _sum: { inputTokens: true, outputTokens: true, costMicroUsd: true }, _count: true }),
      this.prisma.aiUsage.aggregate({ where, _sum: { inputTokens: true, outputTokens: true, costMicroUsd: true }, _count: true, _avg: { latencyMs: true } }),
      this.prisma.aiUsage.count({ where: { ...where, success: false } }),
      this.prisma.$queryRaw<Array<{ day: Date; tokens: bigint; cost: bigint | null; requests: bigint }>>`
        SELECT date_trunc('day', "createdAt") AS day, SUM("inputTokens" + "outputTokens")::bigint AS tokens,
               SUM("costMicroUsd")::bigint AS cost, COUNT(*)::bigint AS requests
        FROM "AiUsage" WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
    ]);
    const models = await this.prisma.aiModel.findMany({ select: { id: true, displayName: true } });
    const name = (id: string | null) => models.find((m) => m.id === id)?.displayName ?? '(deleted model)';
    const usd = (micro: number | bigint | null | undefined) => Number(micro ?? 0) / 1_000_000;
    return {
      days: q.days,
      totals: {
        requests: totals._count,
        failures,
        inputTokens: totals._sum.inputTokens ?? 0,
        outputTokens: totals._sum.outputTokens ?? 0,
        costUsd: usd(totals._sum.costMicroUsd),
        avgLatencyMs: Math.round(totals._avg.latencyMs ?? 0),
      },
      byModel: byModel.map((r) => ({ model: name(r.modelId), requests: r._count, inputTokens: r._sum.inputTokens ?? 0, outputTokens: r._sum.outputTokens ?? 0, cacheReadTokens: r._sum.cacheReadTokens ?? 0, costUsd: usd(r._sum.costMicroUsd) })),
      byAgent: byAgent.map((r) => ({ agent: r.agentKey, requests: r._count, tokens: (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0), costUsd: usd(r._sum.costMicroUsd) })),
      daily: daily.map((d) => ({ day: d.day.toISOString().slice(0, 10), tokens: Number(d.tokens), costUsd: usd(d.cost), requests: Number(d.requests) })),
    };
  }

  // MCP registry
  async mcpServers() {
    const rows = await this.prisma.mcpServer.findMany({ include: { tools: { orderBy: { name: 'asc' } } }, orderBy: { name: 'asc' } });
    return rows.map(({ authSecretEnc, ...s }) => ({
      ...s,
      hasSecret: !!authSecretEnc,
      tools: s.tools.map((t) => ({ ...t, approved: t.approvedHash === t.descriptionHash, changedSinceApproval: !!t.approvedHash && t.approvedHash !== t.descriptionHash })),
    }));
  }

  async createMcpServer(actor: string, dto: McpServerDto) {
    validateMcpUrl(dto.url);
    const s = await this.prisma.mcpServer.create({
      data: { name: dto.name, url: dto.url, authType: dto.authType ?? 'NONE', authSecretEnc: dto.authSecret ? encryptSecret(dto.authSecret) : null, status: dto.status ?? 'DISABLED' },
    });
    await this.audit(actor, 'create', 'McpServer', s.id, { ...dto, authSecret: undefined });
    return { ...s, authSecretEnc: undefined, hasSecret: !!dto.authSecret };
  }

  async updateMcpServer(actor: string, id: string, dto: UpdateMcpServerDto) {
    await this.exists('mcpServer', id);
    if (dto.url) validateMcpUrl(dto.url);
    const { authSecret, ...rest } = dto;
    const s = await this.prisma.mcpServer.update({ where: { id }, data: { ...rest, ...(authSecret !== undefined && { authSecretEnc: authSecret ? encryptSecret(authSecret) : null }) } });
    await this.audit(actor, 'update', 'McpServer', id, rest);
    return { ...s, authSecretEnc: undefined };
  }

  async deleteMcpServer(actor: string, id: string) {
    await this.exists('mcpServer', id);
    await this.prisma.mcpServer.delete({ where: { id } });
    await this.audit(actor, 'delete', 'McpServer', id);
  }

  checkMcpServer(id: string) {
    return this.mcp.refresh(id);
  }

  async updateMcpTool(actor: string, id: string, dto: McpToolDto) {
    const t = await this.prisma.mcpTool.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Tool not found');
    const updated = await this.prisma.mcpTool.update({
      where: { id },
      data: { enabled: dto.enabled, readOnly: dto.readOnly, ...(dto.approve !== undefined && { approvedHash: dto.approve ? t.descriptionHash : null }) },
    });
    await this.audit(actor, 'update', 'McpTool', id, dto);
    return updated;
  }

  private async exists(model: 'aiProvider' | 'aiModel' | 'mcpServer', id: string) {
    const found = await (this.prisma[model] as unknown as { findUnique: (a: object) => Promise<unknown> }).findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Not found');
  }
}

// ───────── controller ─────────

@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@UseGuards(RolesGuard)
@Controller('admin')
export class AiAdminController {
  constructor(private readonly svc: AiAdminService) {}

  @Get('ai/providers') providers() {
    return this.svc.providers();
  }
  @Post('ai/providers') createProvider(@CurrentUser() u: AuthUser, @Body() dto: ProviderDto) {
    return this.svc.createProvider(u.sub, dto);
  }
  @Patch('ai/providers/:id') updateProvider(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProviderDto) {
    return this.svc.updateProvider(u.sub, id, dto);
  }
  @Put('ai/providers/:id/key') @HttpCode(204) setKey(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProviderKeyDto) {
    return this.svc.setKey(u.sub, id, dto.apiKey);
  }
  @Delete('ai/providers/:id/key') @HttpCode(204) clearKey(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.setKey(u.sub, id, null);
  }
  @Delete('ai/providers/:id') @HttpCode(204) deleteProvider(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteProvider(u.sub, id);
  }

  @Get('ai/models') models() {
    return this.svc.models();
  }
  @Post('ai/models') createModel(@CurrentUser() u: AuthUser, @Body() dto: ModelDto) {
    return this.svc.createModel(u.sub, dto);
  }
  @Patch('ai/models/:id') updateModel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateModelDto) {
    return this.svc.updateModel(u.sub, id, dto);
  }
  @Delete('ai/models/:id') @HttpCode(204) deleteModel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteModel(u.sub, id);
  }
  @Post('ai/models/:id/test') @HttpCode(200) testModel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.testModel(u.sub, id);
  }

  @Get('ai/agents') agents() {
    return this.svc.agents();
  }
  @Patch('ai/agents/:key') updateAgent(@CurrentUser() u: AuthUser, @Param('key') key: string, @Body() dto: AgentUpdateDto) {
    return this.svc.updateAgent(u.sub, key, dto);
  }
  @Get('ai/tools') tools() {
    return this.svc.tools();
  }
  @Get('ai/usage') usage(@Query() q: UsageQuery) {
    return this.svc.usage(q);
  }

  @Get('mcp/servers') mcpServers() {
    return this.svc.mcpServers();
  }
  @Post('mcp/servers') createMcp(@CurrentUser() u: AuthUser, @Body() dto: McpServerDto) {
    return this.svc.createMcpServer(u.sub, dto);
  }
  @Patch('mcp/servers/:id') updateMcp(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMcpServerDto) {
    return this.svc.updateMcpServer(u.sub, id, dto);
  }
  @Delete('mcp/servers/:id') @HttpCode(204) deleteMcp(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteMcpServer(u.sub, id);
  }
  @Post('mcp/servers/:id/check') @HttpCode(200) checkMcp(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.checkMcpServer(id);
  }
  @Patch('mcp/tools/:id') updateMcpTool(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: McpToolDto) {
    return this.svc.updateMcpTool(u.sub, id, dto);
  }
}
