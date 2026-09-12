/**
 * Native tool-call schema exporter (Phase 1a).
 *
 * PeakUI historically asked every model to emit a custom `<workspace_tool>`
 * XML wrapper, then recovered via regex when the model dropped it. Models that
 * support native function calling (via the API's `tools` parameter) don't need
 * any of that: the runtime hands the model a JSON schema per tool and parses
 * structured `tool_calls` frames back. This removes the entire
 * narration-recovery / nudge / synthesis machinery for capable models — the
 * model cannot "describe a tool call in prose" because the parser receives
 * structured JSON directly.
 *
 * Schemas here are the single source of truth for native calling. They mirror
 * the request interfaces in `workspace-tool-tools.ts`; keep them in sync.
 *
 * Format: Ollama `/api/chat` `tools` parameter (OpenAI-compatible function
 * schema), also accepted by OpenAI-compatible providers.
 */

import type { WorkspaceToolName } from './workspace-tool-tools'

export interface NativeToolParameterProperty {
  type: string | string[]
  description: string
  enum?: ReadonlyArray<string>
  items?: Record<string, unknown>
  default?: unknown
}

export interface NativeToolSchema {
  type: 'function'
  function: {
    name: WorkspaceToolName
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, NativeToolParameterProperty>
      required?: string[]
    }
  }
}

const S = (description: string): NativeToolParameterProperty => ({ type: 'string', description })
const SEnum = (description: string, ...values: string[]): NativeToolParameterProperty => ({ type: 'string', description, enum: values })
const N = (description: string): NativeToolParameterProperty => ({ type: 'number', description })
const B = (description: string): NativeToolParameterProperty => ({ type: 'boolean', description })
const Obj = (description: string): NativeToolParameterProperty => ({ type: 'object', description })
const StrArr = (description: string): NativeToolParameterProperty => ({ type: 'array', description, items: { type: 'string' } })

/**
 * Per-tool schemas. `required` lists the fields the dispatcher genuinely needs;
 * everything else stays optional so the model isn't forced to invent values.
 */
