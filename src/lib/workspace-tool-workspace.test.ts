import { describe, expect, it } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

import {
  __test__,
  formatDarkWebSearchSection,
  getWorkspaceToolWorkspaceHostRoot,
  getUwafDarkWebDir,
  recordDarkWebSearchNote,
  type DarkWebSearchNoteEntry,
} from './workspace-tool-workspace'

function makeEntry(overrides: Partial<DarkWebSearchNoteEntry> = {}): DarkWebSearchNoteEntry {
  return {
    searchedAt: '2026-07-02T14:32:00.000Z',
    mode: 'stealth',
    stealthProfile: 'normal',
    providerId: 'ahmia',
    providerLabel: 'Ahmia',
    resultCount: 2,
    durationMs: 4200,
    query: 'leaked government documents archive onion',
    topResults: [
      {
        url: 'http://a.onion/x',
        title: 'Government Leak Archive',
        snippet: 'A long-running archive of leaked government documents.',
        category: 'news',
      },
      {
        url: 'http://b.onion/y',
        title: 'Discussion forum',
        snippet: 'A forum where journalists share tips.',
        category: 'forum',
      },
    ],
    success: true,
    ...overrides,
  }
}

describe('formatDarkWebSearchSection', () => {
  it('renders an H2 with timestamp, mode, provider, and result count', () => {
    const section = formatDarkWebSearchSection(makeEntry())
    expect(section.startsWith('## ')).toBe(true)
    expect(section).toContain('2026-07-02T14:32:00.000Z')
    expect(section).toContain('stealth')
    expect(section).toContain('Ahmia')
    expect(section).toContain('2 results')
  })

  it('includes the duration in seconds when provided', () => {
    const section = formatDarkWebSearchSection(makeEntry({ durationMs: 4200 }))
    expect(section).toContain('4.2s')
  })

  it('omits duration when not provided', () => {
    const section = formatDarkWebSearchSection(makeEntry({ durationMs: undefined }))
    expect(section).not.toContain('s ·')
  })

  it('renders each top result as a numbered markdown list with category', () => {
    const section = formatDarkWebSearchSection(makeEntry())
    expect(section).toContain('1. [Government Leak Archive](http://a.onion/x) _[news]_ — A long-running archive')
    expect(section).toContain('2. [Discussion forum](http://b.onion/y) _[forum]_ — A forum')
  })

  it('renders the failed-search note when there are no top results and success is false', () => {
    const section = formatDarkWebSearchSection(makeEntry({
      success: false,
      failureCode: 'search_failed',
      topResults: [],
      resultCount: 0,
    }))
    expect(section).toContain('failed · search_failed')
    expect(section).toContain('No rows survived dedup')
  })

  it('escapes backticks in the query so the code span stays single-line', () => {
    const section = formatDarkWebSearchSection(makeEntry({ query: 'foo `bar` baz' }))
    expect(section).toContain('foo \\`bar\\` baz')
  })

  it('renders the stealth profile when present', () => {
    const section = formatDarkWebSearchSection(makeEntry({ stealthProfile: 'high' }))
    expect(section).toContain('stealth (high)')
  })
})

