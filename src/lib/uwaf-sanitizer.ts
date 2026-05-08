import TurndownService from 'turndown'

const BLOCKED_EXTENSIONS = [
  '.exe', '.sh', '.bin', '.bat', '.cmd', '.msi', '.dll', '.so', '.dmg',
  '.app', '.deb', '.rpm', '.apk', '.jar', '.war', '.iso', '.img',
]

const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid',
  'mc_eid', 'mc_cid', '_ga', '_gl', '_hsenc', '_hsmi',
  'vero_id', 'oly_anon_id', 'oly_enc_id', 'otc',
  'ref', 'referrer', 'source', 's_cid',
]

const AD_DOMAINS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'google-analytics.com', 'facebook.com/tr', 'ads.yahoo.com',
  'amazon-adsystem.com', 'adnxs.com', 'adsrvr.org',
]

const REMOVE_TAGS = [
  'script', 'style', 'noscript', 'iframe', 'svg', 'nav', 'footer',
  'aside', 'header', 'form', 'button', 'input', 'textarea', 'select',
]

const NOISE_CLASSES = [
  'ad', 'ads', 'advertisement', 'banner', 'sidebar', 'widget',
  'popup', 'modal', 'overlay', 'cookie', 'subscribe', 'newsletter',
  'social-share', 'share-buttons', 'related-posts', 'comments',
]

export interface SanitizeOptions {
  strict?: boolean
  maxTextLength?: number
  preserveTables?: boolean
}

export interface ExtractedTable {
  headers: string[]
  rows: string[][]
  markdown: string
  csv: string
}

export function pruneHtml(html: string, options: SanitizeOptions = {}): string {
  let cleaned = html

  for (const tag of REMOVE_TAGS) {
    cleaned = cleaned.replace(new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, 'gi'), '')
    cleaned = cleaned.replace(new RegExp(`<${tag}[^>]*\\/?>`, 'gi'), '')
  }

  if (options.strict) {
    cleaned = cleaned.replace(/\s+(style|class|id|data-[a-z-]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    cleaned = cleaned.replace(/<link[^>]*>/gi, '')
    cleaned = cleaned.replace(/<meta[^>]*>/gi, '')
    cleaned = cleaned.replace(/on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  } else {
    cleaned = cleaned.replace(/class\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    cleaned = cleaned.replace(/id\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
  }

  cleaned = cleaned.replace(/<img[^>]*>/gi, (match) => {
    const src = match.match(/src\s*=\s*["']([^"']+)["']/)?.[1]
    const alt = match.match(/alt\s*=\s*["']([^"']+)["']/)?.[1] || ''
    return src ? `[Image${alt ? `: ${alt}` : ''}](${src})` : ''
  })

  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '')

  cleaned = cleaned.replace(/<br\s*\/?>/gi, '\n')
  cleaned = cleaned.replace(/<\/?(p|div|section|article|main|li|h[1-6])[^>]*>/gi, '\n')
  cleaned = cleaned.replace(/<hr[^>]*>/gi, '\n---\n')

  return cleaned
}

export function filterReadableContent(html: string): string {
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)

  if (mainMatch) return mainMatch[1]
  if (articleMatch) return articleMatch[1]

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const source = bodyMatch ? bodyMatch[1] : html

  const blocks = source.split(/<\/?(div|section|p|blockquote)[^>]*>/i)
  const scored = blocks.map(block => {
    const text = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (text.length < 40) return { text, score: -10 }

    let score = text.length * 0.5
    score += (text.match(/,/g) || []).length * 2
    score -= (text.match(/https?:\/\//g) || []).length * 5

    const noisePatterns = /\b(copyright|all rights reserved|privacy policy|terms of use|cookie policy|advertisement|sponsored|subscribe|sign up)\b/i
    if (noisePatterns.test(text)) score -= 30

    return { text, score }
  })

  let bestStart = 0
  let bestEnd = 0
  let bestScore = 0
  let currentStart = 0
  let currentScore = 0

  for (let i = 0; i < scored.length; i++) {
    if (scored[i].score < 0) {
      if (currentScore > bestScore) {
        bestScore = currentScore
        bestStart = currentStart
        bestEnd = i
      }
      currentScore = 0
      currentStart = i + 1
      continue
    }
    currentScore += scored[i].score
    if (currentScore > bestScore) {
      bestScore = currentScore
      bestStart = currentStart
      bestEnd = i + 1
    }
  }

  if (currentScore > bestScore) {
    bestEnd = scored.length
  }

  return scored.slice(bestStart, bestEnd).map(s => s.text).join('\n\n')
}

export function extractTables(html: string): ExtractedTable[] {
  const tables: ExtractedTable[] = []
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi
  let tableMatch: RegExpExecArray | null

  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableHtml = tableMatch[1]

    const headerCells = Array.from(
      tableHtml.match(/<th[^>]*>([\s\S]*?)<\/th>/gi) || [],
      m => m.replace(/<[^>]+>/g, '').trim()
    )

    const rows: string[][] = []
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    let rowMatch: RegExpExecArray | null

    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const cells = Array.from(
        rowMatch[1].match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [],
        m => m.replace(/<[^>]+>/g, '').trim()
      )
      if (cells.length > 0) rows.push(cells)
    }

    if (rows.length === 0) continue

    const headers = headerCells.length > 0 ? headerCells : rows[0]
    const dataRows = headerCells.length > 0 ? rows : rows.slice(1)

    const maxCols = Math.max(headers.length, ...dataRows.map(r => r.length))

    const paddedHeaders = [...headers]
    while (paddedHeaders.length < maxCols) paddedHeaders.push(`Col ${paddedHeaders.length + 1}`)

    const paddedRows = dataRows.map(row => {
      const padded = [...row]
      while (padded.length < maxCols) padded.push('')
      return padded
    })

    const markdown = `| ${paddedHeaders.join(' | ')} |\n| ${paddedHeaders.map(() => '---').join(' | ')} |\n${paddedRows.map(row => `| ${row.join(' | ')} |`).join('\n')}`

    const csv = [paddedHeaders.join(','), ...paddedRows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))].join('\n')

    tables.push({ headers: paddedHeaders, rows: paddedRows, markdown, csv })
  }

  return tables
}

