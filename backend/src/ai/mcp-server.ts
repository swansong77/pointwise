import { All, Controller, HttpException, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators';
import { TokensService } from './ai.controller';
import { ToolRegistry } from './tools';

/**
 * PointWise as an MCP server for users' own AI clients (Claude, ChatGPT, …). By policy, AI providers
 * never receive user card data, so only the public card-catalog tools are exposed.
 * Streamable HTTP, stateless (a fresh server per request), authenticated with a personal access
 * token (`Authorization: Bearer pw_pat_…`, scope mcp:read). Only read-only tools are exposed and
 * every call is scoped to the token's user.
 */
export function buildMcpServer(registry: ToolRegistry, userId: string): Server {
  const server = new Server({ name: 'pointwise', version: '0.1.0' }, { capabilities: { tools: {} } });
  // No AI provider may receive user card data: an MCP client is an AI provider, so only public catalog tools are exposed.
  const tools = registry.tools.filter((t) => t.readOnly && t.dataClass === 'PUBLIC');
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: true } })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = tools.find((t) => t.name === req.params.name);
    if (!tool) return { content: [{ type: 'text' as const, text: `Unknown tool ${req.params.name}` }], isError: true };
    try {
      const out = await tool.handler({ userId }, (req.params.arguments ?? {}) as Record<string, unknown>);
      return { content: [{ type: 'text' as const, text: `${out.summary}\n\n${JSON.stringify(out.data)}` }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: e instanceof HttpException ? e.message : 'Tool failed' }], isError: true };
    }
  });
  return server;
}

@ApiExcludeController()
@Public()
@Controller('mcp')
export class McpServerController {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly tokens: TokensService,
  ) {}

  @All()
  async handle(@Req() req: Request, @Res() res: Response) {
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
    const userId = await this.tokens.verify(token);
    if (!userId) {
      res.status(401).setHeader('WWW-Authenticate', 'Bearer realm="pointwise-mcp"').json({ error: 'A valid PointWise personal access token is required' });
      return;
    }
    const server = buildMcpServer(this.registry, userId);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
}
