'use client'

import { useRef, useCallback } from 'react'
import { Minimize2, Wifi, WifiOff, Loader } from 'lucide-react'
import { useLiveBrowserConnection } from './useLiveBrowserConnection'

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
}: BrowserModalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const {
    status,
    frameData,
    interrupted,
    hasUsableFrame,
    sendInterrupt,
    sendResume,
    sendInput,
  } = useLiveBrowserConnection({
    sessionId,
    mode,
    enabled: isOpen && enabled,
    autoResumeMs,
    onInterruptChange,
  })

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
    if (!interrupted) return
    const { x, y } = scaleCoords(e.clientX, e.clientY)
    sendInput({ inputType: 'click', x, y, button: 'left', clickCount: 1 })
  }, [interrupted, scaleCoords, sendInput])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!interrupted) return
    const { x, y } = scaleCoords(e.clientX, e.clientY)
    sendInput({ inputType: 'scroll', x, y, deltaX: e.deltaX, deltaY: e.deltaY })
    e.preventDefault()
  }, [interrupted, scaleCoords, sendInput])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!interrupted) return
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
        sendInput({ inputType: 'keypress', ...mapping })
        return
      }
    }

    // Regular typing
    if (e.key.length === 1) {
      e.preventDefault()
      sendInput({ inputType: 'type', text: e.key })
    }
  }, [interrupted, sendInput])

  // Touch support
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!interrupted) return
    const touch = e.touches[0]
    if (!touch) return
    const { x, y } = scaleCoords(touch.clientX, touch.clientY)
    sendInput({ inputType: 'click', x, y, button: 'left', clickCount: 1 })
  }, [interrupted, scaleCoords, sendInput])

  if (!isOpen) return null

  const showLive = enabled && status === 'live' && hasUsableFrame && frameData
  const imageData = showLive ? frameData : fallbackScreenshot
  const connectionLabel = status === 'live'
    ? (hasUsableFrame ? 'Live' : 'Starting...')
    : status === 'connecting'
      ? 'Connecting...'
      : status === 'disconnected'
        ? 'Reconnecting...'
        : 'Offline'

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
            {connectionLabel}
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
            {status === 'failed'
              ? 'Browser connection unavailable'
              : status === 'connecting' || status === 'disconnected'
                ? 'Connecting to browser...'
                : hasUsableFrame
                  ? 'No browser content'
                  : 'Waiting for first painted browser frame...'}
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
