import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  // This route is a WebSocket upgrade proxy.
  // Next.js App Router doesn't natively support WebSocket,
  // so we return a 426 Upgrade Required response.
  // The actual WebSocket proxy is handled by the middleware/proxy layer
  // or directly via the screencast server on port 3001.
  //
  // For clients behind a reverse proxy (Nginx), the WebSocket
  // should connect to the same origin on a path like /ws/screencast
  // which Nginx proxies to port 3001.
  return new Response('WebSocket upgrade required', { status: 426 })
}