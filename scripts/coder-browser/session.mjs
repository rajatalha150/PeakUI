import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const sessions = new Map();
const queues = new Map();
const root = process.env.CODER_BROWSER_STATE_DIR || '/var/lib/peakui/browser';
const viewports = { desktop: { width: 1280, height: 800 }, tablet: { width: 768, height: 1024 }, mobile: { width: 390, height: 844 } };

export function browserUrl(value) {
  const raw = String(value || '').trim();
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter an HTTP or HTTPS URL.');
  return url.href;
}

async function openSession(id) {
  let session = sessions.get(id);
  if (session?.browser.connected && !session.page.isClosed()) return session;
  if (session) { await session.browser.close().catch(() => {}); sessions.delete(id); }
  if (sessions.size >= 8) throw new Error('Browser capacity reached. Close an idle preview and retry.');
  const require = createRequire(new URL('./package.json', import.meta.url));
  const { default: puppeteer } = await import(require.resolve('puppeteer'));
  const profile = join(root, createHash('sha256').update(id).digest('hex'));
  await mkdir(profile, { recursive: true, mode: 0o700 });
  const browser = await puppeteer.launch({ headless: true, userDataDir: profile,
    args: ['--no-sandbox', '--disable-dev-shm-usage'], defaultViewport: viewports.desktop });
  session = { browser, page: null, entries: [], lastUsed: Date.now(), device: 'desktop', profile, savedUrl: '' };
  const attach = async page => {
    if (!page || page === session.page) return;
    session.page = page;
    await page.setViewport(viewports[session.device]);
    const add = (level, message) => {
      session.entries.push({ level, message: `${new Date().toISOString()} ${String(message).slice(0, 2000)}` });
      if (session.entries.length > 160) session.entries.shift();
    };
    page.on('console', msg => add('console', `[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', error => add('pageerror', error.message));
    page.on('requestfailed', req => add('requestfailed', `${req.url()} ${req.failure()?.errorText}`));
    page.on('response', response => { if (response.status() >= 400) add('response', `HTTP ${response.status()} ${response.url()}`); });
    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
  };
  await attach((await browser.pages())[0] || await browser.newPage());
  browser.on('targetcreated', target => { if (target.type() === 'page') target.page().then(attach).catch(() => {}); });
  browser.on('disconnected', () => { if (sessions.get(id) === session) sessions.delete(id); });
  sessions.set(id, session);
  try {
    const saved = JSON.parse(await readFile(join(profile, 'peakui-page.json'), 'utf8'));
    session.navigationId = saved.navigationId;
    session.requestedUrl = saved.requestedUrl;
    if (saved.url) await session.page.goto(browserUrl(saved.url), { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch { /* A new profile or an unavailable previous site must still allow navigation. */ }
  return session;
}

async function execute(id, input) {
  if (input.action === 'close') {
    await sessions.get(id)?.browser.close();
    sessions.delete(id);
    return { ok: true };
  }
  const session = await openSession(id);
  session.lastUsed = Date.now();
  const page = session.page;
  const action = input.action || 'frame';
  if (input.device && input.device !== session.device) {
    if (!viewports[input.device]) throw new Error('Unknown viewport.');
    await page.setViewport(viewports[input.device]);
    session.device = input.device;
  }
  if (action === 'navigate') {
    const target = browserUrl(input.url);
    if (input.navigationId === undefined || session.navigationId !== input.navigationId || session.requestedUrl !== target) {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
      session.navigationId = input.navigationId;
      session.requestedUrl = target;
      session.savedUrl = '';
    }
  }
  else if (action === 'reload') await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  else if (action === 'back') await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 });
  else if (action === 'forward') await page.goForward({ waitUntil: 'domcontentloaded', timeout: 30000 });
  else if (action === 'pointer') {
    const { width, height } = viewports[session.device];
    const x = Math.max(0, Math.min(width - 1, Number(input.x) || 0));
    const y = Math.max(0, Math.min(height - 1, Number(input.y) || 0));
    await page.mouse.move(x, y);
    if (input.event === 'down') await page.mouse.down({ button: 'left' });
    else if (input.event === 'up') await page.mouse.up({ button: 'left' });
  } else if (action === 'scroll') await page.mouse.wheel({ deltaX: Math.max(-2000, Math.min(2000, Number(input.deltaX) || 0)), deltaY: Math.max(-2000, Math.min(2000, Number(input.deltaY) || 0)) });
  else if (action === 'text') await page.keyboard.sendCharacter(String(input.text || '').slice(0, 20000));
  else if (action === 'key') {
    const modifiers = (Array.isArray(input.modifiers) ? input.modifiers : []).filter(key => ['Control', 'Alt', 'Shift', 'Meta'].includes(key));
    try {
      for (const modifier of modifiers) await page.keyboard.down(modifier);
      await page.keyboard.press(String(input.key));
    } finally { for (const modifier of modifiers.reverse()) await page.keyboard.up(modifier); }
  } else if (!['frame', 'screenshot', 'diagnostics'].includes(action)) throw new Error('Unknown browser action.');
  const activePage = session.page;
  const currentUrl = activePage.url();
  if (/^https?:/.test(currentUrl) && session.savedUrl !== currentUrl) {
    await writeFile(join(session.profile, 'peakui-page.json'), JSON.stringify({ url: currentUrl, navigationId: session.navigationId, requestedUrl: session.requestedUrl }), { mode: 0o600 });
    session.savedUrl = currentUrl;
  }
  const editable = await activePage.evaluate(() => {
    const el = document.activeElement;
    return !!el && (el.matches('input:not([type=button]):not([type=checkbox]):not([type=radio]),textarea') || el.isContentEditable);
  }).catch(() => false);
  const result = { url: currentUrl, editable, ...viewports[session.device], entries: session.entries };
  if (action === 'frame' || action === 'screenshot') {
    result.data = await activePage.screenshot({ type: 'jpeg', quality: action === 'frame' ? 70 : 90, encoding: 'base64' });
    result.mimeType = 'image/jpeg';
  }
  return result;
}

// Serialize input and captures so clicks, typing, resize and Vision see one page state.
export function browserAction(id, input) {
  const previous = queues.get(id) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => execute(id, input));
  queues.set(id, next);
  return next.finally(() => { if (queues.get(id) === next) queues.delete(id); });
}

const idle = setInterval(() => {
  for (const [id, session] of sessions) {
    if (Date.now() - session.lastUsed > 20 * 60_000 && !queues.has(id)) void browserAction(id, { action: 'close' }).catch(() => {});
  }
}, 60000);
idle.unref();

export async function closeBrowsers() {
  await Promise.allSettled([...sessions.values()].map(session => session.browser.close()));
  sessions.clear();
}
