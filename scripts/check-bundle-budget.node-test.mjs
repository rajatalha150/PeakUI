import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { measureRoute, scriptPathsFromHtml } from './check-bundle-budget.mjs'

test('entry scripts are deduplicated and lazy chunks are excluded', () => {
  const html = '<script src="/_next/static/chunks/a.js"></script><script src="/_next/static/chunks/a.js"></script><script src="/external.js"></script>'
  assert.deepEqual(scriptPathsFromHtml(html), ['static/chunks/a.js'])
})

test('route size sums individual entry-chunk responses', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'peakui-bundle-'))
  try {
    await mkdir(join(dir, 'server', 'app'), { recursive: true })
    await mkdir(join(dir, 'static', 'chunks'), { recursive: true })
    await writeFile(join(dir, 'server', 'app', 'index.html'), '<script src="/_next/static/chunks/a.js"></script><script src="/_next/static/chunks/b.js"></script>')
    await writeFile(join(dir, 'static', 'chunks', 'a.js'), 'const a = 1;')
    await writeFile(join(dir, 'static', 'chunks', 'b.js'), 'const b = 2;')
    await writeFile(join(dir, 'static', 'chunks', 'lazy.js'), 'const lazy = 3;')
    const result = measureRoute(dir, 'index.html')
    assert.equal(result.files.length, 2)
    assert.equal(result.rawBytes, Buffer.byteLength('const a = 1;const b = 2;'))
    assert.equal(result.gzipBytes, gzipSync('const a = 1;').length + gzipSync('const b = 2;').length)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
