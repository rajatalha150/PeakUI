import { describe, expect, it } from 'vitest'
import { signPreviewTicket, verifyPreviewTicket } from './coder-preview-ticket'

describe('coder preview tickets', () => {
  it('round-trips an approved target', () => {
    const ticket = signPreviewTicket({ port: 8081, secure: false, userId: 'admin-1' }, 1_000_000)
    expect(verifyPreviewTicket(ticket, 1_000_001)).toMatchObject({ port: 8081, secure: false, userId: 'admin-1' })
  })

  it('rejects tampering and expiry', () => {
    const ticket = signPreviewTicket({ port: 443, secure: true, userId: 'admin-1' }, 1_000_000)
    expect(verifyPreviewTicket(`${ticket}x`, 1_000_001)).toBeNull()
    expect(verifyPreviewTicket(ticket, 1_000_000 + 4 * 60 * 60 * 1000 + 1)).toBeNull()
  })
})

