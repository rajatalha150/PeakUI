export const THEME_OPTIONS = [
  {
    id: 'aurora',
    name: 'Aurora',
    description: 'The original violet and blue studio palette.',
    colors: ['#8b5cf6', '#3b82f6', '#0a0a0f'],
  },
  {
    id: 'graphite',
    name: 'Graphite',
    description: 'Clean grey theme with white text, inspired by ChatGPT.',
    colors: ['#10a37f', '#10a37f', '#212121'],
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Deep navy with cool cyan and soft violet contrast.',
    colors: ['#06b6d4', '#a78bfa', '#070b14'],
  },
  {
    id: 'evergreen',
    name: 'Canvas',
    description: 'Warm editorial light theme with sage and brass accents.',
    colors: ['#2f6b63', '#7b5a33', '#f4efe7'],
  },
  {
    id: 'burgundy',
    name: 'Ledger',
    description: 'Cool paper light theme with ink-blue and walnut contrast.',
    colors: ['#355c7d', '#8c5a43', '#eef2f6'],
  },
] as const

export type ThemeId = typeof THEME_OPTIONS[number]['id']

const THEME_IDS = new Set<string>(THEME_OPTIONS.map(theme => theme.id))

export function normalizeTheme(value: unknown): ThemeId {
  return typeof value === 'string' && THEME_IDS.has(value) ? value as ThemeId : 'aurora'
}

export function applyTheme(value: unknown) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = normalizeTheme(value)
}
