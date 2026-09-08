/**
 * Objective-anchoring and divergence guard for the WorkSpaces agent loop.
 *
 * Background — the failure this guards against:
 *   A user gives a clear objective ("analyze the stock market for the best
 *   options play"). The agent's FIRST search is on-topic and returns good
 *   results. Then, on a long browsing session with a large noisy SERP in
 *   context, a local model loses the thread: it falsely declares its own
 *   on-topic results "off-topic," abandons the objective, and pivots to an
 *   unrelated search ("bypassing network restrictions…"), answering a
 *   question the user never asked.
 *
 * Two pure, storage-agnostic defenses live here:
 *
 *   1. `buildObjectiveAnchorMessage` — a short reminder re-asserting the
 *      user's objective. The agent loop prepends this as the *last* message
 *      every tool round so the objective wins recency against the growing
 *      tool-result history (the static top-of-context objective brief gets
 *      buried otherwise).
 *
 *   2. `isSearchRequestRelevantToObjective` + `buildObjectiveDivergenceNudge`
 *      — before dispatching a SEARCH, compare its query to the recorded
 *      objective. If the query is unrelated AND the agent already has an
 *      on-topic search result in hand, inject a nudge telling it to refine
 *      the query (not switch the topic) and skip the off-topic dispatch.
 *      Bounded so it can't loop forever; falls through after the budget.
 *
 * Scope is deliberately narrow: only `web` and `unified_browser` *search*
 * actions are checked. Page opens, fetch_summarize, shell, and document/code
 * tools are NOT checked — URL/command relevance is too noisy to hard-block
 * without false positives, and those tools aren't where the demonstrated
 * topic-pivot failure happened.
 */
import type { WorkspaceToolRequest } from './workspace-tool-tools'

/**
 * Stopwords removed before comparing an objective to a search query. Kept
 * small and conservative — we'd rather under-match (and not block) than
 * over-match and false-positive on a legitimate refinement.
 */
const OBJECTIVE_STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'for', 'of', 'to', 'in', 'on', 'at',
  'by', 'with', 'from', 'as', 'is', 'are', 'be', 'best', 'top', 'good',
  'me', 'my', 'please', 'can', 'you', 'i', 'about', 'how', 'what', 'why',
  'do', 'does', 'did', 'show', 'give', 'find', 'get', 'list', 'latest',
  'current', 'this', 'that', 'it', 's', 't',
])

/**
 * Domain synonym groups. A search that uses a *related* term (e.g. "S&P 500"
 * for a "stock market" objective) is a legitimate refinement, not a topic
 * pivot. Each group maps every member to a canonical key; two keywords are
 * "related" when they share a canonical key. This fixes the false positive
 * where "analyze stock market today" blocked "S&P 500 intraday trading
 * analysis technical levels" because the literal tokens didn't overlap.
 */
const OBJECTIVE_SYNONYM_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  // Equities / market indices
  ['stock', 'stocks', 'equity', 'equities', 'market', 'markets', 'index', 'indices', 'sp500', 's&p', 'nasdaq', 'dow', 'dowjones', 'intraday', 'trading', 'trade', 'ticker', 'tickers', 'share', 'shares', 'securities', 'wallstreet', 'benchmark'],
  // Technical analysis
  ['technical', 'technicals', 'resistance', 'support', 'volume', 'profile', 'levels', 'chart', 'charts', 'candlestick', 'movingaverage', 'rsi', 'macd', 'breakout', 'trend', 'momentum'],
  // Sector / rotation
  ['sector', 'sectors', 'rotation', 'cyclical', 'defensive', 'technology', 'financials', 'energy', 'healthcare', 'consumer', 'industrials', 'materials', 'utilities', 'realestate'],
  // Macro / Fed
  ['fed', 'federal', 'reserve', 'rate', 'rates', 'fomc', 'inflation', 'cpi', 'jobs', 'payrolls', 'unemployment', 'macro', 'economic', 'economy', 'gdp', 'yield', 'yields', 'treasury', 'bond', 'bonds'],
  // Earnings / catalysts
  ['earnings', 'catalyst', 'catalysts', 'outlook', 'forecast', 'analysis', 'analyst', 'analysts', 'valuation', 'sentiment', 'volatility', 'vix'],
]

