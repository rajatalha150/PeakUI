'use client'

import { Minimize2, Loader, Wifi, WifiOff } from 'lucide-react'
import { useLiveBrowserConnection } from './useLiveBrowserConnection'

interface BrowserModalProps {
  sessionId: string
  mode: 'direct' | 'stealth'
  fallbackScreenshot?: string | null
  currentUrl?: string
  title?: string
  enabled?: boolean
  autoResumeMs?: number
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onInterruptChange?: (interrupted: boolean) => void
}

export default function BrowserModal({
  sessionId,
  mode,
  currentUrl,
  title,
  enabled = true,
  autoResumeMs = 120000,
  isOpen,
  onOpenChange,
  onInterruptChange,
}: BrowserModalProps) {
  const {
    status,
    interrupted,
    currentUrl: liveCurrentUrl,
    title: liveTitle,
    setViewportElement,
    sendInterrupt,
    sendResume,
    noteActivity,
  } = useLiveBrowserConnection({
    sessionId,
    mode,
    enabled: isOpen && enabled,
    autoResumeMs,
    onInterruptChange,
  })

  if (!isOpen) return null

  const resolvedUrl = liveCurrentUrl || currentUrl
  const resolvedTitle = liveTitle || title
  const connectionLabel = status === 'live'
    ? 'Interactive'
    : status === 'connecting'
      ? 'Starting...'
      : status === 'disconnected'
        ? 'Reconnecting...'
        : 'Offline'

  const statusMessage = status === 'connecting'
    ? 'Starting interactive browser session...'
    : status === 'disconnected'
      ? 'Reconnecting to the live browser...'
      : status === 'failed'
        ? 'Interactive browser unavailable'
        : interrupted
          ? 'You have control of the browser'
          : 'AI is controlling the browser. Use Take Over to interact.'

  const signalActivity = () => {
    if (interrupted) {
      noteActivity()
    }
  }

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
      onClick={(event) => event.target === event.currentTarget && onOpenChange(false)}
    >
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

          {resolvedUrl && (
            <div style={{
              fontSize: '0.68rem',
              color: 'rgba(255,255,255,0.6)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 420,
            }}>
              {resolvedTitle && <span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>{resolvedTitle}</span>}
              {resolvedTitle && ' · '}
              {resolvedUrl}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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

      <div
        style={{
          width: '90vw',
          maxWidth: 1200,
          aspectRatio: '16/9',
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.15)',
          background: '#111',
          position: 'relative',
        }}
        onMouseDown={signalActivity}
        onWheel={signalActivity}
        onKeyDown={signalActivity}
        onTouchStart={signalActivity}
      >
        <div
          ref={setViewportElement}
          style={{
            width: '100%',
            height: '100%',
            background: '#111',
          }}
        />
        {status !== 'live' && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.5)',
            fontSize: '0.85rem',
            textAlign: 'center',
            padding: 16,
          }}>
            {statusMessage}
          </div>
        )}
        {status === 'live' && !interrupted && (
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
            AI ACTIVE
          </div>
        )}
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
            YOU HAVE CONTROL
          </div>
        )}
      </div>

      <div style={{
        marginTop: 10,
        fontSize: '0.72rem',
        color: 'rgba(255,255,255,0.6)',
        textAlign: 'center',
      }}>
        {statusMessage}
      </div>

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
