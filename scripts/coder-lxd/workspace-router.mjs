import { createHash, timingSafeEqual } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { cp, mkdir, realpath, rename, rm } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const stateDir = process.env.CODER_ROUTER_STATE_DIR || '/var/lib/peakui/coder-router';
const stateFile = join(stateDir, 'sessions.json');
const defaultWorkspace = process.env.CODER_DEFAULT_WORKSPACE || '/workspace';
const seedHome = process.env.CODER_QWEN_SEED_HOME || '/root/.qwen';
const qwenEntry = process.env.CODER_QWEN_ENTRY || '/opt/qwen-code/scripts/cli-entry.js';
const token = process.env.QWEN_SERVER_TOKEN || '';
const listenPort = Number(process.env.CODER_ROUTER_PORT || 4170);
const previewPort = Number(process.env.CODER_PREVIEW_PORT || 4172);
const previewBlockedPorts = new Set([2375, 2376, 4170, 4171, 4172, 11434]);
const runtimes = new Map();
const starts = new Map();
const execFileAsync = promisify(execFile);
let sessionWorkspaces = {};

function containsPath(root, candidate) {
  return candidate === root || candidate.startsWith(root === '/' ? '/' : `${root}${sep}`);
}

export async function canonicalDirectory(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\\%\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Workspace must be an absolute Linux directory.');
  }
  if (value.split('/').some(part => part === '.' || part === '..')) throw new Error('Workspace traversal is not allowed.');
  const canonical = await realpath(resolve(value));
  return canonical;
}

function workspaceFromRequest(pathname, url, body) {
  if (pathname === '/session' || /^\/session\/[^/]+\/load$/.test(pathname)) return body?.cwd;
  const sessionMatch = /^\/session\/([^/]+)/.exec(pathname);
  if (sessionMatch) return sessionWorkspaces[decodeURIComponent(sessionMatch[1])];
  const workspaceMatch = /^\/workspaces\/([^/]+)/.exec(pathname);
  if (workspaceMatch) return decodeURIComponent(workspaceMatch[1]);
  const explicit = url.searchParams.get('workspace');
  if (explicit) return explicit;
  const file = url.searchParams.get('path');
  if (file) {
    const candidates = [...runtimes.keys()].filter(cwd => containsPath(cwd, file));
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0] || defaultWorkspace;
  }
  return defaultWorkspace;
}

function saveSessionWorkspace(id, cwd) {
  sessionWorkspaces[id] = cwd;
  const next = `${stateFile}.tmp`;
  writeFileSync(next, JSON.stringify(sessionWorkspaces), { mode: 0o600 });
  renameSync(next, stateFile);
}

function unusedPort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolvePort(port));
    });
  });
}

