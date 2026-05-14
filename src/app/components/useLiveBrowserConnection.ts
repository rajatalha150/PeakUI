'use client'

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
const CONNECT_TIMEOUT_MS = 4000
const MIN_VISIBLE_FRAME_BYTES = 12_000

function estimateBase64ByteLength(input: string): number {
  if (!input) return 0
  const padding = input.endsWith('==') ? 2 : input.endsWith('=') ? 1 : 0
  return Math.floor((input.length * 3) / 4) - padding
}

function isLikelyBlankStartupFrame(input: string): boolean {
  const bytes = estimateBase64ByteLength(input)
  return bytes > 0 && bytes < MIN_VISIBLE_FRAME_BYTES
}

export function useLiveBrowserConnection({
  sessionId,
  mode,
  enabled = true,
  autoResumeMs = 120000,
  onInterruptChange,
  onStatusChange,
}: UseLiveBrowserConnectionOptions) {
  const [status, setStatus] = useState<LiveBrowserConnectionStatus>('connecting')
  const [frameData, setFrameData] = useState<string | null>(null)
  const [interrupted, setInterrupted] = useState(false)
  const [hasUsableFrame, setHasUsableFrame] = useState(false)

  const failedAttempts = useRef(0)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frameRef = useRef<string | null>(null)
  const hasUsableFrameRef = useRef(false)
  const connectRef = useRef<() => void>(() => {})

  const updateStatus = useCallback((nextStatus: LiveBrowserConnectionStatus) => {
    setStatus(nextStatus)
    onStatusChange?.(nextStatus)
  }, [onStatusChange])

  const sendMessage = useCallback((message: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    }
  }, [])

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) return
    failedAttempts.current += 1
    if (failedAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
      updateStatus('failed')
      return
    }

    const delay = Math.min(1000 * Math.pow(2, failedAttempts.current - 1), MAX_RECONNECT_DELAY_MS)
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null
      updateStatus('connecting')
      connectRef.current()
    }, delay)
  }, [updateStatus])

  const handleFrame = useCallback((nextFrame: string) => {
    if (!nextFrame || nextFrame === frameRef.current) return
    frameRef.current = nextFrame

    // CDP often emits a tiny all-white startup frame before the page paints.
    // Keep showing the fallback screenshot or placeholder until we receive a
    // more substantial frame from the live page.
    if (!hasUsableFrameRef.current && isLikelyBlankStartupFrame(nextFrame)) {
      return
    }

    if (!hasUsableFrameRef.current) {
      hasUsableFrameRef.current = true
      setHasUsableFrame(true)
    }

    setFrameData(nextFrame)
  }, [])

  const connect = useCallback(() => {
    if (!enabled || !sessionId) return

    const params = `sessionId=${encodeURIComponent(sessionId)}&mode=${mode}&autoResumeMs=${autoResumeMs}`
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const urls = [
      `${protocol}//${host}/ws/screencast?${params}`,
      `${protocol}//${window.location.hostname}:3001/?${params}`,
    ]

    let urlIndex = 0

    const tryNext = () => {
      if (urlIndex >= urls.length) {
        if (failedAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
          updateStatus('failed')
          return
        }
        updateStatus('disconnected')
        scheduleReconnect()
        return
      }

      const url = urls[urlIndex]
      urlIndex += 1

      try {
        const ws = new WebSocket(url)
        wsRef.current = ws

        const timeout = setTimeout(() => {
          if (ws.readyState === WebSocket.CONNECTING) {
            ws.close()
            tryNext()
          }
        }, CONNECT_TIMEOUT_MS)

        ws.onopen = () => {
          clearTimeout(timeout)
          updateStatus('live')
          failedAttempts.current = 0
        }

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data)
            switch (message.type) {
              case 'frame':
                if (typeof message.data === 'string') {
                  handleFrame(message.data)
                }
                break
              case 'state': {
                const nextInterrupted = message.interrupted ?? false
                setInterrupted(nextInterrupted)
                onInterruptChange?.(nextInterrupted)
                break
              }
              case 'notification':
                break
              case 'error':
                console.warn('[live-browser] Server error:', message.message)
                break
            }
          } catch {
            // Ignore malformed messages from the stream.
          }
        }

        ws.onclose = () => {
          clearTimeout(timeout)
          if (wsRef.current === ws) {
            wsRef.current = null
            updateStatus('disconnected')
            if (failedAttempts.current < MAX_RECONNECT_ATTEMPTS) {
              scheduleReconnect()
            } else {
              updateStatus('failed')
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
  }, [autoResumeMs, enabled, handleFrame, mode, onInterruptChange, scheduleReconnect, sessionId, updateStatus])

  connectRef.current = connect

  useEffect(() => {
    setFrameData(null)
    frameRef.current = null
    setHasUsableFrame(false)
    hasUsableFrameRef.current = false
    setInterrupted(false)
    failedAttempts.current = 0
    if (enabled && sessionId) {
      updateStatus('connecting')
    }
  }, [enabled, mode, sessionId, updateStatus])

  useEffect(() => {
    if (enabled) {
      connect()
    }

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounting')
        wsRef.current = null
      }
    }
  }, [connect, enabled])

  useEffect(() => {
    if (status !== 'live') return
    const interval = setInterval(() => {
      sendMessage({ type: 'ping' })
    }, 30000)
    return () => clearInterval(interval)
  }, [sendMessage, status])

  return {
    status,
    frameData,
    interrupted,
    hasUsableFrame,
    sendInterrupt: () => sendMessage({ type: 'interrupt' }),
    sendResume: () => sendMessage({ type: 'resume' }),
    sendInput: (payload: Record<string, unknown>) => sendMessage({ type: 'input', payload }),
  }
}
