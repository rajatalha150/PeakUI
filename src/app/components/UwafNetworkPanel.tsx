"use client"

import { useCallback, useEffect, useState } from 'react'
import { Globe, Shield, Wifi, WifiOff, RefreshCw, ChevronUp, ChevronDown } from 'lucide-react'
import { panelIconButtonStyle } from './panelIconButton'

const NETWORK_STATUS_STORAGE_KEY = 'peakui-uwaf-network-status'
const PENDING_STATUS_RETRY_MS = 2000
const NETWORK_STATUS_KEEPALIVE_MS = 60 * 1000

interface UwafStatus {
  directIp?: string
  torReachable?: boolean
  torIsReady?: boolean
  torError?: string
  torExitIp?: string
  torExitCountry?: string
  stealthSearchEngine?: string
  stealthProfile?: 'normal' | 'high'
  onionReady?: boolean
  stealthSearchProviders?: Array<{
    id: string
    label: string
    degraded: boolean
    attempts: number
    successes: number
  }>
  stealthCuratedEntryPoints?: Array<{
    id: string
    label: string
    url: string
  }>
  statusLevel?: 'cached' | 'quick' | 'preflight'
  statusCached?: boolean
  statusCheckedAt?: string
  statusRefreshInProgress?: boolean
}

interface UwafNetworkPanelProps {
  currentMode: 'direct' | 'stealth'
  onModeChange: (mode: 'direct' | 'stealth') => void
  disabled?: boolean
  /**
   * Controlled expand state. Owned by the parent (OpenClawWorkspace) so the
   * "max 2 expanded" accordion rule can be enforced centrally.
   */
  isExpanded: boolean
  /** Toggle handler wired up by the parent to flip `isExpanded`. */
  onToggleExpand: () => void
}

