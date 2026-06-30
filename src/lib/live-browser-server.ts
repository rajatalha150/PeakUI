import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket } from 'ws'
import { getLiveBrowserInfo, getPage, type BrowserMode } from './uwaf-pool'
import { getAuthContextFromToken } from './request-auth'

const LIVE_BROWSER_PORT = parseInt(process.env.SCREENCAST_PORT || '3001', 10)
const PAGE_POLL_INTERVAL_MS = parseInt(process.env.LIVE_BROWSER_PAGE_POLL_INTERVAL_MS || '1000', 10)

const CONTROL_PATHS = new Set(['/ws/live-browser/control', '/ws/screencast'])
const VNC_PATHS = new Set(['/ws/live-browser/vnc'])

interface BrowserControlSession {
  userId: string
  sessionId: string
  mode: BrowserMode
  interrupted: boolean
  autoResumeTimeoutMs: number
  autoResumeTimer: ReturnType<typeof setTimeout> | null
  controlClients: Set<WebSocket>
  pagePollInterval: ReturnType<typeof setInterval> | null
  pagePollPromise: Promise<void> | null
  lastPageSignature: string | null
}

interface LiveBrowserAuth {
  userId: string
  sessionId: string
  mode: BrowserMode
  autoResumeMs: number
}

const globalForLiveBrowser = globalThis as typeof globalThis & {
  __peakuiLiveBrowser?: {
    controlSessions: Map<string, BrowserControlSession>
    controlWss: WebSocketServer | null
    vncWss: WebSocketServer | null
    standaloneHttpServer: HttpServer | null
    attachedToHttpServer: boolean
  }
}

const liveBrowserState = globalForLiveBrowser.__peakuiLiveBrowser ??= {
  controlSessions: new Map<string, BrowserControlSession>(),
  controlWss: null,
  vncWss: null,
  standaloneHttpServer: null,
  attachedToHttpServer: false,
}

function sessionKey(userId: string, sessionId: string, mode: BrowserMode): string {
  return `${userId}:${sessionId}:${mode}`
}

function socketOpen(ws: WebSocket): boolean {
  return ws.readyState === WebSocket.OPEN
}

function sendJson(ws: WebSocket, payload: Record<string, unknown>): void {
  if (!socketOpen(ws)) return
  ws.send(JSON.stringify(payload))
}

function getOrCreateControlSession(auth: LiveBrowserAuth): BrowserControlSession {
  const key = sessionKey(auth.userId, auth.sessionId, auth.mode)
  const existing = liveBrowserState.controlSessions.get(key)
  if (existing) {
    existing.mode = auth.mode
    existing.autoResumeTimeoutMs = auth.autoResumeMs
    return existing
  }

  const created: BrowserControlSession = {
    userId: auth.userId,
    sessionId: auth.sessionId,
    mode: auth.mode,
    interrupted: false,
    autoResumeTimeoutMs: auth.autoResumeMs,
    autoResumeTimer: null,
    controlClients: new Set<WebSocket>(),
    pagePollInterval: null,
    pagePollPromise: null,
    lastPageSignature: null,
  }

  liveBrowserState.controlSessions.set(key, created)
  return created
}

function broadcastToControlClients(session: BrowserControlSession, payload: Record<string, unknown>): void {
  for (const client of session.controlClients) {
    sendJson(client, payload)
  }
}

function clearAutoResumeTimer(session: BrowserControlSession): void {
  if (session.autoResumeTimer) {
    clearTimeout(session.autoResumeTimer)
    session.autoResumeTimer = null
  }
}

function sendState(session: BrowserControlSession): void {
  broadcastToControlClients(session, {
    type: 'state',
    aiActive: !session.interrupted,
    interrupted: session.interrupted,
  })
}

