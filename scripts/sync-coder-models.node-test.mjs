import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const exec = promisify(execFile);

test('live model sync adds Ollama pulls without replacing the selected model', async () => {
  const home = await mkdtemp(join(tmpdir(), 'peakui-model-sync-'));
  const settingsPath = join(home, 'settings.json');
  const selected = { id: 'old:cloud', envKey: 'OPENAI_API_KEY', baseUrl: 'http://127.0.0.1/v1', capabilities: { agent: true } };
  await writeFile(settingsPath, JSON.stringify({ model: { name: 'old:cloud' }, modelProviders: { openai: [selected] }, tools: { approvalMode: 'yolo' } }));
  let models = [
    { name: 'old:cloud', capabilities: ['tools'], details: { context_length: 32768 } },
    { name: 'new:cloud', capabilities: ['tools', 'vision'], details: { context_length: 65536 } },
  ];
  const server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ models })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, QWEN_HOME: home, OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, CODER_MODEL_SYNC_PRESERVE_DEFAULT: '1' };
  const script = new URL('./sync-coder-models.mjs', import.meta.url).pathname;
  try {
    const first = await exec(process.execPath, [script, '--strict'], { env });
    assert.equal(JSON.parse(first.stdout.trim().split('\n').at(-1)).changed, true);
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    assert.equal(settings.model.name, 'old:cloud');
    assert.equal(settings.tools.approvalMode, 'yolo');
    assert(settings.modelProviders.openai.some(model => model.id === 'new:cloud' && model.capabilities.vision));
    const before = (await stat(settingsPath)).mtimeMs;
    const second = await exec(process.execPath, [script, '--strict'], { env });
    assert.equal(JSON.parse(second.stdout.trim().split('\n').at(-1)).changed, false);
    assert.equal((await stat(settingsPath)).mtimeMs, before);
    models = [];
    await assert.rejects(exec(process.execPath, [script, '--strict'], { env }));
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(home, { recursive: true, force: true });
  }
});
