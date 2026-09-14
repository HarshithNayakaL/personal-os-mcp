import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { allCapabilities } from '../../../packages/capabilities/src/catalog.js';
import { loadConfig } from '../../../packages/shared/src/config.js';
import { vault } from '../../../packages/security/src/vault.js';
import { failure } from '../../../packages/protocol/src/index.js';
const c = loadConfig();
const secrets = JSON.parse(vault('.local/credentials'));
const session = randomUUID();
const server = new McpServer({ name: 'personal-mcp-os', version: '1.0.0' });
async function rpc(method: string, args: any = {}, deviceId?: string, approvalId?: string) {
  try {
    const res = await fetch(`http://127.0.0.1:${c.port}/rpc`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secrets.client}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session,
        client: server.server.getClientVersion()?.name ?? 'mcp-client',
        method,
        args,
        deviceId,
        approvalId,
      }),
      signal: AbortSignal.timeout(c.timeoutMs + 5000),
    });
    return await res.json();
  } catch (e) {
    return failure(e);
  }
}
const reply = (r: any) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(r) }],
  isError: !r.ok,
});
for (const cap of allCapabilities)
  server.registerTool(
    cap.name,
    {
      description: `${cap.description}. Risk: ${cap.risk}.`,
      inputSchema: cap.schema.extend({
        deviceId: z
          .string()
          .optional()
          .describe('Explicit device, otherwise session preference or unique compatible device'),
        approvalId: z.string().optional().describe('One-use local approval request ID'),
      }).shape,
    },
    async (raw: any) => {
      const { deviceId, approvalId, ...args } = raw;
      return reply(await rpc(cap.name, args, deviceId, approvalId));
    },
  );
for (const name of ['device.list', 'device.current', 'device.capabilities', 'device.status'])
  server.registerTool(
    name,
    {
      description: `Discover ${name.split('.')[1]}; online status does not imply session preference`,
      inputSchema: { deviceId: z.string().optional() },
    },
    async ({ deviceId }) => reply(await rpc(name, {}, deviceId)),
  );
server.registerTool(
  'session.prefer',
  {
    description: 'Set this MCP connection’s preferred device; never silently falls back',
    inputSchema: { deviceId: z.string() },
  },
  async (a) => reply(await rpc('session.prefer', a)),
);
for (const name of ['audit.recent', 'audit.search'])
  server.registerTool(
    name,
    {
      description: 'Read sanitized execution records',
      inputSchema: {
        limit: z.number().int().min(1).max(200).default(50),
        query: z.string().max(100).default(''),
      },
    },
    async (a) => reply(await rpc(name, a)),
  );
for (const [name, method] of [
  ['devices', 'device.list'],
  ['recent', 'audit.recent'],
  ['browser', 'browser.status'],
  ['cwd', 'system.cwd'],
])
  server.registerResource(
    name,
    `personal://${name}`,
    { description: `Current ${name}`, mimeType: 'application/json' },
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await rpc(method)) },
      ],
    }),
  );
await server.connect(new StdioServerTransport());
