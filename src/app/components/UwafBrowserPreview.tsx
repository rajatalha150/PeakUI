'use client'

import { useState } from 'react'
import { Maximize2, X, ExternalLink } from 'lucide-react'

interface UwafBrowserPreviewProps {
  screenshot?: string | null
  currentUrl?: string
  title?: string
  mode?: 'direct' | 'stealth'
  onClose?: () => void
}

export default function UwafBrowserPreview({
  screenshot,
  currentUrl,
  title,
  mode = 'direct',
  onClose,
}: UwafBrowserPreviewProps) {
  const [expanded, setExpanded] = useState(false)

  if (!screenshot) return null

  const modeBadge = mode === 'stealth'
    ? { label: 'Stealth', bg: 'rgba(168, 85, 247, 0.15)', color: '#a855f7', border: '1px solid rgba(168, 85, 247, 0.3)' }
    : { label: 'Direct', bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.3)' }

  return (
    <div style={{
      padding: '10px 12px',
      borderTop: '1px solid var(--border-color)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 6,
      }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Browser Preview
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              padding: 2,
              display: 'flex',
              alignItems: 'center',
            }}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            <Maximize2 size={12} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                padding: 2,
                display: 'flex',
                alignItems: 'center',
              }}
              title="Close preview"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Mode badge */}
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 6px',
        borderRadius: 4,
        fontSize: '0.62rem',
        fontWeight: 600,
        background: modeBadge.bg,
        color: modeBadge.color,
        border: modeBadge.border,
        marginBottom: 6,
      }}>
        {mode === 'stealth' ? '🛡' : '🌐'} {modeBadge.label}
      </div>

      {/* Screenshot */}
      <div style={{
        borderRadius: 6,
        overflow: 'hidden',
        border: '1px solid var(--border-color)',
        maxHeight: expanded ? 400 : 180,
        transition: 'max-height 0.2s ease',
      }}>
        <img
          src={`data:image/jpeg;base64,${screenshot}`}
          alt="Browser preview"
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            objectFit: 'contain',
          }}
        />
      </div>

      {/* URL and title */}
      {currentUrl && (
        <div style={{ marginTop: 4 }}>
          <div style={{
            fontSize: '0.62rem',
            color: 'var(--text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {title && <span style={{ fontWeight: 600 }}>{title}</span>}
            {title && ' · '}
            <span style={{ color: 'var(--accent-primary)', opacity: 0.8 }}>{currentUrl}</span>
          </div>
          <div style={{ marginTop: 2 }}>
            <a
              href={`data:image/jpeg;base64,${screenshot}`}
              download={`browser-preview-${Date.now()}.jpg`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: '0.6rem',
                color: 'var(--accent-primary)',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <ExternalLink size={8} />
              Open screenshot
            </a>
          </div>
        </div>
      )}
    </div>
  )
}