/**
 * Shell Execution Settings Panel
 */

import React, { useEffect, useState } from 'react'
import { AlertTriangle, Check, Shield, X } from 'lucide-react'

interface ShellSettingsPanelProps {
  onClose: () => void
}

type ShellExecutionMode = 'auto-approve' | 'ask-first' | 'deny'
type ShellExecutionTarget = 'container' | 'host'

interface HostExecutorStatus {
  configured: boolean
  reachable: boolean
  url: string
  error?: string
}

export default function ShellSettingsPanel({ onClose }: ShellSettingsPanelProps) {
  const [target, setTarget] = useState<ShellExecutionTarget>('container')
  const [mode, setMode] = useState<ShellExecutionMode>('ask-first')
  const [allowedCommands, setAllowedCommands] = useState('')
  const [hostAllowedRoots, setHostAllowedRoots] = useState('/tmp/viewllama-openclaw-workspace')
  const [hostAllowedEnvVars, setHostAllowedEnvVars] = useState('PATH\nHOME\nUSER\nSHELL\nLANG\nTERM')
  const [hostMaxTimeoutMs, setHostMaxTimeoutMs] = useState(60000)
  const [hostMaxOutputBytes, setHostMaxOutputBytes] = useState(262144)
  const [hostExecutorStatus, setHostExecutorStatus] = useState<HostExecutorStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch('/api/openclaw/shell/settings')
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        if (cancelled) return

        setTarget(data.shellExecutionTarget === 'host' ? 'host' : 'container')
        setMode(data.shellExecutionMode === 'auto-approve' || data.shellExecutionMode === 'deny' ? data.shellExecutionMode : 'ask-first')
        setAllowedCommands(data.shellAllowedCommands || '')
        setHostAllowedRoots(data.shellHostAllowedRoots || '/tmp/viewllama-openclaw-workspace')
        setHostAllowedEnvVars(data.shellHostAllowedEnvVars || 'PATH\nHOME\nUSER\nSHELL\nLANG\nTERM')
        setHostMaxTimeoutMs(typeof data.shellHostMaxTimeoutMs === 'number' ? data.shellHostMaxTimeoutMs : 60000)
        setHostMaxOutputBytes(typeof data.shellHostMaxOutputBytes === 'number' ? data.shellHostMaxOutputBytes : 262144)
        setHostExecutorStatus(data.hostExecutorStatus || null)
      } catch (error) {
        console.error('Failed to load shell settings:', error)
      } finally {
        if (!cancelled) {
          setLoaded(true)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/openclaw/shell/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shellExecutionTarget: target,
          shellExecutionMode: mode,
          shellAllowedCommands: allowedCommands,
          shellHostAllowedRoots: hostAllowedRoots,
          shellHostAllowedEnvVars: hostAllowedEnvVars,
          shellHostMaxTimeoutMs: hostMaxTimeoutMs,
          shellHostMaxOutputBytes: hostMaxOutputBytes,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onClose()
    } catch (error) {
      console.error('Failed to save shell settings:', error)
    } finally {
      setSaving(false)
    }
  }

  const MODE_DESCRIPTIONS = {
    'auto-approve': {
      icon: Check,
      color: 'var(--success)',
      title: 'Auto-approve',
      description: 'Allowlisted commands run immediately. Everything else still requires approval.',
    },
    'ask-first': {
      icon: Shield,
      color: 'var(--warning)',
      title: 'Ask First (Recommended)',
      description: 'Show an approval dialog for every non-blocked command before it runs.',
    },
    'deny': {
      icon: X,
      color: 'var(--danger)',
      title: 'Deny All',
      description: 'Block all shell command execution. Commands will not run.',
    },
  }

  if (!loaded) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(2, 6, 12, 0.76)',
        backdropFilter: 'blur(10px)',
        zIndex: 1200,
      }}>
        <div style={{ color: 'var(--text-primary)' }}>Loading...</div>
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        justifyContent: 'flex-end',
        background: 'rgba(2, 6, 12, 0.76)',
        backdropFilter: 'blur(10px)',
        zIndex: 1200,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(460px, 100%)',
          height: '100%',
          background: 'var(--bg-base)',
          borderLeft: '1px solid var(--border-color)',
          boxShadow: '-24px 0 60px rgba(0, 0, 0, 0.45)',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={event => event.stopPropagation()}
      >
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}>
          <Shield size={20} style={{ color: 'var(--accent-primary)' }} />
          <h2 style={{ margin: 0, fontSize: '16px' }}>Shell Execution Settings</h2>
          <button
            onClick={onClose}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
            }}
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
          <section style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>
              Execution Target
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {([
                {
                  value: 'container',
                  title: 'Container Shell',
                  description: 'Use the built-in ViewLlama runtime container. Command availability depends on the container image.',
                },
                {
                  value: 'host',
                  title: 'Host Shell',
                  description: 'Use the optional host executor running outside Docker so commands see the host PATH and installed tools.',
                },
              ] as const).map(entryTarget => {
                const active = target === entryTarget.value
                return (
                  <label
                    key={entryTarget.value}
                    style={{
                      display: 'flex',
                      gap: '12px',
                      padding: '12px',
                      borderRadius: '10px',
                      border: active ? '2px solid var(--accent-primary)' : '1px solid var(--border-color)',
                      background: active ? 'var(--accent-soft)' : 'rgba(255,255,255,0.03)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="shellTarget"
                      value={entryTarget.value}
                      checked={active}
                      onChange={() => setTarget(entryTarget.value)}
                      style={{ marginTop: '2px' }}
                    />
                    <div>
                      <div style={{ fontWeight: 500, marginBottom: '4px' }}>{entryTarget.title}</div>
                      <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
                        {entryTarget.description}
                      </p>
                    </div>
                  </label>
                )
              })}
            </div>
          </section>

          <section style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>
              Approval Mode
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {(Object.keys(MODE_DESCRIPTIONS) as ShellExecutionMode[]).map((entryMode) => {
                const { icon: Icon, color, title, description } = MODE_DESCRIPTIONS[entryMode]
                return (
                  <label
                    key={entryMode}
                    style={{
                      display: 'flex',
                      gap: '12px',
                      padding: '12px',
                      borderRadius: '10px',
                      border: mode === entryMode ? `2px solid ${color}` : '1px solid var(--border-color)',
                      background: mode === entryMode ? 'var(--accent-soft)' : 'rgba(255,255,255,0.03)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="shellMode"
                      value={entryMode}
                      checked={mode === entryMode}
                      onChange={() => setMode(entryMode)}
                      style={{ marginTop: '2px' }}
                    />
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                        <Icon size={16} style={{ color }} />
                        <span style={{ fontWeight: 500 }}>{title}</span>
                      </div>
                      <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
                        {description}
                      </p>
                    </div>
                  </label>
                )
              })}
            </div>
          </section>

          <section>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
              Additional Allowed Commands
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
              Comma-separated list of command prefixes to auto-approve in addition to safe defaults like `ls`, `cat`, `git status`, and `node --version`.
            </p>
            <textarea
              value={allowedCommands}
              onChange={(event) => setAllowedCommands(event.target.value)}
              placeholder="docker compose, make, go build"
              style={{
                width: '100%',
                minHeight: '80px',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: 'var(--input-shell-bg)',
                color: 'var(--text-primary)',
                fontFamily: 'monospace',
                fontSize: '13px',
                resize: 'vertical',
              }}
            />
          </section>

          {target === 'host' && mode !== 'deny' && (
            <section style={{ marginTop: '24px', display: 'grid', gap: '16px' }}>
              <div>
                <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
                  Host Executor Status
                </h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {hostExecutorStatus?.configured
                    ? hostExecutorStatus.reachable
                      ? `Connected to ${hostExecutorStatus.url}.`
                      : `Configured at ${hostExecutorStatus.url}, but unreachable: ${hostExecutorStatus.error || 'unknown error'}.`
                    : hostExecutorStatus?.error || 'Host executor is not configured.'}
                </p>
              </div>

              <div>
                <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
                  Host Allowed Roots
                </h3>
                <textarea
                  value={hostAllowedRoots}
                  onChange={(event) => setHostAllowedRoots(event.target.value)}
                  placeholder="/tmp/viewllama-openclaw-workspace"
                  style={{
                    width: '100%',
                    minHeight: '80px',
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--input-shell-bg)',
                    color: 'var(--text-primary)',
                    fontFamily: 'monospace',
                    fontSize: '13px',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div>
                <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
                  Host Allowed Env Vars
                </h3>
                <textarea
                  value={hostAllowedEnvVars}
                  onChange={(event) => setHostAllowedEnvVars(event.target.value)}
                  placeholder={'PATH\nHOME\nUSER\nSHELL'}
                  style={{
                    width: '100%',
                    minHeight: '80px',
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--input-shell-bg)',
                    color: 'var(--text-primary)',
                    fontFamily: 'monospace',
                    fontSize: '13px',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
                    Host Timeout (ms)
                  </h3>
                  <input
                    type="number"
                    value={hostMaxTimeoutMs}
                    min={1000}
                    max={300000}
                    onChange={(event) => setHostMaxTimeoutMs(Number(event.target.value))}
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--input-shell-bg)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>

                <div>
                  <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
                    Host Output Cap (bytes)
                  </h3>
                  <input
                    type="number"
                    value={hostMaxOutputBytes}
                    min={16384}
                    max={1048576}
                    onChange={(event) => setHostMaxOutputBytes(Number(event.target.value))}
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--input-shell-bg)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>
              </div>
            </section>
          )}

          <section style={{ marginTop: '24px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>
              <AlertTriangle size={16} style={{ display: 'inline', marginRight: '6px' }} />
              Blocked Commands
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              The following are always blocked: <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>rm -rf /</code>, <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>mkfs</code>, <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>dd</code>, <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>sudo</code>, <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>ssh</code>, and other dangerous patterns.
            </p>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: '10px' }}>
              Commands like <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>git clone</code>, <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>curl</code>, <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>wget</code>, <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>npm install</code>, and <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>docker compose up</code> are allowed only with explicit approval unless you intentionally allowlist them.
            </p>
          </section>
        </div>

        <div style={{
          padding: '16px 20px',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          gap: '12px',
        }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              flex: 1,
              padding: '12px',
              backgroundColor: 'var(--accent-primary)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '12px 20px',
              backgroundColor: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
