import { NextResponse } from 'next/server'
import { AUTH_COOKIE_NAME, getAuthCookieOptions, shouldUseSecureCookies } from '@/lib/auth'

export async function POST(request: Request) {
  const response = NextResponse.json({ success: true })
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: '',
    ...getAuthCookieOptions(shouldUseSecureCookies(request)),
    maxAge: 0,
  })
  return response
}