/**
 * Canonical key for a keyword, or null if it belongs to no synonym group.
 */
function canonicalKeyword(keyword: string): string | null {
  for (const group of OBJECTIVE_SYNONYM_GROUPS) {
    if (group.includes(keyword)) return group[0]
  }
  return null
}

/**
 * Tokenize free text into a set of meaningful lowercase keywords.
 * Drops tokens shorter than 3 chars and stopwords so "analyze stock market
 * for best options play" → { analyze, stock, market, options, play }.
 */
export function extractObjectiveKeywords(text: string): Set<string> {
  // Split on any non-alphanumeric run so "stock-market" and "don't" tokenize
  // into ["stock","market"] / ["don","t"] rather than one fused token.
  const matches = (text || '').toLowerCase().match(/[a-z0-9]+/g) ?? []
  const out = new Set<string>()
  for (const word of matches) {
    if (word.length >= 3 && !OBJECTIVE_STOP_WORDS.has(word)) {
      out.add(word)
    }
  }
  return out
}

/**
 * Extract the human-readable "topic signal" from a tool request — the text
 * whose subject matter we compare against the objective. Returns null for
 * tools/actions we deliberately don't check (non-search), which the caller
 * treats as "no guard applies — allow."
 */
export function extractSearchSignal(request: WorkspaceToolRequest): { signal: string; kind: string } | null {
  if (request.name === 'web') {
    return { signal: request.request.query, kind: 'web' }
  }
  if (request.name === 'unified_browser') {
    const uwaf = request.request as { action?: string; query?: string }
    if (uwaf.action === 'search' && uwaf.query) {
      return { signal: uwaf.query, kind: 'unified_browser:search' }
    }
    return null
  }
  return null
}

export interface ObjectiveRelevanceResult {
  /** true when the search may advance the objective (or no check applies). */
  relevant: boolean
  /** the signal text that was compared, or null when no check applies. */
  signal: string | null
  /** short human-readable explanation for logging/nudging. */
  reason: string
}

/**
 * Decide whether a search request is plausibly on-topic for the objective.
 *
 * Returns relevant=true (no check) when:
 *   - the objective is empty (nothing to anchor to — let the model explore), or
 *   - the tool isn't a search we check (extractSearchSignal returned null).
 *
 * Otherwise relevant=true iff the search query and the objective share at
 * least one meaningful keyword. A single shared keyword is a low bar on
 * purpose: we only want to catch a *gross* topic pivot, not a legitimate
 * synonym/refinement. The caller additionally gates the hard block on
 * "an on-topic result already exists," so a first exploratory search is
 * never blocked by this heuristic alone.
 */
export function isSearchRequestRelevantToObjective(
  objective: string,
  request: WorkspaceToolRequest,
): ObjectiveRelevanceResult {
  const trimmedObjective = (objective || '').trim()
  if (!trimmedObjective) {
    return { relevant: true, signal: null, reason: 'no objective recorded' }
  }

  const signal = extractSearchSignal(request)
  if (!signal) {
    return { relevant: true, signal: null, reason: 'not a search action — no topic check' }
  }

  const objectiveKeywords = extractObjectiveKeywords(trimmedObjective)
  const queryKeywords = extractObjectiveKeywords(signal.signal)
  if (objectiveKeywords.size === 0 || queryKeywords.size === 0) {
    return { relevant: true, signal: signal.signal, reason: 'could not extract keywords' }
  }

  // Compare canonical keys so related terms (e.g. "stock market" vs "S&P 500
  // intraday trading") count as on-topic. A literal keyword match is still
  // checked first (cheap, and exact matches are the strongest signal).
  let shared = 0
  for (const keyword of queryKeywords) {
    if (objectiveKeywords.has(keyword)) shared += 1
  }

  // Synonym-aware fallback: if no literal overlap, check whether any query
  // keyword shares a canonical group with any objective keyword.
  if (shared === 0) {
    const objectiveCanonical = new Set<string>()
    for (const keyword of objectiveKeywords) {
      const canonical = canonicalKeyword(keyword)
      if (canonical) objectiveCanonical.add(canonical)
    }
    for (const keyword of queryKeywords) {
      const canonical = canonicalKeyword(keyword)
      if (canonical && objectiveCanonical.has(canonical)) shared += 1
    }
  }

  if (shared > 0) {
    return { relevant: true, signal: signal.signal, reason: `shares ${shared} keyword(s) with the objective` }
  }
  return {
    relevant: false,
    signal: signal.signal,
    reason: 'shares no keywords with the objective — possible topic pivot',
  }
}