const TOOL_SCHEMAS: Record<WorkspaceToolName, NativeToolSchema> = {
  shell: {
    type: 'function',
    function: {
      name: 'shell',
      description: 'Run a shell command in the sandboxed container. Use for file inspection, text processing, and build commands. Do NOT use it to scrape web pages (finance/news sites are JS-rendered) — use the web tool instead.',
      parameters: {
        type: 'object',
        properties: {
          command: S('The shell command to run.'),
          description: S('Short human-readable summary of what the command does.'),
        },
        required: ['command'],
      },
    },
  },
  filesystem: {
    type: 'function',
    function: {
      name: 'filesystem',
      description: 'List, read, stat, write, append, or create directories inside the allowed workspace paths. Write/append/mkdir require filesystem-write permission.',
      parameters: {
        type: 'object',
        properties: {
          action: SEnum('The operation to perform.', 'list', 'read', 'stat', 'write', 'append', 'mkdir'),
          path: S('Workspace-relative or allowed absolute path.'),
          content: S('File content for write/append.'),
          createDirectories: B('Create missing parent directories on write.'),
        },
        required: ['action', 'path'],
      },
    },
  },
  web: {
    type: 'function',
    function: {
      name: 'web',
      description: 'Search the public web or fetch a URL. Use for current events, prices, news, weather, and lookups. Returns cited sources.',
      parameters: {
        type: 'object',
        properties: {
          query: S('Concise 3-8 word search phrase, or a public http(s) URL to fetch.'),
          description: S('Why this search advances the task.'),
        },
        required: ['query'],
      },
    },
  },
  code: {
    type: 'function',
    function: {
      name: 'code',
      description: 'Execute a short Python or Node script in an isolated sandbox. Use for data transformation, calculations, and quick prototypes.',
      parameters: {
        type: 'object',
        properties: {
          runtime: SEnum('Script runtime.', 'python', 'node'),
          code: S('Script source code.'),
          filename: S('Optional filename for the script.'),
          workspacePath: S('Optional workspace-relative directory to run in.'),
          args: StrArr('Optional CLI arguments passed to the script.'),
          description: S('What the script does.'),
        },
        required: ['runtime', 'code'],
      },
    },
  },
  browser: {
    type: 'function',
    function: {
      name: 'browser',
      description: 'Drive a real browser: open pages, click, fill forms, submit, extract content. Use for JS-heavy pages.',
      parameters: {
        type: 'object',
        properties: {
          action: SEnum('Browser operation.', 'open', 'click', 'fill', 'submit', 'extract'),
          url: S('URL to open (action=open).'),
          linkIndex: N('Index of a link to click (action=click).'),
          linkText: S('Text of a link to click (action=click).'),
          formIndex: N('Index of a form to fill (action=fill).'),
          values: Obj('Field name -> value map (action=fill).'),
          mode: SEnum('Extraction mode (action=extract).', 'summary', 'text', 'links', 'forms', 'html'),
          description: S('What you are doing.'),
        },
        required: ['action'],
      },
    },
  },
  unified_browser: {
    type: 'function',
    function: {
      name: 'unified_browser',
      description: 'Persistent browser session with search, navigation, tabs, forms, and stealth (Tor) mode. Prefer this over `browser` for multi-step browsing workflows.',
      parameters: {
        type: 'object',
        properties: {
          action: SEnum('Browser operation.', 'search', 'open', 'click', 'type', 'press', 'wait_for_selector', 'scroll', 'back', 'forward', 'new_tab', 'list_tabs', 'switch_tab', 'close_tab', 'select', 'hover', 'extract_table', 'research_batch', 'fill', 'submit', 'extract', 'wait_for_user', 'reopen_recent'),
          query: S('Search phrase (action=search).'),
          url: S('URL to open (action=open).'),
          linkIndex: N('Link index to click.'),
          linkText: S('Link text to click.'),
          formIndex: N('Form index to fill.'),
          values: Obj('Field name -> value map (action=fill).'),
          mode: SEnum('Extraction mode.', 'summary', 'text', 'links', 'forms', 'html'),
          browserMode: SEnum('direct = normal HTTPS; stealth = Tor.', 'direct', 'stealth'),
          selector: S('CSS selector (wait_for_selector / extract).'),
          text: S('Text to type (action=type).'),
          key: S('Key name to press (action=press).'),
          tabIndex: N('Tab index for tab operations.'),
          timeoutMs: N('Timeout in milliseconds.'),
          deltaY: N('Scroll delta (action=scroll).'),
          description: S('What you are doing.'),
        },
        required: ['action'],
      },
    },
  },
  tax_return: {
    type: 'function',
    function: {
      name: 'tax_return',
      description: 'List/inspect IRS forms, fill a PDF tax form from Knowledge Base documents, or generate a W-2/1099 review packet. Only when the user asks for tax work.',
      parameters: {
        type: 'object',
        properties: {
          action: SEnum('Tax operation.', 'generate_review_pdf', 'fill_pdf_form', 'list_forms', 'inspect_form'),
          folder: S('Knowledge Base folder holding the source documents.'),
          taxYear: S('Tax year, e.g. "2025".'),
          templateDocumentId: S('Optional uploaded template document id.'),
          formId: S('IRS form id, e.g. "f1040", "f1040sd".'),
          fields: Obj('Explicit field-name -> value overlay on top of the auto-extracted draft.'),
          flatten: B('Flatten the filled PDF (no editable fields).'),
          description: S('What you are doing.'),
        },
        required: ['action'],
      },
    },
  },
  pdf_document: {
    type: 'function',
    function: {
      name: 'pdf_document',
      description: 'Generate a downloadable PDF. Use ONLY when the user explicitly asks to create/export/save a PDF — never to answer questions or demonstrate capabilities.',
      parameters: {
        type: 'object',
        properties: {
          title: S('Document title.'),
          content: S('Plain-text body (simple documents).'),
          filename: S('Optional output filename.'),
          subtitle: S('Optional subtitle.'),
          sections: StrArr('Optional section headings (use full structure via content when richer layout is needed).'),
          description: S('What the document is for.'),
        },
        required: ['title'],
      },
    },
  },
  workbook_document: {
    type: 'function',
    function: {
      name: 'workbook_document',
      description: 'Generate a downloadable Excel workbook. Use ONLY on an explicit create/export/save request.',
      parameters: {
        type: 'object',
        properties: {
          title: S('Workbook title.'),
          description: S('What the workbook is for.'),
        },
        required: ['title'],
      },
    },
  },
  word_document: {
    type: 'function',
    function: {
      name: 'word_document',
      description: 'Generate a downloadable Word (.docx) document. Use ONLY on an explicit create/export/save request.',
      parameters: {
        type: 'object',
        properties: {
          title: S('Document title.'),
          description: S('What the document is for.'),
        },
        required: ['title'],
      },
    },
  },
  csv_document: {
    type: 'function',
    function: {
      name: 'csv_document',
      description: 'Generate a downloadable CSV file. Use ONLY on an explicit create/export/save request.',
      parameters: {
        type: 'object',
        properties: {
          title: S('File title / basename.'),
          description: S('What the CSV contains.'),
        },
        required: ['title'],
      },
    },
  },
  email_document: {
    type: 'function',
    function: {
      name: 'email_document',
      description: 'Draft an email (.eml) for the user to send. Use ONLY on an explicit request.',
      parameters: {
        type: 'object',
        properties: {
          title: S('Email subject.'),
          description: S('Who it is to and what it should say.'),
        },
        required: ['title'],
      },
    },
  },
  markdown_document: {
    type: 'function',
    function: {
      name: 'markdown_document',
      description: 'Generate a downloadable Markdown (.md) file. Use ONLY on an explicit create/export/save request.',
      parameters: {
        type: 'object',
        properties: {
          title: S('Document title.'),
          description: S('What the file contains.'),
        },
        required: ['title'],
      },
    },
  },
  slides_document: {
    type: 'function',
    function: {
      name: 'slides_document',
      description: 'Generate a downloadable slide deck (.pptx). Use ONLY on an explicit create/export/save request.',
      parameters: {
        type: 'object',
        properties: {
          title: S('Deck title.'),
          description: S('What the deck covers.'),
        },
        required: ['title'],
      },
    },
  },
  archive_document: {
    type: 'function',
    function: {
      name: 'archive_document',
      description: 'Bundle workspace files into a downloadable ZIP archive. Use ONLY on an explicit request.',
      parameters: {
        type: 'object',
        properties: {
          title: S('Archive basename.'),
          description: S('Which files to include.'),
        },
        required: ['title'],
      },
    },
  },
  calendar_document: {
    type: 'function',
    function: {
      name: 'calendar_document',
      description: 'Generate a downloadable calendar event (.ics). Use ONLY on an explicit request.',
      parameters: {
        type: 'object',
        properties: {
          title: S('Event title.'),
          description: S('When and what the event is.'),
        },
        required: ['title'],
      },
    },
  },
  mermaid_document: {
    type: 'function',
    function: {
      name: 'mermaid_document',
      description: 'Render a Mermaid diagram (flowchart, sequence, ER) as a downloadable artifact. Use ONLY on an explicit request.',
      parameters: {
        type: 'object',
        properties: {
          title: S('Diagram title.'),
          description: S('What the diagram should show.'),
        },
        required: ['title'],
      },
    },
  },
  fetch_summarize: {
    type: 'function',
    function: {
      name: 'fetch_summarize',
      description: 'Fetch a public URL and return a structured summary of its content.',
      parameters: {
        type: 'object',
        properties: {
          url: S('Public http(s) URL to fetch.'),
          description: S('What to focus the summary on.'),
        },
        required: ['url'],
      },
    },
  },
  image_generation: {
    type: 'function',
    function: {
      name: 'image_generation',
      description: 'Generate an image from a text prompt via the ComfyUI engine. Only when Image Gen mode is enabled.',
      parameters: {
        type: 'object',
        properties: {
          prompt: S('Image description.'),
          negativePrompt: S('What to avoid in the image.'),
          width: N('Width in pixels (default 1024).'),
          height: N('Height in pixels (default 1024).'),
          steps: N('Sampling steps (default 20).'),
          seed: N('RNG seed for reproducibility.'),
          description: S('What the image is for.'),
        },
        required: ['prompt'],
      },
    },
  },
  notes_search: {
    type: 'function',
    function: {
      name: 'notes_search',
      description: 'Search your saved notes from previous sessions. Use when the user references past work ("as we discussed", "the thing I asked for yesterday") or when prior context would help.',
      parameters: {
        type: 'object',
        properties: {
          query: S('Keywords to search for, e.g. "stock analysis" or "api design".'),
        },
        required: ['query'],
      },
    },
  },
  notes_save: {
    type: 'function',
    function: {
      name: 'notes_save',
      description: 'Save a durable note for future sessions. Use when the user asks you to remember something, states a durable preference, or a decision should carry into later sessions.',
      parameters: {
        type: 'object',
        properties: {
          title: S('Short note title.'),
          content: S('The note content (what to remember).'),
        },
        required: ['title', 'content'],
      },
    },
  },
  http_request: {
    type: 'function',
    function: {
      name: 'http_request',
      description: 'Make an authenticated HTTP request to a public API (GET/POST/PUT/PATCH/DELETE) with custom headers and a JSON body. Use to call real APIs (Jira, GitHub, internal services). Private/localhost URLs are blocked.',
      parameters: {
        type: 'object',
        properties: {
          method: SEnum('HTTP method.', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'),
          url: S('Public http(s) URL to call.'),
          headers: Obj('Optional request headers (e.g. Authorization).'),
          body: Obj('Optional JSON body for non-GET requests.'),
          timeoutMs: N('Optional timeout in milliseconds.'),
          description: S('What this request is for.'),
        },
        required: ['url'],
      },
    },
  },
}

/**
 * Tool descriptions shown to the model. Kept intentionally short — the
 * schema-level descriptions carry the detail.
 */
const TOOL_DESCRIPTIONS: Partial<Record<WorkspaceToolName, string>> = {}

/**
 * Build the native `tools` array for the enabled tool set, in a stable order.
 *
 * @param enabledTools exactly which tools are enabled this turn (already
 *   gated by permissions/mode toggles upstream).
 */
export function buildNativeToolsArray(enabledTools: ReadonlyArray<WorkspaceToolName>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const name of enabledTools) {
    const schema = TOOL_SCHEMAS[name]
    if (!schema) continue
    const extra = TOOL_DESCRIPTIONS[name]
    out.push({
      type: 'function',
      function: {
        name: schema.function.name,
        description: extra ? `${schema.function.description} ${extra}` : schema.function.description,
        parameters: schema.function.parameters,
      },
    })
  }
  return out
}

