/**
 * Pure formatting helpers for the various OpenClaw tool results that get
 * surfaced to the model on the next inference turn.
 *
 * Keeping these out of the giant `OpenClawWorkspace.tsx` component lets us
 * unit-test the output shape (including size guards) without spinning up
 * React. The component just imports the formatter it needs.
 */

/**
 * Max number of characters of page text to keep in the tool result message
 * for non-search browser actions (open, click, extract, research_batch, …).
 * 6,000 fits a normal article body in full and leaves headroom for short
 * product / docs pages. Anything bigger gets truncated with a clear marker
 * so the model knows the rest is in the live browser pane and can call
 * `unified_browser action=extract mode=text` if it really needs more.
 */
const MAX_TEXT_CHARS_OPEN = 6_000

/**
 * Tighter cap for `action === 'search'`. A SERP's `innerText` is mostly
 * navigation chrome and "View all" spam, not signal — the link list below
 * is what matters, and 2,000 chars is plenty for a short intro paragraph
 * from the result blocks.
 */
const MAX_TEXT_CHARS_SEARCH = 2_000

/**
 * Cap the number of links we emit. A real SERP rarely has more than ~20
 * visible results; 60 leaves headroom for "load more" and related sections.
 * More than that is almost always auto-generated nav, footer, or related
 * widgets, not signal.
 */
const MAX_LINKS = 60

/**
 * URLs longer than this are almost always inlined base64 image blobs from
 * `<img src="data:image/...">` or session-internal redirect chains. They
 * are not real navigation targets and they bloat the result. Strip them.
 */
const MAX_LINK_URL_LENGTH = 2_000

const TRUNCATION_MARKER_PREFIX = '\n\n[... '
const TRUNCATION_MARKER_SUFFIX = ' more characters truncated; full content visible in the live browser pane]'

export interface UwafBrowserToolResultEntry {
  action: string;
  currentUrl: string;
  title: string;
  text?: string;
  html?: string;
  markdown?: string;
  links: Array<{
    index: number;
    text: string;
    url: string;
  }>;
  forms: Array<{
    index: number;
    action: string;
    method: string;
    fields: Array<{
      name: string;
      type: string;
      value?: string;
    }>;
  }>;
  tables?: Array<{
    headers: string[];
    rows: string[][];
    markdown: string;
    csv: string;
  }>;
  screenshot?: string;
  mode: 'direct' | 'stealth';
  stealthProfile?: 'normal' | 'high';
  source: 'clear_web' | 'dark_web';
  success: boolean;
  error?: string;
  requestedUrl?: string;
  requestedQuery?: string;
  finalUrl?: string;
  redirected?: boolean;
  httpStatus?: number;
  queryMatched?: boolean;
  resultCount?: number;
  antiBotDetected?: boolean;
  loginDetected?: boolean;
  jsErrors?: string[];
  networkErrors?: string[];
  failureCode?: string;
  failureDetail?: string;
  pageChanged?: boolean;
  navigationChanged?: boolean;
  selectorMatched?: boolean;
  waitTimedOut?: boolean;
  searchEngine?: string;
  searchProviderId?: string;
  searchAttempts?: Array<{
    providerId: string;
    providerLabel: string;
    success: boolean;
    resultCount: number;
    queryMatched?: boolean;
    failureCode?: string;
    failureDetail?: string;
  }>;
  tabs?: Array<{
    index: number;
    url: string;
    title: string;
    active: boolean;
  }>;
  activeTabIndex?: number;
  observations?: string[];
  batchResults?: Array<{
    url: string;
    title: string;
    markdown: string;
    links: Array<{ index: number; text: string; url: string }>;
    depth: number;
  }>;
}

/**
 * True for URLs that are inlined base64 image blobs, oversized redirect
 * chains, or other "not a real navigation target" payloads. We strip these
 * from the link list before emitting the tool result.
 */
function isJunkLinkUrl(url: string): boolean {
  if (!url) return true
  if (!url.trim()) return true
  const lower = url.toLowerCase()
  if (lower.startsWith('data:image')) return true
  if (lower.includes(';base64,')) return true
  if (url.length > MAX_LINK_URL_LENGTH) return true
  return false
}

/**
 * Apply a hard character cap to a string and append a clear marker
 * explaining what was dropped and where to find the rest. The marker is
 * part of the returned string so callers can size-check the whole output.
 */
export function truncateWithMarker(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  const dropped = value.length - maxChars
  return value.slice(0, maxChars) + TRUNCATION_MARKER_PREFIX + dropped + TRUNCATION_MARKER_SUFFIX
}

