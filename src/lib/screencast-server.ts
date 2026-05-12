import { createServer, type Server as HttpServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { getPage, type BrowserMode } from './uwaf-pool'
import { verifyToken } from './auth'

const SCREENCAST_PORT = parseInt(process.env.SCREENCAST_PORT || '3001', 10)
const FRAME_QUALITY = parseInt(process.env.SCREENCAST_QUALITY || '60', 10)
const FRAME_MAX_WIDTH = parseInt(process.env.SCREENCAST_WIDTH || '1280', 10)
const FRAME_MAX_HEIGHT = parseInt(process.env.SCREENCAST_HEIGHT || '720', 10)

interface ScreencastClient {
  ws: WebSocket
  userId: string
  sessionId: string
  mode: BrowserMode
  cdpSession: any | null
  frameAckId: number
  interrupted: boolean
  lastUserInputAt: number
  autoResumeTimer: ReturnType<typeof setTimeout> | null
  autoResumeTimeoutMs: number
}

const clients = new Map<string, ScreencastClient>()

let wss: WebSocketServer | null = null
let standaloneHttpServer: HttpServer | null = null
let attachedToHttpServer = false

function clientKey(userId: string, sessionId: string): string {
  return `${userId}:${sessionId}`
}

async function startScreencastForClient(client: ScreencastClient): Promise<void> {
  try {
    const contextKey = `${client.userId}:${client.sessionId}`
    const page = await getPage(contextKey, client.mode)
    const context = page.context()
    const cdp = await (context as any).newCDPSession(page)
    client.cdpSession = cdp

    cdp.on('Page.screencastFrame', async (event: any) => {
      client.frameAckId = event.sessionId
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({
          type: 'frame',
          data: event.data,
          metadata: event.metadata,
        }))
      }
      try {
        await cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId })
      } catch {
        // frame ack may fail if screencast already stopped
      }
    })

    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: FRAME_QUALITY,
      maxWidth: FRAME_MAX_WIDTH,
      maxHeight: FRAME_MAX_HEIGHT,
    })

    sendState(client)
  } catch (err) {
    console.error('[screencast] Failed to start screencast:', err instanceof Error ? err.message : String(err))
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to start screencast. Browser may not be ready yet.',
      }))
    }
  }
}

async function stopScreencastForClient(client: ScreencastClient): Promise<void> {
  if (client.autoResumeTimer) {
    clearTimeout(client.autoResumeTimer)
    client.autoResumeTimer = null
  }
  if (client.cdpSession) {
    try { await client.cdpSession.send('Page.stopScreencast') } catch {}
    try { await client.cdpSession.detach() } catch {}
    client.cdpSession = null
  }
}

function sendState(client: ScreencastClient): void {
  if (client.ws.readyState !== WebSocket.OPEN) return
  client.ws.send(JSON.stringify({
    type: 'state',
    aiActive: !client.interrupted,
    interrupted: client.interrupted,
  }))
}

function startAutoResumeTimer(client: ScreencastClient): void {
  if (client.autoResumeTimer) clearTimeout(client.autoResumeTimer)
  client.autoResumeTimer = setTimeout(() => {
    if (client.interrupted) {
      client.interrupted = false
      sendState(client)
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type: 'notification', message: 'Auto-resumed: 2 minutes of inactivity' }))
      }
    }
  }, client.autoResumeTimeoutMs)
}

async function handleInput(client: ScreencastClient, payload: any): Promise<void> {
  if (!client.cdpSession) return
  client.lastUserInputAt = Date.now()
  if (client.autoResumeTimer) startAutoResumeTimer(client)

  try {
    switch (payload.inputType) {
      case 'click': {
        const { x, y, button = 'left', clickCount = 1 } = payload
        await client.cdpSession.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount })
        await client.cdpSession.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount })
        break
      }
      case 'scroll': {
        const { x, y, deltaX, deltaY } = payload
        await client.cdpSession.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: deltaX || 0, deltaY: deltaY || 0 })
        break
      }
      case 'keypress': {
        const { key, keyCode, code } = payload
        const keyDownParams: any = { type: 'keyDown', key, code: code || key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode }
        await client.cdpSession.send('Input.dispatchKeyEvent', keyDownParams)
        await client.cdpSession.send('Input.dispatchKeyEvent', { ...keyDownParams, type: 'keyUp' })
        break
      }
      case 'type': {
        const { text } = payload
        if (text) await client.cdpSession.send('Input.insertText', { text })
        break
      }
    }
  } catch (err) {
    console.warn('[screencast] Input dispatch failed:', err instanceof Error ? err.message : String(err))
  }
}

function handleMessage(client: ScreencastClient, data: string): void {
  let msg: any
  try { msg = JSON.parse(data) } catch { return }

  switch (msg.type) {
    case 'input':
      if (client.interrupted) handleInput(client, msg.payload)
      break
    case 'interrupt':
      client.interrupted = true
      startAutoResumeTimer(client)
      sendState(client)
      break
    case 'resume':
      client.interrupted = false
      if (client.autoResumeTimer) { clearTimeout(client.autoResumeTimer); client.autoResumeTimer = null }
      sendState(client)
      break
    case 'ping':
      if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify({ type: 'pong' }))
      break
  }
}