export default function UwafNetworkPanel({
  currentMode,
  onModeChange,
  disabled,
  isExpanded,
  onToggleExpand,
}: UwafNetworkPanelProps) {
  const [status, setStatus] = useState<UwafStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchStatus = useCallback(async (level: 'cached' | 'quick' | 'preflight' = 'quick', options?: { force?: boolean; silent?: boolean }) => {
    if (!options?.silent) setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ level })
      if (options?.force) params.set('force', '1')
      const res = await fetch(`/api/openclaw/uwaf-browser/status?${params.toString()}`)
      if (!res.ok) throw new Error(`Status check failed: ${res.status}`)
      const data = await res.json()
      setStatus(data)
      window.sessionStorage.setItem(NETWORK_STATUS_STORAGE_KEY, JSON.stringify(data))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check network status')
    } finally {
      if (!options?.silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    try {
      const cached = window.sessionStorage.getItem(NETWORK_STATUS_STORAGE_KEY)
      if (cached) {
        setStatus(JSON.parse(cached))
      }
    } catch {
      window.sessionStorage.removeItem(NETWORK_STATUS_STORAGE_KEY)
    }

    const timeout = window.setTimeout(() => {
      void fetchStatus('quick')
    }, 0)
    const keepAlive = window.setInterval(() => {
      void fetchStatus('cached', { silent: true })
    }, NETWORK_STATUS_KEEPALIVE_MS)
    return () => {
      window.clearTimeout(timeout)
      window.clearInterval(keepAlive)
    }
  }, [fetchStatus])

  useEffect(() => {
    if (!status?.statusRefreshInProgress && status?.directIp !== 'checking' && status?.torReachable !== undefined) {
      return
    }

    const timeout = window.setTimeout(() => {
      void fetchStatus('quick', { silent: true })
    }, PENDING_STATUS_RETRY_MS)
    return () => window.clearTimeout(timeout)
  }, [fetchStatus, status?.directIp, status?.statusRefreshInProgress, status?.torReachable])

  const handleRefresh = useCallback(() => {
    void fetchStatus('preflight', { force: true })
  }, [fetchStatus])

  const formatCheckedAt = (value?: string) => {
    if (!value) return null
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div style={{
      padding: '10px 12px',
      borderTop: '1px solid var(--border-color)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: isExpanded ? 8 : 0,
      }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Network Hub
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            style={panelIconButtonStyle('networkHub', { loading })}
            title="Run full stealth verification"
          >
            <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
          <button
            type="button"
            onClick={onToggleExpand}
            style={panelIconButtonStyle('networkHub')}
            title={isExpanded ? 'Collapse network hub' : 'Expand network hub'}
          >
            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          <div style={{
            display: 'flex',
            gap: 6,
            marginBottom: 10,
          }}>
            <button
              type="button"
              onClick={() => onModeChange('direct')}
              disabled={disabled}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                justifyContent: 'center',
                padding: '6px 8px',
                borderRadius: 6,
                border: currentMode === 'direct' ? '2px solid var(--accent-primary)' : '1px solid var(--border-color)',
                background: currentMode === 'direct' ? 'var(--accent-soft)' : 'transparent',
                color: currentMode === 'direct' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontSize: '0.72rem',
                fontWeight: currentMode === 'direct' ? 600 : 400,
              }}
            >
              <Globe size={12} />
              Direct
            </button>
            <button
              type="button"
              onClick={() => onModeChange('stealth')}
              disabled={disabled || status?.torReachable === false}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                justifyContent: 'center',
                padding: '6px 8px',
                borderRadius: 6,
                border: currentMode === 'stealth' ? '2px solid #a855f7' : '1px solid var(--border-color)',
                background: currentMode === 'stealth' ? 'rgba(168, 85, 247, 0.1)' : 'transparent',
                color: currentMode === 'stealth' ? '#a855f7' : 'var(--text-secondary)',
                cursor: disabled || status?.torReachable === false ? 'not-allowed' : 'pointer',
                fontSize: '0.72rem',
                fontWeight: currentMode === 'stealth' ? 600 : 400,
              }}
            >
              <Shield size={12} />
              Stealth
            </button>
          </div>

          {error && (
            <div style={{ fontSize: '0.68rem', color: 'var(--danger, #ef4444)', marginBottom: 6 }}>
              {error}
            </div>
          )}

          {status && (
            <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                <Globe size={10} />
                <span>Direct IP: {status.directIp && status.directIp !== 'checking' ? status.directIp : 'checking...'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                {status.torReachable === undefined ? (
                  <><RefreshCw size={10} style={{ animation: status.statusRefreshInProgress ? 'spin 1s linear infinite' : 'none' }} /><span>Tor: Checking</span></>
                ) : status.torReachable ? (
                  <><Wifi size={10} style={{ color: '#22c55e' }} /><span>Tor: Online</span></>
                ) : (
                  <><WifiOff size={10} style={{ color: 'var(--danger, #ef4444)' }} /><span>Tor: Offline</span></>
                )}
              </div>
              {status.torIsReady !== undefined && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  <Shield size={10} style={{ color: status.torIsReady ? '#a855f7' : 'var(--danger, #ef4444)' }} />
                  <span>Stealth route: {status.torIsReady ? 'Verified over Tor' : 'Unverified'}</span>
                </div>
              )}
              {status.torReachable && status.torExitIp && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  <Shield size={10} style={{ color: '#a855f7' }} />
                  <span>Exit: {status.torExitIp}{status.torExitCountry ? ` (${status.torExitCountry})` : ''}</span>
                </div>
              )}
              {status.stealthSearchEngine && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  <Globe size={10} />
                  <span>Stealth search: {status.stealthSearchEngine}</span>
                </div>
              )}
              {status.stealthSearchProviders && status.stealthSearchProviders.length > 0 && (
                <div style={{ marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                    <Globe size={10} />
                    <span>Approved engines</span>
                  </div>
                  <div style={{ paddingLeft: 14 }}>
                    {status.stealthSearchProviders.slice(0, 6).map(provider => (
                      <div key={provider.id} style={{ opacity: provider.degraded ? 0.7 : 1 }}>
                        {provider.label}{provider.degraded ? ' (cooldown)' : ''}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {status.stealthProfile && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  <Shield size={10} />
                  <span>Stealth profile: {status.stealthProfile}</span>
                </div>
              )}
              {status.onionReady !== undefined && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  <Shield size={10} style={{ color: status.onionReady ? '#a855f7' : 'var(--danger, #ef4444)' }} />
                  <span>.onion support: {status.onionReady ? 'Ready' : 'Unavailable'}</span>
                </div>
              )}
              {status.statusCheckedAt && (
                <div style={{ fontSize: '0.62rem', opacity: 0.72, marginBottom: 4 }}>
                  {status.statusLevel === 'preflight' ? 'Verified' : 'Checked'} {formatCheckedAt(status.statusCheckedAt)}
                  {status.statusCached ? ' (cached)' : ''}
                  {status.statusRefreshInProgress ? ' - refreshing...' : ''}
                </div>
              )}
              {status.torError && (
                <div style={{ fontSize: '0.62rem', color: 'var(--danger, #ef4444)', marginTop: 2 }}>
                  {status.torError}
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 6, fontSize: '0.6rem', color: 'var(--text-secondary)', opacity: 0.6 }}>
            {currentMode === 'stealth'
              ? 'All traffic routed through Tor network. .onion sites accessible.'
              : 'Standard internet connection. Clear web sites only.'}
          </div>
        </div>
      )}
    </div>
  )
}
