'use client'

import type RFB from '@novnc/novnc'
import { useCallback, useEffect, useRef, useState } from 'react'

export type LiveBrowserConnectionStatus = 'connecting' | 'live' | 'disconnected' | 'failed'

interface UseLiveBrowserConnectionOptions {
  sessionId: string
  mode: 'direct' | 'stealth'
  enabled?: boolean
  autoResumeMs?: number
  onInterruptChange?: (interrupted: boolean) => void
  onStatusChange?: (status: LiveBrowserConnectionStatus) => void
}

const MAX_RECONNECT_ATTEMPTS = 5
const MAX_RECONNECT_DELAY_MS = 30000
const CONNECT_TIMEOUT_MS = 8000

export function useLiveBrowserConnection({
  sessionId,
  mode,
  enabled = true,
  autoResumeMs = 120000,
  onInterruptChange,
  onStatusChange,
}: UseLiveBrowserConnectionOptions) {
  const [status, setStatus] = useState<LiveBrowserConnectionStatus>('connecting')
  const [interrupted, setInterrupted] = useState(false)
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)
  const [title, setTitle] = useState<string | null>(null)
  const [viewportElement, setViewportElementState] = useState<HTMLDivElement | null>(null)
  const [vncUrl, setVncUrl] = useState<string | null>(null)

  const failedAttempts = useRef(0)
  const controlSocketRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectRef = useRef<() => void>(() => {})
  const activeControlUrlRef = useRef<string | null>(null)
  const rfbRef = useRef<RFB | null>(null)
  const interruptedRef = useRef(false)
  const disposedRef = useRef(false)

  const updateStatus = useCallback((nextStatus: LiveBrowserConnectionStatus) => {
    setStatus(nextStatus)
    onStatusChange?.(nextStatus)
  }, [onStatusChange])

  const disconnectRfb = useCallback(() => {
    const existing = rfbRef.current
    rfbRef.current = null
    if (!existing) return
    try {
      existing.disconnect()
    } catch {
      // Ignore teardown failures from noVNC during unmount/reconnect.
    }
  }, [])

  const setViewportElement = useCallback((element: HTMLDivElement | null) => {
    setViewportElementState(element)
  }, [])

  const sendControlMessage = useCallback((message: Record<string, unknown>) => {
    if (controlSocketRef.current?.readyState === WebSocket.OPEN) {
      controlSocketRef.current.send(JSON.stringify(message))
    }
  }, [])

  const scheduleReconnect = useCallback(() => {
    if (disposedRef.current || reconnectTimerRef.current) return

    failedAttempts.current += 1
    if (failedAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
      updateStatus('failed')
      return
    }

    const delay = Math.min(1000 * 2 ** (failedAttempts.current - 1), MAX_RECONNECT_DELAY_MS)
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null
      updateStatus('connecting')
      connectRef.current()
    }, delay)
  }, [updateStatus])

  const connectRfb = useCallback(async (nextVncUrl: string) => {
    if (!enabled || !viewportElement || !nextVncUrl) return

    disconnectRfb()

    const { default: RFB } = await import('@novnc/novnc')
    if (disposedRef.current || !viewportElement) return

    viewportElement.replaceChildren()

    const rfb = new RFB(viewportElement, nextVncUrl, { shared: true })
    rfb.background = 'transparent'
    rfb.scaleViewport = true
    rfb.resizeSession = false
    rfb.clipViewport = false
    rfb.focusOnClick = true
    rfb.qualityLevel = 8
    rfb.compressionLevel = 2
    rfb.viewOnly = !interruptedRef.current

    rfb.addEventListener('connect', () => {
      failedAttempts.current = 0
      updateStatus('live')
      if (interruptedRef.current) {
        rfb.focus()
      }
    })

    rfb.addEventListener('disconnect', () => {
      if (disposedRef.current) return
      if (rfbRef.current === rfb) {
        rfbRef.current = null
      }
      updateStatus('disconnected')
      scheduleReconnect()
    })

    rfb.addEventListener('securityfailure', () => {
      updateStatus('failed')
    })

    rfb.addEventListener('credentialsrequired', () => {
      updateStatus('failed')
    })

    rfbRef.current = rfb
  }, [disconnectRfb, enabled, scheduleReconnect, updateStatus, viewportElement])

  const connect = useCallback(() => {
    if (!enabled || !sessionId) return

    interruptedRef.current = false
    setInterrupted(false)
    setCurrentUrl(null)
    setTitle(null)
    setVncUrl(null)
    updateStatus('connecting')

    const params = `sessionId=${encodeURIComponent(sessionId)}&mode=${encodeURIComponent(mode)}&autoResumeMs=${autoResumeMs}`
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const primaryHost = window.location.host
    const fallbackHost = `${window.location.hostname}:3001`
    const urls = [
      `${protocol}//${primaryHost}/ws/live-browser/control?${params}`,
      `${protocol}//${fallbackHost}/ws/live-browser/control?${params}`,
    ]

    let urlIndex = 0

    const tryNext = () => {
      if (disposedRef.current || urlIndex >= urls.length) {
        updateStatus('disconnected')
        scheduleReconnect()
        return
      }

      const url = urls[urlIndex]
      urlIndex += 1
      activeControlUrlRef.current = url

      try {
        const ws = new WebSocket(url)
        controlSocketRef.current = ws

        const timeout = setTimeout(() => {
          if (ws.readyState === WebSocket.CONNECTING) {
            ws.close()
            tryNext()
          }
        }, CONNECT_TIMEOUT_MS)

        ws.onopen = () => {
          clearTimeout(timeout)
          updateStatus('connecting')
        }

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data)
            switch (message.type) {
              case 'ready':
                if (typeof message.vncPath === 'string' && activeControlUrlRef.current) {
                  const resolvedVncUrl = new URL(message.vncPath, activeControlUrlRef.current).toString()
                  setVncUrl(resolvedVncUrl)
                }
                break
              case 'state': {
                const nextInterrupted = message.interrupted === true
                interruptedRef.current = nextInterrupted
                setInterrupted(nextInterrupted)
                onInterruptChange?.(nextInterrupted)
                break
              }
              case 'page':
                setCurrentUrl(typeof message.currentUrl === 'string' ? message.currentUrl : null)
                setTitle(typeof message.title === 'string' ? message.title : null)
                break
              case 'notification':
                break
              case 'error':
                console.warn('[live-browser] Control error:', message.message)
                break
              case 'pong':
                break
            }
          } catch {
            // Ignore malformed control messages.
          }
        }

        ws.onclose = () => {
          clearTimeout(timeout)
          if (controlSocketRef.current === ws) {
            controlSocketRef.current = null
            setVncUrl(null)
            disconnectRfb()
            if (!disposedRef.current) {
              updateStatus('disconnected')
              scheduleReconnect()
            }
          }
        }

        ws.onerror = () => {
          clearTimeout(timeout)
          if (urlIndex < urls.length) {
            tryNext()
          }
        }
      } catch {
        tryNext()
      }
    }

    tryNext()
  }, [autoResumeMs, disconnectRfb, enabled, mode, onInterruptChange, scheduleReconnect, sessionId, updateStatus])

  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  useEffect(() => {
    disposedRef.current = false
    failedAttempts.current = 0

    return () => {
      disposedRef.current = true
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (controlSocketRef.current) {
        controlSocketRef.current.close(1000, 'Unmounting live browser')
        controlSocketRef.current = null
      }
      disconnectRfb()
    }
  }, [disconnectRfb, enabled, mode, sessionId])

  useEffect(() => {
    if (!enabled) return

    const timeout = setTimeout(() => {
      connect()
    }, 0)

    return () => {
      clearTimeout(timeout)
    }
  }, [connect, enabled])

  useEffect(() => {
    if (!enabled || !vncUrl || !viewportElement) return
    void connectRfb(vncUrl)

    return () => {
      disconnectRfb()
    }
  }, [connectRfb, disconnectRfb, enabled, viewportElement, vncUrl])

  useEffect(() => {
    if (!rfbRef.current) return
    rfbRef.current.viewOnly = !interrupted
    if (interrupted) {
      rfbRef.current.focus()
    } else {
      rfbRef.current.blur()
    }
  }, [interrupted])

  useEffect(() => {
    if (status !== 'live') return
    const interval = setInterval(() => {
      sendControlMessage({ type: 'ping' })
    }, 30000)
    return () => clearInterval(interval)
  }, [sendControlMessage, status])

  useEffect(() => {
    if (!interrupted || status !== 'live') return
    const interval = setInterval(() => {
      sendControlMessage({ type: 'activity' })
    }, 15000)
    return () => clearInterval(interval)
  }, [interrupted, sendControlMessage, status])

  return {
    status,
    interrupted,
    currentUrl,
    title,
    setViewportElement,
    sendInterrupt: () => sendControlMessage({ type: 'interrupt' }),
    sendResume: () => sendControlMessage({ type: 'resume' }),
    noteActivity: () => sendControlMessage({ type: 'activity' }),
  }
}
