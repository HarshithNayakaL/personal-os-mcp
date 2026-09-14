import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
const schema = z
  .object({
    deviceName: z.string().default('windows-main'),
    host: z.string().default('127.0.0.1'),
    port: z.number().int().min(1024).max(65535).default(4319),
    roots: z.array(z.string()).min(1),
    timeoutMs: z.number().int().min(100).max(300000).default(30000),
    maxBytes: z.number().int().min(1024).max(16777216).default(1048576),
    browserProfile: z.string(),
    downloadDirectory: z.string(),
    headless: z.boolean().default(false),
    enabledCapabilities: z.array(z.string()).default(['*']),
    allowedEnvironment: z.array(z.string()).default([]),
    allowedLocalHosts: z.array(z.string()).default([]),
    approvals: z.record(z.enum(['allow', 'required', 'deny'])),
    commandDenyPatterns: z.array(z.string()).default([]),
    logging: z.boolean().default(true),
    androidPairing: z.boolean().default(true),
  })
  .strict();
export type Config = z.infer<typeof schema>;
export function loadConfig(
  file = process.env.PERSONAL_MCP_CONFIG || 'config/personal-mcp.yaml',
): Config {
  const c = schema.parse(YAML.parse(fs.readFileSync(file, 'utf8')));
  if (!['127.0.0.1', 'localhost'].includes(c.host))
    throw new Error(
      'V1 must bind to loopback. Pair Android through adb reverse; remote transport requires TLS and is not enabled.',
    );
  for (const pattern of c.commandDenyPatterns) new RegExp(pattern);
  c.roots = c.roots.map((p) => path.resolve(p));
  c.browserProfile = path.resolve(c.browserProfile);
  c.downloadDirectory = path.resolve(c.downloadDirectory);
  return c;
}
