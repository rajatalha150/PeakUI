import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), settingsUpsert: vi.fn(), coderSync: vi.fn() }))
vi.mock('@/lib/request-auth', () => ({ getCurrentAuth: mocks.auth }))
vi.mock('@/lib/prisma', () => ({ prisma: { userSettings: { upsert: mocks.settingsUpsert } } }))
vi.mock('@/lib/coder-uncensored-sync', () => ({ syncCoderUncensoredContext: mocks.coderSync }))

import { POST } from './route'

it('refuses shared Coder context changes from non-admin users', async () => {
  mocks.auth.mockResolvedValue({ user: { id: 'user-1', role: 'USER' } })
  const response = await POST(new Request('http://localhost/api/settings', {
    method: 'POST',
    body: JSON.stringify({ coderUncensored: true }),
  }))
  expect(response.status).toBe(403)
  expect(mocks.settingsUpsert).not.toHaveBeenCalled()
  expect(mocks.coderSync).not.toHaveBeenCalled()
})
