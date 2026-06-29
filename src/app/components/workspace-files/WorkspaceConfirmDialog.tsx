'use client'

import { useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'

export interface WorkspaceConfirmDialogProps {
  open: boolean
  title: string
  message: string
  /** Highlight that this is a destructive action. */
  destructive?: boolean
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Lightweight confirmation dialog used for destructive file operations
 * (delete, bulk delete). Renders as a modal overlay with a focused
 * backdrop. Esc cancels; clicking the backdrop also cancels.
 */
export default function WorkspaceConfirmDialog({
  open,
  title,
  message,
  destructive,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: WorkspaceConfirmDialogProps) {
  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        onConfirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel, onConfirm])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1360,
        background: 'rgba(2, 6, 12, 0.7)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onMouseDown={event => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        style={{
          width: 'min(440px, 92vw)',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--border-color)',
          borderRadius: 12,
          background: 'var(--bg-base)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
          }}
        >
          {destructive && <AlertTriangle size={14} color="#f59e0b" />}
          <strong style={{ flex: 1, fontSize: '0.86rem', color: 'var(--text-primary)' }}>{title}</strong>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            style={{
              width: 24,
              height: 24,
              borderRadius: 4,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-primary)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            <X size={12} />
          </button>
        </div>
        <div style={{ padding: '14px 16px', fontSize: '0.82rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
          {message}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            padding: '10px 14px',
            borderTop: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '5px 12px',
              borderRadius: 5,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: '0.78rem',
              cursor: 'pointer',
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            style={{
              padding: '5px 14px',
              borderRadius: 5,
              border: destructive
                ? '1px solid rgba(239, 68, 68, 0.6)'
                : '1px solid var(--accent-color, #6366f1)',
              background: destructive ? 'rgba(239, 68, 68, 0.85)' : 'var(--accent-color, #6366f1)',
              color: 'white',
              fontSize: '0.78rem',
              cursor: 'pointer',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}