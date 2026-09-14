import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Core } from '../apps/mcp-server/src/core.js';
import { Audit } from '../packages/shared/src/audit.js';
import { loadConfig } from '../packages/shared/src/config.js';
import { Executor } from '../apps/windows-agent/src/executor.js';
import { requestHttp } from '../apps/windows-agent/src/http.js';
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'personal-mcp-reliability-'));
  const config = {
    ...loadConfig(),
    roots: [root],
    timeoutMs: 200,
    approvals: { READ: 'allow' as const },
  };
  return {
    root,
    config,
    clean: () => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  };
}
test('core handles lost agents and does not accept a result from another device', async () => {
  const f = await fixture();
  const core = new Core(f.config, await Audit.open(path.join(f.root, 'audit.sqlite')));
  let request: any;
  const socket = {
    send: (raw: string) => {
      request = JSON.parse(raw);
    },
    close() {},
  } as any;
  try {
    core.register(
      {
        id: 'windows',
        type: 'windows',
        online: true,
        lastSeen: Date.now(),
        capabilities: ['system.info'],
      },
      socket,
    );
    const run = core.execute(core.session('test'), 'system.info', {});
    assert(request);
    core.result('different', { id: request.id, result: { ok: true, data: 'forged' } });
    assert.equal(core.pending.size, 1);
    core.disconnect('windows', socket);
    assert.equal((await run).error?.code, 'DEVICE_DISCONNECTED');
    assert.equal(core.pending.size, 0);
  } finally {
    core.close();
    await f.clean();
  }
});
test('core timeout sends cancellation and audits timeout outcome', async () => {
  const f = await fixture();
  const core = new Core(f.config, await Audit.open(path.join(f.root, 'audit.sqlite')));
  const messages: any[] = [];
  const socket = { send: (raw: string) => messages.push(JSON.parse(raw)), close() {} } as any;
  try {
    core.register(
      {
        id: 'windows',
        type: 'windows',
        online: true,
        lastSeen: Date.now(),
        capabilities: ['system.info'],
      },
      socket,
    );
    const result = await core.execute(core.session('test'), 'system.info', {});
    assert.equal(result.error?.code, 'TIMEOUT');
    assert.equal(messages[1].type, 'cancel');
    assert.equal(core.audit.search()[0].status, 'TIMEOUT');
  } finally {
    core.close();
    await f.clean();
  }
});
test('HTTP named local endpoint connects through pinned DNS and response limit is enforced', async () => {
  const f = await fixture();
  const srv = http.createServer((req, res) =>
    res.end(req.url === '/large' ? 'x'.repeat(40000) : 'ok'),
  );
  await new Promise<void>((resolve) => srv.listen(0, resolve));
  try {
    const port = (srv.address() as any).port;
    const config = { ...f.config, maxBytes: 1024, allowedLocalHosts: ['localhost'] };
    assert.equal(
      ((await requestHttp('get', { url: `http://localhost:${port}` }, config)) as any).body,
      'ok',
    );
    await assert.rejects(
      requestHttp('get', { url: `http://localhost:${port}/large` }, config),
      /limit/,
    );
  } finally {
    await new Promise<void>((resolve) => srv.close(() => resolve()));
    await f.clean();
  }
});
test(
  'Windows application and process discovery use working native APIs',
  { skip: process.platform !== 'win32' },
  async () => {
    const f = await fixture();
    const e = new Executor({ ...f.config, timeoutMs: 10000 });
    try {
      const processes = await e.execute('process.list', {});
      assert(Array.isArray(processes));
      assert(processes.some((p: any) => p.Id === process.pid));
      const apps = await e.execute('app.list', {});
      assert(Array.isArray(apps) || typeof apps === 'object');
      const system = await e.execute('system.info', {});
      assert.equal(system.platform, 'win32');
    } finally {
      await e.close();
      await f.clean();
    }
  },
);
test('Git branch switching, push and pull work against a disposable local remote', async () => {
  const f = await fixture();
  const e = new Executor({ ...f.config, timeoutMs: 10000 });
  try {
    const remote = path.join(f.root, 'remote.git'),
      work = path.join(f.root, 'work');
    await fs.mkdir(work);
    await e.command('git', ['init', '--bare', remote], f.root);
    await e.command('git', ['init', '-b', 'main'], work);
    await e.command('git', ['config', 'user.name', 'Test'], work);
    await e.command('git', ['config', 'user.email', 'test@example.invalid'], work);
    await fs.writeFile(path.join(work, 'test.txt'), 'local only');
    await e.execute('git.add', { cwd: work, paths: ['test.txt'] });
    await e.execute('git.commit', { cwd: work, message: 'initial' });
    await e.command('git', ['remote', 'add', 'origin', remote], work);
    assert.equal(
      (await e.command('git', ['push', '--set-upstream', 'origin', 'main'], work)).exitCode,
      0,
    );
    assert.equal((await e.execute('git.push', { cwd: work })).exitCode, 0);
    assert.equal((await e.execute('git.pull', { cwd: work })).exitCode, 0);
    await e.execute('git.branch', { cwd: work, name: 'topic' });
    assert.equal((await e.execute('git.checkout', { cwd: work, name: 'topic' })).exitCode, 0);
  } finally {
    await e.close();
    await f.clean();
  }
});
