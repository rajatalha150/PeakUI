import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { browserAction, browserUrl, closeBrowsers } from './session.mjs';

test('browser URLs preserve guest loopback, default ports and private sites', () => {
  assert.equal(browserUrl('localhost:80'), 'http://localhost/');
  assert.equal(browserUrl('https://localhost:443'), 'https://localhost/');
  assert.equal(browserUrl('http://192.168.1.2:3000'), 'http://192.168.1.2:3000/');
  assert.throws(() => browserUrl('file:///etc/passwd'));
  assert.throws(() => browserUrl('https://user:password@example.com'));
});

test('guest browser shares interaction, screenshots, logs and persistent storage', { skip: !process.env.CODER_BROWSER_INTEGRATION }, async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: '/app' }); res.end(); return; }
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('X-Frame-Options', 'DENY');
    res.end('<html><body style="background:rgb(0,128,0)"><input autofocus><script>console.log("guest-test",localStorage.getItem("typed"));document.querySelector("input").focus();document.querySelector("input").value=localStorage.getItem("typed")||"";document.querySelector("input").oninput=e=>localStorage.setItem("typed",e.target.value)</script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/redirect`;
  const id = `integration-${Date.now()}`;
  try {
    const navigation = await browserAction(id, { action: 'navigate', url, navigationId: 1 });
    assert.match(navigation.url, /\/app$/);
    await browserAction(id, { action: 'text', text: 'shared-state' });
    const desktop = await browserAction(id, { action: 'screenshot' });
    assert.equal(desktop.width, 1280);
    assert.ok(Buffer.from(desktop.data, 'base64').length > 1000);
    assert.ok(desktop.entries.some(entry => entry.message.includes('guest-test')));
    const before = desktop.entries.filter(entry => entry.message.includes('guest-test')).length;
    const reopened = await browserAction(id, { action: 'navigate', url, navigationId: 1 });
    assert.equal(reopened.entries.filter(entry => entry.message.includes('guest-test')).length, before, 'reopening popup must not reload');
    await browserAction(id, { action: 'pointer', event: 'down', x: 20, y: 20 });
    assert.equal((await browserAction(id, { action: 'pointer', event: 'up', x: 20, y: 20 })).editable, true);
    await browserAction(id, { action: 'key', key: 'End' });
    await browserAction(id, { action: 'key', key: 'ArrowLeft' });
    await browserAction(id, { action: 'key', key: 'Backspace' });
    await browserAction(id, { action: 'text', text: 'X' });
    const edited = await browserAction(id, { action: 'navigate', url, navigationId: 2 });
    assert.ok(edited.entries.some(entry => entry.message.includes('shared-staXe')), 'arrow, backspace and typed text must edit the same input');
    const mobile = await browserAction(id, { action: 'frame', device: 'mobile' });
    assert.equal(mobile.width, 390);
    assert.equal(mobile.url, navigation.url);
    await browserAction(id, { action: 'close' });
    const frame = await browserAction(id, { action: 'frame' });
    assert.equal(frame.url, navigation.url, 'reconnecting restores the last page');
    assert.ok(frame.data);
    assert.ok(frame.entries.some(entry => entry.message.includes('shared-staXe')), 'typed state must survive browser restart');
    const other = await browserAction(`${id}-other`, { action: 'navigate', url });
    assert.ok(!other.entries.some(entry => entry.message.includes('shared-staXe')), 'profiles must be isolated');
  } finally {
    await closeBrowsers();
    await new Promise(resolve => server.close(resolve));
  }
});
