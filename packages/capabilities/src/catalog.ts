import { z } from 'zod';
import type { Capability, Risk } from '../../protocol/src/index.js';
const s = z.string().min(1).max(8192),
  text = z.string().max(1048576),
  n = z.number().int().nonnegative();
export const catalog: Capability[] = [];
function add(name: string, risk: Risk, description: string, shape: z.ZodRawShape = {}) {
  catalog.push({ name, risk, description, schema: z.object(shape).strict() });
}
for (const op of ['list', 'stat', 'read', 'search'])
  add(`filesystem.${op}`, 'READ', `${op} files inside configured roots`, {
    path: s,
    ...(op === 'read' ? { encoding: z.enum(['utf8', 'base64']).default('utf8') } : {}),
    ...(op === 'search' ? { pattern: s, limit: n.max(1000).default(100) } : {}),
  });
for (const op of ['write', 'append'])
  add(`filesystem.${op}`, 'WRITE', `${op} bounded text or binary content`, {
    path: s,
    content: text,
    encoding: z.enum(['utf8', 'base64']).default('utf8'),
  });
for (const op of ['copy', 'move'])
  add(
    `filesystem.${op}`,
    op === 'move' ? 'SENSITIVE' : 'WRITE',
    `${op} file without overwriting destination`,
    { source: s, destination: s },
  );
add('filesystem.mkdir', 'WRITE', 'Create directories', { path: s });
add('filesystem.delete', 'SENSITIVE', 'Delete a file or directory', {
  path: s,
  recursive: z.boolean().default(false),
});
for (const name of ['shell.execute', 'powershell.execute'])
  add(
    name,
    'EXECUTE',
    'Execute a command under the normal user account; unrestricted OS access after approval',
    {
      command: text,
      cwd: s,
      timeoutMs: n.min(100).max(300000).optional(),
      env: z.record(z.string()).default({}),
    },
  );
for (const op of ['info', 'cwd', 'environment']) add(`system.${op}`, 'READ', `Read system ${op}`);
add('process.list', 'READ', 'List running process identifiers and names');
add('process.start', 'EXECUTE', 'Start an executable with arguments', {
  executable: s,
  args: z.array(s).max(100).default([]),
  cwd: s,
});
add('process.kill', 'SENSITIVE', 'Terminate a process', { pid: n.positive() });
add('app.list', 'READ', 'List launchable Start menu applications');
add('app.launch', 'EXECUTE', 'Launch an installed application', { appId: s });
add('clipboard.read', 'SENSITIVE', 'Read text from the user clipboard');
add('clipboard.write', 'WRITE', 'Replace user clipboard text', { text });
for (const op of ['status', 'diff', 'log', 'add', 'commit', 'branch', 'checkout', 'pull', 'push'])
  add(
    `git.${op}`,
    op === 'push' || op === 'checkout' || op === 'pull'
      ? 'SENSITIVE'
      : ['add', 'commit', 'branch'].includes(op)
        ? 'EXECUTE'
        : 'READ',
    `Run git ${op} in an allowed repository`,
    {
      cwd: s,
      ...(op === 'add' ? { paths: z.array(s).min(1).max(100) } : {}),
      ...(op === 'commit' ? { message: s } : {}),
      ...(op === 'branch' || op === 'checkout' ? { name: s } : {}),
      ...(op === 'log' ? { limit: n.min(1).max(100).default(20) } : {}),
    },
  );
for (const op of [
  'launch',
  'close',
  'status',
  'back',
  'forward',
  'reload',
  'tabs',
  'new_tab',
  'snapshot',
  'get_text',
  'get_links',
])
  add(
    `browser.${op}`,
    ['status', 'tabs', 'snapshot', 'get_text', 'get_links'].includes(op) ? 'READ' : 'EXECUTE',
    `Browser ${op.replaceAll('_', ' ')}`,
  );
add('browser.navigate', 'EXECUTE', 'Navigate the current tab to an HTTP(S) URL', { url: s });
for (const op of ['close_tab', 'switch_tab'])
  add(`browser.${op}`, 'EXECUTE', `${op.replace('_', ' ')} by tab ID`, { tabId: s });
for (const op of [
  'click',
  'type',
  'clear',
  'select',
  'press',
  'hover',
  'upload',
  'download',
  'wait',
  'submit',
])
  add(
    `browser.${op}`,
    ['click', 'press', 'submit', 'download'].includes(op)
      ? 'SENSITIVE'
      : op === 'wait'
        ? 'READ'
        : 'EXECUTE',
    `${op} an element from the latest semantic snapshot`,
    {
      ref: s,
      ...(['type', 'select', 'press'].includes(op) ? { text } : {}),
      ...(op === 'upload' ? { path: s } : {}),
      ...(op === 'download' ? { destination: s.optional() } : {}),
    },
  );
add(
  'browser.screenshot',
  'SENSITIVE',
  'Save a screenshot to an allowed path; pixels may contain private information',
  { path: s },
);
add(
  'browser.evaluate',
  'SENSITIVE',
  'Evaluate JavaScript in page context; arbitrary scripts can access authenticated data',
  { expression: text },
);
for (const op of ['get', 'post', 'put', 'patch', 'delete'])
  add(
    `http.${op}`,
    op === 'get' ? 'READ' : 'SENSITIVE',
    `Send HTTP ${op.toUpperCase()} without redirects or ambient credentials`,
    {
      url: s,
      headers: z.record(z.string()).default({}),
      query: z.record(z.string()).default({}),
      body: text.optional(),
    },
  );
export const androidCatalog: Capability[] = [];
for (const [name, risk, shape] of [
  ['device.info', 'READ', {}],
  ['device.battery', 'READ', {}],
  ['device.network', 'READ', {}],
  ['apps.list', 'READ', {}],
  ['apps.launch', 'EXECUTE', { packageName: s }],
  ['intent.open', 'EXECUTE', { url: s }],
  ['intent.share', 'SENSITIVE', { text }],
  ['files.list', 'READ', { path: z.string().default('') }],
  ['files.read', 'SENSITIVE', { path: s }],
  ['files.write', 'WRITE', { path: s, content: text }],
  ['files.copy', 'WRITE', { source: s, destination: s }],
  ['files.move', 'SENSITIVE', { source: s, destination: s }],
  ['files.share', 'SENSITIVE', { path: s }],
  ['notifications.list', 'SENSITIVE', {}],
  ['browser.open', 'EXECUTE', { url: s }],
  ['media.list', 'READ', {}],
] as [string, Risk, z.ZodRawShape][])
  androidCatalog.push({
    name,
    risk,
    description: `Android ${name}; requires foreground companion and applicable platform permission`,
    schema: z.object(shape).strict(),
  });
export const allCapabilities = [...catalog, ...androidCatalog];
