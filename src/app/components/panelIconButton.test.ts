import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_EXPANDED_PANELS,
  PANEL_IDS,
  SIDE_RAIL_EXPANDED_STORAGE_KEY,
  isPanelId,
  panelIconButtonStyle,
  readExpandedPanels,
  writeExpandedPanels,
  type PanelId,
} from './panelIconButton'

/**
 * Minimal in-memory Storage stub. We don't use vi.fn() because the storage
 * helpers only call `getItem` / `setItem` and we want plain Map semantics
 * so the test reads as data, not mocks.
 */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: (key) => { map.delete(key) },
    clear: () => { map.clear() },
    key: (index) => Array.from(map.keys())[index] ?? null,
    get length() { return map.size },
  } as Storage
}

describe('panelIconButton', () => {
  afterEach(() => {
    /* no-op; tests do not mutate globals */
  })

  describe('isPanelId', () => {
    it('accepts all four valid panel ids', () => {
      for (const id of PANEL_IDS) {
        expect(isPanelId(id)).toBe(true)
      }
    })

    it('rejects unknown values', () => {
      expect(isPanelId('notAPanel')).toBe(false)
      expect(isPanelId('')).toBe(false)
      expect(isPanelId(null)).toBe(false)
      expect(isPanelId(42)).toBe(false)
      expect(isPanelId({})).toBe(false)
      expect(isPanelId(undefined)).toBe(false)
    })
  })

  describe('panelIconButtonStyle', () => {
    it('locks shape at 24x24 / rounded 6 across all tints', () => {
      for (const tint of PANEL_IDS) {
        const style = panelIconButtonStyle(tint)
        expect(style.width).toBe(24)
        expect(style.height).toBe(24)
        expect(style.borderRadius).toBe(6)
      }
    })

    it('switches cursor to wait when loading', () => {
      expect(panelIconButtonStyle('canvas').cursor).toBe('pointer')
      expect(panelIconButtonStyle('canvas', { loading: true }).cursor).toBe('wait')
      expect(panelIconButtonStyle('canvas', { loading: true }).opacity).toBe(0.7)
    })
  })

  describe('readExpandedPanels / writeExpandedPanels', () => {
    it('round-trips the expanded set through storage', () => {
      const storage = memoryStorage()
      const set: PanelId[] = ['workspaceFiles', 'networkHub']
      writeExpandedPanels(storage, set)
      expect(storage.getItem(SIDE_RAIL_EXPANDED_STORAGE_KEY)).toBe(JSON.stringify(set))
      const restored = readExpandedPanels(storage, PANEL_IDS)
      expect(restored).toEqual(set)
    })

    it('caps the persisted set at MAX_EXPANDED_PANELS on write', () => {
      const storage = memoryStorage()
      writeExpandedPanels(storage, ['canvas', 'workspaceFiles', 'networkHub'])
      const restored = readExpandedPanels(storage, PANEL_IDS)
      expect(restored).toHaveLength(MAX_EXPANDED_PANELS)
      expect(restored).toEqual(['canvas', 'workspaceFiles'])
    })

    it('drops panel ids that are not currently mounted', () => {
      const storage = memoryStorage()
      writeExpandedPanels(storage, ['canvas', 'liveBrowser'])
      // User disabled the internet toggle; liveBrowser is not mounted now.
      const restored = readExpandedPanels(storage, ['canvas', 'workspaceFiles', 'networkHub'])
      expect(restored).toEqual(['canvas'])
    })

    it('filters unknown ids and dedupes', () => {
      const storage = memoryStorage()
      // Hand-craft a corrupted payload to make sure the reader is defensive.
      storage.setItem(
        SIDE_RAIL_EXPANDED_STORAGE_KEY,
        JSON.stringify(['workspaceFiles', 'notAPanel', 'workspaceFiles', 'liveBrowser']),
      )
      const restored = readExpandedPanels(storage, PANEL_IDS)
      expect(restored).toEqual(['workspaceFiles', 'liveBrowser'])
    })

    it('returns an empty list when storage is missing or malformed', () => {
      const missing = readExpandedPanels(null, PANEL_IDS)
      expect(missing).toEqual([])

      const corrupted = memoryStorage()
      corrupted.setItem(SIDE_RAIL_EXPANDED_STORAGE_KEY, '{not json')
      expect(readExpandedPanels(corrupted, PANEL_IDS)).toEqual([])

      const wrongShape = memoryStorage()
      wrongShape.setItem(SIDE_RAIL_EXPANDED_STORAGE_KEY, JSON.stringify({ workspaceFiles: true }))
      expect(readExpandedPanels(wrongShape, PANEL_IDS)).toEqual([])
    })

    it('swallows setItem failures (private mode / quota)', () => {
      const throwing: Storage = {
        getItem: () => null,
        setItem: () => { throw new Error('QuotaExceededError') },
        removeItem: () => {},
        clear: () => {},
        key: () => null,
        length: 0,
      }
      // Should not throw.
      writeExpandedPanels(throwing, ['canvas'])
    })
  })
})
