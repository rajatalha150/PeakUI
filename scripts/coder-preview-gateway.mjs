import { createHmac, timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'

/**
 * PeakUI preview gateway — single-hop, isolated preview origin.
 *
 * The preview pane frames a dev server the coding agent started inside the
 * coder container. Both the app and the coder container run with host
 * networking, so the dev server's loopback port is reachable from the app
 * directly. This gateway serves that dev server on its own port (:4173) so
 * the previewed page lives on a SEPARATE origin from PeakUI (:3000) and its
 * `allow-same-origin` iframe can never reach PeakUI's cookies/localStorage.
 *
 * A signed ticket (minted by `POST /api/coder/preview`) is the only thing that
 * opens a route: it names the single port the gateway may proxy, so a crafted
 * page cannot use this origin to reach arbitrary internal services (SSRF
 * guard). There is intentionally NO bridge hop — the gateway connects straight
 * to `127.0.0.1:<port>`, which is the same loopback the dev server bound.
 */

const listenPort = Number(process.env.CODER_PREVIEW_GATEWAY_PORT || 4173)
const secret = (process.env.JWT_SECRET || '').trim()
const routeCookie = '__peakui_preview_route'
const blockedPorts = new Set([2375, 2376, 4170, 4171, 4172, 4173, 4318, 5432, 6379, 9050, 9150, 11434])

function sign(payload) {
  return createHmac('sha256', secret).update(`peakui-preview:${payload}`).digest('base64url')
}

function verify(ticket) {
  const [payload, supplied, extra] = String(ticket || '').split('.')
  if (!payload || !supplied || extra || secret.length < 32) return null
  const expected = sign(payload)
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!Number.isInteger(value.p) || value.p < 1 || value.p > 65535 || blockedPorts.has(value.p)) return null
    if (typeof value.s !== 'boolean' || typeof value.e !== 'number' || value.e <= Math.floor(Date.now() / 1000)) return null
    if (typeof value.u !== 'string' || !value.u) return null
    return { port: value.p, secure: value.s }
  } catch {
    return null
  }
}

function cookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const at = part.indexOf('=')
    return at < 0 ? [part, ''] : [part.slice(0, at), part.slice(at + 1)]
  }))
}

function appCookieHeader(header = '') {
  return header.split(';').map(part => part.trim()).filter(part => part && !part.startsWith(`${routeCookie}=`)).join('; ')
}

function routeFor(req) {
  return verify(cookies(req.headers.cookie)[routeCookie])
}

function rewriteSetCookie(value) {
  return value.replace(/;\s*Domain=(?:\.?localhost|127\.0\.0\.1)(?=;|$)/ig, '')
}

/**
 * Forward the request straight to the dev server on the shared loopback. The
 * route cookie already proves the caller is authorized for this specific port.
 */
function proxy(req, res, target) {
  const transport = target.secure ? https : http
  // Strip the gateway's own route cookie before forwarding, so the dev server
  // only sees its own application cookies (and the cookie header matches what a
  // direct visit would send).
  const cookie = appCookieHeader(req.headers.cookie)
  const headers = { ...req.headers, host: `localhost:${target.port}` }
  if (cookie) headers.cookie = cookie
  else delete headers.cookie
  const upstream = transport.request({
    hostname: '127.0.0.1',
    port: target.port,
    method: req.method,
    path: req.url,
    rejectUnauthorized: false,
    headers,
  }, incoming => {
    const headers = { ...incoming.headers }
    if (Array.isArray(headers['set-cookie'])) headers['set-cookie'] = headers['set-cookie'].map(rewriteSetCookie)
    if (typeof headers.location === 'string') {
      try {
        const location = new URL(headers.location)
        if (['localhost', '127.0.0.1'].includes(location.hostname) && Number(location.port || (location.protocol === 'https:' ? 443 : 80)) === target.port) {
          headers.location = `${location.pathname}${location.search}${location.hash}`
        }
      } catch { /* Relative redirects already remain on this clean origin. */ }
    }
    res.writeHead(incoming.statusCode || 502, headers)
    incoming.pipe(res)
  })
  upstream.on('error', error => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`Preview server is not reachable: ${error.message}`)
    } else res.destroy(error)
  })
  req.on('aborted', () => upstream.destroy())
  req.pipe(upstream)
}

function upgrade(req, socket, head, target) {
  const upstream = target.secure
    ? tls.connect({ host: '127.0.0.1', port: target.port, rejectUnauthorized: false })
    : net.connect({ host: '127.0.0.1', port: target.port })
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
  upstream.once(target.secure ? 'secureConnect' : 'connect', () => {
    const headers = { ...req.headers, host: `localhost:${target.port}` }
    const lines = Object.entries(headers).flatMap(([name, value]) => Array.isArray(value)
      ? value.map(item => `${name}: ${item}`)
      : value === undefined ? [] : [`${name}: ${value}`])
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`)
    if (head.length) upstream.write(head)
    socket.pipe(upstream).pipe(socket)
  })
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://preview.local')
  if (url.pathname === '/__peakui/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end('{"status":"ok"}')
    return
  }
  if (url.pathname === '/__peakui/open') {
    const ticket = url.searchParams.get('ticket') || ''
    if (!verify(ticket)) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('This preview link is invalid or expired. Reopen it from PeakUI.')
      return
    }
    const path = url.searchParams.get('path') || '/'
    const destination = path.startsWith('/') && !path.startsWith('//') ? path : '/'
    res.writeHead(302, {
      location: destination,
      'set-cookie': `${routeCookie}=${ticket}; HttpOnly; SameSite=Strict; Path=/; Max-Age=14400`,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    })
    res.end()
    return
  }
  const target = routeFor(req)
  if (!target) {
    res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end('Preview authorization is missing or expired. Reopen the preview from PeakUI.')
    return
  }
  proxy(req, res, target)
})

server.on('upgrade', (req, socket, head) => {
  const target = routeFor(req)
  if (!target) return socket.destroy()
  upgrade(req, socket, head, target)
})

server.listen(listenPort, '0.0.0.0', () => {
  console.log(`PeakUI preview gateway listening on :${listenPort}`)
})
