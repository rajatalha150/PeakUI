import type { CSSProperties } from 'react'

/**
 * Per-panel color tints for the side-rail header icon buttons (minimize +
 * refresh). The four panels each get a distinct hue so the buttons are
 * scannable at a glance and the minimize affordance for each panel is
 * visually anchored to its content.
 */
export type PanelTint = 'canvas' | 'workspaceFiles' | 'networkHub' | 'liveBrowser'

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

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  const r = parseInt(normalized.slice(0, 2), 16)
  const g = parseInt(normalized.slice(2, 4), 16)
  const b = parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export const __test__ = { hexToRgba, TINTS }
