import { cookies } from 'next/headers'
import { verifyToken } from './auth'

export async function getCurrentUserId(): Promise<string | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('auth_token')?.value
  if (!token) return null

  const payload = await verifyToken(token)
  return typeof payload?.id === 'string' ? payload.id : null
}
