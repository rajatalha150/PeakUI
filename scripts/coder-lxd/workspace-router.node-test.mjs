import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import net from 'node:net';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { test } from 'node:test';
import { tmpdir } from 'node:os';

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

test('routes parent and nested directories to independent persistent runtimes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'peakui-coder-router-'));
  const workspace = join(root, 'workspace');
  const child = join(workspace, 'vision-proxy');
  const seed = join(root, 'qwen-seed');
  await mkdir(child, { recursive: true });
  await mkdir(seed);
  const port = await freePort();
  const previewPort = await freePort();
  const appPort = await freePort();
  const app = http.createServer((req, res) => res.end(`preview:${req.url}`));
  app.on('upgrade', (req, socket) => {
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.end(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  });
  await new Promise(done => app.listen(appPort, '127.0.0.1', done));
  const env = {
    ...process.env,
    CODER_ROUTER_PORT: String(port),
    CODER_DEFAULT_WORKSPACE: workspace,
    CODER_PREVIEW_PORT: String(previewPort),
    CODER_ROUTER_STATE_DIR: join(root, 'state'),
    CODER_QWEN_SEED_HOME: seed,
    CODER_QWEN_ENTRY: new URL('./mock-qwen.mjs', import.meta.url).pathname,
    QWEN_SERVER_TOKEN: 'test-token',
  };
  let router;
  async function start() {
    router = spawn(process.execPath, [new URL('./workspace-router.mjs', import.meta.url).pathname], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 80; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: 'Bearer test-token' } });
        if (res.ok) return;
      } catch { /* opening */ }
      await new Promise(done => setTimeout(done, 50));
    }
    throw new Error('Router did not start');
  }
  async function stop() {
    router.kill('SIGTERM');
    await new Promise(done => router.once('exit', done));
  }
  async function request(path, body) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer test-token', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, data: await res.json() };
  }
  try {
    await start();
    assert.equal((await request('/workspaces', { cwd: child, persist: true })).status, 200);
    assert.equal((await request('/session', { sessionId: 'parent', cwd: workspace })).data.cwd, workspace);
    assert.equal((await request('/session', { sessionId: 'child', cwd: child })).data.cwd, child);
    assert.equal((await request('/session/parent/status')).data.cwd, workspace);
    assert.equal((await request('/session/child/status')).data.cwd, child);
    const preview = await fetch(`http://p${appPort}.localhost:${previewPort}/hello`);
    assert.equal(await preview.text(), 'preview:/hello');
    const ws = new WebSocket(`ws://p${appPort}.localhost:${previewPort}/hmr`);
    await new Promise((resolveOpen, rejectOpen) => {
      ws.onopen = resolveOpen;
      ws.onerror = rejectOpen;
    });
    ws.close();
    assert.equal((await request(`/workspaces/${encodeURIComponent(child)}/file?path=x`)).data.cwd, child);
    assert.equal((await request('/session', { sessionId: 'invalid', cwd: `${workspace}/../outside` })).status, 400);
    await stop();
    await start();
    assert.equal((await request('/session/child/status')).data.cwd, child);
  } finally {
    if (router && router.exitCode === null) await stop();
    await new Promise(done => app.close(done));
    await rm(root, { recursive: true, force: true });
  }
});
