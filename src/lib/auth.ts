import type { Role } from '@prisma/client'
import { jwtVerify, SignJWT, type JWTPayload } from 'jose'

export const AUTH_COOKIE_NAME = 'auth_token'
export const AUTH_TOKEN_AUDIENCE = 'peakui-app'
export const AUTH_TOKEN_ISSUER = 'peakui'
export const AUTH_TOKEN_TYPE = 'access'
export const AUTH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7

const MIN_JWT_SECRET_LENGTH = 32
const DEV_FALLBACK_SECRET = 'peakui-development-only-jwt-secret-change-before-production'

export interface AuthTokenClaims extends JWTPayload {
  sub: string
  username: string
  role: Role
  tokenVersion: number
  type: typeof AUTH_TOKEN_TYPE
}

export function getJwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim()
  if (configured && configured.length >= MIN_JWT_SECRET_LENGTH) {
    return configured
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `JWT_SECRET must be set and at least ${MIN_JWT_SECRET_LENGTH} characters long in production.`,
    )
  }

  return DEV_FALLBACK_SECRET
}

function getJwtKey(): Uint8Array {
  return new TextEncoder().encode(getJwtSecret())
}

export function getAuthCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure,
    priority: 'high' as const,
    maxAge: AUTH_TOKEN_TTL_SECONDS,
  }
}

export function shouldUseSecureCookies(request: Request): boolean {
  return request.url.startsWith('https://') || request.headers.get('x-forwarded-proto') === 'https'
}

export async function signToken(payload: {
  userId: string
  username: string
  role: Role
  tokenVersion: number
}) {
  return new SignJWT({
    username: payload.username,
    role: payload.role,
    tokenVersion: payload.tokenVersion,
    type: AUTH_TOKEN_TYPE,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(AUTH_TOKEN_ISSUER)
    .setAudience(AUTH_TOKEN_AUDIENCE)
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${AUTH_TOKEN_TTL_SECONDS}s`)
    .sign(getJwtKey())
}

function parseClaims(payload: JWTPayload): AuthTokenClaims | null {
  const sub = typeof payload.sub === 'string'
    ? payload.sub
    : typeof payload.id === 'string'
      ? payload.id
      : null
  const username = typeof payload.username === 'string' ? payload.username : null
  const role = payload.role === 'ADMIN' || payload.role === 'MANAGER' || payload.role === 'USER'
    ? payload.role
    : null
  const tokenVersion = typeof payload.tokenVersion === 'number'
    ? payload.tokenVersion
    : typeof payload.ver === 'number'
      ? payload.ver
      : 0
  const type = typeof payload.type === 'string' ? payload.type : AUTH_TOKEN_TYPE

  if (!sub || !username || !role || type !== AUTH_TOKEN_TYPE) {
    return null
  }

  return {
    ...payload,
    sub,
    username,
    role,
    tokenVersion,
    type: AUTH_TOKEN_TYPE,
  }
}

export async function verifyToken(input: string): Promise<AuthTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(input, getJwtKey(), {
      algorithms: ['HS256'],
      issuer: AUTH_TOKEN_ISSUER,
      audience: AUTH_TOKEN_AUDIENCE,
    })
    return parseClaims(payload)
  } catch {
    return null
  }
}