async function prepareQwenHome(cwd) {
  if (cwd === defaultWorkspace) return seedHome;
  const hash = createHash('sha256').update(cwd).digest('hex').slice(0, 24);
  const home = join(stateDir, 'qwen', hash);
  if (!existsSync(home)) {
    await mkdir(join(stateDir, 'qwen'), { recursive: true, mode: 0o700 });
    const staging = `${home}.${process.pid}.tmp`;
    await mkdir(staging, { recursive: true, mode: 0o700 });
    // Preserve model/auth settings and historical transcripts without cloning
    // debug logs and caches into every selected directory.
    try {
      for (const name of ['settings.json', 'QWEN.md', 'oauth_creds.json', 'output-language.md', 'agents', 'projects', 'file-history', 'memories', 'skills', 'extensions', 'extension-store']) {
        const source = join(seedHome, name);
        if (existsSync(source)) await cp(source, join(staging, name), { recursive: true, force: false });
      }
      await rename(staging, home);
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }
  if (existsSync(join(seedHome, 'QWEN.md'))) {
    await cp(join(seedHome, 'QWEN.md'), join(home, 'QWEN.md'), { force: true });
  }
  return home;
}

async function startRuntime(cwd) {
  const existing = runtimes.get(cwd);
  if (existing && existing.child.exitCode === null) return existing;
  if (starts.has(cwd)) return starts.get(cwd);
  const start = (async () => {
    const home = await prepareQwenHome(cwd);
    if (qwenEntry === '/opt/qwen-code/scripts/cli-entry.js') {
      await execFileAsync(process.execPath, ['/opt/qwen-code/sync-coder-models.mjs'], {
        env: { ...process.env, QWEN_HOME: home }, timeout: 30_000,
      });
    }
    const port = await unusedPort();
    const child = spawn(process.execPath, [
      qwenEntry, 'serve',
      '--hostname', '127.0.0.1', '--port', String(port), '--workspace', cwd,
      '--no-web', '--enable-session-shell',
    ], { env: { ...process.env, QWEN_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
    const logName = createHash('sha256').update(cwd).digest('hex').slice(0, 24);
    const logPath = join(stateDir, `${logName}.log`);
    child.stdout.pipe(createWriteStream(logPath, { flags: 'a', mode: 0o600 }));
    child.stderr.pipe(createWriteStream(logPath, { flags: 'a', mode: 0o600 }));
    const runtime = { child, port };
    runtimes.set(cwd, runtime);
    child.once('exit', () => { if (runtimes.get(cwd) === runtime) runtimes.delete(cwd); });
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw new Error(`Qwen exited while opening ${cwd}; see ${logPath}`);
      try {
        const health = await fetch(`http://127.0.0.1:${port}/health`, {
          headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000),
        });
        if (health.ok) return runtime;
      } catch { /* still starting */ }
      await new Promise(done => setTimeout(done, 500));
    }
    child.kill('SIGTERM');
    throw new Error(`Qwen did not become ready for ${cwd}; see ${logPath}`);
  })();
  starts.set(cwd, start);
  try { return await start; } finally { starts.delete(cwd); }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function previewTarget(req) {
  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  const match = /^p(s?)(\d{4,5})\.localhost$/.exec(host);
  if (!match) return null;
  const port = Number(match[2]);
  if (port < 1024 || port > 65535 || previewBlockedPorts.has(port)) return null;
  return { secure: Boolean(match[1]), port };
}

function proxyPreview(req, res) {
  const target = previewTarget(req);
  if (!target) return sendJson(res, 400, { error: 'Invalid preview host.' });
  const transport = target.secure ? https : http;
  const upstream = transport.request({
    hostname: '127.0.0.1', port: target.port, path: req.url,
    method: req.method, rejectUnauthorized: false,
    headers: { ...req.headers, host: `localhost:${target.port}` },
  }, incoming => {
    const headers = { ...incoming.headers };
    if (typeof headers.location === 'string') {
      try {
        const location = new URL(headers.location);
        if (['localhost', '127.0.0.1'].includes(location.hostname) && Number(location.port) === target.port) {
          location.protocol = 'http:';
          location.hostname = `p${target.secure ? 's' : ''}${target.port}.localhost`;
          location.port = String(previewPort);
          headers.location = location.toString();
        }
      } catch { /* relative redirects already stay on the preview origin */ }
    }
    res.writeHead(incoming.statusCode || 502, headers);
    incoming.pipe(res);
  });
  upstream.on('error', error => { if (!res.headersSent) sendJson(res, 502, { error: error.message }); else res.destroy(error); });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

function proxyPreviewUpgrade(req, socket, head) {
  const target = previewTarget(req);
  if (!target) { socket.destroy(); return; }
  const upstream = target.secure
    ? tls.connect({ host: '127.0.0.1', port: target.port, rejectUnauthorized: false })
    : net.connect({ host: '127.0.0.1', port: target.port });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  upstream.once(target.secure ? 'secureConnect' : 'connect', () => {
    const headers = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      headers.push(`${name}: ${name.toLowerCase() === 'host' ? `localhost:${target.port}` : req.rawHeaders[i + 1]}`);
    }
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
}

function readSmallBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let length = 0;
    req.on('data', chunk => {
      length += chunk.length;
      if (length > 1024 * 1024) { reject(new Error('Request body is too large.')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function proxy(req, res, runtime, buffered, onSuccess) {
  const upstream = http.request({
    hostname: '127.0.0.1', port: runtime.port, path: req.url,
    method: req.method, headers: { ...req.headers, host: `127.0.0.1:${runtime.port}` },
  }, incoming => {
    if (incoming.statusCode >= 200 && incoming.statusCode < 300 && onSuccess) {
      try { onSuccess(); }
      catch (error) {
        incoming.destroy();
        return sendJson(res, 507, { error: `Could not persist session routing: ${error.message}` });
      }
    }
    res.writeHead(incoming.statusCode || 502, incoming.headers);
    incoming.pipe(res);
  });
  upstream.on('error', error => { if (!res.headersSent) sendJson(res, 502, { error: error.message }); else res.destroy(error); });
  req.on('aborted', () => upstream.destroy());
  if (buffered) upstream.end(buffered);
  else req.pipe(upstream);
}

async function handle(req, res) {
  if (!token) return sendJson(res, 503, { error: 'CODER_SERVER_TOKEN is required.' });
  const supplied = (req.headers.authorization || '').replace(/^Bearer /i, '');
  const expectedBuffer = Buffer.from(token);
  const suppliedBuffer = Buffer.from(supplied);
  if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    return sendJson(res, 401, { error: 'Unauthorized' });
  }
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/health') {
    await startRuntime(defaultWorkspace);
    return sendJson(res, 200, { status: 'ok' });
  }
  const smallBody = req.method === 'POST' && (url.pathname === '/session' || url.pathname === '/workspaces' || /^\/session\/[^/]+\/load$/.test(url.pathname));
  const buffered = smallBody ? await readSmallBody(req) : null;
  const body = buffered?.length ? JSON.parse(buffered.toString('utf8')) : null;
  if (url.pathname === '/workspaces' && req.method === 'POST') {
    const cwd = await canonicalDirectory(body?.cwd);
    await startRuntime(cwd);
    return sendJson(res, 200, { id: cwd, cwd, primary: cwd === defaultWorkspace, trusted: true, persisted: true });
  }
  const requested = workspaceFromRequest(url.pathname, url, body);
  if (!requested) return sendJson(res, 404, { error: 'Session workspace is unknown. Load the session first.' });
  const cwd = await canonicalDirectory(requested);
  const runtime = await startRuntime(cwd);
  const sessionCreate = url.pathname === '/session' && req.method === 'POST';
  const sessionLoad = /^\/session\/[^/]+\/load$/.test(url.pathname) && req.method === 'POST';
  const sessionId = sessionCreate ? body?.sessionId : sessionLoad ? decodeURIComponent(url.pathname.split('/')[2]) : null;
  proxy(req, res, runtime, buffered, sessionId ? () => saveSessionWorkspace(sessionId, cwd) : undefined);
}

export function startServer() {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  try { sessionWorkspaces = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { sessionWorkspaces = {}; }
  const server = http.createServer((req, res) => {
    handle(req, res).catch(error => {
      if (!res.headersSent) sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      else res.destroy(error);
    });
  });
  const previewServer = http.createServer(proxyPreview);
  previewServer.on('upgrade', proxyPreviewUpgrade);
  server.listen(listenPort, '127.0.0.1');
  previewServer.listen(previewPort, '127.0.0.1');
  const shutdown = () => {
    server.close();
    previewServer.close();
    for (const { child } of runtimes.values()) child.kill('SIGTERM');
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return server;
}

if (process.argv[1] && new URL(import.meta.url).pathname === resolve(process.argv[1])) startServer();
