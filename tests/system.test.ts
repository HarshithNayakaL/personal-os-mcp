import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import YAML from 'yaml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Paths, Approvals, redact, auditArgs } from '../packages/security/src/index.js';
import { vault } from '../packages/security/src/vault.js';
import { Audit } from '../packages/shared/src/audit.js';
import { loadConfig, type Config } from '../packages/shared/src/config.js';
import { Core } from '../apps/mcp-server/src/core.js';
import { Executor } from '../apps/windows-agent/src/executor.js';
import { catalog } from '../packages/capabilities/src/catalog.js';
import { privateAddress, requestHttp } from '../apps/windows-agent/src/http.js';
const project = process.cwd();
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'personal-mcp-test-'));
  const work = path.join(root, 'work');
  await fs.mkdir(work);
  const config: Config = {
    ...loadConfig(),
    roots: [work],
    browserProfile: path.join(root, 'profile'),
    downloadDirectory: work,
    headless: true,
    timeoutMs: 5000,
    maxBytes: 32768,
  };
  return {
    root,
    work,
    config,
    cleanup: () => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
  };
}
test('canonical roots reject traversal, credential paths and linked escapes', async () => {
  const f = await fixture();
  try {
    const guard = new Paths([f.work]);
    await fs.writeFile(path.join(f.work, 'safe.txt'), 'hello');
    assert.equal(await guard.resolve(path.join(f.work, 'safe.txt')), path.join(f.work, 'safe.txt'));
    await assert.rejects(guard.resolve(path.join(f.work, '..', 'outside'), true), /outside/);
    await assert.rejects(guard.resolve(path.join(f.work, '.env'), true), /Credential/);
    await assert.rejects(guard.mutable(f.work), /root/);
    await fs.mkdir(path.join(f.root, 'outside'));
    await fs.symlink(path.join(f.root, 'outside'), path.join(f.work, 'link'), 'junction');
    await assert.rejects(guard.resolve(path.join(f.work, 'link', 'new.txt'), true), /outside/);
  } finally {
    await f.cleanup();
  }
});
test('approvals bind identity, device, exact arguments and expire after single use', () => {
  const p = new Approvals({ READ: 'allow', SENSITIVE: 'required' });
  assert.equal(p.check('s', 'd', 'read', 'READ', {}), 'not-required');
  assert.throws(() => p.check('s', 'd', 'delete', 'SENSITIVE', { path: 'a' }), /approval/i);
  const id = [...p.pending.keys()][0];
  p.approve(id);
  assert.throws(() => p.check('other', 'd', 'delete', 'SENSITIVE', { path: 'a' }, id));
  assert.equal(p.check('s', 'd', 'delete', 'SENSITIVE', { path: 'a' }, id), id);
  assert.throws(() => p.check('s', 'd', 'delete', 'SENSITIVE', { path: 'a' }, id));
  assert.throws(
    () => new Approvals({ READ: 'deny' }).check('s', 'd', 'read', 'READ', {}),
    /denied/,
  );
});
test('redaction removes recognizable credentials and audit omits command payloads', () => {
  assert.deepEqual(
    redact({
      password: 'hidden',
      nested: { Authorization: 'Bearer token' },
      message: 'token=private-value',
    }),
    {
      password: '[REDACTED]',
      nested: { Authorization: '[REDACTED]' },
      message: 'token=[REDACTED]',
    },
  );
  assert.equal(auditArgs({ command: 'sensitive output', path: 'note' }).command, '[OMITTED]');
});
test('schema rejects unknown fields and invalid dangerous arguments', () => {
  for (const name of ['filesystem.read', 'process.kill', 'shell.execute'])
    assert.equal(
      catalog.find((c) => c.name === name)!.schema.safeParse({ unknown: true }).success,
      false,
    );
  assert.equal(
    catalog.find((c) => c.name === 'process.kill')!.schema.safeParse({ pid: -1 }).success,
    false,
  );
});
test('routing does not confuse online devices with preferred device', async () => {
  const f = await fixture();
  const audit = await Audit.open(path.join(f.root, 'audit.sqlite'));
  const core = new Core(f.config, audit);
  try {
    core.devices.set('win', {
      id: 'win',
      type: 'windows',
      online: true,
      lastSeen: 1,
      capabilities: ['x'],
    });
    core.devices.set('phone', {
      id: 'phone',
      type: 'android',
      online: true,
      lastSeen: 1,
      capabilities: ['x', 'y'],
    });
    const s = core.session('one');
    assert.throws(() => core.route(s, 'x'), /preferred/);
    assert.equal(core.route(s, 'y').id, 'phone');
    s.preferredDevice = 'win';
    assert.equal(core.route(s, 'x').id, 'win');
    assert.throws(() => core.route(s, 'y'), /does not support/);
    core.devices.get('win')!.online = false;
    assert.throws(() => core.route(s, 'x'), /offline/);
  } finally {
    core.close();
    await f.cleanup();
  }
});
test('SQLite audit persists sanitized records across reopen', async () => {
  const f = await fixture();
  try {
    let audit = await Audit.open(path.join(f.root, 'audit.sqlite'));
    audit.record({
      session: 's',
      client: 'test',
      device: 'd',
      capability: 'filesystem.read',
      parameters: { password: 'secret' },
      status: 'success',
      duration: 2,
      approval: 'none',
    });
    audit.close();
    audit = await Audit.open(path.join(f.root, 'audit.sqlite'));
    assert.equal(audit.search(10, 'filesystem').length, 1);
    assert.match(String(audit.search()[0].parameters), /REDACTED/);
    audit.close();
    assert.equal(
      (await fs.readFile(path.join(f.root, 'audit.sqlite'))).subarray(0, 15).toString(),
      'SQLite format 3',
    );
  } finally {
    await f.cleanup();
  }
});
test('filesystem primitives operate on temporary text and binary files', async () => {
  const f = await fixture();
  const e = new Executor(f.config);
  try {
    const file = path.join(f.work, 'one.txt');
    await e.execute('filesystem.write', { path: file, content: 'hello' });
    await e.execute('filesystem.append', { path: file, content: ' world' });
    assert.equal((await e.execute('filesystem.read', { path: file })).content, 'hello world');
    const copy = path.join(f.work, 'copy.txt');
    await e.execute('filesystem.copy', { source: file, destination: copy });
    await assert.rejects(e.execute('filesystem.copy', { source: file, destination: copy }));
    const moved = path.join(f.work, 'moved.txt');
    await e.execute('filesystem.move', { source: copy, destination: moved });
    assert.equal(
      (await e.execute('filesystem.search', { path: f.work, pattern: 'moved' })).paths.length,
      1,
    );
    const binary = path.join(f.work, 'b.bin');
    await e.execute('filesystem.write', { path: binary, content: 'AAECA/8=', encoding: 'base64' });
    assert.equal(
      (await e.execute('filesystem.read', { path: binary, encoding: 'base64' })).content,
      'AAECA/8=',
    );
    await e.execute('filesystem.delete', { path: moved });
    await assert.rejects(fs.stat(moved));
    await fs.writeFile(file, Buffer.alloc(40000));
    await assert.rejects(e.execute('filesystem.read', { path: file }), /limit/);
  } finally {
    await e.close();
    await f.cleanup();
  }
});
test('shell and PowerShell execute and enforce output/timeout limits', async () => {
  const f = await fixture();
  const e = new Executor(f.config);
  try {
    const r = await e.execute('shell.execute', { cwd: f.work, command: 'echo personal-mcp' });
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /personal-mcp/);
    if (process.platform === 'win32') {
      const p = await e.execute('powershell.execute', {
        cwd: f.work,
        command: '[Console]::WriteLine(6*7)',
      });
      assert.equal(p.exitCode, 0);
      assert.match(p.stdout, /42/);
    }
    await assert.rejects(
      e.command(process.execPath, ['-e', 'setTimeout(()=>{},5000)'], f.work, 100),
      /timed out|cancelled/,
    );
    await assert.rejects(
      e.command(process.execPath, ['-e', 'console.log("x".repeat(50000))'], f.work),
      /limit/,
    );
    await assert.rejects(
      e.execute('shell.execute', {
        cwd: f.work,
        command: 'echo ok',
        env: { SECRET_OVERRIDE: 'x' },
      }),
      /not permitted/,
    );
  } finally {
    await e.close();
    await f.cleanup();
  }
});
test('Git primitives work in a disposable repository', async () => {
  const f = await fixture();
  const e = new Executor(f.config);
  try {
    assert.equal((await e.command('git', ['init'], f.work)).exitCode, 0);
    await e.command('git', ['config', 'user.name', 'MCP Test'], f.work);
    await e.command('git', ['config', 'user.email', 'test@example.invalid'], f.work);
    await fs.writeFile(path.join(f.work, 'file.txt'), 'one');
    await e.execute('git.add', { cwd: f.work, paths: ['file.txt'] });
    assert.equal(
      (await e.execute('git.commit', { cwd: f.work, message: 'Test commit' })).exitCode,
      0,
    );
    assert.match((await e.execute('git.log', { cwd: f.work })).stdout, /Test commit/);
    await fs.writeFile(path.join(f.work, 'file.txt'), 'two');
    assert.match((await e.execute('git.diff', { cwd: f.work })).stdout, /two/);
    assert.match((await e.execute('git.status', { cwd: f.work })).stdout, /file.txt/);
    assert.equal((await e.execute('git.branch', { cwd: f.work, name: 'test-branch' })).exitCode, 0);
  } finally {
    await e.close();
    await f.cleanup();
  }
});
test('HTTP pins DNS, blocks private destinations, disallows credential headers and redirects', async () => {
  const f = await fixture();
  const srv = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: 'http://example.com' });
      res.end();
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ method: req.method }));
    }
  });
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(srv.address() as any).port}`;
  try {
    assert(privateAddress('127.0.0.1'));
    assert(privateAddress('::ffff:7f00:1'));
    assert(!privateAddress('8.8.8.8'));
    await assert.rejects(requestHttp('get', { url }, f.config), /Private/);
    const c = { ...f.config, allowedLocalHosts: ['127.0.0.1'] };
    assert.equal(((await requestHttp('post', { url, body: 'x' }, c)) as any).body.method, 'POST');
    assert.equal(((await requestHttp('get', { url: url + '/redirect' }, c)) as any).status, 302);
    await assert.rejects(
      requestHttp('get', { url, headers: { Authorization: 'x' } }, c),
      /headers/,
    );
  } finally {
    await new Promise<void>((resolve) => srv.close(() => resolve()));
    await f.cleanup();
  }
});
test('real Chromium navigates, snapshots, uses semantic refs, handles tabs and downloads', async () => {
  const f = await fixture();
  const e = new Executor(f.config);
  const srv = http.createServer((req, res) => {
    if (req.url === '/file') {
      res.setHeader('Content-Disposition', 'attachment; filename="sample.txt"');
      res.end('downloaded');
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<title>Test form</title><label>Email<input aria-label="Email"></label><button onclick="document.querySelector(&quot;p&quot;).textContent=&quot;Clicked&quot;">Apply</button><p>Ready</p><a href="/file">Download</a><input type="password" value="do-not-expose">',
    );
  });
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  try {
    await e.execute('browser.launch', {});
    await e.execute('browser.navigate', { url: `http://127.0.0.1:${(srv.address() as any).port}` });
    const s = await e.execute('browser.snapshot', {});
    assert.equal(s.title, 'Test form');
    assert(!JSON.stringify(s).includes('do-not-expose'));
    const input = s.elements.find((x: any) => x.name === 'Email');
    await e.execute('browser.type', { ref: input.ref, text: 'test@example.invalid' });
    await e.execute('browser.click', { ref: s.elements.find((x: any) => x.name === 'Apply').ref });
    assert.match((await e.execute('browser.get_text', {})).text, /Clicked/);
    await e.execute('browser.download', {
      ref: s.elements.find((x: any) => x.name === 'Download').ref,
      destination: path.join(f.work, 'download.txt'),
    });
    assert.equal(await fs.readFile(path.join(f.work, 'download.txt'), 'utf8'), 'downloaded');
    await e.execute('browser.new_tab', {});
    await assert.rejects(e.execute('browser.click', { ref: input.ref }), /expired/);
    assert.equal((await e.execute('browser.tabs', {})).length, 2);
    await e.execute('browser.screenshot', { path: path.join(f.work, 'screenshot.png') });
    assert((await fs.stat(path.join(f.work, 'screenshot.png'))).size > 0);
  } finally {
    await e.close();
    await new Promise<void>((resolve) => srv.close(() => resolve()));
    await f.cleanup();
  }
});
test(
  'MCP client → core → Windows agent integration, pairing, approvals, audit and disconnect',
  { timeout: 90000 },
  async () => {
    const f = await fixture();
    await fs.mkdir(path.join(f.root, '.local'));
    const listener = http.createServer();
    await new Promise<void>((r) => listener.listen(0, '127.0.0.1', r));
    const port = (listener.address() as any).port;
    await new Promise<void>((r) => listener.close(() => r()));
    const config = {
      ...f.config,
      port,
      approvals: { READ: 'allow', WRITE: 'allow', EXECUTE: 'required', SENSITIVE: 'required' },
    };
    const configPath = path.join(f.root, 'config.yaml');
    await fs.writeFile(configPath, YAML.stringify(config));
    const credentials = {
      client: randomBytes(32).toString('hex'),
      agent: randomBytes(32).toString('hex'),
      admin: randomBytes(32).toString('hex'),
    };
    vault(path.join(f.root, '.local/credentials'), JSON.stringify(credentials));
    const children: ChildProcess[] = [];
    let logs = '';
    let client: Client | undefined;
    let phone: WebSocket | undefined;
    const env = { ...process.env, PERSONAL_MCP_CONFIG: configPath };
    const run = (relative: string) => {
      const child = spawn(process.execPath, [path.join(project, relative)], {
        cwd: f.root,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout?.on('data', (b) => (logs += b));
      child.stderr?.on('data', (b) => (logs += b));
      children.push(child);
      return child;
    };
    async function api(route: string, body?: any, admin = false) {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, {
        headers: {
          Authorization: `Bearer ${admin ? credentials.admin : credentials.client}`,
          'Content-Type': 'application/json',
        },
        method: body ? 'POST' : 'GET',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return response.json();
    }
    try {
      run('dist/apps/mcp-server/src/daemon.js');
      run('dist/apps/windows-agent/src/main.js');
      let ready = false;
      for (let i = 0; i < 100; i++) {
        try {
          const h = await api('/health');
          if (h.devices?.some((d: any) => d.online)) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      assert(ready, logs);
      assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 401);
      client = new Client({ name: 'integration-test', version: '1.0.0' });
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [path.join(project, 'dist/apps/mcp-server/src/main.js')],
          cwd: f.root,
          env: env as Record<string, string>,
          stderr: 'pipe',
        }),
      );
      const tools = await client.listTools();
      assert(tools.tools.length > 80);
      const call = async (name: string, args: any = {}) =>
        JSON.parse((await client!.callTool({ name, arguments: args })).content[0].text);
      assert.equal((await call('device.list')).data[0].id, config.deviceName);
      assert((await client.listResources()).resources.length >= 4);
      await call('filesystem.write', { path: path.join(f.work, 'mcp.txt'), content: 'via MCP' });
      assert.equal(
        (await call('filesystem.read', { path: path.join(f.work, 'mcp.txt') })).data.content,
        'via MCP',
      );
      const command = { cwd: f.work, command: 'echo routed' };
      const blocked = await call('shell.execute', command);
      assert.equal(blocked.error.code, 'APPROVAL_REQUIRED');
      const pending = await api('/admin/pending', undefined, true);
      const approval = pending.find((p: any) => p.capability === 'shell.execute');
      assert(approval);
      await api('/admin/approve', { id: approval.id }, true);
      assert.match(
        (await call('shell.execute', { ...command, approvalId: approval.id })).data.stdout,
        /routed/,
      );
      assert((await call('audit.recent')).data.length >= 4);
      const pairing = await api('/admin/pair', {}, true);
      const paired = await api('/pair', { code: pairing.value, deviceId: 'android-test' });
      assert(paired.token);
      const reused = await api('/pair', { code: pairing.value, deviceId: 'android-other' });
      assert(reused.error);
      phone = new WebSocket(`ws://127.0.0.1:${port}/agent`, {
        headers: { Authorization: `Bearer ${paired.token}` },
      });
      await new Promise<void>((resolve, reject) => {
        phone!.on('open', () =>
          phone!.send(
            JSON.stringify({
              type: 'register',
              device: { id: 'android-test', type: 'android', capabilities: ['device.info'] },
            }),
          ),
        );
        phone!.on('message', (raw) => {
          if (JSON.parse(raw.toString()).type === 'registered') resolve();
        });
        phone!.on('error', reject);
      });
      assert.equal((await call('device.current')).error.code, 'DEVICE_AMBIGUOUS');
      assert.equal((await call('session.prefer', { deviceId: config.deviceName })).ok, true);
      assert.equal((await call('device.current')).data.id, config.deviceName);
    } finally {
      phone?.terminate();
      await client?.close();
      await Promise.all(
        children.map(
          (child) =>
            new Promise<void>((resolve) => {
              if (child.exitCode !== null) {
                resolve();
                return;
              }
              child.once('exit', () => resolve());
              child.kill();
            }),
        ),
      );
      await f.cleanup();
    }
  },
);
