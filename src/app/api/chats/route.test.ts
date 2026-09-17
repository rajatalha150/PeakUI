import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression cover for the `/api/chats` DELETE handler.
 *
 * The bug: the Coding view sends `{ id, surface: 'coder' }` to delete ONE
 * session, but the handler's ordering treated "a surface is present" as
 * "delete every session on that surface" — so one click wiped all coder
 * sessions, and the transcript poll then re-persisted the still-open ones as
 * zombies that "kept popping back". A specific id must always win over a
 * surface that happens to ride along.
 */
const mocks = vi.hoisted(() => ({
  getCurrentUserId: vi.fn(),
  deleteChatSession: vi.fn(),
  deleteChatSessions: vi.fn(),
  listChatSessions: vi.fn(),
  updateChatSession: vi.fn(),
  upsertChatSession: vi.fn(),
}))

vi.mock('@/lib/request-auth', () => ({
  getCurrentUserId: mocks.getCurrentUserId,
}))

vi.mock('@/lib/chat-sessions', () => ({
  deleteChatSession: mocks.deleteChatSession,
  deleteChatSessions: mocks.deleteChatSessions,
  listChatSessions: mocks.listChatSessions,
  updateChatSession: mocks.updateChatSession,
  upsertChatSession: mocks.upsertChatSession,
}))

async function loadRoute() {
  return await import('./route')
}

function makeDelete(body: unknown): Request {
  return new Request('http://localhost/api/chats', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mocks.getCurrentUserId.mockReset()
  mocks.getCurrentUserId.mockResolvedValue('user-1')
  mocks.deleteChatSession.mockReset().mockResolvedValue(true)
  mocks.deleteChatSessions.mockReset().mockResolvedValue({ count: 1 })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('/api/chats DELETE', () => {
  it('deletes a single session by id even when a surface rides along', async () => {
    const { DELETE } = await loadRoute()

    await DELETE(makeDelete({ id: 's1', surface: 'coder' }) as never)

    // The single-session path must be taken, NOT the surface-wide path.
    expect(mocks.deleteChatSession).toHaveBeenCalledWith('user-1', 's1')
    expect(mocks.deleteChatSessions).not.toHaveBeenCalled()
  })

  it('deletes many sessions by id list without touching the surface-wide path', async () => {
    const { DELETE } = await loadRoute()

    await DELETE(makeDelete({ ids: ['s1', 's2'], surface: 'coder' }) as never)

    expect(mocks.deleteChatSessions).toHaveBeenCalledWith('user-1', { ids: ['s1', 's2'] })
    expect(mocks.deleteChatSession).not.toHaveBeenCalled()
  })

  it('deletes the whole surface only when NO id is present', async () => {
    const { DELETE } = await loadRoute()

    await DELETE(makeDelete({ surface: 'coder' }) as never)

    expect(mocks.deleteChatSessions).toHaveBeenCalledWith('user-1', { surface: 'coder' })
    expect(mocks.deleteChatSession).not.toHaveBeenCalled()
  })

  it('returns 404 when a single id does not exist', async () => {
    mocks.deleteChatSession.mockResolvedValue(false)
    const { DELETE } = await loadRoute()

    const res = await DELETE(makeDelete({ id: 'missing', surface: 'coder' }) as never)

    expect(res.status).toBe(404)
  })
})
