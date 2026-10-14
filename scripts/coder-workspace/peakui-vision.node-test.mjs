import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { analyzeImage, selectVisionRoute } from './peakui-vision.mjs';

const temp = await mkdtemp(join(tmpdir(), 'peakui-vision-test-'));
after(async () => { await rm(temp, { recursive: true, force: true }); });

const model = { id: 'vision:test', baseUrl: '', envKey: 'TEST_VISION_KEY', capabilities: { vision: true } };

test('selected Vision model must exist and accept images', () => {
  assert.throws(() => selectVisionRoute({ visionModel: 'missing', modelProviders: { openai: [model] } }), /not registered/);
  assert.throws(() => selectVisionRoute({ modelProviders: { openai: [{ ...model, capabilities: {} }] } }), /No Vision model/);
});

test('analyzes the actual image with the selected model and returns its observation', async () => {
  let request;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    request = { url: req.url, body: JSON.parse(body) };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: { content: 'The page shows a login form and an error banner.' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const settingsPath = join(temp, 'settings.json');
    const imagePath = join(temp, 'screen.png');
    await writeFile(settingsPath, JSON.stringify({
      visionModel: 'openai:vision:test',
      modelProviders: { openai: [{ ...model, baseUrl: `http://127.0.0.1:${port}/v1` }] },
    }));
    await writeFile(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lYQAAAAASUVORK5CYII=', 'base64'));
    const result = await analyzeImage(imagePath, 'What is visible?', { settingsPath, timeoutMs: 2000 });
    assert.equal(result.model, 'vision:test');
    assert.match(result.text, /login form/);
    assert.equal(request.url, '/api/chat');
    assert.equal(request.body.model, 'vision:test');
    assert.equal(request.body.think, false);
    assert.equal(request.body.messages[0].content, 'What is visible?');
    assert.match(request.body.messages[0].images[0], /^[A-Za-z0-9+/]+=*$/);
  } finally {
    server.close();
  }
});
