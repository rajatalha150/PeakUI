import { jwtVerify, SignJWT, type JWTPayload } from 'jose'

const secretKey = process.env.JWT_SECRET || 'super-secret-key-for-jwt-auth-that-should-be-long-and-secure'
const key = new TextEncoder().encode(secretKey)

export async function signToken(payload: JWTPayload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(key)
}

export async function verifyToken(input: string) {
  try {
    const { payload } = await jwtVerify(input, key, {
      algorithms: ['HS256'],
    })
    return payload
  } catch {
    return null
  }
}
