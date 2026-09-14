import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../dist/packages/shared/src/config.js';
import { vault } from '../dist/packages/security/src/vault.js';
const c = loadConfig();
for (const p of [...c.roots, c.downloadDirectory, '.local']) fs.mkdirSync(p, { recursive: true });
if (!fs.existsSync('.local/credentials'))
  vault(
    '.local/credentials',
    JSON.stringify({
      client: randomBytes(32).toString('hex'),
      agent: randomBytes(32).toString('hex'),
      admin: randomBytes(32).toString('hex'),
    }),
  );
fs.writeFileSync(
  '.local/mcp-client.json',
  JSON.stringify(
    {
      mcpServers: {
        'personal-os': { command: process.execPath, args: [path.resolve('scripts/mcp.mjs')] },
      },
    },
    null,
    2,
  ),
);
console.log('Configuration validated; workspace and OS-protected local credentials are ready.');
