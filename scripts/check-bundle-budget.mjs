#!/usr/bin/env node
/** Check the JavaScript loaded by each public entry page, not every lazy chunk. */

import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const BUILD_DIR = join(process.cwd(), '.next')
const ROUTES = [
  ['/', 'index.html'],
  ['/coder', 'coder.html'],
  ['/login', 'login.html'],
]

// The original budget was set for first-load JS. Keep it while changing the
// measurement from all generated chunks to those referenced by each page.
const BUDGET = { rawBytes: 3_500_000, gzipBytes: 1_200_000 }

export function scriptPathsFromHtml(html) {
  const paths = new Set()
  for (const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
    const pathname = new URL(match[1], 'http://localhost').pathname
    if (pathname.startsWith('/_next/static/chunks/') && pathname.endsWith('.js')) {
      paths.add(pathname.slice('/_next/'.length))
    }
  }
  return [...paths]
}

export function measureRoute(buildDir, htmlFile) {
  const html = readFileSync(join(buildDir, 'server', 'app', htmlFile), 'utf8')
  const files = scriptPathsFromHtml(html)
  if (!files.length) throw new Error(`No entry scripts found in ${htmlFile}`)
  return {
    files,
    rawBytes: files.reduce((total, file) => total + statSync(join(buildDir, file)).size, 0),
    // Each chunk is served as its own compressed response.
    gzipBytes: files.reduce((total, file) => total + gzipSync(readFileSync(join(buildDir, file))).length, 0),
  }
}

function main() {
  let failed = false
  for (const [route, htmlFile] of ROUTES) {
    const { files, rawBytes, gzipBytes } = measureRoute(BUILD_DIR, htmlFile)
    const over = rawBytes > BUDGET.rawBytes || gzipBytes > BUDGET.gzipBytes
    failed ||= over
    console.log(`${route}: ${files.length} entry chunks, ${rawBytes.toLocaleString()} bytes raw, ${gzipBytes.toLocaleString()} bytes gzip${over ? ' OVER BUDGET' : ''}`)
  }
  console.log(`Per-route budget: ${BUDGET.rawBytes.toLocaleString()} raw / ${BUDGET.gzipBytes.toLocaleString()} gzip bytes`)
  if (failed) process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main()
  } catch (error) {
    console.error(`bundle:check: ${error.message}. Run npm run build first.`)
    process.exitCode = 1
  }
}
