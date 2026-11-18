import { describe, expect, it } from 'vitest'
import { hasPermission, resolvePermissions, serializePermissionOverrides } from './permissions'

describe('user administration boundary', () => {
  it('does not delegate administrator creation through overrides', () => {
    const permissionOverrides = serializePermissionOverrides({ allow: ['users.manage'], deny: [] })
    for (const role of ['USER', 'MANAGER'] as const) {
      expect(hasPermission({ role, permissionOverrides }, 'users.manage')).toBe(false)
      expect(resolvePermissions({ role, permissionOverrides })).not.toContain('users.manage')
    }
  })

  it('keeps user administration available to admins', () => {
    expect(hasPermission({ role: 'ADMIN' }, 'users.manage')).toBe(true)
  })
})