/**
 * The per-round objective re-anchor. Injected as the *last* message each tool
 * round so the objective wins recency against the growing tool-result history.
 * Kept short and imperative — local models attend to recent, concrete text.
 */
export function buildObjectiveAnchorMessage(objective: string): string {
  const trimmed = (objective || '').trim()
  if (!trimmed) return ''
  return [
    'Reminder — the user’s objective for this turn is:',
    trimmed,
    'Judge every new search result and tool output by whether it advances THIS objective. Do not declare on-topic results “off-topic,” and do not switch to a different topic. If current results are insufficient, refine the search query — do not change the goal.',
  ].join('\n')
}

/**
 * The divergence nudge injected when a search query is off-topic relative to
 * the objective. `hadRelevantResult` toggles the wording: when the agent
 * already has an on-topic result, the nudge is firm (you have what you need,
 * refine the query); otherwise it is a softer caution (explain the
 * connection or align to the objective).
 *
 * Plain text only — never contains `<workspace_tool>` or angle-bracketed
 * placeholder tokens, so it cannot trip the template-placeholder guard or
 * the malformed-wrapper detector.
 */
export function buildObjectiveDivergenceNudge(
  objective: string,
  request: WorkspaceToolRequest,
  hadRelevantResult: boolean,
): string {
  const trimmed = (objective || '').trim()
  const signal = extractSearchSignal(request)
  const queryText = signal?.signal ?? '(unavailable)'
  if (hadRelevantResult) {
    return [
      `Your earlier search was on-topic for the objective and already returned usable results. Your new search (“${queryText}”) is unrelated to the objective and looks like a topic switch — do not run it.`,
      `Objective: ${trimmed}`,
      'Do NOT declare your prior on-topic results “off-topic.” If you need different results, refine the query to stay on the objective. If the results you have are enough, stop searching and answer the user.',
    ].join('\n')
  }
  return [
    `Your planned search (“${queryText}”) shares no keywords with the objective, so it may be a topic switch.`,
    `Objective: ${trimmed}`,
    'Either rephrase the search so it clearly advances the objective, or proceed with the results you already have. Do not abandon the objective.',
  ].join('\n')
}

/**
 * The hard "stop calling tools and answer now" nudge injected when the agent
 * has cycled (>= MAX_CYCLE_NOTICES immediate/cycle-repeat notices) or is near
 * the productive tool budget. Two observed failures this closes:
 *   - The agent ran ~50 tool rounds and never produced a final answer.
 *   - The agent kept evading the existing "stop and answer" notice by varying
 *     the action/query of each call, so cycle detection fired 10× with no
 *     effect.
 *
 * Once this nudge is in play the loop DISABLES further tool dispatch for the
 * turn, so the model cannot keep calling tools — it must produce text. The
 * nudge is deliberately permissive about exactly one escape: if the model
 * genuinely cannot answer with the evidence it has, it may ask the user to
 * grant more turns (the visible pause / its own response will tell the user
 * to reply "continue"). It must NOT silently keep calling tools, and must
 * NOT just stop without a response.
 *
 * Plain text only — no `<workspace_tool>` and no angle-bracketed placeholder
 * tokens — so it cannot trip the template-placeholder guard or the
 * malformed-wrapper detector.
 */
export function buildForcedSynthesisNudge(): string {
  return [
    'You have used many tool steps and are now repeating the same tool calls without converging on an answer. Stop calling tools for the rest of THIS turn.',
    'You have already gathered enough evidence to be useful. Write your final answer now, in plain text, using the results you already collected. Further tool calls from this point are ignored, so do not emit any.',
    'If — and only if — you genuinely cannot answer at all with the evidence you have, say so explicitly in your plain-text response and ask the user to reply “continue” to grant you more tool turns. Otherwise, synthesize the best answer you can from what you collected; do not ask for more turns you do not need.',
  ].join('\n')
}