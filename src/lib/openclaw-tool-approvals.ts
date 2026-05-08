import { createHash, createHmac, timingSafeEqual } from 'crypto'

const approvalSecret = process.env.JWT_SECRET || 'super-secret-key-for-jwt-auth-that-should-be-long-and-secure'
const APPROVAL_TTL_MS = 10 * 60 * 1000

export type OpenClawApprovalTool = 'filesystem' | 'code' | 'browser' | 'unified_browser'

interface OpenClawApprovalClaims {
  userId: string
  tool: OpenClawApprovalTool
  action: string
  requestHash: string
  issuedAt: number
}

function serializeStable(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(serializeStable).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${serializeStable(entryValue)}`)

  return `{${entries.join(',')}}`
}

export function hashOpenClawApprovalRequest(value: unknown): string {
  return createHash('sha256').update(serializeStable(value)).digest('hex')
}

export function createOpenClawApprovalToken(input: {
  userId: string
  tool: OpenClawApprovalTool
  action: string
  requestPayload: unknown
}): string {
  const claims: OpenClawApprovalClaims = {
    userId: input.userId,
    tool: input.tool,
    action: input.action.trim(),
    requestHash: hashOpenClawApprovalRequest(input.requestPayload),
    issuedAt: Date.now(),
  }

  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signature = createHmac('sha256', approvalSecret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export function verifyOpenClawApprovalToken(
  token: string,
  expected: {
    userId: string
    tool: OpenClawApprovalTool
    action: string
    requestPayload: unknown
  }
): { valid: boolean; reason?: string } {
  const [payload, signature] = token.split('.')
  if (!payload || !signature) {
    return { valid: false, reason: 'Invalid approval token format' }
  }

  const expectedSignature = createHmac('sha256', approvalSecret).update(payload).digest('base64url')
  const providedBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)

  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    return { valid: false, reason: 'Approval token signature mismatch' }
  }

  let claims: OpenClawApprovalClaims

  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OpenClawApprovalClaims
  } catch {
    return { valid: false, reason: 'Approval token payload is invalid' }
  }

  if (claims.userId !== expected.userId) {
    return { valid: false, reason: 'Approval token belongs to a different user' }
  }

  if (claims.tool !== expected.tool || claims.action !== expected.action.trim()) {
    return { valid: false, reason: 'Approval token does not match this tool action' }
  }

  if (Date.now() - claims.issuedAt > APPROVAL_TTL_MS) {
    return { valid: false, reason: 'Approval token has expired' }
  }

  const requestHash = hashOpenClawApprovalRequest(expected.requestPayload)
  if (claims.requestHash !== requestHash) {
    return { valid: false, reason: 'Approval token does not match this request payload' }
  }

  return { valid: true }
}
