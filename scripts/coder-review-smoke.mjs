/** Authenticated API and browser regression checks using disposable fixtures. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { Client } from 'pg';
import { SignJWT } from 'jose';
import { chromium } from 'playwright-core';

const base = new URL(process.argv[2] || 'http://127.0.0.1:3107');
assert(['127.0.0.1', 'localhost'].includes(base.hostname), 'Smoke target must be local');
assert(process.env.JWT_SECRET?.length >= 32, 'A configured JWT_SECRET is required');
const db = new Client({ connectionString: process.env.DATABASE_URL });
const users = [];
const sessions = [];
const checks = [];
const filename = `coder-review-${randomUUID()}.txt`;
const path = `/workspace/${filename}`;
const artifacts = process.env.CODER_REVIEW_ARTIFACTS || '/tmp/peakui-coder-review';
let browser;
let admin;
let daemon;
let fixtureCreated = false;

async function request(user, route, method = 'GET', body, extraHeaders = {}) {
  const response = await fetch(new URL(route, base), {
    method, headers: { cookie: `auth_token=${user.token}`, 'Content-Type': 'application/json', ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 200); }
  return { status: response.status, data };
}

async function account(role) {
  const id = randomUUID();
  const username = `coder-review-${id}`;
  await db.query('INSERT INTO "User" (id, username, "passwordHash", role) VALUES ($1,$2,$3,$4)', [id, username, 'disabled-smoke-account', role]);
  const token = await new SignJWT({ username, role, tokenVersion: 0, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(id).setIssuer('peakui')
    .setAudience('peakui-app').setIssuedAt().setExpirationTime('20m')
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
  const user = { id, token };
  users.push(user);
  return user;
}

try {
  await db.connect();
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  admin = await account('ADMIN');
  const peer = await account('ADMIN');
  const standard = await account('USER');
  const ready = await request(admin, '/api/coder/readiness');
  assert.equal(ready.status, 200, JSON.stringify(ready));
  for (const route of ['/api/coder/health', '/api/coder/workspace/settings', '/api/coder/file?path=%2Fworkspace%2FQWEN.md']) {
    assert.equal((await request(standard, route)).status, 403);
  }
  checks.push('readiness and shared-runtime authorization');
  const created = await request(admin, '/api/chats', 'POST', { title: 'Disposable coder review', surface: 'coder', messages: [] });
  assert.equal(created.status, 201, JSON.stringify(created));
  const sid = created.data.session.id;
  sessions.push(sid);
  assert.equal((await request(peer, `/api/coder/session/${sid}/status`)).status, 404);
  assert.equal((await request(admin, '/api/coder/session', 'POST', {})).status, 400);
  assert.equal((await request(admin, '/api/coder/session', 'POST', { sessionId: sid, cwd: '/workspace' }, { origin: 'https://untrusted.example' })).status, 403);
  const started = await request(admin, '/api/coder/session', 'POST', { sessionId: sid, cwd: '/workspace' });
  assert.equal(started.status, 200, JSON.stringify(started));
  daemon = started.data;
  assert.equal((await request(admin, '/api/coder/session', 'POST', { sessionId: sid, cwd: '/apps' })).status, 409);
  await request(admin, '/api/chats', 'PATCH', { id: sid, surface: 'coder', coderWorkspace: '/apps' });
  assert.equal((await request(admin, `/api/chats/${sid}`)).data.coderWorkspace, '/workspace');
  checks.push('session ownership, origin validation and immutable workspace binding');

  const root = '/api/coder/workspaces/%2Fworkspace';
  const write = await request(admin, `${root}/file/write`, 'POST', { path, mode: 'create', content: 'review fixture alpha\n' });
  fixtureCreated = write.status === 201 || write.status === 200;
  assert(fixtureCreated, JSON.stringify(write));
  const read = await request(admin, `${root}/file?path=${encodeURIComponent(path)}`);
  assert.equal(read.status, 200, JSON.stringify(read));
  const firstHash = read.data.hash;
  const replace = await request(admin, `${root}/file/write`, 'POST', { path, mode: 'replace', expectedHash: firstHash, content: 'review fixture beta\n' });
  assert.equal(replace.status, 200, JSON.stringify(replace));
  const conflict = await request(admin, `${root}/file/write`, 'POST', { path, mode: 'replace', expectedHash: firstHash, content: 'stale overwrite\n' });
  assert(conflict.status >= 400, 'Stale file write must fail');
  const glob = await request(admin, `${root}/glob?pattern=${encodeURIComponent(filename)}&maxResults=10`);
  assert.equal(glob.status, 200, JSON.stringify(glob));
  assert(glob.data.matches.includes(filename), JSON.stringify(glob.data));
  checks.push('real daemon file read/write, compare-and-swap conflict, scoped glob');

  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  await context.addCookies([{ name: 'auth_token', value: admin.token, url: base.origin, httpOnly: true, sameSite: 'Lax' }]);
  await context.addInitScript(id => localStorage.setItem('peakui-coder-active-session', id), sid);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(30_000);
  await page.goto(new URL('/coder', base).href, { waitUntil: 'domcontentloaded' });
  await page.getByText('daemon online', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await page.getByText(filename, { exact: true }).first().click();
  const editor = page.locator('.monaco-editor textarea').first();
  await editor.waitFor({ state: 'visible', timeout: 60_000 });
  await page.locator('.monaco-editor').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('browser edited fixture', { delay: 25 });
  await page.keyboard.press('Enter');
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await save.waitFor({ state: 'visible' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent?.trim() === 'Save' && !b.disabled));
  await save.click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent?.trim() === 'Save' && b.disabled));
  const saved = await request(admin, `${root}/file?path=${encodeURIComponent(path)}`);
  assert.equal(saved.data.content, 'browser edited fixture\n');
  await page.screenshot({ path: `${artifacts}/desktop-editor.png`, fullPage: true });
  checks.push('Monaco load, editing and authenticated save');
  await page.getByRole('button', { name: 'Search', exact: true }).first().click();
  const search = page.getByPlaceholder('case-insensitive substring');
  // Input text is a product detail; fall back to the search pane input if renamed.
  const searchInput = await search.count() ? search : page.locator('input[placeholder*="Search"]').first();
  await searchInput.fill('browser edited fixture');
  await searchInput.press('Enter');
  await page.getByText('browser edited fixture', { exact: true }).first().waitFor();
  checks.push('workspace search through real gateway');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${artifacts}/mobile-editor.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Page overflows mobile viewport');
  assert.deepEqual(errors, [], 'Browser runtime errors');
  checks.push('desktop/mobile browser rendering without runtime errors');
  await context.close();
  console.log(JSON.stringify({ ok: true, checks, artifacts }, null, 2));
} finally {
  await browser?.close();
  if (fixtureCreated && admin && daemon?.sessionId) {
    const cleanup = await request(admin, `/api/coder/session/${daemon.sessionId}/shell`, 'POST', { command: `rm -- '${path}'` }, { 'x-qwen-client-id': daemon.clientId });
    if (cleanup.status !== 200) console.error('Fixture file cleanup failed:', cleanup.status);
  }
  if (admin) for (const sid of sessions) {
    await request(admin, `/api/coder/session/${sid}`, 'DELETE').catch(() => {});
  }
  for (const user of users) {
    await db.query('DELETE FROM "User" WHERE id=$1', [user.id]);
  }
  await db.end();
}
