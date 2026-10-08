import { createRequire } from 'node:module';

const require = createRequire('/opt/qwen-code/package.json');
const terminals = new Map();
const MAX_HISTORY = 1024 * 1024;
const MAX_TERMINALS = 24;

function dimensions(value, fallback, max) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, max) : fallback;
}

function publish(terminal, type, data) {
  const item = { id: ++terminal.sequence, type, data };
  terminal.history.push(item);
  terminal.historyBytes += Buffer.byteLength(data);
  while ((terminal.historyBytes > MAX_HISTORY || terminal.history.length > 4096) && terminal.history.length > 1) {
    terminal.historyBytes -= Buffer.byteLength(terminal.history.shift().data);
  }
  const frame = `id: ${item.id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const viewer of terminal.viewers) {
    if (!viewer.write(frame)) {
      terminal.viewers.delete(viewer);
      viewer.end();
    }
  }
}

export function openTerminal(id, cwd, options = {}) {
  const existing = terminals.get(id);
  if (existing && existing.cwd !== cwd) throw new Error('Terminal workspace mismatch.');
  if (existing && !existing.exited) return { created: false, cwd };
  for (const [key, terminal] of terminals) if (terminal.exited && key !== id) terminals.delete(key);
  if (terminals.size >= MAX_TERMINALS && !existing) throw new Error('Terminal capacity reached.');
  const pty = require('@lydell/node-pty');
  const shell = pty.spawn('/bin/bash', ['-l'], {
    name: 'xterm-256color', cols: dimensions(options.cols, 80, 400),
    rows: dimensions(options.rows, 24, 200), cwd,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', PWD: cwd },
  });
  const terminal = { shell, cwd, sequence: 0, history: [], historyBytes: 0, viewers: new Set(), exited: false };
  terminals.set(id, terminal);
  shell.onData(data => publish(terminal, 'output', data));
  shell.onExit(({ exitCode }) => {
    terminal.exited = true;
    publish(terminal, 'exit', String(exitCode));
  });
  return { created: true, cwd };
}

export function terminalInput(id, input) {
  const terminal = terminals.get(id);
  if (!terminal || terminal.exited) throw new Error('Terminal is not running.');
  if (input.action === 'write') {
    if (typeof input.data !== 'string' || Buffer.byteLength(input.data) > 65536) throw new Error('Invalid terminal input.');
    terminal.shell.write(input.data);
  } else if (input.action === 'resize') {
    terminal.shell.resize(dimensions(input.cols, 80, 400), dimensions(input.rows, 24, 200));
  } else if (input.action === 'close') {
    terminal.shell.kill();
  } else throw new Error('Unknown terminal action.');
}

export function streamTerminal(id, req, res) {
  const terminal = terminals.get(id);
  if (!terminal) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Terminal is not running.' }));
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const lastId = Number(req.headers['last-event-id'] || 0);
  for (const item of terminal.history) {
    if (item.id > lastId) res.write(`id: ${item.id}\nevent: ${item.type}\ndata: ${JSON.stringify(item.data)}\n\n`);
  }
  terminal.viewers.add(res);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
  res.on('close', () => { clearInterval(heartbeat); terminal.viewers.delete(res); });
}

export function closeTerminals() {
  for (const terminal of terminals.values()) if (!terminal.exited) terminal.shell.kill();
  terminals.clear();
}

export function closeTerminal(id) {
  const terminal = terminals.get(id);
  if (!terminal) return;
  terminals.delete(id);
  if (!terminal.exited) terminal.shell.kill();
  for (const viewer of terminal.viewers) viewer.end();
  terminal.viewers.clear();
}
