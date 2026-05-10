export interface OpenClawShellToolRequest {
  command: string
  description?: string
}

export interface OpenClawWebToolRequest {
  query: string
  description?: string
}

export interface OpenClawFilesystemToolRequest {
  action: 'list' | 'read' | 'stat' | 'write' | 'append' | 'mkdir'
  path: string
  content?: string
  createDirectories?: boolean
}

export interface OpenClawCodeToolRequest {
  runtime: 'python' | 'node'
  code: string
  filename?: string
  workspacePath?: string
  args?: string[]
  description?: string
}

export interface OpenClawBrowserToolRequest {
  action: 'open' | 'click' | 'fill' | 'submit' | 'extract'
  url?: string
  linkIndex?: number
  linkText?: string
  formIndex?: number
  values?: Record<string, string>
  mode?: 'summary' | 'text' | 'links' | 'forms' | 'html'
  description?: string
}

export interface OpenClawUwafBrowserToolRequest {
  action: 'open' | 'click' | 'extract_table' | 'research_batch' | 'fill' | 'submit' | 'extract'
  url?: string
  linkIndex?: number
  linkText?: string
  formIndex?: number
  values?: Record<string, string>
  mode?: 'summary' | 'text' | 'links' | 'forms' | 'html'
  browserMode?: 'direct' | 'stealth'
  depth?: number
  description?: string
}

export type OpenClawToolRequest =
  | {
      name: 'web'
      request: OpenClawWebToolRequest
    }
  | {
      name: 'shell'
      request: OpenClawShellToolRequest
    }
  | {
      name: 'filesystem'
      request: OpenClawFilesystemToolRequest
    }
  | {
      name: 'code'
      request: OpenClawCodeToolRequest
    }
  | {
      name: 'browser'
      request: OpenClawBrowserToolRequest
    }
  | {
      name: 'unified_browser'
      request: OpenClawUwafBrowserToolRequest
    }

export const OPENCLAW_WEB_TOOL_EXAMPLE = `<openclaw_tool name="web">
{"query":"latest Next.js 16 route handlers docs","description":"Verify the current route-handler behavior before answering"}
</openclaw_tool>`

export const OPENCLAW_SHELL_TOOL_EXAMPLE = `<openclaw_tool name="shell">
{"command":"pwd","description":"Check the current workspace"}
</openclaw_tool>`

export const OPENCLAW_FILESYSTEM_TOOL_EXAMPLE = `<openclaw_tool name="filesystem">
{"action":"read","path":"/home/raza/Desktop/project/src/app.ts"}
</openclaw_tool>`

export const OPENCLAW_FILESYSTEM_WRITE_TOOL_EXAMPLE = `<openclaw_tool name="filesystem">
{"action":"write","path":"/tmp/peakui-openclaw-workspace/notes/todo.md","content":"# TODO\\n- Inspect the crash logs","createDirectories":true}
</openclaw_tool>`

export const OPENCLAW_CODE_TOOL_EXAMPLE = `<openclaw_tool name="code">
{"runtime":"python","filename":"summarize.py","code":"print('hello from sandbox')","workspacePath":"analysis/demo","description":"Run a short Python script in the managed workspace"}
</openclaw_tool>`

export const OPENCLAW_BROWSER_TOOL_EXAMPLE = `<openclaw_tool name="browser">
{"action":"open","url":"https://example.com","description":"Open the page and inspect its links and forms"}
</openclaw_tool>`

export const OPENCLAW_UWAF_BROWSER_TOOL_EXAMPLE = `<openclaw_tool name="unified_browser">
{"action":"open","url":"https://example.com","browserMode":"direct","description":"Open a page in Direct (clear web) mode"}
</openclaw_tool>`

function isUwafAction(value: unknown): value is OpenClawUwafBrowserToolRequest['action'] {
  return value === 'open'
    || value === 'click'
    || value === 'extract_table'
    || value === 'research_batch'
    || value === 'fill'
    || value === 'submit'
    || value === 'extract'
}

function isUwafBrowserMode(value: unknown): value is 'direct' | 'stealth' {
  return value === 'direct' || value === 'stealth'
}