export function sanitizeTrackingParams(url: string): string {
  try {
    const parsed = new URL(url)
    for (const param of TRACKING_PARAMS) {
      parsed.searchParams.delete(param)
    }
    return parsed.toString()
  } catch {
    return url
  }
}

export function isBlockedBinaryUrl(url: string, contentType?: string, contentDisposition?: string): boolean {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.toLowerCase()
    if (BLOCKED_EXTENSIONS.some(ext => path.endsWith(ext))) return true
  } catch {}

  if (contentType) {
    const ct = contentType.toLowerCase()
    if (
      ct.includes('application/x-executable') ||
      ct.includes('application/x-msdownload') ||
      ct.includes('application/x-dosexec') ||
      ct.includes('application/octet-stream')
    ) return true
  }

  if (contentDisposition) {
    const cd = contentDisposition.toLowerCase()
    if (BLOCKED_EXTENSIONS.some(ext => cd.includes(ext))) return true
  }

  return false
}

function initTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
  })

  td.addRule('tables', {
    filter: 'table',
    replacement(_content, node) {
      const table = node as HTMLElement
      const rows = Array.from(table.querySelectorAll('tr'))
      if (rows.length === 0) return ''

      const result: string[] = []
      let headerDone = false

      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('th, td'))
        const texts = cells.map(cell => (cell.textContent || '').trim())
        result.push(`| ${texts.join(' | ')} |`)

        if (!headerDone && row.querySelector('th')) {
          result.push(`| ${texts.map(() => '---').join(' | ')} |`)
          headerDone = true
        }
      }

      return result.join('\n')
    },
  })

  return td
}

const turndownInstance = initTurndown()

export function sanitizeHtmlToMarkdown(html: string, options: SanitizeOptions = {}): string {
  const pruned = pruneHtml(html, options)
  const readable = filterReadableContent(pruned)

  let finalHtml = readable
  if (options.strict) {
    finalHtml = finalHtml.replace(/<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>/gi, (match, href) => {
      const clean = sanitizeTrackingParams(href)
      for (const domain of AD_DOMAINS) {
        try {
          if (new URL(clean).hostname.endsWith(domain)) return ''
        } catch { /* skip */ }
      }
      return match.replace(href, clean)
    })
  }

  let markdown = turndownInstance.turndown(finalHtml)

  markdown = markdown
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '')
    .replace(/^#+\s*$/gm, '')

  if (options.maxTextLength && markdown.length > options.maxTextLength) {
    markdown = markdown.slice(0, options.maxTextLength) + '\n\n...[content truncated]'
  }

  return markdown
}

export function extractMetadata(html: string): {
  title: string
  description: string
  ogImage?: string
  canonicalUrl?: string
} {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : ''

  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)
  const description = descMatch ? descMatch[1].trim() : ''

  const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:image["']/i)
  const ogImage = ogImageMatch ? ogImageMatch[1].trim() : undefined

  const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i)
  const canonicalUrl = canonicalMatch ? canonicalMatch[1].trim() : undefined

  return { title, description, ogImage, canonicalUrl }
}