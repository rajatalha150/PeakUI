import { createHmac, timingSafeEqual } from 'node:crypto'
import { getJwtSecret } from './auth'

const TICKET_TTL_SECONDS = 4 * 60 * 60

export interface PreviewTicket {
  port: number
  secure: boolean
  expiresAt: number
  userId: string
}

function encode(value: string | Buffer) {
  return Buffer.from(value).toString('base64url')
}

function signature(payload: string) {
  return createHmac('sha256', getJwtSecret()).update(`peakui-preview:${payload}`).digest('base64url')
}

export function signPreviewTicket(input: { port: number; secure: boolean; userId: string }, now = Date.now()) {
  const payload = encode(JSON.stringify({
    p: input.port,
    s: input.secure,
    e: Math.floor(now / 1000) + TICKET_TTL_SECONDS,
    u: input.userId,
  }))
  return `${payload}.${signature(payload)}`
}

export function verifyPreviewTicket(ticket: string, now = Date.now()): PreviewTicket | null {
  const [payload, supplied, extra] = ticket.split('.')
  if (!payload || !supplied || extra) return null
  const expected = signature(payload)
  const suppliedBytes = Buffer.from(supplied)
  const expectedBytes = Buffer.from(expected)
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) return null
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    if (!Number.isInteger(value.p) || Number(value.p) < 1 || Number(value.p) > 65535) return null
    if (typeof value.s !== 'boolean' || typeof value.e !== 'number' || value.e <= Math.floor(now / 1000)) return null
    if (typeof value.u !== 'string' || !value.u) return null
    return { port: Number(value.p), secure: value.s, expiresAt: value.e, userId: value.u }
  } catch {
    return null
  }
}