const TOOL_BLOCK_PATTERN = /<openclaw_tool\s+name=["'](shell|filesystem|web|code|browser|unified_browser)["']\s*>([\s\S]*?)<\/openclaw_tool>/i

/** Strip all complete and partial <openclaw_tool> tags from content. */
export function stripAllToolTags(content: string): string {
  // Remove complete tool blocks first
  let cleaned = content.replace(/<openclaw_tool\s+name=["'](shell|filesystem|web|code|browser|unified_browser)["']\s*>[\s\S]*?<\/openclaw_tool>/gi, '')
  // Remove partial/incomplete tags (no closing tag)
  cleaned = cleaned.replace(/<openclaw_tool\s+name=["'](shell|filesystem|web|code|browser|unified_browser)["']\s*>[\s\S]*/gi, '')
  // Remove orphaned opening tags
  cleaned = cleaned.replace(/<openclaw_tool[^>]*>/gi, '')
  // Remove orphaned closing tags
  cleaned = cleaned.replace(/<\/openclaw_tool>/gi, '')
  return cleaned.replace(/\n{3,}/g, '\n\n').trim()
}

function isFilesystemAction(value: unknown): value is OpenClawFilesystemToolRequest['action'] {
  return value === 'list'
    || value === 'read'
    || value === 'stat'
    || value === 'write'
    || value === 'append'
    || value === 'mkdir'
}

function isBrowserAction(value: unknown): value is OpenClawBrowserToolRequest['action'] {
  return value === 'open'
    || value === 'click'
    || value === 'fill'
    || value === 'submit'
    || value === 'extract'
}

function isBrowserExtractMode(value: unknown): value is NonNullable<OpenClawBrowserToolRequest['mode']> {
  return value === 'summary'
    || value === 'text'
    || value === 'links'
    || value === 'forms'
    || value === 'html'
}

export function extractOpenClawToolRequest(content: string): {
  cleanedContent: string
  request?: OpenClawToolRequest
} {
  const match = content.match(TOOL_BLOCK_PATTERN)
  if (!match) {
    return { cleanedContent: stripAllToolTags(content) }
  }

  const cleanedContent = stripAllToolTags(content.replace(match[0], ''))
  const toolName = match[1]

  try {
    if (toolName === 'web') {
      const parsed = JSON.parse(match[2].trim()) as Partial<OpenClawWebToolRequest>
      const query = typeof parsed.query === 'string' ? parsed.query.trim() : ''
      if (!query) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      return {
        cleanedContent,
        request: {
          name: 'web',
          request: {
            query,
            description: typeof parsed.description === 'string' && parsed.description.trim()
              ? parsed.description.trim()
              : undefined,
          },
        },
      }
    }

    if (toolName === 'shell') {
      const parsed = JSON.parse(match[2].trim()) as Partial<OpenClawShellToolRequest>
      const command = typeof parsed.command === 'string' ? parsed.command.trim() : ''
      if (!command) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      return {
        cleanedContent,
        request: {
          name: 'shell',
          request: {
            command,
            description: typeof parsed.description === 'string' && parsed.description.trim()
              ? parsed.description.trim()
              : undefined,
          },
        },
      }
    }

    if (toolName === 'code') {
      const parsed = JSON.parse(match[2].trim()) as Partial<OpenClawCodeToolRequest>
      const runtime = parsed.runtime === 'python' || parsed.runtime === 'node'
        ? parsed.runtime
        : null
      const code = typeof parsed.code === 'string' ? parsed.code : ''
      const args = Array.isArray(parsed.args)
        ? parsed.args.filter((entry): entry is string => typeof entry === 'string').slice(0, 20)
        : undefined

      if (!runtime || !code.trim()) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      return {
        cleanedContent,
        request: {
          name: 'code',
          request: {
            runtime,
            code,
            filename: typeof parsed.filename === 'string' && parsed.filename.trim()
              ? parsed.filename.trim()
              : undefined,
            workspacePath: typeof parsed.workspacePath === 'string' && parsed.workspacePath.trim()
              ? parsed.workspacePath.trim()
              : undefined,
            args,
            description: typeof parsed.description === 'string' && parsed.description.trim()
              ? parsed.description.trim()
              : undefined,
          },
        },
      }
    }

    if (toolName === 'browser') {
      const parsed = JSON.parse(match[2].trim()) as Partial<OpenClawBrowserToolRequest>
      const action = isBrowserAction(parsed.action) ? parsed.action : null

      if (!action) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const request: OpenClawBrowserToolRequest = {
        action,
        description: typeof parsed.description === 'string' && parsed.description.trim()
          ? parsed.description.trim()
          : undefined,
      }

      if (typeof parsed.url === 'string' && parsed.url.trim()) {
        request.url = parsed.url.trim()
      }

      if (typeof parsed.linkIndex === 'number' && Number.isInteger(parsed.linkIndex) && parsed.linkIndex >= 0) {
        request.linkIndex = parsed.linkIndex
      }

      if (typeof parsed.linkText === 'string' && parsed.linkText.trim()) {
        request.linkText = parsed.linkText.trim()
      }

      if (typeof parsed.formIndex === 'number' && Number.isInteger(parsed.formIndex) && parsed.formIndex >= 0) {
        request.formIndex = parsed.formIndex
      }

      if (parsed.values && typeof parsed.values === 'object' && !Array.isArray(parsed.values)) {
        request.values = Object.fromEntries(
          Object.entries(parsed.values)
            .filter(([, value]) => typeof value === 'string')
            .map(([key, value]) => [key, value.trim()])
            .filter(([, value]) => value.length > 0)
        )
      }

      if (isBrowserExtractMode(parsed.mode)) {
        request.mode = parsed.mode
      }

      if (
        (action === 'open' && !request.url)
        || (action === 'click' && request.linkIndex === undefined && !request.linkText)
        || (action === 'fill' && (request.formIndex === undefined || !request.values || Object.keys(request.values).length === 0))
      ) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      return {
        cleanedContent,
        request: {
          name: 'browser',
          request,
        },
      }
    }

    if (toolName === 'unified_browser') {
      const parsed = JSON.parse(match[2].trim()) as Partial<OpenClawUwafBrowserToolRequest>
      const action = isUwafAction(parsed.action) ? parsed.action : null

      if (!action) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const request: OpenClawUwafBrowserToolRequest = {
        action,
        description: typeof parsed.description === 'string' && parsed.description.trim()
          ? parsed.description.trim()
          : undefined,
      }

      if (typeof parsed.url === 'string' && parsed.url.trim()) {
        request.url = parsed.url.trim()
      }

      if (typeof parsed.linkIndex === 'number' && Number.isInteger(parsed.linkIndex) && parsed.linkIndex >= 0) {
        request.linkIndex = parsed.linkIndex
      }

      if (typeof parsed.linkText === 'string' && parsed.linkText.trim()) {
        request.linkText = parsed.linkText.trim()
      }

      if (typeof parsed.formIndex === 'number' && Number.isInteger(parsed.formIndex) && parsed.formIndex >= 0) {
        request.formIndex = parsed.formIndex
      }

      if (parsed.values && typeof parsed.values === 'object' && !Array.isArray(parsed.values)) {
        request.values = Object.fromEntries(
          Object.entries(parsed.values)
            .filter(([, value]) => typeof value === 'string')
            .map(([key, value]) => [key, value.trim()])
            .filter(([, value]) => value.length > 0)
        )
      }

      if (isBrowserExtractMode(parsed.mode)) {
        request.mode = parsed.mode
      }

      if (isUwafBrowserMode(parsed.browserMode)) {
        request.browserMode = parsed.browserMode
      }

      if (typeof parsed.depth === 'number' && Number.isInteger(parsed.depth) && parsed.depth >= 1 && parsed.depth <= 3) {
        request.depth = parsed.depth
      }

      if (
        (action === 'open' && !request.url)
        || (action === 'click' && request.linkIndex === undefined && !request.linkText)
        || (action === 'research_batch' && !request.url)
      ) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      return {
        cleanedContent,
        request: {
          name: 'unified_browser',
          request,
        },
      }
    }

    const parsed = JSON.parse(match[2].trim()) as Partial<OpenClawFilesystemToolRequest>
    const requestedPath = typeof parsed.path === 'string' ? parsed.path.trim() : ''
    const action = isFilesystemAction(parsed.action) ? parsed.action : null

    if (!requestedPath || !action) {
      return { cleanedContent: stripAllToolTags(content) }
    }

    if ((action === 'write' || action === 'append') && typeof parsed.content !== 'string') {
      return { cleanedContent: stripAllToolTags(content) }
    }

    const request: OpenClawFilesystemToolRequest = {
      action,
      path: requestedPath,
    }

    if (typeof parsed.content === 'string') {
      request.content = parsed.content
    }

    if (parsed.createDirectories === true) {
      request.createDirectories = true
    }

    return {
      cleanedContent,
      request: {
        name: 'filesystem',
        request,
      },
    }
  } catch {
    return { cleanedContent: stripAllToolTags(content) }
  }
}
