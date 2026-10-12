import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('the running Coder router refreshes its model list without restarting the workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'peakui-model-router-'));
  const workspace = join(root, 'workspace');
  const seed = join(root, 'qwen');
  await mkdir(workspace);
  await mkdir(seed);
  await writeFile(join(seed, 'settings.json'), JSON.stringify({ model: { name: 'old:cloud' }, modelProviders: { openai: [] } }));
  let models = [{ name: 'old:cloud', capabilities: ['tools'], details: { context_length: 32768 } }];
  const ollama = http.createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ models })); });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  const port = await new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const selected = server.address().port; server.close(() => resolve(selected)); });
  });
  const previewPort = await new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const selected = server.address().port; server.close(() => resolve(selected)); });
  });
  const env = {
    ...process.env, CODER_ROUTER_PORT: String(port), CODER_PREVIEW_PORT: String(previewPort),
    CODER_DEFAULT_WORKSPACE: workspace, CODER_ROUTER_STATE_DIR: join(root, 'state'), CODER_SEED_HOME: seed,
    CODER_ENTRY: new URL('./mock-coder.mjs', import.meta.url).pathname,
    CODER_MODEL_SYNC_SCRIPT: new URL('../sync-coder-models.mjs', import.meta.url).pathname,
    OPENAI_BASE_URL: `http://127.0.0.1:${ollama.address().port}/v1`, QWEN_SERVER_TOKEN: 'test-token',
  };
  const router = spawn(process.execPath, [new URL('./workspace-router.mjs', import.meta.url).pathname], { env, stdio: 'ignore' });
  const request = async force => {
    const response = await fetch(`http://127.0.0.1:${port}/peakui/models?workspace=${encodeURIComponent(workspace)}${force ? '&force=1' : ''}`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        const health = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: 'Bearer test-token' } });
        if (health.ok) break;
      } catch { /* opening */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.deepEqual((await request(false)).models.map(model => model.modelId), ['old:cloud']);
    models = [...models, { name: 'new:cloud', capabilities: ['tools'], details: { context_length: 65536 } }];
    assert.deepEqual((await request(false)).models.map(model => model.modelId), ['old:cloud']);
    assert.deepEqual((await request(true)).models.map(model => model.modelId), ['old:cloud', 'new:cloud']);
  } finally {
    router.kill('SIGTERM');
    await new Promise(resolve => router.once('exit', resolve));
    await new Promise(resolve => ollama.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
