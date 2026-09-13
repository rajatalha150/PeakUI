/** Dependency-free tool identity shared by storage, analytics and context code. */
export const TOOL_REGISTRY = {
  shell: ['Shell command result:', 'Shell command'],
  filesystem: ['Filesystem tool result:', 'Filesystem'],
  web: ['Web research tool result:', 'Web research'],
  code: ['Code execution result:', 'Code execution'],
  browser: ['Browser tool result:', 'Browser'],
  unified_browser: ['UWAF browser tool result:', 'Unified browser'],
  tax_return: ['Tax return PDF tool result:', 'Tax return'],
  pdf_document: ['PDF document tool result:', 'PDF document'],
  workbook_document: ['Excel workbook tool result:', 'Excel workbook'],
  word_document: ['Word document tool result:', 'Word document'],
  csv_document: ['CSV export tool result:', 'CSV export'],
  email_document: ['Email writer tool result:', 'Email writer'],
  markdown_document: ['Markdown document tool result:', 'Markdown document'],
  slides_document: ['Slide deck tool result:', 'Slide deck'],
  archive_document: ['Archive tool result:', 'Archive'],
  calendar_document: ['Calendar tool result:', 'Calendar'],
  mermaid_document: ['Mermaid diagram tool result:', 'Mermaid diagram'],
  fetch_summarize: ['URL fetch and summarize tool result:', 'URL fetch and summarize'],
  image_generation: ['Image generation tool result:', 'Image generation'],
  notes_search: ['Notes search tool result:', 'Notes search'],
  notes_save: ['Notes save tool result:', 'Notes save'],
  http_request: ['HTTP request tool result:', 'HTTP request'],
  spreadsheet_query: ['Spreadsheet query tool result:', 'Spreadsheet query'],
  calendar_query: ['Calendar query tool result:', 'Calendar query'],
} as const;

export type WorkspaceToolName = keyof typeof TOOL_REGISTRY;
export const WORKSPACE_TOOL_NAMES = Object.keys(TOOL_REGISTRY) as WorkspaceToolName[];
export function isWorkspaceToolName(value: unknown): value is WorkspaceToolName {
  return typeof value === 'string' && Object.hasOwn(TOOL_REGISTRY, value);
}
export const TOOL_RESULT_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ...Object.values(TOOL_REGISTRY),
  ['Tax return tool result:', 'Tax return'],
];
export const TOOL_RESULT_HEADER_RE = new RegExp(`^(?:${TOOL_RESULT_PREFIXES
  .map(([prefix]) => prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`);

export function isToolResultMessage(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const message = value as { role?: unknown; hidden?: unknown; content?: unknown };
  return message.role === 'user' && message.hidden === true
    && typeof message.content === 'string' && TOOL_RESULT_HEADER_RE.test(message.content);
}
