/**
 * Pure formatting helpers for the various WorkspaceTool tool results that get
 * surfaced to the model on the next inference turn.
 *
 * Keeping these out of the giant `WorkspaceToolWorkspace.tsx` component lets us
 * unit-test the output shape (including size guards) without spinning up
 * React. The component just imports the formatter it needs.
 */

import { wrapUntrustedToolResult } from './workspace-tool-tool-output-trust';

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
  /**
   * Optional clustered result digest for stealth searches. Mirrors the
   * shape on `UwafBrowserResult.clusteredResults` (uwaf-browser.ts).
   * When present, the formatter renders a compact, category-grouped
   * bullet list in addition to the full link list above.
   */
  clusteredResults?: {
    categories: Record<string, Array<{
      url: string;
      title: string;
      snippet: string;
      category: string;
      providerId: string;
      rank: number;
    }>>;
    total: number;
    presentCategories: string[];
    dedupStats: { input: number; unique: number; dropped: number };
    providersUsed: string[];
  };
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
 * Human-readable guidance for a `failureCode` value produced by the
 * unified_browser runtime. The raw codes are technical and the model
 * can't reliably distinguish "Tor is down" from "Ahmia is anti-botting
 * us" from "the .onion is dead" without help.
 *
 * Returns a `{ short, detail }` pair:
 *   - `short`: a one-line summary the model can quote to the user.
 *   - `detail`: actionable guidance including the next step the model
 *               should usually take (use a different provider, switch
 *               modes, request human takeover, etc.).
 *
 * The failure code set is the union of `UwafFailureCode` in
 * `uwaf-browser.ts:100-114` plus the onion-resolution codes in
 * `uwaf-pool.ts:135-144`. Unrecognized codes fall through to a
 * generic "search did not succeed" message so the model still gets
 * something useful.
 */
export interface UwafFailureGuidance {
  short: string
  detail: string
}

export function humanizeUwafFailureCode(
  code: string | undefined | null,
  context: { mode?: 'direct' | 'stealth'; resultCount?: number; isOnion?: boolean } = {},
): UwafFailureGuidance | null {
  if (!code) return null
  const normalized = code.trim().toLowerCase()
  if (!normalized) return null
  switch (normalized) {
    case 'tor_unavailable':
      return {
        short: 'The Tor proxy is unreachable from this container.',
        detail: 'Verify `tor-proxy` is healthy and `TOR_PROXY_URL` resolves to a reachable SOCKS5 endpoint. Direct mode still works for clear-web research.',
      }
    case 'timeout':
      return {
        short: context.isOnion
          ? 'The .onion site did not respond within the configured budget.'
          : 'The site did not respond within the configured budget.',
        detail: 'Tor circuits can take 5-30 seconds to build for new destinations. Try again, or switch to a different approved provider via `providerId`.',
      }
    case 'anti_bot_detected':
      return {
        short: 'The destination presented a CAPTCHA or anti-bot challenge.',
        detail: 'Use `wait_for_user` to let the user solve it, or switch to a different approved provider.',
      }
    case 'login_required':
      return {
        short: 'The destination requires authentication.',
        detail: 'Use `wait_for_user` to let the user sign in, then resume from the observed page state.',
      }
    case 'connection_refused':
      return {
        short: context.isOnion
          ? 'The .onion service refused the connection.'
          : 'The site refused the connection.',
        detail: 'The destination may be offline. Try a different approved entry point, or use `wait_for_user` if the user can verify the URL.',
      }
    case 'onion_not_found':
      return {
        short: 'The .onion address is unreachable or no longer exists.',
        detail: 'Verify the address — v3 .onion is 56 characters, lowercase a-z and 2-7 only. Address verified unreachable after 2 attempts.',
      }
    case 'navigation_failed':
      return {
        short: 'The page failed to load.',
        detail: 'The destination may be down or blocking automated access. Try a different approved entry point, or switch to Direct mode if the topic is also indexed on the clear web.',
      }
    case 'homepage_bounce':
      return {
        short: 'The search request bounced back to a search homepage.',
        detail: 'The provider may have rate-limited or rejected the query phrasing. Try a different query, or switch to another approved provider.',
      }
    case 'search_failed':
      if ((context.resultCount ?? 0) === 0) {
        return {
          short: 'All approved providers returned zero results for this query.',
          detail: 'Try a different query phrasing. If the topic is also indexed on the clear web, switch to Direct mode.',
        }
      }
      return {
        short: 'The search did not produce a usable results page.',
        detail: 'The provider loaded a page but the result blocks did not match the query strongly enough. Try a different provider, or refine the query.',
      }
    case 'empty_response':
      return {
        short: 'The destination returned an empty body.',
        detail: 'The site may be offline or blocking automated access. Try a different approved entry point.',
      }
    case 'invalid_onion_host':
      return {
        short: 'The .onion URL is malformed.',
        detail: 'v3 .onion is 56 characters, lowercase a-z and 2-7 only. Verify the address.',
      }
    default:
      return {
        short: 'The browser action failed.',
        detail: `Unrecognized failure code: "${code}". Use a different approved provider, or switch modes if the topic is also available on the clear web.`,
      }
  }
}

