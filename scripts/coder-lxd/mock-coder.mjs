import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const args = process.argv;
const cwd = args[args.indexOf('--workspace') + 1];
const port = Number(args[args.indexOf('--port') + 1]);
http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"ok"}');
    return;
  }
  if (req.url === '/workspace/models') {
    if (req.method === 'PATCH') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ updated: true, runtimeSync: { status: 'applied' } }));
      return;
    }
    const settings = JSON.parse(await readFile(join(process.env.QWEN_HOME, 'settings.json'), 'utf8'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ models: (settings.modelProviders?.openai || []).map(model => ({
      key: createHash('sha256').update(model.id).digest('hex'), modelId: model.id,
      contextWindowSize: model.generationConfig?.contextWindowSize || 32768, canEditContextWindow: true,
    })) }));
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ cwd, path: req.url, body: Buffer.concat(chunks).toString() }));
}).listen(port, '127.0.0.1');
