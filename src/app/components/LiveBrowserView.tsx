'use client'

import { useCallback } from 'react'
import { ChevronDown, ChevronUp, Loader, Wifi, WifiOff } from 'lucide-react'
import { type LiveBrowserConnectionStatus, useLiveBrowserConnection } from './useLiveBrowserConnection'
import LiveBrowserViewport from './LiveBrowserViewport'
import { panelIconButtonStyle } from './panelIconButton'

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
  /**
   * Controlled expand state. Owned by the parent (OpenClawWorkspace) so the
   * "max 2 expanded" accordion rule can be enforced centrally.
   */
  isExpanded: boolean
  /** Toggle handler wired up by the parent to flip `isExpanded`. */
  onToggleExpand: () => void
}

export default function LiveBrowserView({
  sessionId,
  mode,
  currentUrl,
  title,
  onInterruptChange,
  onStatusChange,
  enabled = true,
  autoResumeMs = 120000,
  isExpanded,
  onToggleExpand,
}: LiveBrowserViewProps) {
  const {
    status,
    interrupted,
    currentUrl: liveCurrentUrl,
    title: liveTitle,
    setViewportElement,
    sendInterrupt,
    sendResume,
    noteActivity,
    requestFocus,
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

  const resolvedUrl = liveCurrentUrl || currentUrl
  const resolvedTitle = liveTitle || title
  const connectionLabel = status === 'live'
    ? 'Interactive'
    : status === 'connecting'
      ? 'Starting'
      : status === 'disconnected'
        ? 'Reconnecting'
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

  const signalActivity = useCallback(() => {
    if (interrupted) {
      noteActivity()
    }
    // Re-focus the noVNC canvas on every interaction so React re-renders
    // (which can yank DOM focus back to the wrapper) don't break typing.
    requestFocus()
  }, [interrupted, noteActivity, requestFocus])

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
          <button
            onClick={onToggleExpand}
            title={isExpanded ? 'Minimize' : 'Expand'}
            aria-label={isExpanded ? 'Minimize live browser' : 'Expand live browser'}
            style={panelIconButtonStyle('liveBrowser')}
          >
            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: isExpanded ? 6 : 0 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 4, fontSize: '0.62rem', fontWeight: 600, background: modeBadge.bg, color: modeBadge.color, border: modeBadge.border }}>
          {mode === 'stealth' ? '🛡' : '🌐'} {modeBadge.label}
        </div>
        {enabled && (
          <button
            onClick={interrupted ? sendResume : sendInterrupt}
            style={{
              fontSize: '0.6rem',
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 4,
              border: interrupted ? '1px solid #22c55e' : '1px solid #f59e0b',
              background: interrupted ? 'rgba(34, 197, 94, 0.15)' : 'rgba(245, 158, 11, 0.15)',
              color: interrupted ? '#22c55e' : '#f59e0b',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            title={interrupted ? 'Resume AI control' : 'Take over browser control'}
          >
            {interrupted ? '▶ Resume AI' : '⏸ Take Over'}
          </button>
        )}
      </div>

      {isExpanded && (
        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
          <div
            style={{ borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border-color)', position: 'relative', background: '#111', aspectRatio: '16/9', maxHeight: 180 }}
            onMouseDown={signalActivity}
            onWheel={signalActivity}
            onKeyDown={signalActivity}
            onTouchStart={signalActivity}
          >
            <LiveBrowserViewport ref={setViewportElement} />
            {status !== 'live' && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.75rem', opacity: 0.8, padding: 12 }}>
                {statusMessage}
              </div>
            )}
            {status === 'live' && !interrupted && (
              <div style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(239, 68, 68, 0.9)', color: '#fff', fontSize: '0.55rem', fontWeight: 700, padding: '2px 5px', borderRadius: 3, display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff', animation: 'blink 1s infinite' }} />
                AI ACTIVE
              </div>
            )}
            {interrupted && (
              <div style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(245, 158, 11, 0.9)', color: '#fff', fontSize: '0.55rem', fontWeight: 700, padding: '2px 5px', borderRadius: 3 }}>
                YOU HAVE CONTROL
              </div>
            )}
          </div>

          <div style={{ marginTop: 6, fontSize: '0.62rem', color: 'var(--text-secondary)' }}>
            {statusMessage}
          </div>

          {resolvedUrl && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {resolvedTitle && <span style={{ fontWeight: 600 }}>{resolvedTitle}</span>}
                {resolvedTitle && ' · '}
                <span style={{ color: 'var(--accent-primary)', opacity: 0.8 }}>{resolvedUrl}</span>
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
