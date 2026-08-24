#!/usr/bin/env node
/**
 * Bundle budget gate.
 *
 * Measures the JavaScript the browser must download and parse before the app
 * boots, and fails the build when it exceeds a hard budget. This is the same
 * guard Unsloth uses to stop a single accidental static import (e.g. a dialog
 * that is closed on load) from silently carrying megabytes into the entry
 * bundle.
 *
 * PeakUI ships several heavy client libraries (react-syntax-highlighter,
 * react-markdown, mermaid, exceljs, docx, pptxgenjs, xlsx-populate, mammoth,
 * officeparser) that are only needed for specific panels/artifacts. If any of
 * them is statically imported into the main chat bundle, first-load time
 * balloons. This gate catches that regression automatically.
 *
 * Run after `next build`:  npm run bundle:check
 *
 * The budget is the sum of every `.js` chunk in `.next/static/chunks`. It is
 * deliberately sized with headroom over the measured baseline so a normal
 * build never trips it, but a multi-megabyte accidental import does.
 *
 * Raising the budget is a normal thing to do — but do it in the same change as
 * the import that needed it, with the measured numbers, so the regression is
 * visible in the diff.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const CHUNKS_DIR = join(process.cwd(), '.next', 'static', 'chunks')

// Measured baseline (2026-08-24): 2,342,433 bytes raw / 686,680 bytes gzip
// across 17 chunks. Budget is ~1.5x raw and ~1.75x gzip for headroom.
const BUDGET = {
  rawBytes: 3_500_000,
  gzipBytes: 1_200_000,
}

function listJsChunks(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    console.error(`bundle:check: no build output at ${dir}. Run \`npm run build\` first.`)
    process.exit(1)
  }
  return entries.filter(name => name.endsWith('.js')).map(name => join(dir, name))
}

function main() {
  const files = listJsChunks(CHUNKS_DIR)
  let rawBytes = 0
  const sizes = []
  for (const file of files) {
    const size = statSync(file).size
    rawBytes += size
    sizes.push({ file: file.split('/').pop(), size })
  }
  const gzipBytes = gzipSync(Buffer.concat(files.map(f => readFileSync(f)))).length

  const rawOver = rawBytes > BUDGET.rawBytes
  const gzipOver = gzipBytes > BUDGET.gzipBytes

  console.log(`bundle:check: ${files.length} JS chunks`)
  console.log(`  raw:   ${rawBytes.toLocaleString()} bytes (budget ${BUDGET.rawBytes.toLocaleString()})${rawOver ? '  OVER' : ''}`)
  console.log(`  gzip:  ${gzipBytes.toLocaleString()} bytes (budget ${BUDGET.gzipBytes.toLocaleString()})${gzipOver ? '  OVER' : ''}`)

  const top = sizes.sort((a, b) => b.size - a.size).slice(0, 5)
  console.log('  largest chunks:')
  for (const { file, size } of top) {
    console.log(`    ${size.toLocaleString().padStart(9)}  ${file}`)
  }

  if (rawOver || gzipOver) {
    console.error('\nbundle:check: FAILED — the JavaScript bundle exceeds its budget.')
    console.error('A static import is likely pulling a heavy library into the entry bundle.')
    console.error('Convert it to a dynamic import() (or lazy-load the component) and re-measure.')
    process.exit(1)
  }

  console.log('bundle:check: OK')
}

main()
