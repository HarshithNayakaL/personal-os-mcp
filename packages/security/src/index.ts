import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Fault, type PermissionPolicy, type Risk } from '../../protocol/src/index.js';
const secretKey =
  /password|passwd|secret|token|authorization|cookie|api.?key|private.?key|credential/i;
export function redact(value: any): any {
  if (typeof value === 'string') {
    let result = value
      .replace(
        /-----BEGIN [\w ]*PRIVATE KEY-----[\s\S]*?-----END [\w ]*PRIVATE KEY-----/g,
        '[REDACTED PRIVATE KEY]',
      )
      .replace(/(Bearer\s+)[\w.\-~+/=]+/gi, '$1[REDACTED]')
      .replace(
        /((?:password|passwd|secret|token|api[_-]?key|authorization|cookie)\s*[=:]\s*)[^\s,;]+/gi,
        '$1[REDACTED]',
      )
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[REDACTED]@')
      .replace(
        /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,
        '[REDACTED]',
      );
    for (const [k, v] of Object.entries(process.env))
      if (secretKey.test(k) && v && v.length >= 6) result = result.split(v).join('[REDACTED]');
    return result;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, secretKey.test(k) ? '[REDACTED]' : redact(v)]),
    );
  return value;
}
export function auditArgs(args: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(args).map(([k, v]) => [
      k,
      /content|text|script|command|body|headers|env|expression|data/i.test(k)
        ? '[OMITTED]'
        : redact(v),
    ]),
  );
}
export class Paths {
  constructor(
    public roots: string[],
    public protectedPaths: string[] = [],
  ) {}
  async resolve(input: string, allowMissing = false): Promise<string> {
    const target = path.resolve(input);
    let real: string;
    try {
      real = await fs.realpath(target);
    } catch (e: any) {
      if (!allowMissing || e.code !== 'ENOENT') throw e;
      let cursor = path.dirname(target);
      const tail = [path.basename(target)];
      while (true) {
        try {
          real = path.join(await fs.realpath(cursor), ...tail.reverse());
          break;
        } catch (x: any) {
          if (x.code !== 'ENOENT' || cursor === path.dirname(cursor)) throw x;
          tail.push(path.basename(cursor));
          cursor = path.dirname(cursor);
        }
      }
    }
    const within = (root: string, p: string) => {
      const rel = path.relative(root, p);
      return (
        rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))
      );
    };
    const roots = await Promise.all(this.roots.map((r) => fs.realpath(r)));
    if (!roots.some((r) => within(r, real!)))
      throw new Fault('PATH_DENIED', 'Path is outside allowed roots');
    if (
      this.protectedPaths.some((r) => within(path.resolve(r), real!)) ||
      /(?:^|[\\/])(?:\.env(?:\.[^\\/]+)?|id_rsa|id_ed25519|credentials|cookies|login data)(?:[\\/]|$)/i.test(
        real!,
      )
    )
      throw new Fault('SECRET_PATH_DENIED', 'Credential or internal storage is not exposed');
    return real!;
  }
  async mutable(input: string) {
    const p = await this.resolve(input, true);
    if (this.roots.some((r) => path.resolve(r).toLowerCase() === p.toLowerCase()))
      throw new Fault('ROOT_PROTECTED', 'Cannot mutate an allowed root itself');
    return p;
  }
}
export class Approvals {
  pending = new Map<
    string,
    {
      fingerprint: string;
      session: string;
      device: string;
      capability: string;
      args: unknown;
      expires: number;
      approved: boolean;
    }
  >();
  constructor(public policy: PermissionPolicy) {}
  check(
    session: string,
    device: string,
    capability: string,
    risk: Risk,
    args: unknown,
    approvalId?: string,
  ) {
    const rule = this.policy[capability] ?? this.policy[risk] ?? 'required';
    if (rule === 'deny') throw new Fault('DENIED', 'Capability denied by policy');
    if (rule === 'allow') return 'not-required';
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ session, device, capability, args }))
      .digest('hex');
    const existing = approvalId ? this.pending.get(approvalId) : undefined;
    if (
      existing?.approved &&
      existing.fingerprint === fingerprint &&
      existing.expires > Date.now()
    ) {
      this.pending.delete(approvalId!);
      return approvalId!;
    }
    for (const [id, p] of this.pending) if (p.expires <= Date.now()) this.pending.delete(id);
    const old = [...this.pending].find(([, p]) => p.fingerprint === fingerprint);
    const id = old?.[0] ?? randomUUID();
    if (!old)
      this.pending.set(id, {
        fingerprint,
        session,
        device,
        capability,
        // The approver must see exactly what the fingerprint binds. Redacting here would let
        // a secret-looking key (e.g. `token=1&<payload>`) hide part of a command from review.
        args: structuredClone(args),
        expires: Date.now() + 300000,
        approved: false,
      });
    throw new Fault(
      'APPROVAL_REQUIRED',
      `Local approval required. Request ${id}. Approve with the local approval CLI, then retry identical arguments with approvalId.`,
    );
  }
  approve(id: string) {
    const p = this.pending.get(id);
    if (!p || p.expires <= Date.now())
      throw new Fault('APPROVAL_EXPIRED', 'Unknown or expired request');
    p.approved = true;
  }
}