function startAutoResumeTimer(session: BrowserControlSession): void {
  clearAutoResumeTimer(session)
  session.autoResumeTimer = setTimeout(() => {
    if (!session.interrupted) return
    session.interrupted = false
    sendState(session)
    broadcastToControlClients(session, {
      type: 'notification',
      message: 'Auto-resumed: 2 minutes of inactivity',
    })
  }, session.autoResumeTimeoutMs)
}

function setInterrupted(session: BrowserControlSession, interrupted: boolean): void {
  session.interrupted = interrupted
  if (interrupted) {
    stopPagePolling(session)
    startAutoResumeTimer(session)
  } else {
    clearAutoResumeTimer(session)
    ensurePagePolling(session)
    // Force a one-shot broadcast so the client UI catches up to whatever the
    // user did while they were in control.
    void broadcastPageState(session, true)
  }
  sendState(session)
}

function noteActivity(session: BrowserControlSession): void {
  if (!session.interrupted) return
  startAutoResumeTimer(session)
}

async function broadcastPageState(session: BrowserControlSession, force = false): Promise<void> {
  if (session.pagePollPromise) {
    return session.pagePollPromise
  }

      const key = sessionKey(session.userId, session.sessionId, session.mode)
  session.pagePollPromise = (async () => {
    try {
      const page = await getPage(key, session.mode)
      const currentUrl = page.url()
      const title = await page.title().catch(() => '')
      const nextSignature = `${currentUrl}\n${title}`

      if (!force && nextSignature === session.lastPageSignature) {
        return
      }

      session.lastPageSignature = nextSignature
      broadcastToControlClients(session, {
        type: 'page',
        currentUrl,
        title,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      broadcastToControlClients(session, {
        type: 'error',
        message: `Live browser page sync failed: ${message}`,
      })
    }
  })().finally(() => {
    session.pagePollPromise = null
  })

  return session.pagePollPromise
}

function ensurePagePolling(session: BrowserControlSession): void {
  if (session.pagePollInterval) return
  // While the user has control (interrupted=true), stop polling so the React
  // UI doesn't re-render every second and steal DOM focus from the noVNC
  // canvas. The user's own interactions update the page metadata via separate
  // channels (or not at all, which is fine while they're typing).
  if (session.interrupted) return

  session.pagePollInterval = setInterval(() => {
    void broadcastPageState(session)
  }, PAGE_POLL_INTERVAL_MS)
}

function stopPagePolling(session: BrowserControlSession): void {
  if (session.pagePollInterval) {
    clearInterval(session.pagePollInterval)
    session.pagePollInterval = null
  }
}

function getRequestPath(req: { url?: string | undefined; headers?: { host?: string | undefined } }): string {
  const url = new URL(req.url || '/', `http://${req.headers?.host || 'localhost'}`)
  return url.pathname
}

async function authenticateConnection(ws: WebSocket, req: IncomingMessage): Promise<LiveBrowserAuth | null> {
  const url = new URL(req.url || '/', `http://${req.headers?.host || 'localhost'}`)
  const sessionId = url.searchParams.get('sessionId')
  const mode = (url.searchParams.get('mode') || 'direct') as BrowserMode
  const autoResumeMs = parseInt(url.searchParams.get('autoResumeMs') || '120000', 10)

  if (!sessionId) {
    sendJson(ws, { type: 'error', message: 'Missing sessionId' })
    ws.close(4001, 'Missing sessionId')
    return null
  }

  let token: string | null = null
  const cookieHeader = req.headers?.cookie || ''
  const cookieMatch = cookieHeader.match(/(?:^|; )auth_token=([^;]+)/)
  if (cookieMatch) token = decodeURIComponent(cookieMatch[1])
  if (!token) token = url.searchParams.get('token')

  if (!token) {
    sendJson(ws, { type: 'error', message: 'Missing auth token' })
    ws.close(4001, 'Missing auth token')
    return null
  }

  const auth = await getAuthContextFromToken(token)
  if (!auth || !auth.permissions.includes('openclaw.use') || !auth.permissions.includes('openclaw.uwaf')) {
    sendJson(ws, { type: 'error', message: 'Invalid or expired token' })
    ws.close(4003, 'Unauthorized')
    return null
  }

  return {
    userId: auth.user.id,
    sessionId,
    mode,
    autoResumeMs,
  }
}

function handleControlMessage(session: BrowserControlSession, raw: string): void {
  let message: Record<string, unknown>
  try {
    message = JSON.parse(raw)
  } catch {
    return
  }

  switch (message.type) {
    case 'interrupt':
      setInterrupted(session, true)
      break
    case 'resume':
      setInterrupted(session, false)
      break
    case 'activity':
      noteActivity(session)
      break
    case 'ping':
      broadcastToControlClients(session, { type: 'pong' })
      break
  }
}

function handleControlConnection(ws: WebSocket, req: IncomingMessage): void {
  void authenticateConnection(ws, req).then(async (auth) => {
    if (!auth) return

    const session = getOrCreateControlSession(auth)
    session.controlClients.add(ws)

    ws.on('message', (raw) => {
      const data = typeof raw === 'string' ? raw : raw.toString('utf-8')
      handleControlMessage(session, data)
    })

    ws.on('close', () => {
      session.controlClients.delete(ws)
      if (session.controlClients.size === 0) {
        stopPagePolling(session)
      }
    })

    ws.on('error', (error) => {
      console.warn('[live-browser] Control socket error:', error.message)
    })

    sendState(session)

    const liveInfo = await getLiveBrowserInfo(sessionKey(auth.userId, auth.sessionId, auth.mode), auth.mode)
    sendJson(ws, {
      type: 'ready',
      vncPath: `/ws/live-browser/vnc?sessionId=${encodeURIComponent(auth.sessionId)}&mode=${encodeURIComponent(auth.mode)}`,
      viewport: liveInfo.viewport,
    })

    ensurePagePolling(session)
    await broadcastPageState(session, true)
  }).catch((error) => {
    console.error('[live-browser] Control auth/setup failed:', error instanceof Error ? error.message : String(error))
    ws.close(4003, 'Authentication failed')
  })
}

function handleVncConnection(ws: WebSocket, req: IncomingMessage): void {
  void authenticateConnection(ws, req).then(async (auth) => {
    if (!auth) return

    const liveInfo = await getLiveBrowserInfo(sessionKey(auth.userId, auth.sessionId, auth.mode), auth.mode)
    const tcpSocket = net.createConnection({
      host: '127.0.0.1',
      port: liveInfo.vncPort,
    })
    tcpSocket.setNoDelay(true)

    const closeBoth = (code?: number, reason?: string) => {
      if (!tcpSocket.destroyed) tcpSocket.destroy()
      if (socketOpen(ws)) {
        ws.close(code, reason)
      }
    }

    tcpSocket.on('connect', () => {
      // no-op
    })

    tcpSocket.on('data', (chunk) => {
      if (socketOpen(ws)) {
        ws.send(chunk, { binary: true })
      }
    })

    tcpSocket.on('error', (error) => {
      console.warn('[live-browser] VNC TCP bridge error:', error.message)
      closeBoth(1011, 'VNC bridge error')
    })

    tcpSocket.on('close', () => {
      if (socketOpen(ws)) {
        ws.close(1000, 'VNC server closed')
      }
    })

    ws.on('message', (data) => {
      if (tcpSocket.destroyed) return
      if (typeof data === 'string') {
        tcpSocket.write(data)
        return
      }
      if (Buffer.isBuffer(data)) {
        tcpSocket.write(data)
        return
      }
      tcpSocket.write(Buffer.from(data as ArrayBuffer))
    })

    ws.on('close', () => {
      if (!tcpSocket.destroyed) tcpSocket.end()
    })

    ws.on('error', (error) => {
      console.warn('[live-browser] VNC websocket error:', error.message)
      if (!tcpSocket.destroyed) tcpSocket.destroy()
    })
  }).catch((error) => {
    console.error('[live-browser] VNC auth/setup failed:', error instanceof Error ? error.message : String(error))
    ws.close(4003, 'Authentication failed')
  })
}

function handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
  const path = getRequestPath(request)

  if (CONTROL_PATHS.has(path)) {
    if (!liveBrowserState.controlWss) {
      socket.destroy()
      return
    }
    liveBrowserState.controlWss.handleUpgrade(request, socket, head, (ws) => {
      liveBrowserState.controlWss!.emit('connection', ws, request)
    })
    return
  }

  if (VNC_PATHS.has(path)) {
    if (!liveBrowserState.vncWss) {
      socket.destroy()
      return
    }
    liveBrowserState.vncWss.handleUpgrade(request, socket, head, (ws) => {
      liveBrowserState.vncWss!.emit('connection', ws, request)
    })
    return
  }

  socket.destroy()
}

export function startLiveBrowserServer(): void {
  if (liveBrowserState.controlWss || liveBrowserState.vncWss) return

  liveBrowserState.controlWss = new WebSocketServer({ noServer: true })
  liveBrowserState.controlWss.on('connection', handleControlConnection)

  liveBrowserState.vncWss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  })
  liveBrowserState.vncWss.on('connection', handleVncConnection)

  liveBrowserState.standaloneHttpServer = createServer()
  liveBrowserState.standaloneHttpServer.on('upgrade', handleUpgrade)
  liveBrowserState.standaloneHttpServer.listen(LIVE_BROWSER_PORT, () => {
    console.log(`[live-browser] Standalone WebSocket bridge listening on port ${LIVE_BROWSER_PORT}`)
  })
}

