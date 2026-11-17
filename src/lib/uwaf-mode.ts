export type UwafBrowserMode = 'direct' | 'stealth'

const DARK_WEB_INTENT_RE =
  /\.onion|\b(?:dark[\s-]*web|dark[\s-]*net|hidden\s+services?|tor\s+hidden|onion\s+sites?|onion\s+links?|ahmia|onionway|tor66)\b/i

/**
 * Return true when the URL or target string refers to a `.onion` hidden service.
 */
export function isOnionTarget(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false
  const trimmed = url.trim().toLowerCase()
  if (!trimmed) return false
  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`)
    if (parsed.hostname.includes('.onion')) return true
  } catch {
    // Fall back to raw string matching below when URL lacks full scheme syntax.
  }
  return trimmed.includes('.onion')
}

/**
 * Return true when text explicitly signals dark-web / Tor / `.onion` intent.
 */
export function isDarkWebIntentText(text?: string | null): boolean {
  if (!text || typeof text !== 'string') return false
  const trimmed = text.trim()
  if (!trimmed) return false
  return DARK_WEB_INTENT_RE.test(trimmed)
}

/**
 * Resolve the effective UWAF browser mode for a tool request.
 * `.onion` targets and dark-web intent queries always upgrade to `'stealth'`
 * so callers with a default `'direct'` UI toggle never fail dark-web actions.
 */
export function resolveEffectiveUwafBrowserMode(input: {
  explicitMode?: UwafBrowserMode | null
  preferredMode?: UwafBrowserMode | null
  action?: string
  url?: string
  query?: string
}): UwafBrowserMode {
  if (isOnionTarget(input.url)) return 'stealth'
  if (isDarkWebIntentText(input.query)) return 'stealth'
  if (input.explicitMode === 'stealth' || input.explicitMode === 'direct') {
    return input.explicitMode
  }
  if (input.preferredMode === 'stealth' || input.preferredMode === 'direct') {
    return input.preferredMode
  }
  return 'direct'
}