describe('recordDarkWebSearchNote — filesystem behavior', () => {
  it('appends to an existing file instead of overwriting it', async () => {
    // Use a unique per-test workspace so the test does not collide with
    // production data. The writer uses getWorkspaceToolWorkspaceHostRoot()
    // and getUwafDarkWebDir() as-is; we override the env var.
    const previous = process.env.WORKSPACE_TOOL_HOST_WORKSPACE_DIR
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'peakui-darkweb-'))
    process.env.WORKSPACE_TOOL_HOST_WORKSPACE_DIR = tmpRoot
    try {
      const first = await recordDarkWebSearchNote(makeEntry({ query: 'first' }))
      expect(first.ok).toBe(true)
      const second = await recordDarkWebSearchNote(makeEntry({ query: 'second' }))
      expect(second.ok).toBe(true)
      const finalPath = path.join(getUwafDarkWebDir(), 'dark-web-searches.md')
      const content = await fs.readFile(finalPath, 'utf8')
      expect(content).toContain('# Dark Web Searches')
      expect(content).toContain('`first`')
      expect(content).toContain('`second`')
    } finally {
      if (previous === undefined) {
        delete process.env.WORKSPACE_TOOL_HOST_WORKSPACE_DIR
      } else {
        process.env.WORKSPACE_TOOL_HOST_WORKSPACE_DIR = previous
      }
      await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  it('creates the file with the header on first call', async () => {
    const previous = process.env.WORKSPACE_TOOL_HOST_WORKSPACE_DIR
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'peakui-darkweb-'))
    process.env.WORKSPACE_TOOL_HOST_WORKSPACE_DIR = tmpRoot
    try {
      const result = await recordDarkWebSearchNote(makeEntry())
      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await fs.readFile(result.path, 'utf8')
        expect(content).toContain(__test__.DARK_WEB_NOTES_HEADER)
      }
    } finally {
      if (previous === undefined) {
        delete process.env.WORKSPACE_TOOL_HOST_WORKSPACE_DIR
      } else {
        process.env.WORKSPACE_TOOL_HOST_WORKSPACE_DIR = previous
      }
      await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  it('returns ok:false (does not throw) when the workspace directory cannot be written', async () => {
    const previous = process.env.WORKSPACE_TOOL_HOST_WORKSPACE_DIR
    // Point the workspace at a file that already exists, so mkdir
    // recursive on its subpath fails. The writer must swallow the
    // error and return ok:false.
    const blockedDir = path.join(os.tmpdir(), `peakui-block-${Date.now()}`)
    await fs.writeFile(blockedDir, 'this is a file, not a directory')
    process.env.WORKSPACE_TOOL_HOST_WORKSPACE_DIR = blockedDir
    try {
      const result = await recordDarkWebSearchNote(makeEntry())
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.length).toBeGreaterThan(0)
      }
    } finally {
      if (previous === undefined) {
        delete process.env.WORKSPACE_TOOL_HOST_WORKSPACE_DIR
      } else {
        process.env.WORKSPACE_TOOL_HOST_WORKSPACE_DIR = previous
      }
      await fs.rm(blockedDir, { force: true }).catch(() => undefined)
    }
  })

  it('ensures the research/dark_web directory exists on first call', async () => {
    const previous = process.env.WORKSPACE_TOOL_HOST_WORKSPACE_DIR
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'peakui-darkweb-'))
    process.env.WORKSPACE_TOOL_HOST_WORKSPACE_DIR = tmpRoot
    try {
      // The dark_web subdir should not exist yet.
      const darkWebPath = path.join(getUwafDarkWebDir(), 'dark-web-searches.md')
      const beforeExists = await fs.stat(darkWebPath).then(() => true).catch(() => false)
      expect(beforeExists).toBe(false)
      await recordDarkWebSearchNote(makeEntry())
      const afterExists = await fs.stat(darkWebPath).then(() => true).catch(() => false)
      expect(afterExists).toBe(true)
    } finally {
      if (previous === undefined) {
        delete process.env.WORKSPACE_TOOL_HOST_WORKSPACE_DIR
      } else {
        process.env.WORKSPACE_TOOL_HOST_WORKSPACE_DIR = previous
      }
      await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  it('uses the host workspace root when WORKSPACE_TOOL_HOST_WORKSPACE_DIR is set', () => {
    const previous = process.env.WORKSPACE_TOOL_HOST_WORKSPACE_DIR
    process.env.WORKSPACE_TOOL_HOST_WORKSPACE_DIR = '/tmp/test-workspace-xyz'
    try {
      expect(getWorkspaceToolWorkspaceHostRoot()).toBe('/tmp/test-workspace-xyz')
    } finally {
      if (previous === undefined) {
        delete process.env.WORKSPACE_TOOL_HOST_WORKSPACE_DIR
      } else {
        process.env.WORKSPACE_TOOL_HOST_WORKSPACE_DIR = previous
      }
    }
  })
})
