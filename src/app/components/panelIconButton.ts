import type { CSSProperties } from 'react'

/**
 * Per-panel color tints for the side-rail header icon buttons (minimize +
 * refresh). The four panels each get a distinct hue so the buttons are
 * scannable at a glance and the minimize affordance for each panel is
 * visually anchored to its content.
 */
export type PanelTint = 'canvas' | 'workspaceFiles' | 'networkHub' | 'liveBrowser'

/**
 * Stable identity for each side-rail panel. Identical to `PanelTint` so a
 * single union drives both the button color and the expand/collapse state
 * registry in `WorkspaceToolWorkspace`.
 */
export type PanelId = PanelTint

export const PANEL_IDS: readonly PanelId[] = [
  'canvas',
  'workspaceFiles',
  'networkHub',
  'liveBrowser',
] as const

/** Maximum number of side-rail panels that may be expanded at once. */
export const MAX_EXPANDED_PANELS = 2

/**
 * localStorage key for the persisted set of expanded panels. Single key for
 * the whole rail so the cap and ordering stay consistent across all four
 * panels. Stored value is a JSON array of `PanelId` strings.
 */
export const SIDE_RAIL_EXPANDED_STORAGE_KEY = 'workspace-tool.sideRail.expandedPanels'

/** Type guard for a value parsed from localStorage. */
export function isPanelId(value: unknown): value is PanelId {
  return typeof value === 'string'
    && (PANEL_IDS as readonly string[]).includes(value)
}

export interface PanelIconButtonOptions {
  /**
   * When true (e.g. a refresh button while a fetch is in flight), the cursor
   * becomes a spinner and the button dims slightly so the in-flight state
   * is readable.
   */
  loading?: boolean
}

interface TintSpec {
  /** sRGB hex triplet, used as the basis for all three alpha stops. */
  base: string
}

const TINTS: Record<PanelTint, TintSpec> = {
  // Orange→red: warm, "creative / generated artifact" reading for Canvas.
  canvas: { base: '#f97316' },
  // Yellow→orange: a half-step lighter than Canvas so the two adjacent
  // panels don't read as the same hue.
  workspaceFiles: { base: '#eab308' },
  // Green: signals "connected / live status" for the network hub.
  networkHub: { base: '#22c55e' },
  // Blue: cool counterpart to the warm content panels, signals the
  // live browser surface.
  liveBrowser: { base: '#3b82f6' },
}

/**
 * Build the inline style for a side-rail panel header icon button.
 *
 * Shape is locked across panels: 24×24, rounded 6, centered icon. The tint
 * drives border, faint background fill, and icon color so each panel's
 * buttons are immediately identifiable.
 */
export function panelIconButtonStyle(
  tint: PanelTint,
  options: PanelIconButtonOptions = {},
): CSSProperties {
  const { base } = TINTS[tint]
  return {
    width: 24,
    height: 24,
    borderRadius: 6,
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    cursor: options.loading ? 'wait' : 'pointer',
    transition: 'all 0.15s ease',
    border: `1px solid ${hexToRgba(base, 0.5)}`,
    background: hexToRgba(base, 0.12),
    color: hexToRgba(base, 0.75),
    opacity: options.loading ? 0.7 : 1,
  }
}

/**
 * Read the persisted set of expanded panel IDs from localStorage. Always
 * intersects with `mounted` so a panel the user has disabled (e.g. turned
 * off the internet toggle hiding the live browser) does not silently come
 * back expanded. The returned array preserves the original order so the
 * caller can use it directly as the initial expanded set.
 */
export function readExpandedPanels(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  mounted: readonly PanelId[],
): PanelId[] {
  if (!storage) return []
  let raw: string | null = null
  try {
    raw = storage.getItem(SIDE_RAIL_EXPANDED_STORAGE_KEY)
  } catch {
    return []
  }
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const mountedSet = new Set(mounted)
  const seen = new Set<PanelId>()
  const result: PanelId[] = []
  for (const candidate of parsed) {
    if (!isPanelId(candidate)) continue
    if (!mountedSet.has(candidate)) continue
    if (seen.has(candidate)) continue
    seen.add(candidate)
    result.push(candidate)
    if (result.length >= MAX_EXPANDED_PANELS) break
  }
  return result
}

/**
 * Persist the current expanded set. Silently no-ops if storage is
 * unavailable (private mode, quota, etc.). The cap is enforced on write so
 * the stored shape can never represent an invalid state.
 */
export function writeExpandedPanels(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  expanded: readonly PanelId[],
): void {
  if (!storage) return
  const capped = expanded.slice(0, MAX_EXPANDED_PANELS)
  try {
    storage.setItem(SIDE_RAIL_EXPANDED_STORAGE_KEY, JSON.stringify(capped))
  } catch {
    /* best-effort */
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  const r = parseInt(normalized.slice(0, 2), 16)
  const g = parseInt(normalized.slice(2, 4), 16)
  const b = parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export const __test__ = { hexToRgba, TINTS, readExpandedPanels, writeExpandedPanels }