/**
 * Filter the link list to real navigation targets and cap the count.
 * Returns a new array; does not mutate the input.
 */
export function compactLinks(
  links: UwafBrowserToolResultEntry['links'],
): UwafBrowserToolResultEntry['links'] {
  if (!links || links.length === 0) return links
  const filtered: UwafBrowserToolResultEntry['links'] = []
  for (const link of links) {
    if (isJunkLinkUrl(link.url)) continue
    filtered.push(link)
    if (filtered.length >= MAX_LINKS) break
  }
  return filtered
}

/**
 * Format a unified_browser tool result for inclusion in the next model
 * turn. The output is plain text — it gets dropped into a user-role
 * message in `sessionHistory` verbatim, so we keep it small and signal
 * anything that was dropped.
 *
 * Truncation policy (see the constants at the top of this file for the
 * numbers and the rationale):
 *   - `text` is capped based on action; the head is kept and a marker
 *     is appended explaining what was dropped.
 *   - `links` is filtered to real navigation targets and capped at
 *     `MAX_LINKS` entries.
 *   - The failure path is left terse (it already is).
 *   - `forms`, `tables`, `tabs`, `batchResults` are kept as-is — these
 *     are small, structural, and the model genuinely needs them for
 *     click-following, form-fill, and batch research.
 */
