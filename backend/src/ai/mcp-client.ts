import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHash } from 'crypto';
import { decryptSecret } from '../common/crypto';
import { PrismaService } from '../common/prisma.service';
import { JsonSchemaObject } from './types';

/**
 * Admin-only MCP client. Remote servers are reached over Streamable HTTP only (no stdio processes
 * on the API host). A tool can be used by agents only when an admin enabled it AND approved the
 * exact description/schema (hash) — a changed tool definition must be re-approved.
 */

const BLOCKED_HOSTS = [/^169\.254\./, /^metadata\.google\.internal$/i, /^0\.0\.0\.0$/, /^\[?fd00:ec2::254\]?$/i];

export function allowedHosts(env = process.env): string[] {
  return (env.MCP_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** HTTPS required unless the host is explicitly allow-listed (e.g. an internal docker service). */
export function validateMcpUrl(raw: string, env = process.env): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BadRequestException('MCP server URL is not a valid URL');
  }
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTS.some((re) => re.test(host))) throw new BadRequestException('This host is not allowed');
  const listed = allowedHosts(env);
  if (listed.length && !listed.includes(host)) throw new BadRequestException(`Host ${host} is not in MCP_ALLOWED_HOSTS`);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && listed.includes(host))) {
    throw new BadRequestException('MCP servers must use https (or an allow-listed internal host)');
  }
  if (u.username || u.password) throw new BadRequestException('Put credentials in the auth secret, not the URL');
  return u;
}

export function toolHash(t: { name: string; description?: string; inputSchema?: unknown }): string {
  return createHash('sha256')
    .update(JSON.stringify([t.name, t.description ?? '', t.inputSchema ?? {}]))
    .digest('hex');
}

/** LLM-facing tool name for an external MCP tool: mcp_<server>_<tool>, [A-Za-z0-9_-], ≤ 64 chars. */
export function mcpToolName(server: string, tool: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '_');
  return `mcp_${clean(server)}_${clean(tool)}`.slice(0, 64);
}

export interface McpServerRow {
  id: string;
  name: string;
  url: string;
  authType: 'NONE' | 'BEARER';
  authSecretEnc: string | null;
}

export type ClientFactory = () => Pick<Client, 'connect' | 'listTools' | 'callTool' | 'close' | 'getServerVersion'>;

@Injectable()
export class McpClientService {
  private readonly logger = new Logger(McpClientService.name);
  clientFactory: ClientFactory = () => new Client({ name: 'pointwise', version: '0.1.0' });

  constructor(private readonly prisma: PrismaService) {}

  private async open(s: McpServerRow) {
    const url = validateMcpUrl(s.url);
    const headers: Record<string, string> = {};
    if (s.authType === 'BEARER' && s.authSecretEnc) headers.Authorization = `Bearer ${decryptSecret(s.authSecretEnc)}`;
    const client = this.clientFactory();
    const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers, redirect: 'error' } });
    await Promise.race([client.connect(transport), new Promise((_, rej) => setTimeout(() => rej(new Error('connect timeout')), 10_000))]);
    return client;
  }

  /** Connect, list tools, store them (new tools disabled; changed tools lose approval), update health. */
  async refresh(serverId: string) {
    const s = await this.prisma.mcpServer.findUniqueOrThrow({ where: { id: serverId } });
    let client: Awaited<ReturnType<McpClientService['open']>> | null = null;
    try {
      client = await this.open(s);
      const { tools } = await client.listTools();
      const version = client.getServerVersion();
      for (const t of tools.slice(0, 200)) {
        const hash = toolHash(t);
        await this.prisma.mcpTool.upsert({
          where: { serverId_name: { serverId, name: t.name } },
          update: { description: (t.description ?? '').slice(0, 4000), inputSchema: (t.inputSchema ?? {}) as object, descriptionHash: hash },
          create: { serverId, name: t.name, description: (t.description ?? '').slice(0, 4000), inputSchema: (t.inputSchema ?? {}) as object, descriptionHash: hash },
        });
      }
      await this.prisma.mcpTool.deleteMany({ where: { serverId, name: { notIn: tools.map((t) => t.name) } } });
      await this.prisma.mcpServer.update({
        where: { id: serverId },
        data: { health: 'UP', lastCheckedAt: new Date(), lastError: null, version: version ? `${version.name} ${version.version}` : null },
      });
      return { health: 'UP' as const, tools: tools.length };
    } catch (e) {
      const msg = (e as Error).message.slice(0, 500);
      await this.prisma.mcpServer.update({ where: { id: serverId }, data: { health: 'DOWN', lastCheckedAt: new Date(), lastError: msg } });
      return { health: 'DOWN' as const, error: msg };
    } finally {
      await client?.close().catch(() => undefined);
    }
  }

  async refreshAll(): Promise<number> {
    const servers = await this.prisma.mcpServer.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    for (const s of servers) await this.refresh(s.id);
    return servers.length;
  }

  /** Tools an agent may use: enabled, approved hash == current hash, server active and up. */
  async usableTools(toolIds: string[]) {
    if (!toolIds.length) return [];
    const rows = await this.prisma.mcpTool.findMany({ where: { id: { in: toolIds }, enabled: true, server: { status: 'ACTIVE' } }, include: { server: true } });
    return rows
      .filter((t) => t.approvedHash === t.descriptionHash)
      .map((t) => ({
        id: t.id,
        llmName: mcpToolName(t.server.name, t.name),
        name: t.name,
        description: `[External tool from MCP server "${t.server.name}"] ${t.description}`.slice(0, 1024),
        inputSchema: normaliseSchema(t.inputSchema),
        server: t.server,
        readOnly: t.readOnly,
      }));
  }

  async call(server: McpServerRow, tool: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const client = await this.open(server);
    try {
      const res = await client.callTool({ name: tool, arguments: args });
      const content = (res.content as Array<{ type: string; text?: string }> | undefined) ?? [];
      const text = content.map((c) => (c.type === 'text' ? c.text : `[${c.type} content omitted]`)).join('\n');
      return { text: text.slice(0, 20_000), isError: !!res.isError };
    } finally {
      await client.close().catch(() => undefined);
    }
  }
}

export function normaliseSchema(s: unknown): JsonSchemaObject {
  const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
  return {
    type: 'object',
    properties: (o.properties && typeof o.properties === 'object' ? o.properties : {}) as Record<string, unknown>,
    ...(Array.isArray(o.required) && { required: o.required as string[] }),
  };
}
