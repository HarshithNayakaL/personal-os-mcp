import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { allCapabilities } from '../../../packages/capabilities/src/catalog.js';
import {
  Fault,
  failure,
  type Device,
  type Session,
  type ExecutionResult,
} from '../../../packages/protocol/src/index.js';
import { Approvals, auditArgs, redact } from '../../../packages/security/src/index.js';
import type { Config } from '../../../packages/shared/src/config.js';
import { Audit } from '../../../packages/shared/src/audit.js';
export class Core {
  devices = new Map<string, Device>();
  sessions = new Map<string, Session>();
  connections = new Map<string, WebSocket>();
  approvals: Approvals;
  pending = new Map<
    string,
    { device: string; resolve: (r: ExecutionResult) => void; timer: NodeJS.Timeout }
  >();
  constructor(
    public config: Config,
    public audit: Audit,
  ) {
    this.approvals = new Approvals(config.approvals);
  }
  session(id: string, client = 'mcp-client') {
    let s = this.sessions.get(id);
    if (!s) {
      if (this.sessions.size > 1000) throw new Fault('SESSION_LIMIT', 'Too many sessions');
      s = { id, client };
      this.sessions.set(id, s);
    }
    return s;
  }
  register(device: Device, socket: WebSocket) {
    if (this.connections.has(device.id))
      throw new Fault('DEVICE_BUSY', 'Identity already connected');
    this.devices.set(device.id, device);
    this.connections.set(device.id, socket);
  }
  disconnect(id: string, socket: WebSocket) {
    if (this.connections.get(id) !== socket) return;
    this.connections.delete(id);
    const d = this.devices.get(id);
    if (d) d.online = false;
    for (const [key, p] of this.pending)
      if (p.device === id) {
        clearTimeout(p.timer);
        p.resolve(
          failure(
            new Fault(
              'DEVICE_DISCONNECTED',
              'Device disconnected during execution; side effects may have occurred',
            ),
          ),
        );
        this.pending.delete(key);
      }
  }
  route(session: Session, capability?: string, explicit?: string) {
    const preferred = explicit ?? session.preferredDevice;
    if (preferred) {
      const d = this.devices.get(preferred);
      if (!d?.online) throw new Fault('DEVICE_OFFLINE', 'Selected device is offline');
      if (capability && !d.capabilities.includes(capability))
        throw new Fault(
          'CAPABILITY_UNAVAILABLE',
          'Selected device does not support this capability',
        );
      return d;
    }
    const matches = [...this.devices.values()].filter(
      (d) => d.online && (!capability || d.capabilities.includes(capability)),
    );
    if (matches.length !== 1)
      throw new Fault(
        matches.length ? 'DEVICE_AMBIGUOUS' : 'DEVICE_UNAVAILABLE',
        matches.length
          ? 'Select a preferred device or pass deviceId'
          : 'No compatible device online',
      );
    return matches[0];
  }
  result(device: string, message: any) {
    const p = this.pending.get(message.id);
    if (!p || p.device !== device) return;
    clearTimeout(p.timer);
    this.pending.delete(message.id);
    p.resolve(message.result);
  }
  async execute(
    session: Session,
    name: string,
    input: any,
    deviceId?: string,
    approvalId?: string,
  ): Promise<ExecutionResult> {
    const start = Date.now();
    let device = 'unresolved',
      approval = 'none',
      args: any = {};
    let result: ExecutionResult;
    try {
      const cap = allCapabilities.find((c) => c.name === name);
      if (!cap) throw new Fault('UNKNOWN_CAPABILITY', name);
      args = cap.schema.parse(input);
      device = this.route(session, name, deviceId).id;
      approval = this.approvals.check(session.id, device, name, cap.risk, args, approvalId);
      const socket = this.connections.get(device)!;
      if (this.pending.size >= 128) throw new Fault('BUSY', 'Core execution queue is full');
      const id = randomUUID();
      result = await new Promise<ExecutionResult>((resolve) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          socket.send(JSON.stringify({ type: 'cancel', id }));
          resolve(
            failure(
              new Fault('TIMEOUT', 'Execution timed out; check state before retrying mutations'),
            ),
          );
        }, this.config.timeoutMs);
        this.pending.set(id, { device, resolve, timer });
        socket.send(
          JSON.stringify({
            type: 'execute',
            id,
            session: session.id,
            capability: name,
            args,
            timeoutMs: this.config.timeoutMs,
          }),
          (err) => {
            if (err) {
              clearTimeout(timer);
              this.pending.delete(id);
              resolve(failure(err));
            }
          },
        );
      });
    } catch (e) {
      result = failure(e);
    }
    result = redact({ ...result, durationMs: Date.now() - start });
    this.audit.record({
      session: session.id,
      client: session.client,
      device,
      capability: name,
      parameters: auditArgs(args),
      status: result.ok ? 'success' : (result.error?.code ?? 'error'),
      duration: Date.now() - start,
      approval,
      error: result.error,
    });
    return result;
  }
  close() {
    for (const [id, s] of this.connections) {
      this.disconnect(id, s);
      s.close();
    }
    this.audit.close();
  }
}
