"use client"

import React from 'react'
import { Check, ChevronDown, ChevronUp, Copy, Download, Edit2, Loader2, Save, X } from 'lucide-react'
import ArtifactPreviewContent from './ArtifactPreviewContent'
import type { CanvasArtifactRecord } from '@/lib/canvas-artifacts'
import { artifactSupportsTextEditing, buildArtifactExport, formatBytes, isLargeArtifactContent } from '@/lib/canvas-rendering'
import { downloadBlob } from './ChatMessageContent'

interface CanvasPreviewProps {
  artifact: CanvasArtifactRecord
  onUpdate?: (id: string, content: string, name: string) => Promise<void>
  onDelete?: (id: string) => Promise<void>
  onDownload?: (artifact: CanvasArtifactRecord) => void
}

const actionButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  padding: '4px 8px',
  borderRadius: '6px',
  border: '1px solid var(--border-color)',
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: '0.72rem',
}

export default function CanvasPreview({ artifact, onUpdate, onDelete, onDownload }: CanvasPreviewProps) {
  const [expanded, setExpanded] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [editContent, setEditContent] = React.useState(artifact.content || '')
  const [editName, setEditName] = React.useState(artifact.name)
  const [copied, setCopied] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fullPreview, setFullPreview] = React.useState(false)

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(artifact.content || '')
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Failed to copy to clipboard')
    }
  }, [artifact.content])

  const handleSave = React.useCallback(async () => {
    if (!onUpdate) return
    setSaving(true)
    setError(null)
    try {
      await onUpdate(artifact.id, editContent, editName)
      setEditing(false)
    } catch {
      setError('Failed to save changes')
    } finally {
      setSaving(false)
    }
  }, [artifact.id, editContent, editName, onUpdate])

  const editable = artifactSupportsTextEditing(artifact)

  return (
    <div style={{ border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-secondary)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', borderBottom: '1px solid var(--border-color)' }}>
        {editing ? (
          <input
            value={editName}
            onChange={(event) => setEditName(event.target.value)}
            style={{ flex: 1, background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '4px 8px', color: 'var(--text-primary)' }}
          />
        ) : (
          <strong style={{ flex: 1 }}>{artifact.name}</strong>
        )}
        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{formatBytes(artifact.size)}</span>
      </div>
      {error && <div style={{ padding: '8px 12px', color: 'var(--danger)', fontSize: '0.75rem' }}>{error}</div>}
      <div style={{ padding: '12px' }}>
        <ArtifactPreviewContent
          artifact={artifact}
          content={artifact.content || ''}
          expanded={expanded}
          renderFullContent={!isLargeArtifactContent(artifact.content || '') || fullPreview}
          editing={editing}
          editContent={editContent}
          onContentChange={setEditContent}
        />
        {expanded && isLargeArtifactContent(artifact.content || '') && !fullPreview && (
          <button type="button" onClick={() => setFullPreview(true)} style={{ ...actionButtonStyle, marginTop: '10px' }}>
            <ChevronDown size={12} />
            Load full preview
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '10px 12px', borderTop: '1px solid var(--border-color)' }}>
        <button type="button" onClick={() => setExpanded(current => !current)} style={actionButtonStyle}>
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? 'Collapse' : 'Expand'}
        </button>
        <button type="button" onClick={handleCopy} style={{ ...actionButtonStyle, color: copied ? '#10b981' : undefined }}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" onClick={() => onDownload?.(artifact)} style={actionButtonStyle}>
          <Download size={12} />
          Download
        </button>
        {artifact.exportTargets.map(target => (
          <button
            key={target}
            type="button"
            onClick={() => {
              const payload = buildArtifactExport(artifact, target, artifact.content || '')
              downloadBlob(payload.filename, new Blob([payload.content], { type: payload.mimeType }))
            }}
            style={actionButtonStyle}
          >
            <Download size={12} />
            {target}
          </button>
        ))}
        {editable && (
          <button type="button" onClick={() => setEditing(true)} style={actionButtonStyle}>
            <Edit2 size={12} />
            Edit
          </button>
        )}
        {editing && (
          <>
            <button type="button" onClick={() => void handleSave()} disabled={saving} style={{ ...actionButtonStyle, color: '#10b981', borderColor: '#10b981' }}>
              {saving ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={12} />}
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditContent(artifact.content || '')
                setEditName(artifact.name)
                setEditing(false)
                setError(null)
              }}
              style={actionButtonStyle}
            >
              <X size={12} />
              Cancel
            </button>
          </>
        )}
        {onDelete && (
          <button type="button" onClick={() => void onDelete(artifact.id)} style={{ ...actionButtonStyle, marginLeft: 'auto', color: 'var(--danger)' }}>
            <X size={12} />
            Delete
          </button>
        )}
      </div>
    </div>
  )
}