export function attachToHttpServer(server: HttpServer): void {
  if (liveBrowserState.attachedToHttpServer) return
  liveBrowserState.attachedToHttpServer = true
  server.on('upgrade', handleUpgrade)
}

export async function stopLiveBrowserServer(): Promise<void> {
  for (const session of liveBrowserState.controlSessions.values()) {
    clearAutoResumeTimer(session)
    stopPagePolling(session)
    for (const client of session.controlClients) {
      if (socketOpen(client)) {
        client.close(1001, 'Server shutting down')
      }
    }
  }
  liveBrowserState.controlSessions.clear()

  if (liveBrowserState.controlWss) {
    liveBrowserState.controlWss.close()
    liveBrowserState.controlWss = null
  }

  if (liveBrowserState.vncWss) {
    liveBrowserState.vncWss.close()
    liveBrowserState.vncWss = null
  }

  if (liveBrowserState.standaloneHttpServer) {
    await new Promise<void>((resolve) => {
      liveBrowserState.standaloneHttpServer!.close(() => resolve())
    })
    liveBrowserState.standaloneHttpServer = null
  }
}

export function isBrowserInterrupted(userId: string, sessionId: string, mode: BrowserMode): boolean {
  return liveBrowserState.controlSessions.get(sessionKey(userId, sessionId, mode))?.interrupted ?? false
}

export function getLiveBrowserState(userId: string, sessionId: string, mode: BrowserMode): { connected: boolean; interrupted: boolean } {
  const session = liveBrowserState.controlSessions.get(sessionKey(userId, sessionId, mode))
  return {
    connected: Boolean(session && session.controlClients.size > 0),
    interrupted: session?.interrupted ?? false,
  }
}

export async function restartScreencastForSession(userId: string, sessionId: string, mode: BrowserMode): Promise<void> {
  const session = liveBrowserState.controlSessions.get(sessionKey(userId, sessionId, mode))
  if (!session) return
  await broadcastPageState(session, true)
}

export const startScreencastServer = startLiveBrowserServer
export const stopScreencastServer = stopLiveBrowserServer
