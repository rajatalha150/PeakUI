import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), progress: vi.fn() }))
vi.mock('@/lib/request-auth', () => ({ getCurrentAuth: mocks.auth }))
vi.mock('@/lib/backup-engine', () => ({ getBackupProgress: mocks.progress }))

import { GET } from './route'

const request = () => new Request('http://localhost/api/backup/progress?id=backup-1')

beforeEach(() => {
  mocks.auth.mockReset().mockResolvedValue({ user: { id: 'alice' } })
  mocks.progress.mockReset().mockReturnValue({
    id: 'backup-1', userId: 'alice', startedAt: 1, phase: 'done', message: 'Ready',
    percent: 100, scopes: ['chats'], direction: 'export',
  })
})

describe('backup progress ownership', () => {
  it('requires authentication', async () => {
    mocks.auth.mockResolvedValue(null)
    expect((await GET(request())).status).toBe(401)
  })

  it('does not reveal another user’s backup status', async () => {
    mocks.progress.mockReturnValue({ id: 'backup-1', userId: 'bob' })
    expect((await GET(request())).status).toBe(404)
  })

  it('returns only public progress fields to its owner', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ id: 'backup-1', percent: 100 })
    expect(body).not.toHaveProperty('userId')
  })
})
