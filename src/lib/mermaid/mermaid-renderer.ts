import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { NormalizedMermaidDocument } from './mermaid-schema'

const execFileAsync = promisify(execFile)

/**
 * Render a Mermaid diagram to SVG (or PNG).
 *
 * Tries `@mermaid-js/mermaid-cli` (mmdc) first. If mmdc is not installed
 * (no Chrome / Puppeteer binaries), fall back to a static SVG envelope that
 * carries the diagram source so the client-side Mermaid renderer can produce
 * a proper diagram. This keeps the API stable even on hosts without Chrome.
 */
export async function renderMermaidDocument(document: NormalizedMermaidDocument): Promise<Buffer> {
  if (document.format === 'png') {
    const svg = await renderMermaidSvg(document)
    return rasterizePlaceholder(svg)
  }
  return await renderMermaidSvg(document)
}

async function renderMermaidSvg(document: NormalizedMermaidDocument): Promise<Buffer> {
  const rendered = await tryMermaidCli(document)
  if (rendered) return rendered
  return Buffer.from(buildPlaceholderSvg(document), 'utf8')
}

/**
 * Path to a Puppeteer config that tells mmdc to use the system Chromium
 * binary instead of trying to download its own (which fails in the
 * container because of network restrictions during puppeteer install).
 *
 * If the file is missing mmdc falls back to its default behavior and the
 * placeholder SVG is used.
 */
const PUPPETEER_CONFIG_PATH = '/tmp/peakui-mermaid-puppeteer-config.json'

async function ensurePuppeteerConfig(): Promise<string | null> {
  const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    || process.env.PUPPETEER_EXECUTABLE_PATH
    || '/usr/bin/chromium-browser'

  const config = {
    executablePath: chromiumPath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  }

  try {
    await writeFile(PUPPETEER_CONFIG_PATH, JSON.stringify(config), 'utf8')
    return PUPPETEER_CONFIG_PATH
  } catch {
    return null
  }
}

async function tryMermaidCli(document: NormalizedMermaidDocument): Promise<Buffer | null> {
  let workdir: string | null = null
  try {
    workdir = await mkdtemp(join(tmpdir(), 'peakui-mermaid-'))
    const inputPath = join(workdir, 'input.mmd')
    const outputPath = join(workdir, `output.${document.format}`)
    await writeFile(inputPath, document.diagram, 'utf8')

    const mmdcBin = await resolveMmdcBinary()
    if (!mmdcBin) return null

    const puppeteerConfig = await ensurePuppeteerConfig()
    const args = [
      '-i', inputPath,
      '-o', outputPath,
      '-t', document.theme,
      '-b', document.backgroundColor,
    ]
    if (puppeteerConfig) {
      args.push('-p', puppeteerConfig)
    }

    await execFileAsync(mmdcBin, args, { timeout: 45_000 })

    const output = await readFile(outputPath)
    if (output.length === 0) return null
    return Buffer.from(output)
  } catch {
    return null
  } finally {
    if (workdir) {
      await rm(workdir, { recursive: true, force: true }).catch(() => {})
    }
    rm(PUPPETEER_CONFIG_PATH, { force: true }).catch(() => {})
  }
}

async function resolveMmdcBinary(): Promise<string | null> {
  const candidates = [
    'mmdc',
    join(process.cwd(), 'node_modules', '.bin', 'mmdc'),
    '/usr/local/bin/mmdc',
    '/usr/bin/mmdc',
  ]
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ['--version'], { timeout: 4_000 })
      return candidate
    } catch {
      // not installed at this path
    }
  }
  return null
}

function rasterizePlaceholder(_svg: Buffer): Buffer {
  // PNG fallback: reuse the placeholder SVG; downstream consumers will treat
  // it as binary. For higher fidelity install mmdc.
  return _svg
}

function buildPlaceholderSvg(document: NormalizedMermaidDocument): string {
  const titleEscaped = document.title.replace(/[<&>]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
  const bg = document.backgroundColor || 'white'
  const sourceLines = document.diagram.split('\n').slice(0, 40)
  const lineHeight = 18
  const startY = 100
  const tspan = sourceLines.map((line, index) => {
    const safe = line.replace(/[<&>]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
    return `<text x="40" y="${startY + index * lineHeight}" font-family="monospace" font-size="14" fill="#0F172A">${safe || ' '}</text>`
  }).join('')

  // The fallback SVG now actually looks like a diagram outline: title bar
  // at top, a labelled "Diagram source" panel with a border, and the raw
  // .mmd code formatted so it's clearly readable. Previously the placeholder
  // looked like a blank canvas with a title — which made Mermaid artifacts
  // appear "broken" to the user even though the artifact itself was valid.
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="520" viewBox="0 0 720 520">
  <rect width="720" height="520" fill="${bg}" />
  <rect x="0" y="0" width="720" height="56" fill="#1E3A8A" />
  <text x="24" y="36" fill="#FFFFFF" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="700">${titleEscaped}</text>
  <text x="24" y="86" fill="#0F172A" font-family="Helvetica, Arial, sans-serif" font-size="14" font-weight="700">Mermaid diagram source</text>
  <text x="24" y="106" fill="#475569" font-family="Helvetica, Arial, sans-serif" font-size="12">Server-side rendering unavailable — preview the source below, or click "Re-render" to retry.</text>
  <rect x="20" y="118" width="680" height="${Math.max(80, sourceLines.length * lineHeight + 24)}" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1" rx="6" />
  ${tspan}
  <text x="24" y="${520 - 16}" fill="#94A3B8" font-family="Helvetica, Arial, sans-serif" font-size="11">format: ${document.format} · theme: ${document.theme}</text>
</svg>`
}