/**
 * Parse an Ollama `/api/chat` streamed frame's `message.tool_calls` field into
 * normalized `{ name, args }` pairs. Returns an empty array when the frame
 * carries no tool calls. Tolerates both `arguments` as object and as
 * JSON-string (some bridges serialize it).
 */
export function parseNativeToolCalls(frame: unknown): Array<{ name: string; args: Record<string, unknown> }> {
  if (!frame || typeof frame !== 'object') return []
  const message = (frame as { message?: { tool_calls?: unknown } }).message
  const toolCalls = message?.tool_calls
  if (!Array.isArray(toolCalls)) return []

  const out: Array<{ name: string; args: Record<string, unknown> }> = []
  for (const call of toolCalls) {
    if (!call || typeof call !== 'object') continue
    const fn = (call as { function?: { name?: unknown; arguments?: unknown } }).function
    if (!fn || typeof fn.name !== 'string') continue
    let args: Record<string, unknown> = {}
    if (fn.arguments && typeof fn.arguments === 'object') {
      args = fn.arguments as Record<string, unknown>
    } else if (typeof fn.arguments === 'string') {
      try {
        const parsed = JSON.parse(fn.arguments)
        if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>
      } catch {
        // Malformed arguments JSON — leave args empty; the dispatcher will
        // reject the call with a validation error rather than crash.
      }
    }
    out.push({ name: fn.name, args })
  }
  return out
}