async function authenticateConnection(ws: WebSocket, req: any): Promise<{ userId: string; sessionId: string; mode: BrowserMode; autoResumeMs: number } | null> {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const sessionId = url.searchParams.get('sessionId')
  const mode = (url.searchParams.get('mode') || 'direct') as BrowserMode
  const autoResumeMs = parseInt(url.searchParams.get('autoResumeMs') || '120000', 10)

  if (!sessionId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Missing sessionId' }))
    ws.close(4001, 'Missing parameters')
    return null
  }

  // Try cookie first (httpOnly), then URL param
  let token: string | null = null
  const cookieHeader = req.headers?.cookie || ''
  const cookieMatch = cookieHeader.match(/(?:^|; )auth_token=([^;]+)/)
  if (cookieMatch) token = decodeURIComponent(cookieMatch[1])
  if (!token) token = url.searchParams.get('token')

  if (!token) {
    ws.send(JSON.stringify({ type: 'error', message: 'Missing auth token' }))
    ws.close(4001, 'Missing auth')
    return null
  }

  const payload = await verifyToken(token)
  if (!payload || typeof payload.id !== 'string') {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid or expired token' }))
    ws.close(4003, 'Unauthorized')
    return null
  }

  return { userId: payload.id, sessionId, mode, autoResumeMs }
}

function handleConnection(ws: WebSocket, req: any): void {
  authenticateConnection(ws, req).then((auth) => {
    if (!auth) return

    const { userId, sessionId, mode, autoResumeMs } = auth
    const key = clientKey(userId, sessionId)

    const existing = clients.get(key)
    if (existing) {
      stopScreencastForClient(existing).catch(() => {})
      existing.ws.close(4002, 'Replaced by new connection')
      clients.delete(key)
    }

    const client: ScreencastClient = {
      ws, userId, sessionId, mode, cdpSession: null, frameAckId: 0,
      interrupted: false, lastUserInputAt: 0, autoResumeTimer: null, autoResumeTimeoutMs: autoResumeMs,
    }

    clients.set(key, client)

    ws.on('message', (raw: any) => {
      const data = typeof raw === 'string' ? raw : raw.toString('utf-8')
      handleMessage(client, data)
    })

    ws.on('close', () => {
      const c = clients.get(key)
      if (c) { stopScreencastForClient(c).catch(() => {}); clients.delete(key) }
    })

    ws.on('error', (err) => { console.warn('[screencast] WebSocket error:', err.message) })

    startScreencastForClient(client).catch((err) => { console.error('[screencast] Failed to start:', err) })
    ws.send(JSON.stringify({ type: 'state', aiActive: true, interrupted: false }))
  }).catch((err) => {
    console.error('[screencast] Auth failed:', err)
    ws.close(4003, 'Authentication failed')
  })
}

/**
 * Start the screencast WebSocket server on SCREENCAST_PORT.
 * Also used to handle upgrades at /ws/screencast when attached to the Next.js HTTP server.
 */
export function startScreencastServer(): void {
  if (wss) return

  wss = new WebSocketServer({ noServer: true })
  wss.on('connection', handleConnection)

  // Always start standalone server on SCREENCAST_PORT as fallback
  standaloneHttpServer = createServer()
  standaloneHttpServer.on('upgrade', (request: any, socket: any, head: any) => {
    wss!.handleUpgrade(request, socket, head, (ws) => {
      wss!.emit('connection', ws, request)
    })
  })
  standaloneHttpServer.listen(SCREENCAST_PORT, () => {
    console.log(`[screencast] Standalone WebSocket server listening on port ${SCREENCAST_PORT}`)
  })
}

/**
 * Attach WebSocket upgrade handler to an existing HTTP server (e.g., Next.js).
 * This enables same-origin WebSocket at /ws/screencast — no separate port needed.
 */
export function attachToHttpServer(server: HttpServer): void {
  if (attachedToHttpServer) return
  attachedToHttpServer = true

  server.on('upgrade', (request: any, socket: any, head: any) => {
    if ((request.url || '').startsWith('/ws/screencast')) {
      if (!wss) return
      const server = wss
      server.handleUpgrade(request, socket, head, (ws) => {
        server.emit('connection', ws, request)
      })
    }
  })
}

export async function stopScreencastServer(): Promise<void> {
  if (!wss && !standaloneHttpServer) return

  for (const [, client] of clients) {
    await stopScreencastForClient(client).catch(() => {})
    client.ws.close(1001, 'Server shutting down')
  }
  clients.clear()

  if (wss) { wss.close(); wss = null }

  if (standaloneHttpServer) {
    await new Promise<void>((resolve) => { standaloneHttpServer!.close(() => resolve()) })
    standaloneHttpServer = null
  }
}

export function isBrowserInterrupted(userId: string, sessionId: string): boolean {
  const key = clientKey(userId, sessionId)
  const client = clients.get(key)
  return client?.interrupted ?? false
}

export function getScreencastState(userId: string, sessionId: string): { connected: boolean; interrupted: boolean } {
  const key = clientKey(userId, sessionId)
  const client = clients.get(key)
  return {
    connected: client != null && client.ws.readyState === WebSocket.OPEN,
    interrupted: client?.interrupted ?? false,
  }
}