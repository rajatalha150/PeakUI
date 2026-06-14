import React, { useEffect, useState } from 'react'
import { CheckCircle, FilePenLine, FileText, Globe, Shield, Terminal, XCircle } from 'lucide-react'

interface ShellCommandModalProps {
  title: string
  description?: string
  previewLabel: string
  previewContent: string
  toolKind: 'shell' | 'filesystem' | 'code' | 'browser' | 'unified_browser' | 'tax_return' | 'pdf_document' | 'workbook_document'
  onApprove: () => void
  onReject: () => void
  isOpen: boolean
  autoApproveSeconds?: number
}

function renderToolIcon(toolKind: ShellCommandModalProps['toolKind']) {
  if (toolKind === 'filesystem') return <FilePenLine size={24} style={{ color: 'var(--accent-primary)' }} />
  if (toolKind === 'browser') return <Globe size={24} style={{ color: 'var(--accent-primary)' }} />
  if (toolKind === 'unified_browser') return <Shield size={24} style={{ color: 'var(--accent-uwaf, var(--accent-primary))' }} />
  if (toolKind === 'tax_return' || toolKind === 'pdf_document' || toolKind === 'workbook_document') return <FileText size={24} style={{ color: 'var(--accent-primary)' }} />
  if (toolKind === 'code') return <Terminal size={24} style={{ color: 'var(--accent-primary)' }} />
  return <Terminal size={24} style={{ color: 'var(--accent-primary)' }} />
}

export default function ShellCommandModal({
  title,
  description,
  previewLabel,
  previewContent,
  toolKind,
  onApprove,
  onReject,
  isOpen,
  autoApproveSeconds,
}: ShellCommandModalProps) {
  const [countdown, setCountdown] = useState(autoApproveSeconds ?? 0)

  useEffect(() => {
    if (!isOpen || !autoApproveSeconds) {
      setCountdown(0)
      return
    }
    setCountdown(autoApproveSeconds)
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          onApprove()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [isOpen, autoApproveSeconds, onApprove])

  if (!isOpen) return null

  return (
    <div className="shell-command-modal-overlay" style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(2, 6, 12, 0.76)',
      backdropFilter: 'blur(10px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1300,
    }}>
      <div className="shell-command-modal" style={{
        background: 'var(--bg-base)',
        borderRadius: '12px',
        padding: '24px',
        maxWidth: '700px',
        width: '92%',
        border: '1px solid var(--border-color)',
        boxShadow: '0 30px 80px rgba(0, 0, 0, 0.45)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          {renderToolIcon(toolKind)}
          <h2 style={{ margin: 0, fontSize: '18px' }}>
            {title}
          </h2>
        </div>

        {description && (
          <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
            {description}
          </p>
        )}

        <div style={{ marginBottom: '8px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          {previewLabel}
        </div>

        <div style={{
          background: 'var(--input-shell-bg)',
          borderRadius: '8px',
          padding: '12px',
          fontFamily: 'monospace',
          fontSize: '14px',
          marginBottom: '20px',
          border: '1px solid var(--border-color)',
          whiteSpace: 'pre-wrap',
          maxHeight: '320px',
          overflow: 'auto',
        }}>
          {previewContent}
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => { setCountdown(0); onReject(); }}
            style={{
              flex: 1,
              padding: '12px',
              backgroundColor: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            <XCircle size={18} />
            Reject
          </button>
          <button
            onClick={() => { setCountdown(0); onApprove(); }}
            style={{
              flex: 1,
              padding: '12px',
              backgroundColor: 'var(--success)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            <CheckCircle size={18} />
            {countdown > 0 ? `Approve (${countdown}s)` : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  )
}
