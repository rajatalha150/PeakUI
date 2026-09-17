#!/usr/bin/env node
/**
 * verify-site.mjs — real-browser smoke check for a static site.
 *
 * Serves the given directory over loopback and drives it with headless Chrome
 * (via the puppeteer install baked into this container at
 * /opt/qwen-code/browser). Emits a JSON report of title/h1/landmarks/errors and
 * writes light/dark screenshots. Exits non-zero if the page logged any error.
 *
 * Usage: node verify-site.mjs <site-dir> [port]
 *
 * This is the committed replacement for the ad-hoc /tmp harness the agent used
 * to write by hand every session; it lives here so a fresh VM has it and it
 * survives image resets. ESM resolves `puppeteer` relative to THIS file, so it
 * must stay co-located with the harness node_modules (see Dockerfile.coder).
 */
import puppeteer from 'puppeteer';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] ?? '/workspace/site');
const PORT = Number(process.argv[3] ?? 0);

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  // A 1x1 transparent GIF for the browser's automatic /favicon.ico request, so
  // it never 404s and the console stays clean (404 noise is not a site failure).
  if (p === '/favicon.ico') {
    const GIF = Buffer.from('R0lGODlhAQABAAAAACwAAAAAAQABAAA=', 'base64');
    res.writeHead(200, { 'content-type': 'image/x-icon', 'content-length': GIF.length });
    res.end(GIF);
    return;
  }
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('404');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));

try {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });
  await new Promise((r) => setTimeout(r, 800));

  const info = await page.evaluate(() => ({
    title: document.title,
    h1: document.querySelector('h1')?.textContent?.trim(),
    skipLink: !!document.querySelector('a[href^="#"]'),
    landmarks: {
      header: !!document.querySelector('header'),
      main: !!document.querySelector('main'),
      footer: !!document.querySelector('footer'),
    },
    bodyText: document.body.innerText.replace(/\s+/g, ' ').slice(0, 200),
  }));

  await page.screenshot({ path: '/tmp/verify-light.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: '/tmp/verify-dark.png' });

  console.log(JSON.stringify({
    url,
    info,
    errors,
    shots: ['/tmp/verify-light.png', '/tmp/verify-dark.png'],
  }, null, 2));
} finally {
  await browser.close();
  server.close();
}

process.exit(errors.length ? 1 : 0);
