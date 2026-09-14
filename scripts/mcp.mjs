import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
await import('../dist/apps/mcp-server/src/main.js');
