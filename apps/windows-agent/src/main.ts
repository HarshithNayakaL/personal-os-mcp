import WebSocket from 'ws';
import { z } from 'zod';
import { loadConfig } from '../../../packages/shared/src/config.js';
import { vault } from '../../../packages/security/src/vault.js';
import { redact } from '../../../packages/security/src/index.js';
import { catalog } from '../../../packages/capabilities/src/catalog.js';
import { failure } from '../../../packages/protocol/src/index.js';
import { Executor } from './executor.js';
const c = loadConfig();
const secrets = JSON.parse(vault('.local/credentials'));
const executor = new Executor(c);
let stopping = false;
let socket: WebSocket;
let retry: NodeJS.Timeout | undefined;
let heartbeat: NodeJS.Timeout;
let chain = Promise.resolve();
const active = new Map<string, AbortController>();
function connect() {
  socket = new WebSocket(`ws://127.0.0.1:${c.port}/agent`, {
    headers: { Authorization: `Bearer ${secrets.agent}` },
    maxPayload: c.maxBytes + 16384,
  });
  socket.on('open', () => {
    socket.send(
      JSON.stringify({
        type: 'register',
        device: {
          id: c.deviceName,
          type: 'windows',
          capabilities: catalog
            .filter(
              (x) => c.enabledCapabilities.includes('*') || c.enabledCapabilities.includes(x.name),
            )
            .map((x) => x.name),
        },
      }),
    );
    heartbeat = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'heartbeat' }));
    }, 10000);
  });
  socket.on('message', (raw) => {
    let m: any;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (m.type === 'registered') {
      if (c.logging) process.stderr.write(`Windows agent registered as ${c.deviceName}\n`);
      return;
    }
    if (m.type === 'cancel') {
      active.get(m.id)?.abort();
      return;
    }
    if (m.type !== 'execute') return;
    const parsed = z
      .object({
        type: z.literal('execute'),
        id: z.string().uuid(),
        session: z.string(),
        capability: z.string(),
        args: z.record(z.any()),
        timeoutMs: z.number().int().min(100).max(300000),
      })
      .safeParse(m);
    if (!parsed.success) {
      socket.close(1008, 'Invalid execution request');
      return;
    }
    if (active.size >= 128) {
      socket.send(
        JSON.stringify({
          type: 'result',
          id: m.id,
          result: { ok: false, error: { code: 'BUSY', message: 'Agent queue is full' } },
        }),
      );
      return;
    }
    const controller = new AbortController();
    active.set(m.id, controller);
    const timer = setTimeout(() => controller.abort(), m.timeoutMs);
    const connection = socket;
    chain = chain.then(async () => {
      try {
        if (controller.signal.aborted) throw new Error('Request expired in queue');
        const data = await executor.execute(m.capability, m.args, controller.signal);
        const payload = JSON.stringify({
          type: 'result',
          id: m.id,
          result: { ok: true, data: redact(data) },
        });
        if (Buffer.byteLength(payload) > c.maxBytes)
          throw new Error('OUTPUT_LIMIT: Encoded response exceeds configured maximum');
        if (connection.readyState === WebSocket.OPEN) connection.send(payload);
      } catch (e) {
        if (connection.readyState === WebSocket.OPEN)
          connection.send(JSON.stringify({ type: 'result', id: m.id, result: redact(failure(e)) }));
      } finally {
        clearTimeout(timer);
        active.delete(m.id);
      }
    });
  });
  socket.on('error', (e) => process.stderr.write(`Agent connection: ${redact(e.message)}\n`));
  socket.on('close', () => {
    clearInterval(heartbeat);
    for (const controller of active.values()) controller.abort();
    if (!stopping) retry = setTimeout(connect, 3000);
  });
}
connect();
async function shutdown() {
  stopping = true;
  clearTimeout(retry);
  clearInterval(heartbeat);
  for (const a of active.values()) a.abort();
  socket?.close();
  await executor.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
