import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authorizeCoderSession,
  bindCoderSessionWorkspace,
  extractCoderSessionId,
  isFileOperationPath,
  isPrivilegedCoderPath,
  isSessionPath,
  normalizeCoderFilePath,
  normalizeCoderWorkspacePath,
} from './coder-authorization'

const prismaMock = vi.hoisted(() => ({
  chatSession: { findUnique: vi.fn(), updateMany: vi.fn() },
}))

vi.mock('./prisma', () => ({ prisma: prismaMock }))

/**
 * The coder gateway is a pass-through to a SINGLE shared daemon process, so the
 * only thing standing between a user and another user's live session is the
 * ownership check in this module. The path shape tests guard against a crafted
 * `/session/<uuid>` reattach, and the workspace normalisation guards against a
 * crafted `?workspace=` walking the gateway into a path the daemon never
 * registered.
 */
describe('isPrivilegedCoderPath', () => {
  it('flags daemon-wide configuration surfaces', () => {
    for (const path of ['/auth', '/mcp', '/extensions', '/usage', '/stats']) {
      expect(isPrivilegedCoderPath(path), path).toBe(true)
    }
    for (const path of ['/auth/token', '/mcp/servers', '/usage/report']) {
      expect(isPrivilegedCoderPath(path), path).toBe(true)
    }
  })

  it('does not flag session/workspace routes', () => {
    for (const path of ['/session', '/sessions', '/workspace', '/health', '/capabilities']) {
      expect(isPrivilegedCoderPath(path), path).toBe(false)
    }
  })

  it('does not match a sibling prefix that merely shares a name', () => {
    // `/usage-report` must not be treated as `/usage`.
    expect(isPrivilegedCoderPath('/usage-report')).toBe(false)
  })
})

describe('isSessionPath', () => {
  it('is true only for a specific session, not the bare create/list routes', () => {
    expect(isSessionPath('/session/abc')).toBe(true)
    expect(isSessionPath('/session/abc/status')).toBe(true)
    expect(isSessionPath('/session')).toBe(false)
    expect(isSessionPath('/sessions')).toBe(false)
  })
})

describe('extractCoderSessionId', () => {
  it('extracts and decodes the id from a session path', () => {
    expect(extractCoderSessionId('/session/abc-123')).toBe('abc-123')
    expect(extractCoderSessionId('/session/abc-123/status')).toBe('abc-123')
    expect(extractCoderSessionId('/session/urn%3Auser')).toBe('urn:user')
  })

  it('returns null for non-session paths and malformed encodings', () => {
    expect(extractCoderSessionId('/session')).toBeNull()
    expect(extractCoderSessionId('/sessions')).toBeNull()
    expect(extractCoderSessionId('/session/%E0%A4%A')).toBeNull()
  })
})

describe('isFileOperationPath', () => {
  it('flags the daemon file read/write routes', () => {
    for (const p of ['/file', '/file/bytes', '/list', '/stat', '/glob', '/file/write', '/file/edit']) {
      expect(isFileOperationPath(p), p).toBe(true)
    }
  })

  it('does not flag session/workspace/health routes', () => {
    for (const p of ['/session', '/workspace', '/health', '/capabilities', '/models']) {
      expect(isFileOperationPath(p), p).toBe(false)
    }
  })
})

describe('normalizeCoderFilePath', () => {
  it('keeps an absolute file path and strips redundant/trailing slashes', () => {
    expect(normalizeCoderFilePath('/workspace/src/app.ts')).toBe('/workspace/src/app.ts')
    expect(normalizeCoderFilePath('/workspace/src/')).toBe('/workspace/src')
  })

  it('rejects relative paths and traversal', () => {
    for (const bad of ['src/app.ts', '', '   ', null, undefined, 42, './rel', '/etc/../passwd', '../../etc/passwd']) {
      expect(normalizeCoderFilePath(bad as never)).toBeNull()
    }
  })
})

describe('normalizeCoderWorkspacePath', () => {
  it('keeps an absolute path and strips redundant slashes and a trailing slash', () => {
    expect(normalizeCoderWorkspacePath('/workspace')).toBe('/workspace')
    expect(normalizeCoderWorkspacePath('/srv/app/')).toBe('/srv/app')
    expect(normalizeCoderWorkspacePath('//srv//app')).toBe('/srv/app')
    expect(normalizeCoderWorkspacePath('  /srv/app  ')).toBe('/srv/app')
  })

  it('keeps the root path intact', () => {
    expect(normalizeCoderWorkspacePath('/')).toBe('/')
    expect(normalizeCoderWorkspacePath('///')).toBe('/')
  })

  it('rejects relative paths and traversal', () => {
    for (const bad of ['workspace', '', '   ', null, undefined, 42, './rel', '/etc/../passwd']) {
      expect(normalizeCoderWorkspacePath(bad as never)).toBeNull()
    }
  })
})

describe('authorizeCoderSession', () => {
  beforeEach(() => {
    prismaMock.chatSession.findUnique.mockReset()
  })

  it('allows the owner of a coder-surface session', async () => {
    prismaMock.chatSession.findUnique.mockResolvedValue({ userId: 'user-1', surface: 'coder' })
    await expect(authorizeCoderSession('user-1', 'session-1')).resolves.toBe(true)
  })

  it('denies a foreign owner and a non-coder surface', async () => {
    prismaMock.chatSession.findUnique.mockResolvedValue({ userId: 'user-2', surface: 'coder' })
    await expect(authorizeCoderSession('user-1', 'session-1')).resolves.toBe(false)

    prismaMock.chatSession.findUnique.mockResolvedValue({ userId: 'user-1', surface: 'chat' })
    await expect(authorizeCoderSession('user-1', 'session-1')).resolves.toBe(false)
  })

  it('denies a missing session and an empty id without querying', async () => {
    prismaMock.chatSession.findUnique.mockResolvedValue(null)
    await expect(authorizeCoderSession('user-1', 'session-1')).resolves.toBe(false)
    await expect(authorizeCoderSession('user-1', '')).resolves.toBe(false)
    expect(prismaMock.chatSession.findUnique).toHaveBeenCalledTimes(1)
  })
})

describe('bindCoderSessionWorkspace', () => {
  it('uses a null-only ownership-checked update and confirms the winning binding', async () => {
    prismaMock.chatSession.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.chatSession.findUnique.mockResolvedValue({ userId: 'a', surface: 'coder', coderWorkspace: '/original' })
    expect(await bindCoderSessionWorkspace('a', 's', '/other')).toBe(false)
    expect(prismaMock.chatSession.updateMany).toHaveBeenLastCalledWith({
      where: { id: 's', userId: 'a', surface: 'coder', coderWorkspace: null }, data: { coderWorkspace: '/other' },
    })
    expect(await bindCoderSessionWorkspace('a', 's', '/original')).toBe(true)
  })

  it('rejects encoded, control-character and dot-segment workspace paths', () => {
    for (const p of ['/a/%2e%2e/b', '/a/./b', '/a\u0000b', '/a\\b']) {
      expect(normalizeCoderWorkspacePath(p)).toBeNull()
    }
  })
})
