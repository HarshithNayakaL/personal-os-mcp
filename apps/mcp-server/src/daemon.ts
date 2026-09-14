import http from 'node:http';
import { WebSocketServer } from 'ws';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { z } from 'zod';
import { Core } from './core.js';
import { loadConfig } from '../../../packages/shared/src/config.js';
import { Audit } from '../../../packages/shared/src/audit.js';
import { vault } from '../../../packages/security/src/vault.js';
import { catalog, androidCatalog } from '../../../packages/capabilities/src/catalog.js';
import { failure } from '../../../packages/protocol/src/index.js';
import { redact } from '../../../packages/security/src/index.js';
const c = loadConfig();
const credentials = JSON.parse(vault('.local/credentials'));
const core = new Core(c, await Audit.open('.local/audit.sqlite'));
const paired: Record<string, string> = fs.existsSync('.local/paired')
  ? JSON.parse(vault('.local/paired'))
  : {};
let pairCode: { value: string; expires: number } | undefined;
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const auth = (req: http.IncomingMessage, token: string) =>
  equal(String(req.headers.authorization ?? ''), `Bearer ${token}`);
const send = (res: http.ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};
async function body(req: http.IncomingMessage) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > c.maxBytes + 16384) throw new Error('Request too large');
  }
  return JSON.parse(raw || '{}');
}
const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.origin) {
      send(res, 403, { error: 'Browser origins are not accepted' });
      return;
    }
    if (req.url === '/pair' && req.method === 'POST' && c.androidPairing) {
      const a = z
        .object({ code: z.string(), deviceId: z.string().regex(/^android-[a-zA-Z0-9-]{1,80}$/) })
        .strict()
        .parse(await body(req));
      if (!pairCode || pairCode.expires < Date.now() || !equal(a.code, pairCode.value)) {
        send(res, 403, { error: 'Invalid pairing code' });
        return;
      }
      pairCode = undefined;
      const token = randomBytes(32).toString('hex');
      paired[a.deviceId] = token;
      vault('.local/paired', JSON.stringify(paired));
      send(res, 200, { token, deviceId: a.deviceId });
      return;
    }
    if (req.url?.startsWith('/admin/')) {
      if (!auth(req, credentials.admin)) {
        send(res, 401, { error: 'Unauthorized' });
        return;
      }
      if (req.url === '/admin/pending') {
        send(
          res,
          200,
          [...core.approvals.pending].map(([id, p]) => ({ id, ...p })),
        );
        return;
      }
      if (req.url === '/admin/approve' && req.method === 'POST') {
        core.approvals.approve((await body(req)).id);
        send(res, 200, { approved: true });
        return;
      }
      if (req.url === '/admin/pair' && req.method === 'POST') {
        if (!c.androidPairing) throw new Error('Android pairing disabled');
        pairCode = { value: randomBytes(16).toString('hex'), expires: Date.now() + 300000 };
        send(res, 200, pairCode);
        return;
      }
    }
    if (!auth(req, credentials.client)) {
      send(res, 401, { error: 'Unauthorized' });
      return;
    }
    if (req.url === '/health') {
      send(res, 200, { ok: true, devices: [...core.devices.values()] });
      return;
    }
    if (req.url === '/rpc' && req.method === 'POST') {
      const a = z
        .object({
          session: z.string().uuid(),
          client: z.string().max(100).optional(),
          method: z.string(),
          args: z.record(z.any()).default({}),
          deviceId: z.string().optional(),
          approvalId: z.string().optional(),
        })
        .strict()
        .parse(await body(req));
      const session = core.session(a.session, a.client);
      let data: any;
      if (a.method === 'device.list' || a.method === 'device.status')
        data = [...core.devices.values()];
      else if (a.method === 'device.current') data = core.route(session, undefined, a.deviceId);
      else if (a.method === 'device.capabilities')
        data = core.route(session, undefined, a.deviceId).capabilities;
      else if (a.method === 'session.prefer') {
        if (!core.devices.has(a.args.deviceId)) throw new Error('Unknown device');
        session.preferredDevice = a.args.deviceId;
        data = session;
      } else if (a.method === 'audit.recent' || a.method === 'audit.search')
        data = core.audit.search(a.args.limit, a.args.query);
      else {
        send(res, 200, await core.execute(session, a.method, a.args, a.deviceId, a.approvalId));
        return;
      }
      send(res, 200, { ok: true, data });
      return;
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, 400, redact(failure(e)));
  }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: c.maxBytes + 16384 });
server.on('upgrade', (req, socket, head) => {
  const bearer = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
  const deviceId = equal(bearer, credentials.agent)
    ? c.deviceName
    : Object.keys(paired).find((id) => equal(bearer, paired[id]));
  if (req.url !== '/agent' || !deviceId || req.headers.origin) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    let registered = false;
    let last = Date.now();
    const monitor = setInterval(() => {
      if (Date.now() - last > 45000) ws.terminate();
      else ws.ping();
    }, 15000);
    ws.on('pong', () => {
      last = Date.now();
    });
    ws.on('message', (raw) => {
      try {
        const m = JSON.parse(raw.toString());
        last = Date.now();
        if (!registered) {
          const r = z
            .object({
              type: z.literal('register'),
              device: z.object({
                id: z.string(),
                type: z.enum(['windows', 'android']),
                capabilities: z.array(z.string()).max(150),
              }),
            })
            .strict()
            .parse(m);
          if (
            r.device.id !== deviceId ||
            r.device.type !== (deviceId === c.deviceName ? 'windows' : 'android')
          )
            throw new Error('Identity mismatch');
          const capabilities = r.device.capabilities.filter(
            (name) =>
              (r.device.type === 'windows'
                ? catalog
                : [...androidCatalog, ...catalog.filter((x) => x.name.startsWith('clipboard.'))]
              ).some((x) => x.name === name) &&
              (c.enabledCapabilities.includes('*') || c.enabledCapabilities.includes(name)),
          );
          core.register({ ...r.device, capabilities, online: true, lastSeen: last }, ws);
          registered = true;
          ws.send(JSON.stringify({ type: 'registered', deviceId }));
          return;
        }
        if (m.type === 'result') {
          const r = z
            .object({
              type: z.literal('result'),
              id: z.string().uuid(),
              result: z.object({
                ok: z.boolean(),
                data: z.unknown().optional(),
                error: z.object({ code: z.string(), message: z.string() }).optional(),
                durationMs: z.number().optional(),
              }),
            })
            .parse(m);
          core.result(deviceId, r);
        } else if (m.type !== 'heartbeat') throw new Error('Invalid message');
        const d = core.devices.get(deviceId);
        if (d) d.lastSeen = last;
      } catch {
        ws.close(1008, 'Invalid protocol message');
      }
    });
    ws.on('close', () => {
      clearInterval(monitor);
      core.disconnect(deviceId, ws);
    });
    ws.on('error', () => ws.close());
  });
});
server.listen(c.port, c.host, () => {
  if (c.logging) process.stderr.write(`Personal MCP core listening at ${c.host}:${c.port}\n`);
});
let shutting = false;
function shutdown() {
  if (shutting) return;
  shutting = true;
  core.close();
  wss.close();
  server.close();
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