export function formatUwafBrowserToolResult(entry: UwafBrowserToolResultEntry): string {
  const profileLabel = entry.mode === 'stealth' && entry.stealthProfile ? ` · ${entry.stealthProfile}` : '';
  const modeLabel = entry.mode === 'stealth' ? `Stealth (Tor${profileLabel})` : 'Direct (Clear Web)';
  const lines = [
    `Unified browser result [${modeLabel}]:`,
    `Action: ${entry.action}`,
    `Status: ${entry.success ? 'completed' : 'failed'}`,
    `Source: ${entry.source === 'dark_web' ? 'Dark Web' : 'Clear Web'}`,
  ];

  if (!entry.success) {
    if (entry.searchEngine?.trim()) {
      lines.push(`Search engine: ${entry.searchEngine.trim()}`);
    }
    if (entry.searchProviderId?.trim()) {
      lines.push(`Search provider id: ${entry.searchProviderId.trim()}`);
    }
    if (entry.failureCode) {
      lines.push(`Failure code: ${entry.failureCode}`);
    }
    if (entry.error?.trim()) {
      lines.push(`Error: ${entry.error.trim()}`);
    }
    if (entry.failureDetail?.trim() && entry.failureDetail.trim() !== entry.error?.trim()) {
      lines.push(`Detail: ${entry.failureDetail.trim()}`);
    }
    if (entry.searchAttempts && entry.searchAttempts.length > 0) {
      lines.push('', 'Provider attempts:');
      entry.searchAttempts.forEach(attempt => {
        const status = attempt.success
          ? `success (${attempt.resultCount} result blocks)`
          : `failed${attempt.failureCode ? `: ${attempt.failureCode}` : ''}${attempt.resultCount > 0 ? ` (${attempt.resultCount} result blocks)` : ''}`;
        lines.push(`- ${attempt.providerLabel} [${attempt.providerId}]: ${status}`);
      });
    }
    if (entry.observations && entry.observations.length > 0) {
      lines.push('', 'Observed issues:');
      entry.observations.forEach(note => {
        lines.push(`- ${note}`);
      });
    }
    lines.push('', 'Use this result to continue the task. Do not claim browser actions or page state that did not happen.');
    return lines.join('\n');
  }

  lines.push(`URL: ${entry.currentUrl}`);
  lines.push(`Title: ${entry.title}`);
  if (entry.requestedQuery?.trim()) {
    lines.push(`Query: ${entry.requestedQuery.trim()}`);
  }
  if (entry.searchEngine?.trim()) {
    lines.push(`Search engine: ${entry.searchEngine.trim()}`);
  }
  if (entry.searchProviderId?.trim()) {
    lines.push(`Search provider id: ${entry.searchProviderId.trim()}`);
  }
  if (typeof entry.queryMatched === 'boolean') {
    lines.push(`Query matched page: ${entry.queryMatched ? 'yes' : 'no'}`);
  }
  if (typeof entry.resultCount === 'number') {
    lines.push(`Detected result blocks: ${entry.resultCount}`);
  }
  if (typeof entry.httpStatus === 'number') {
    lines.push(`HTTP status: ${entry.httpStatus}`);
  }
  if (entry.redirected) {
    lines.push('Redirected: yes');
  }
  if (typeof entry.navigationChanged === 'boolean') {
    lines.push(`Navigation changed: ${entry.navigationChanged ? 'yes' : 'no'}`);
  }
  if (typeof entry.pageChanged === 'boolean') {
    lines.push(`Page changed: ${entry.pageChanged ? 'yes' : 'no'}`);
  }
  if (typeof entry.selectorMatched === 'boolean') {
    lines.push(`Selector matched: ${entry.selectorMatched ? 'yes' : 'no'}`);
  }
  if (entry.waitTimedOut) {
    lines.push('Wait timed out: yes');
  }
  if (entry.antiBotDetected) {
    lines.push('Anti-bot detected: yes');
  }
  if (entry.loginDetected) {
    lines.push('Login/auth detected: yes');
  }
  if (entry.searchAttempts && entry.searchAttempts.length > 0) {
    lines.push('', 'Provider attempts:');
    entry.searchAttempts.forEach(attempt => {
      const status = attempt.success
        ? `success (${attempt.resultCount} result blocks)`
        : `failed${attempt.failureCode ? `: ${attempt.failureCode}` : ''}${attempt.resultCount > 0 ? ` (${attempt.resultCount} result blocks)` : ''}`;
      lines.push(`- ${attempt.providerLabel} [${attempt.providerId}]: ${status}`);
    });
  }

  if (entry.text?.trim()) {
    const textBudget = entry.action === 'search' ? MAX_TEXT_CHARS_SEARCH : MAX_TEXT_CHARS_OPEN;
    lines.push('', 'Page content:', truncateWithMarker(entry.text.trim(), textBudget));
  } else if (entry.markdown?.trim()) {
    const textBudget = entry.action === 'search' ? MAX_TEXT_CHARS_SEARCH : MAX_TEXT_CHARS_OPEN;
    lines.push('', 'Page content (Markdown):', truncateWithMarker(entry.markdown.trim(), textBudget));
  }

  const compactedLinks = compactLinks(entry.links);
  if (compactedLinks.length > 0) {
    lines.push('', 'Links:');
    compactedLinks.forEach(link => {
      lines.push(`- [${link.index}] ${link.text} -> ${link.url}`);
    });
  }

  if (entry.forms.length > 0) {
    lines.push('', 'Forms:');
    entry.forms.forEach(form => {
      lines.push(`- [${form.index}] ${form.method} ${form.action}`);
      form.fields.forEach(field => {
        lines.push(`  - ${field.name} (${field.type})${field.value ? ` = ${field.value}` : ''}`);
      });
    });
  }

  if (entry.tables && entry.tables.length > 0) {
    lines.push('', 'Tables:');
    entry.tables.forEach((table, i) => {
      lines.push(`  Table ${i + 1}: ${table.headers.length} columns, ${table.rows.length} rows`);
      lines.push(table.markdown);
    });
  }

  if (entry.batchResults && entry.batchResults.length > 0) {
    lines.push('', `Research batch: ${entry.batchResults.length} pages crawled`);
    entry.batchResults.forEach((result, i) => {
      lines.push(`  [Depth ${result.depth}] ${result.title} - ${result.url}`);
      if (result.markdown.trim()) {
        lines.push(`  Content preview: ${result.markdown.slice(0, 500)}...`);
      }
    });
  }

  if (entry.tabs && entry.tabs.length > 0) {
    lines.push('', 'Tabs:');
    entry.tabs.forEach(tab => {
      lines.push(`- [${tab.index}] ${tab.active ? '*' : ' '} ${tab.title || '(untitled)'} -> ${tab.url}`);
    });
  }

  if (entry.observations && entry.observations.length > 0) {
    lines.push('', 'Observations:');
    entry.observations.forEach(note => {
      lines.push(`- ${note}`);
    });
  }

  if (entry.jsErrors && entry.jsErrors.length > 0) {
    lines.push('', 'JavaScript/runtime issues:');
    entry.jsErrors.forEach(issue => {
      lines.push(`- ${issue}`);
    });
  }

  if (entry.networkErrors && entry.networkErrors.length > 0) {
    lines.push('', 'Network issues:');
    entry.networkErrors.forEach(issue => {
      lines.push(`- ${issue}`);
    });
  }

  lines.push('', 'Use this result to continue the task. Separate observed evidence from inference, and do not claim a search or interaction succeeded unless these browser fields show that it did.');
  return lines.join('\n');
}

export const __test__ = {
  MAX_TEXT_CHARS_OPEN,
  MAX_TEXT_CHARS_SEARCH,
  MAX_LINKS,
  MAX_LINK_URL_LENGTH,
  truncateWithMarker,
  compactLinks,
  isJunkLinkUrl,
}
