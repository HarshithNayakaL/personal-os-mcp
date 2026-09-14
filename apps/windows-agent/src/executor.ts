import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { catalog } from '../../../packages/capabilities/src/catalog.js';
import { Fault } from '../../../packages/protocol/src/index.js';
import { Paths, redact } from '../../../packages/security/src/index.js';
import type { Config } from '../../../packages/shared/src/config.js';
import { Browser } from './browser.js';
import { requestHttp } from './http.js';
export class Executor {
  paths: Paths;
  browser: Browser;
  constructor(public c: Config) {
    this.paths = new Paths(c.roots, [c.browserProfile, path.resolve('.local')]);
    this.browser = new Browser(c, this.paths);
  }
  async command(
    executable: string,
    args: string[],
    cwd: string,
    timeoutMs = this.c.timeoutMs,
    env: Record<string, string> = {},
    signal?: AbortSignal,
  ) {
    for (const key of Object.keys(env))
      if (!this.c.allowedEnvironment.includes(key))
        throw new Fault('ENV_DENIED', `Environment override ${key} is not permitted`);
    const start = Date.now();
    const workingDirectory = await this.paths.resolve(cwd);
    const inherited = { ...process.env, ...env };
    if (executable.toLowerCase() === 'powershell.exe')
      inherited.PSModulePath = path.join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'Modules',
      );
    return new Promise<{
      stdout: string;
      stderr: string;
      exitCode: number | null;
      duration: number;
      workingDirectory: string;
    }>((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd: workingDirectory,
        env: inherited,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '',
        stderr = '',
        size = 0,
        finished = false;
      let terminationError: Error | undefined;
      const kill = () => {
        if (child.pid && process.platform === 'win32')
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          }).on('error', () => child.kill());
        else child.kill('SIGKILL');
      };
      const abort = () => {
        terminationError = new Fault('TIMEOUT', 'Command cancelled; process termination requested');
        kill();
      };
      const timer = setTimeout(abort, Math.min(timeoutMs, this.c.timeoutMs));
      signal?.addEventListener('abort', abort, { once: true });
      function finish(error?: Error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error);
      }
      child.stdout.on('data', (chunk) => {
        size += chunk.length;
        if (size > this.c.maxBytes) {
          terminationError = new Fault('OUTPUT_LIMIT', 'Command output exceeded limit');
          kill();
        } else stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        size += chunk.length;
        if (size > this.c.maxBytes) {
          terminationError = new Fault('OUTPUT_LIMIT', 'Command output exceeded limit');
          kill();
        } else stderr += chunk;
      });
      child.on('error', finish);
      child.on('close', (exitCode) => {
        if (finished) return;
        if (terminationError) {
          finish(terminationError);
          return;
        }
        finish();
        resolve({
          stdout: redact(stdout),
          stderr: redact(stderr),
          exitCode,
          duration: Date.now() - start,
          workingDirectory,
        });
      });
      if (signal?.aborted) abort();
    });
  }
  private async ps(
    script: string,
    cwd = this.c.roots[0],
    signal?: AbortSignal,
    timeoutMs = this.c.timeoutMs,
    env: Record<string, string> = {},
  ) {
    return this.command(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      cwd,
      timeoutMs,
      env,
      signal,
    );
  }
  async execute(name: string, input: unknown, signal?: AbortSignal): Promise<any> {
    const cap = catalog.find((c) => c.name === name);
    if (!cap) throw new Fault('UNKNOWN_CAPABILITY', name);
    if (!this.c.enabledCapabilities.includes('*') && !this.c.enabledCapabilities.includes(name))
      throw new Fault('DISABLED', name);
    const a = cap.schema.parse(input) as any;
    const [ns, op] = name.split('.');
    if (signal?.aborted) throw new Fault('TIMEOUT', 'Request expired');
    if (ns === 'browser') {
      const cancel = () => {
        void this.browser.close().catch(() => {});
      };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        return await this.browser.execute(op, a);
      } finally {
        signal?.removeEventListener('abort', cancel);
      }
    }
    if (ns === 'http') return requestHttp(op, a, this.c, signal);
    if (ns === 'filesystem') {
      if (op === 'copy' || op === 'move') {
        const src = await this.paths.resolve(a.source);
        const dest = await this.paths.mutable(a.destination);
        if (op === 'move') await this.paths.mutable(src);
        await fs.copyFile(src, dest, 1);
        if (op === 'move') await fs.unlink(src);
        return { source: src, destination: dest };
      }
      const p = await this.paths.resolve(a.path, ['write', 'append', 'mkdir'].includes(op));
      if (op === 'list')
        return (await fs.readdir(p, { withFileTypes: true }))
          .slice(0, 1000)
          .map((e) => ({ name: e.name, directory: e.isDirectory(), symlink: e.isSymbolicLink() }));
      if (op === 'stat') {
        const st = await fs.stat(p);
        return {
          path: p,
          size: st.size,
          directory: st.isDirectory(),
          modified: st.mtime.toISOString(),
        };
      }
      if (op === 'read') {
        if ((await fs.stat(p)).size > this.c.maxBytes)
          throw new Fault('OUTPUT_LIMIT', 'File exceeds configured read limit');
        const data = await fs.readFile(p);
        return {
          path: p,
          encoding: a.encoding,
          content:
            a.encoding === 'base64' ? data.toString('base64') : redact(data.toString('utf8')),
        };
      }
      if (op === 'write' || op === 'append') {
        await this.paths.mutable(p);
        const data = Buffer.from(a.content, a.encoding);
        if (data.length > this.c.maxBytes) throw new Fault('INPUT_LIMIT', 'Content exceeds limit');
        if (op === 'write') await fs.writeFile(p, data);
        else await fs.appendFile(p, data);
        return { path: p, bytes: data.length };
      }
      if (op === 'mkdir') {
        await this.paths.mutable(p);
        await fs.mkdir(p, { recursive: true });
        return { path: p };
      }
      if (op === 'delete') {
        await this.paths.mutable(p);
        await fs.rm(p, { recursive: a.recursive, force: false });
        return { deleted: p };
      }
      if (op === 'search') {
        const results: string[] = [];
        let visited = 0;
        const walk = async (dir: string) => {
          for (const e of await fs.readdir(dir, { withFileTypes: true })) {
            if (signal?.aborted) throw new Fault('TIMEOUT', 'Search cancelled');
            if (++visited > 10000 || results.length >= a.limit) return;
            const f = path.join(dir, e.name);
            if (e.isSymbolicLink()) continue;
            try {
              await this.paths.resolve(f);
            } catch {
              continue;
            }
            if (e.name.toLowerCase().includes(a.pattern.toLowerCase())) results.push(f);
            if (e.isDirectory()) await walk(f);
          }
        };
        await walk(p);
        return { paths: results, truncated: visited > 10000 || results.length >= a.limit };
      }
    }
    if (ns === 'shell' || ns === 'powershell') {
      for (const pattern of this.c.commandDenyPatterns)
        if (new RegExp(pattern, 'i').test(a.command))
          throw new Fault('COMMAND_DENIED', 'Command matched a configured restriction');
      return ns === 'powershell'
        ? this.ps(a.command, a.cwd, signal, a.timeoutMs, a.env)
        : this.command(
            process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
            process.platform === 'win32' ? ['/d', '/s', '/c', a.command] : ['-c', a.command],
            a.cwd,
            a.timeoutMs,
            a.env,
            signal,
          );
    }
    if (ns === 'system') {
      if (op === 'info')
        return {
          platform: os.platform(),
          hostname: os.hostname(),
          release: os.release(),
          arch: os.arch(),
          cpus: os.cpus().length,
          totalMemory: os.totalmem(),
          uptime: os.uptime(),
        };
      if (op === 'cwd') return { cwd: this.c.roots[0] };
      return Object.fromEntries(
        Object.entries(process.env).map(([k, v]) => [
          k,
          this.c.allowedEnvironment.includes(k) ? redact(v) : '[REDACTED]',
        ]),
      );
    }
    if (ns === 'git') {
      const argv: Record<string, string[]> = {
        status: ['status', '--porcelain=v1', '--branch'],
        diff: ['diff', '--no-ext-diff', '--no-textconv'],
        log: ['log', `-${a.limit ?? 20}`, '--format=%h %s'],
        add: ['add', '--', ...(a.paths ?? [])],
        commit: ['commit', '-m', a.message ?? ''],
        branch: ['branch', '--', a.name ?? ''],
        checkout: ['switch', '--', a.name ?? ''],
        pull: ['pull', '--ff-only'],
        push: ['push'],
      };
      if (a.name?.startsWith('-'))
        throw new Fault('INVALID_ARGUMENT', 'Branch name cannot start with -');
      if (op === 'add') for (const f of a.paths) await this.paths.resolve(path.resolve(a.cwd, f));
      return this.command(
        'git',
        ['-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false', ...argv[op]],
        a.cwd,
        this.c.timeoutMs,
        {},
        signal,
      );
    }
    if (ns === 'process') {
      if (op === 'list') {
        const r = await this.ps(
          'Get-Process | Select-Object Id,ProcessName | ConvertTo-Json -Compress',
          undefined,
          signal,
        );
        if (r.exitCode !== 0) throw new Fault('PROCESS_FAILED', r.stderr);
        return JSON.parse(r.stdout || '[]');
      }
      if (op === 'kill') {
        if (a.pid === process.pid || a.pid === process.ppid)
          throw new Fault('PROTECTED_PROCESS', 'Cannot kill the agent or its parent');
        return this.ps(`Stop-Process -Id ${a.pid} -ErrorAction Stop`, undefined, signal);
      }
      const cwd = await this.paths.resolve(a.cwd);
      return new Promise((resolve, reject) => {
        const p = spawn(a.executable, a.args, {
          cwd,
          windowsHide: true,
          detached: false,
          stdio: 'ignore',
        });
        p.once('error', reject);
        p.once('spawn', () => {
          p.unref();
          resolve({ pid: p.pid });
        });
      });
    }
    if (ns === 'app') {
      if (op === 'list') {
        const r = await this.ps(
          'Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress',
          undefined,
          signal,
        );
        if (r.exitCode !== 0) throw new Fault('APP_FAILED', r.stderr);
        return JSON.parse(r.stdout || '[]');
      }
      if (!/^[\w.\-!\\:{}]+$/.test(a.appId))
        throw new Fault('INVALID_ARGUMENT', 'Invalid application ID');
      return this.command(
        'explorer.exe',
        [`shell:AppsFolder\\${a.appId}`],
        this.c.roots[0],
        this.c.timeoutMs,
        {},
        signal,
      );
    }
    if (ns === 'clipboard') {
      if (op === 'read') {
        const r = await this.ps('Get-Clipboard -Raw', undefined, signal);
        if (r.exitCode !== 0) throw new Fault('CLIPBOARD_FAILED', r.stderr);
        return { text: r.stdout };
      }
      const b = Buffer.from(a.text, 'utf8').toString('base64');
      return this.ps(
        `Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b}')))`,
        undefined,
        signal,
      );
    }
    throw new Fault('UNKNOWN_CAPABILITY', name);
  }
  async close() {
    await this.browser.close();
  }
}
