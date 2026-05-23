"use client"

import { useCallback, useEffect, useState } from 'react'
import { Globe, Shield, Wifi, WifiOff, RefreshCw, ChevronUp, ChevronDown } from 'lucide-react'

interface UwafStatus {
  directIp: string
  torReachable: boolean
  torIsReady?: boolean
  torError?: string
  torExitIp?: string
  torExitCountry?: string
  stealthSearchEngine?: string
  onionReady?: boolean
}

interface UwafNetworkPanelProps {
  currentMode: 'direct' | 'stealth'
  onModeChange: (mode: 'direct' | 'stealth') => void
  disabled?: boolean
}

export default function UwafNetworkPanel({ currentMode, onModeChange, disabled }: UwafNetworkPanelProps) {
  const [status, setStatus] = useState<UwafStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  const fetchStatus = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/openclaw/uwaf-browser/status')
      if (!res.ok) throw new Error(`Status check failed: ${res.status}`)
      const data = await res.json()
      setStatus(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check network status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void fetchStatus()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [fetchStatus])

  return (
    <div style={{
      padding: '10px 12px',
      borderTop: '1px solid var(--border-color)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: collapsed ? 0 : 8,
      }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Network Hub
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            onClick={() => setCollapsed(current => !current)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              padding: 2,
              display: 'flex',
              alignItems: 'center',
            }}
            title={collapsed ? 'Expand network hub' : 'Collapse network hub'}
          >
            {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
          <button
            type="button"
            onClick={fetchStatus}
            disabled={loading}
            style={{
              background: 'none',
              border: 'none',
              cursor: loading ? 'wait' : 'pointer',
              color: 'var(--text-secondary)',
              padding: 2,
              display: 'flex',
              alignItems: 'center',
            }}
            title="Refresh status"
          >
            <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
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
              disabled={disabled || (status ? !status.torReachable : false)}
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
                cursor: disabled || (status ? !status.torReachable : false) ? 'not-allowed' : 'pointer',
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
                <span>Direct IP: {status.directIp}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                {status.torReachable ? (
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
              {status.onionReady !== undefined && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  <Shield size={10} style={{ color: status.onionReady ? '#a855f7' : 'var(--danger, #ef4444)' }} />
                  <span>.onion support: {status.onionReady ? 'Ready' : 'Unavailable'}</span>
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
        </>
      )}
    </div>
  )
}
