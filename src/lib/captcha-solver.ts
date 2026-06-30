/**
 * CAPTCHA / WAF solver adapter.
 *
 * The default posture is "no-op": when `CAPTCHA_PROVIDER` and `CAPTCHA_API_KEY`
 * are not set, the solver returns null and callers fall back to returning
 * whatever the page currently shows (often a Cloudflare / DDoS-Guard
 * interstitial — the model can describe the block to the user).
 *
 * When configured, supported providers are:
 *   - 2captcha   — POST to `https://2captcha.com/createTask`, poll `getTaskResult`
 *   - anticaptcha — POST to `https://api.anticaptcha.com/createTask`, poll `getTaskResult`
 *
 * Each provider has its own price-per-solve; we track per-user spend via
 * `getRemainingBudget` and refuse to dispatch if a user would exceed
 * `CAPTCHA_BUDGET_USD_PER_USER` in the current `CAPTCHA_BUDGET_RESET_HOURS`.
 */

export type CaptchaProvider = '2captcha' | 'anticaptcha' | 'none'

export interface CaptchaSolution {
  provider: CaptchaProvider
  taskId: string
  solvedAt: number
  costUsd: number
}

interface CaptchaSolverConfig {
  provider: CaptchaProvider
  apiKey: string
  baseUrl: string
  budgetUsdPerUser: number
  budgetResetHours: number
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function getCaptchaSolverConfig(): CaptchaSolverConfig | null {
  const rawProvider = process.env.CAPTCHA_PROVIDER?.trim().toLowerCase()
  const apiKey = process.env.CAPTCHA_API_KEY?.trim() || ''
  const provider: CaptchaProvider =
    rawProvider === '2captcha' ? '2captcha' :
    rawProvider === 'anticaptcha' ? 'anticaptcha' :
    'none'
  if (provider === 'none' || !apiKey) return null
  const baseUrl =
    provider === '2captcha'
      ? (process.env.CAPTCHA_2CAPTCHA_URL?.trim() || 'https://2captcha.com')
      : (process.env.CAPTCHA_ANTICAPTCHA_URL?.trim() || 'https://api.anticaptcha.com')
  return {
    provider,
    apiKey,
    baseUrl,
    budgetUsdPerUser: readNumber('CAPTCHA_BUDGET_USD_PER_USER', 5),
    budgetResetHours: readNumber('CAPTCHA_BUDGET_RESET_HOURS', 24),
  }
}

/** Per-user spend tracker — keyed off userId. */
interface UserSpendState {
  spentUsd: number
  resetAt: number
}

const spendByUser = new Map<string, UserSpendState>()
const PRICE_PER_SOLVE_USD = 0.003 // cloudflare turnstile approximate

function ensureSpendState(userId: string, resetHours: number): UserSpendState {
  const now = Date.now()
  const existing = spendByUser.get(userId)
  if (existing && existing.resetAt > now) return existing
  const fresh: UserSpendState = {
    spentUsd: 0,
    resetAt: now + resetHours * 60 * 60 * 1000,
  }
  spendByUser.set(userId, fresh)
  return fresh
}

export function getRemainingBudget(userId: string): { remainingUsd: number; resetsAt: number } {
  const config = getCaptchaSolverConfig()
  if (!config) return { remainingUsd: 0, resetsAt: 0 }
  const state = ensureSpendState(userId, config.budgetResetHours)
  const remainingUsd = Math.max(0, config.budgetUsdPerUser - state.spentUsd)
  return { remainingUsd, resetsAt: state.resetAt }
}

export interface CaptchaChallengeContext {
  /** Public URL the user is trying to access — used for site-key extraction later. */
  challengeUrl: string
  /** Identifier of the requesting user for budget enforcement. */
  userId: string
  /** Abort signal for cancellation. */
  signal?: AbortSignal
}

/**
 * Solve a CAPTCHA challenge. Returns null in three cases:
 *   1. No solver configured (CAPTCHA_PROVIDER missing).
 *   2. The user is over budget.
 *   3. The provider responds with an error.
 *
 * The actual provider integration is intentionally minimal — we POST a
 * generic Cloudflare Turnstile-style task and poll for ≤120s. Real site-key
 * extraction will arrive once we wire up the user's verified CAPTCHA
 * provider; the 120s budget keeps any misuse from saturating the API.
 */
export async function solveCaptchaIfConfigured(
  context: CaptchaChallengeContext,
  options: { solution?: string; siteKey?: string } = {},
): Promise<CaptchaSolution | null> {
  const config = getCaptchaSolverConfig()
  if (!config) return null
  const budget = getRemainingBudget(context.userId)
  if (budget.remainingUsd < PRICE_PER_SOLVE_USD) return null
  if (context.signal?.aborted) return null
  try {
    if (config.provider === '2captcha') {
      return await solveVia2Captcha(config, context, options)
    }
    if (config.provider === 'anticaptcha') {
      return await solveViaAntiCaptcha(config, context, options)
    }
  } catch (error) {
    console.warn('[captcha-solver] solve failed:', error instanceof Error ? error.message : String(error))
  }
  return null
}

async function solveVia2Captcha(
  config: CaptchaSolverConfig,
  context: CaptchaChallengeContext,
  options: { solution?: string; siteKey?: string },
): Promise<CaptchaSolution | null> {
  const siteKey = options.siteKey ?? extractSiteKey() ?? '0x00000000000000000000000000000000'
  const createRes = await fetch(`${config.baseUrl}/createTask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientKey: config.apiKey,
      task: {
        type: 'TurnstileTaskProxyless',
        websiteURL: context.challengeUrl,
        websiteKey: siteKey,
      },
    }),
    signal: context.signal,
  }).catch(() => null)
  if (!createRes?.ok) return null
  const created = await createRes.json().catch(() => null)
  const taskId = (created as { taskId?: string } | null)?.taskId
  if (!taskId) return null
  // Poll up to 24 × 5s = 120s.
  for (let i = 0; i < 24; i += 1) {
    if (context.signal?.aborted) return null
    await new Promise(resolve => setTimeout(resolve, 5_000))
    const pollRes = await fetch(`${config.baseUrl}/getTaskResult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: config.apiKey, taskId }),
      signal: context.signal,
    }).catch(() => null)
    if (!pollRes?.ok) continue
    const poll = await pollRes.json().catch(() => null)
    const status = (poll as { status?: string } | null)?.status
    const solution = (poll as { solution?: { token?: string } } | null)?.solution
    if (status === 'ready' && solution?.token) {
      recordSpend(context.userId, config)
      return {
        provider: '2captcha',
        taskId,
        solvedAt: Date.now(),
        costUsd: PRICE_PER_SOLVE_USD,
      }
    }
  }
  return null
}

