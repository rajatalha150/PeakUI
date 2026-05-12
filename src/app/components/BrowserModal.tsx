'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Maximize2, Minimize2, Wifi, WifiOff, Loader } from 'lucide-react'

type ConnectionStatus = 'connecting' | 'live' | 'disconnected' | 'failed'

interface BrowserModalProps {
  sessionId: string
  mode: 'direct' | 'stealth'
  /** Static screenshot to show as fallback */
  fallbackScreenshot?: string | null
  currentUrl?: string
  title?: string
  enabled?: boolean
  autoResumeMs?: number
  /** Called from parent to toggle modal */
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** Called when interrupt state changes */
  onInterruptChange?: (interrupted: boolean) => void
  /** Callback to send messages to the sidebar's WebSocket (shared WS ref) */
  wsRef?: React.MutableRefObject<WebSocket | null>
}

export default function BrowserModal({
  sessionId,
  mode,
  fallbackScreenshot,
  currentUrl,
  title,
  enabled = true,
  autoResumeMs = 120000,
  isOpen,
  onOpenChange,
  onInterruptChange,
  wsRef: externalWsRef,
}: BrowserModalProps) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [frameData, setFrameData] = useState<string | null>(null)
  const [interrupted, setInterrupted] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frameRef = useRef<string | null>(null)
  const reconnectAttempts = useRef(0)
  const imgRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const maxReconnectDelay = 30000
  const MAX_RECONNECT_ATTEMPTS = 5

  const connect = useCallback(() => {
    if (!enabled || !sessionId) return

    // Try same-origin first (works through reverse proxies with WebSocket support),
    // then fall back to direct port (works on localhost / direct access)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const params = `sessionId=${encodeURIComponent(sessionId)}&mode=${mode}&autoResumeMs=${autoResumeMs}`
    const sameOriginUrl = `${protocol}//${host}/ws/screencast?${params}`
    const directUrl = `${protocol}//${window.location.hostname}:3001/?${params}`

    const urls = [sameOriginUrl, directUrl]
    let urlIndex = 0

    const tryUrl = () => {
      if (urlIndex >= urls.length) {
        if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
          setStatus('failed')
          return
        }
        setStatus('disconnected')
        scheduleReconnect()
        return
      }
      const url = urls[urlIndex++]
      try {
        const ws = new WebSocket(url)
        wsRef.current = ws
        if (externalWsRef) externalWsRef.current = ws

        ws.onopen = () => {
          setStatus('live')
          reconnectAttempts.current = 0
        }

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data)
            switch (msg.type) {
              case 'frame':
                if (msg.data && msg.data !== frameRef.current) {
                  frameRef.current = msg.data
                  setFrameData(msg.data)
                }
                break
              case 'state':
                setInterrupted(msg.interrupted ?? false)
                onInterruptChange?.(msg.interrupted ?? false)
                break
            }
          } catch { /* ignore */ }
        }

        ws.onclose = () => {
          setStatus('disconnected')
          wsRef.current = null
          if (externalWsRef) externalWsRef.current = null
          if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
            setStatus('failed')
          } else {
            scheduleReconnect()
          }
        }

        ws.onerror = () => {
          // This URL didn't work, try next
          tryUrl()
        }
      } catch {
        tryUrl()
      }
    }

    tryUrl()
  }, [enabled, sessionId, mode, autoResumeMs, onInterruptChange, externalWsRef])

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) return
    if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) return
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), maxReconnectDelay)
    reconnectAttempts.current++
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null
      setStatus('connecting')
      connect()
    }, delay)
  }, [connect])

  useEffect(() => {
    if (isOpen && enabled) {
      connect()
    }
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Modal closing')
        wsRef.current = null
      }
    }
  }, [isOpen, enabled, connect])

  // Heartbeat
  useEffect(() => {
    if (status !== 'live') return
    const interval = setInterval(() => {
      wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify({ type: 'ping' }))
    }, 30000)
    return () => clearInterval(interval)
  }, [status])

  const sendInterrupt = useCallback(() => {
    wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify({ type: 'interrupt' }))
  }, [])

  const sendResume = useCallback(() => {
    wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify({ type: 'resume' }))
  }, [])

  // --- Input relay ---
  const BROWSER_WIDTH = 1280
  const BROWSER_HEIGHT = 720

  const scaleCoords = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    if (!containerRef.current) return { x: 0, y: 0 }
    const rect = containerRef.current.getBoundingClientRect()
    return {
      x: Math.round((clientX - rect.left) / rect.width * BROWSER_WIDTH),
      y: Math.round((clientY - rect.top) / rect.height * BROWSER_HEIGHT),
    }
  }, [])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!interrupted || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    const { x, y } = scaleCoords(e.clientX, e.clientY)
    wsRef.current.send(JSON.stringify({
      type: 'input',
      payload: { inputType: 'click', x, y, button: 'left', clickCount: 1 },
    }))
  }, [interrupted, scaleCoords])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!interrupted || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    const { x, y } = scaleCoords(e.clientX, e.clientY)
    wsRef.current.send(JSON.stringify({
      type: 'input',
      payload: { inputType: 'scroll', x, y, deltaX: e.deltaX, deltaY: e.deltaY },
    }))
    e.preventDefault()
  }, [interrupted, scaleCoords])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!interrupted || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    // Special keys
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape' || e.key === 'Backspace' || e.key === 'Delete') {
      const keyMap: Record<string, { key: string; code: string; keyCode: number }> = {
        Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
        Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
        Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
        Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
        Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
      }
      const mapping = keyMap[e.key]
      if (mapping) {
        e.preventDefault()
        wsRef.current.send(JSON.stringify({
          type: 'input',
          payload: { inputType: 'keypress', ...mapping },
        }))
        return
      }
    }

    // Regular typing
    if (e.key.length === 1) {
      e.preventDefault()
      wsRef.current.send(JSON.stringify({
        type: 'input',
        payload: { inputType: 'type', text: e.key },
      }))
    }
  }, [interrupted])

  // Touch support
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!interrupted || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    const touch = e.touches[0]
    if (!touch) return
    const { x, y } = scaleCoords(touch.clientX, touch.clientY)
    wsRef.current.send(JSON.stringify({
      type: 'input',
      payload: { inputType: 'click', x, y, button: 'left', clickCount: 1 },
    }))
  }, [interrupted, scaleCoords])

  if (!isOpen) return null

  const showLive = enabled && status === 'live' && frameData
  const imageData = showLive ? frameData : fallbackScreenshot

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(8px)',
      }}
      onClick={(e) => e.target === e.currentTarget && onOpenChange(false)}
    >
      {/* Header bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        maxWidth: 1200,
        padding: '10px 16px',
        marginBottom: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Mode badge */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            borderRadius: 4,
            fontSize: '0.7rem',
            fontWeight: 600,
            background: mode === 'stealth' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(59, 130, 246, 0.2)',
            color: mode === 'stealth' ? '#a855f7' : '#3b82f6',
            border: `1px solid ${mode === 'stealth' ? 'rgba(168, 85, 247, 0.4)' : 'rgba(59, 130, 246, 0.4)'}`,
          }}>
            {mode === 'stealth' ? '🛡 Stealth' : '🌐 Direct'}
          </div>

          {/* Connection status */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: '0.7rem',
            color: status === 'live' ? '#22c55e' : status === 'connecting' || status === 'disconnected' ? '#f59e0b' : '#ef4444',
          }}>
            {status === 'live' ? <Wifi size={12} /> : status === 'connecting' || status === 'disconnected' ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <WifiOff size={12} />}
            {status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting...' : status === 'disconnected' ? 'Reconnecting...' : 'Offline'}
          </div>

          {/* URL */}
          {currentUrl && (
            <div style={{
              fontSize: '0.68rem',
              color: 'rgba(255,255,255,0.6)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 400,
            }}>
              {title && <span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>{title}</span>}
              {title && ' · '}
              {currentUrl}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Interrupt / Resume button */}
          {enabled && status === 'live' && (
            <button
              onClick={interrupted ? sendResume : sendInterrupt}
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                padding: '6px 14px',
                borderRadius: 6,
                border: interrupted ? '1px solid #22c55e' : '1px solid #f59e0b',
                background: interrupted ? 'rgba(34, 197, 94, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                color: interrupted ? '#22c55e' : '#f59e0b',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {interrupted ? '▶ Resume AI' : '⏸ Take Over'}
            </button>
          )}
          <button
            onClick={() => onOpenChange(false)}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 6,
              color: '#fff',
              cursor: 'pointer',
              padding: '4px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: '0.72rem',
            }}
          >
            <Minimize2 size={12} /> Close
          </button>
        </div>
      </div>

      {/* Browser view container */}
      <div
        ref={containerRef}
        style={{
          width: '90vw',
          maxWidth: 1200,
          aspectRatio: '16/9',
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.15)',
          background: '#111',
          position: 'relative',
          cursor: interrupted ? 'crosshair' : 'default',
        }}
        onClick={handleClick}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        onTouchStart={handleTouchStart}
        tabIndex={0}
      >
        {imageData ? (
          <img
            ref={imgRef}
            src={`data:image/jpeg;base64,${imageData}`}
            alt="Browser view"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: 'block',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
            draggable={false}
          />
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'rgba(255,255,255,0.4)',
            fontSize: '0.85rem',
            gap: 8,
          }}>
            {status === 'failed' && <WifiOff size={24} />}
            {status === 'failed' ? 'Browser connection unavailable' : status === 'connecting' || status === 'disconnected' ? 'Connecting to browser...' : 'No browser content'}
          </div>
        )}

        {/* Live indicator */}
        {showLive && !interrupted && (
          <div style={{
            position: 'absolute',
            top: 10,
            right: 10,
            background: 'rgba(239, 68, 68, 0.9)',
            color: '#fff',
            fontSize: '0.65rem',
            fontWeight: 700,
            padding: '3px 8px',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}>
            <span style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#fff',
              animation: 'blink 1s infinite',
            }} />
            LIVE
          </div>
        )}

        {/* User control indicator */}
        {interrupted && (
          <div style={{
            position: 'absolute',
            top: 10,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(245, 158, 11, 0.9)',
            color: '#fff',
            fontSize: '0.65rem',
            fontWeight: 700,
            padding: '3px 10px',
            borderRadius: 4,
          }}>
            YOU HAVE CONTROL — click, type, or scroll to interact
          </div>
        )}
      </div>

      {/* Instruction text */}
      {interrupted && (
        <div style={{
          marginTop: 10,
          fontSize: '0.7rem',
          color: 'rgba(255,255,255,0.5)',
          textAlign: 'center',
        }}>
          Click on the browser view to interact. Type with your keyboard. Press &quot;Resume AI&quot; when done.
        </div>
      )}

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}