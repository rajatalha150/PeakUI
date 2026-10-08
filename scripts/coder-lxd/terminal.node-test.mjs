import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { closeTerminals, openTerminal, streamTerminal, terminalInput } from './terminal.mjs';

async function until(check) {
  for (let i = 0; i < 60; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('PTY output did not arrive.');
}

test('interactive shell retains cwd, streams output, accepts input and resize', async () => {
  const id = `test-${process.pid}`;
  const response = new EventEmitter();
  let output = '';
  response.writeHead = status => assert.equal(status, 200);
  response.write = chunk => { output += chunk; return true; };
  response.end = () => {};
  try {
    assert.equal(openTerminal(id, '/tmp', { cols: 80, rows: 24 }).created, true);
    assert.equal(openTerminal(id, '/tmp').created, false);
    assert.throws(() => openTerminal(id, '/workspace'), /workspace mismatch/);
    streamTerminal(id, { headers: {} }, response);
    terminalInput(id, { action: 'write', data: 'printf "PEAKUI_CWD:%s\\n" "$PWD"\n' });
    await until(() => output.includes('PEAKUI_CWD:/tmp'));
    terminalInput(id, { action: 'resize', cols: 100, rows: 30 });
    terminalInput(id, { action: 'write', data: 'cd /workspace\nprintf "PEAKUI_CWD:%s\\n" "$PWD"\n' });
    await until(() => output.includes('PEAKUI_CWD:/workspace'));
    response.emit('close');
  } finally {
    closeTerminals();
  }
});