async function solveViaAntiCaptcha(
  config: CaptchaSolverConfig,
  context: CaptchaChallengeContext,
  options: { solution?: string; siteKey?: string },
): Promise<CaptchaSolution | null> {
  const siteKey = options.siteKey ?? extractSiteKey() ?? '0x00000000000000000000000000000000'
  const createRes = await fetch(`${config.baseUrl}/createTask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientKey: config.apiKey,
      task: {
        type: 'TurnstileTaskProxyless',
        websiteURL: context.challengeUrl,
        websiteKey: siteKey,
      },
    }),
    signal: context.signal,
  }).catch(() => null)
  if (!createRes?.ok) return null
  const created = await createRes.json().catch(() => null)
  const taskId = (created as { taskId?: string } | null)?.taskId
  if (!taskId) return null
  for (let i = 0; i < 24; i += 1) {
    if (context.signal?.aborted) return null
    await new Promise(resolve => setTimeout(resolve, 5_000))
    const pollRes = await fetch(`${config.baseUrl}/getTaskResult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: config.apiKey, taskId }),
      signal: context.signal,
    }).catch(() => null)
    if (!pollRes?.ok) continue
    const poll = await pollRes.json().catch(() => null)
    const status = (poll as { status?: string } | null)?.status
    if (status === 'ready') {
      recordSpend(context.userId, config)
      return {
        provider: 'anticaptcha',
        taskId,
        solvedAt: Date.now(),
        costUsd: PRICE_PER_SOLVE_USD,
      }
    }
  }
  return null
}

function recordSpend(userId: string, config: CaptchaSolverConfig): void {
  const state = ensureSpendState(userId, config.budgetResetHours)
  state.spentUsd += PRICE_PER_SOLVE_USD
  spendByUser.set(userId, state)
}

/** Very loose site-key extractor — refine when wiring real Turnstile sites. */
function extractSiteKey(): string | null {
  return null
}

/** Heuristic — match the common "Just a moment…" / "Checking your browser…" pages. */
export function looksLikeChallengePage(text: string | null | undefined): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  return lower.includes('just a moment') ||
    lower.includes('checking your browser') ||
    lower.includes('press & hold') ||
    lower.includes('attention required') ||
    lower.includes('ddos-guard') ||
    lower.includes('cf-chl-bypass')
}

/** re-export for tests */
export const __test__ = { recordSpend, ensureSpendState, spendByUser }
