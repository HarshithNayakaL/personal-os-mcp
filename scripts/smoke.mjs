import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const client = new Client({ name: 'personal-os-smoke', version: '1.0.0' });
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('mcp.mjs', import.meta.url))],
    }),
  );
  const tools = await client.listTools();
  const parse = (r) => JSON.parse(r.content[0].text);
  const devices = parse(await client.callTool({ name: 'device.list', arguments: {} }));
  const info = parse(await client.callTool({ name: 'system.info', arguments: {} }));
  if (!devices.ok || !devices.data.some((d) => d.online) || !info.ok)
    throw new Error('Smoke check failed');
  const audit = parse(await client.callTool({ name: 'audit.recent', arguments: { limit: 5 } }));
  console.log(
    JSON.stringify(
      {
        ok: true,
        toolCount: tools.tools.length,
        devices: devices.data.map((d) => ({
          id: d.id,
          online: d.online,
          capabilities: d.capabilities.length,
        })),
        platform: info.data.platform,
        auditRows: audit.data.length,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