/**
 * Detect whether a URL is an .onion address. Used to pick the right
 * humanized message for the failure code (e.g. "The .onion site did
 * not respond" vs "The site did not respond").
 */
function isOnionUrlLocal(url: string | undefined): boolean {
  if (!url) return false
  try {
    return new URL(url).hostname.toLowerCase().endsWith('.onion')
  } catch {
    return false
  }
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
    // Human-readable guidance keyed off the failure code. This is the
    // actionable text the model uses to decide the next step (switch
    // providers, use wait_for_user, switch modes, etc.).
    const guidance = humanizeUwafFailureCode(entry.failureCode, {
      mode: entry.mode,
      resultCount: entry.resultCount,
      isOnion: isOnionUrlLocal(entry.requestedUrl) || isOnionUrlLocal(entry.finalUrl) || isOnionUrlLocal(entry.currentUrl),
    });
    if (guidance) {
      lines.push('', `What this means: ${guidance.short}`);
      lines.push(`Next step: ${guidance.detail}`);
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
    // Page content is raw rendered page text (SERP bodies, article text) —
    // the primary prompt-injection vector. Truncate first to bound the size,
    // then wrap as untrusted so embedded instructions / forged delimiters
    // can't be read as task signals. The trusted "Page content:" label and
    // the structured link/form lists below stay outside the wrap.
    lines.push('', 'Page content:', wrapUntrustedToolResult('uwaf-browser', truncateWithMarker(entry.text.trim(), textBudget)));
  } else if (entry.markdown?.trim()) {
    const textBudget = entry.action === 'search' ? MAX_TEXT_CHARS_SEARCH : MAX_TEXT_CHARS_OPEN;
    lines.push('', 'Page content (Markdown):', wrapUntrustedToolResult('uwaf-browser', truncateWithMarker(entry.markdown.trim(), textBudget)));
  }

  const compactedLinks = compactLinks(entry.links);
  if (compactedLinks.length > 0) {
    lines.push('', 'Links:');
    compactedLinks.forEach(link => {
      lines.push(`- [${link.index}] ${link.text} -> ${link.url}`);
    });
  }

  // Clustered-result digest (stealth searches). The full link list
  // above is still emitted; this section is the structured shortcut
  // the model can read first to skip rank-1 spam and find the
  // strongest surviving rows.
  if (entry.clusteredResults && entry.clusteredResults.total > 0) {
    const cr = entry.clusteredResults
    lines.push(
      '',
      `Clustered results (${cr.total} unique after dedup of ${cr.dedupStats.input}, providers: ${cr.providersUsed.join(', ')}):`,
    )
    for (const category of cr.presentCategories) {
      const rows = cr.categories[category]
      if (!rows || rows.length === 0) continue
      lines.push(`  [${category}]`)
      for (const row of rows.slice(0, 5)) {
        const snippet = row.snippet ? ` — ${row.snippet.slice(0, 160)}` : ''
        lines.push(`  - ${row.title} -> ${row.url}${snippet}`)
      }
    }
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
  humanizeUwafFailureCode,
}
