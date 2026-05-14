'use client'

import { Wifi, WifiOff, Loader } from 'lucide-react'
import { type LiveBrowserConnectionStatus, useLiveBrowserConnection } from './useLiveBrowserConnection'

interface LiveBrowserViewProps {
  sessionId: string
  mode: 'direct' | 'stealth'
  fallbackScreenshot?: string | null
  currentUrl?: string
  title?: string
  onInterruptChange?: (interrupted: boolean) => void
  onStatusChange?: (status: LiveBrowserConnectionStatus) => void
  enabled?: boolean
  autoResumeMs?: number
}

export default function LiveBrowserView({
  sessionId,
  mode,
  fallbackScreenshot,
  currentUrl,
  title,
  onInterruptChange,
  onStatusChange,
  enabled = true,
  autoResumeMs = 120000,
}: LiveBrowserViewProps) {
  const {
    status,
    frameData,
    interrupted,
    hasUsableFrame,
    sendInterrupt,
    sendResume,
  } = useLiveBrowserConnection({
    sessionId,
    mode,
    enabled,
    autoResumeMs,
    onInterruptChange,
    onStatusChange,
  })

  const modeBadge = mode === 'stealth'
    ? { label: 'Stealth', bg: 'rgba(168, 85, 247, 0.15)', color: '#a855f7', border: '1px solid rgba(168, 85, 247, 0.3)' }
    : { label: 'Direct', bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.3)' }

  const showLive = enabled && status === 'live' && hasUsableFrame && frameData
  const imageData = showLive ? frameData : fallbackScreenshot
  const connectionLabel = status === 'live'
    ? (hasUsableFrame ? 'Live' : 'Starting')
    : status === 'connecting'
      ? 'Connecting'
      : status === 'disconnected'
        ? 'Reconnecting'
        : 'Offline'

  const statusMessage = status === 'connecting' ? 'Connecting to browser...'
    : status === 'failed' ? 'Browser offline — using screenshot fallback'
    : status === 'disconnected' ? 'Reconnecting...'
    : hasUsableFrame ? 'Waiting for browser activity...' : 'Waiting for first painted browser frame...'

  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border-color)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {enabled ? 'Live Browser' : 'Browser Preview'}
        </span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {enabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: '0.62rem', color: status === 'live' ? '#22c55e' : status === 'connecting' || status === 'disconnected' ? '#f59e0b' : '#ef4444' }}>
              {status === 'live' ? <Wifi size={10} /> : status === 'connecting' || status === 'disconnected' ? <Loader size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <WifiOff size={10} />}
              {connectionLabel}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 4, fontSize: '0.62rem', fontWeight: 600, background: modeBadge.bg, color: modeBadge.color, border: modeBadge.border }}>
          {mode === 'stealth' ? '🛡' : '🌐'} {modeBadge.label}
        </div>
        {enabled && status === 'live' && (
          <button onClick={interrupted ? sendResume : sendInterrupt} style={{ fontSize: '0.6rem', fontWeight: 600, padding: '2px 8px', borderRadius: 4, border: interrupted ? '1px solid #22c55e' : '1px solid #f59e0b', background: interrupted ? 'rgba(34, 197, 94, 0.15)' : 'rgba(245, 158, 11, 0.15)', color: interrupted ? '#22c55e' : '#f59e0b', cursor: 'pointer', transition: 'all 0.15s ease' }} title={interrupted ? 'Resume AI control' : 'Take over browser control'}>
            {interrupted ? '▶ Resume AI' : '⏸ Take Over'}
          </button>
        )}
      </div>

      <div style={{ borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border-color)', position: 'relative', background: '#111' }}>
        {imageData ? (
          <img src={`data:image/jpeg;base64,${imageData}`} alt={showLive ? 'Live browser view' : 'Browser screenshot'} style={{ width: '100%', height: 'auto', display: 'block', objectFit: 'contain' }} />
        ) : (
          <div style={{ width: '100%', aspectRatio: '16/9', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '0.75rem', opacity: 0.6, gap: 4 }}>
            {status === 'failed' && <WifiOff size={16} />}
            {statusMessage}
          </div>
        )}
        {showLive && !interrupted && (
          <div style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(239, 68, 68, 0.9)', color: '#fff', fontSize: '0.55rem', fontWeight: 700, padding: '2px 5px', borderRadius: 3, display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff', animation: 'blink 1s infinite' }} />
            LIVE
          </div>
        )}
        {interrupted && (
          <div style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(245, 158, 11, 0.9)', color: '#fff', fontSize: '0.55rem', fontWeight: 700, padding: '2px 5px', borderRadius: 3 }}>
            YOU HAVE CONTROL
          </div>
        )}
      </div>

      {currentUrl && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title && <span style={{ fontWeight: 600 }}>{title}</span>}
            {title && ' · '}
            <span style={{ color: 'var(--accent-primary)', opacity: 0.8 }}>{currentUrl}</span>
          </div>
        </div>
      )}

      <style>{`
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
