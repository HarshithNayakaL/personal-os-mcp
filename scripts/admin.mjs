import { loadConfig } from '../dist/packages/shared/src/config.js';
import { vault } from '../dist/packages/security/src/vault.js';
const c = loadConfig();
const credentials = JSON.parse(vault('.local/credentials'));
const [action, id] = process.argv.slice(2);
if (!['pending', 'approve', 'pair', 'health'].includes(action)) {
  console.error('Usage: node scripts/admin.mjs pending | approve <id> | pair | health');
  process.exit(1);
}
const res = await fetch(
  `http://127.0.0.1:${c.port}/${action === 'health' ? 'health' : 'admin/' + action}`,
  {
    method: ['approve', 'pair'].includes(action) ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${action === 'health' ? credentials.client : credentials.admin}`,
      'Content-Type': 'application/json',
    },
    ...(['approve', 'pair'].includes(action) ? { body: JSON.stringify({ id }) } : {}),
  },
);
console.log(JSON.stringify(await res.json(), null, 2));
if (!res.ok) process.exitCode = 1;
