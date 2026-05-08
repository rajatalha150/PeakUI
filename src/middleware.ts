import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from './lib/auth'

export async function middleware(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value
  const isLoginPage = request.nextUrl.pathname.startsWith('/login')
  
  if (!token) {
    if (!isLoginPage) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return NextResponse.next()
  }

  const payload = await verifyToken(token)
  
  if (!payload) {
    if (!isLoginPage) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return NextResponse.next()
  }

  // Already authenticated, trying to access login
  if (isLoginPage) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return NextResponse.next()
}

export const config = {
  // API routes perform their own auth checks. Keeping them out of middleware
  // avoids Next cloning large upload bodies before route handlers read them.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
