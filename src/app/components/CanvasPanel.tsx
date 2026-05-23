"use client"

import React from 'react'
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Edit2,
  FileJson,
  FileSpreadsheet,
  FileText,
  Image,
  Loader2,
  Save,
  X,
} from 'lucide-react'
import ArtifactPreviewContent from './ArtifactPreviewContent'
import VirtualizedList from './VirtualizedList'
import type { CanvasArtifactRecord } from '@/lib/canvas-artifacts'
import {
  isChartArtifact,
  isCodeArtifact,
  isImageArtifact,
  isMarkdownArtifact,
  isTableArtifact,
} from '@/lib/canvas-artifacts'
import {
  artifactSupportsTextEditing,
  buildArtifactExport,
  formatBytes,
  isLargeArtifactContent,
} from '@/lib/canvas-rendering'
import { downloadBlob } from './ChatMessageContent'

export type { CanvasArtifactRecord as CanvasArtifactData }

interface CanvasPanelProps {
  artifacts: CanvasArtifactRecord[]
  onUpdate: (id: string, content: string, name: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onDownload: (artifact: CanvasArtifactRecord) => void
  onFetchContent: (id: string) => Promise<CanvasArtifactRecord | null>
}

type CanvasRow =
  | { type: 'bundle'; id: string; label: string; count: number }
  | { type: 'artifact'; artifact: CanvasArtifactRecord }

const actionButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '3px',
  padding: '3px 7px',
  border: '1px solid var(--border-color)',
  borderRadius: '5px',
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: '0.7rem',
  cursor: 'pointer',
}

function getArtifactIcon(artifact: CanvasArtifactRecord) {
  if (isImageArtifact(artifact)) return <Image size={14} />
  if (isMarkdownArtifact(artifact)) return <FileText size={14} />
  if (isTableArtifact(artifact)) return <FileSpreadsheet size={14} />
  if (artifact.kind === 'data' || artifact.mimeType === 'application/json') return <FileJson size={14} />
  return <FileText size={14} />
}

function createCanvasRows(artifacts: CanvasArtifactRecord[]): CanvasRow[] {
  const groups = new Map<string, CanvasArtifactRecord[]>()
  const singles: CanvasArtifactRecord[] = []

  for (const artifact of artifacts) {
    if (artifact.bundleId) {
      const key = artifact.bundleId
      const next = groups.get(key) ?? []
      next.push(artifact)
      groups.set(key, next)
      continue
    }
    singles.push(artifact)
  }

  const rows: CanvasRow[] = []
  for (const artifactsInBundle of groups.values()) {
    const bundleLabel = artifactsInBundle[0]?.bundleName || artifactsInBundle[0]?.bundleId || 'Artifact bundle'
    rows.push({
      type: 'bundle',
      id: artifactsInBundle[0]?.bundleId || bundleLabel,
      label: bundleLabel,
      count: artifactsInBundle.length,
    })
    for (const artifact of artifactsInBundle) {
      rows.push({ type: 'artifact', artifact })
    }
  }

  for (const artifact of singles) {
    rows.push({ type: 'artifact', artifact })
  }

  return rows
}

function ArtifactCard({
  artifact,
  expanded,
  editing,
  renderFullContent,
  editContent,
  editName,
  onToggleExpand,
  onLoadFullPreview,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onContentChange,
  onNameChange,
  onCopy,
  onDownload,
  onDelete,
  onExport,
  copied,
  saving,
  error,
}: {
  artifact: CanvasArtifactRecord
  expanded: boolean
  editing: boolean
  renderFullContent: boolean
  editContent: string
  editName: string
  onToggleExpand: () => void
  onLoadFullPreview: () => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => Promise<void>
  onContentChange: (content: string) => void
  onNameChange: (name: string) => void
  onCopy: () => void
  onDownload: () => void
  onDelete: () => void
  onExport: (target: CanvasArtifactRecord['exportTargets'][number]) => void
  copied: boolean
  saving: boolean
  error: string | null
}) {
  const content = artifact.content || ''
  const largeContent = isLargeArtifactContent(content)
  const editable = artifactSupportsTextEditing(artifact)
  const supportsRichData = isTableArtifact(artifact) || isChartArtifact(artifact) || isCodeArtifact(artifact) || isMarkdownArtifact(artifact)

  return (
    <div style={{ border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-secondary)', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 10px',
          borderBottom: '1px solid var(--border-color)',
          background: 'rgba(255,255,255,0.02)',
        }}
      >
        <span style={{ color: 'var(--accent-primary)', flexShrink: 0 }}>{getArtifactIcon(artifact)}</span>
        {editing ? (
          <input
            type="text"
            value={editName}
            onChange={(event) => onNameChange(event.target.value)}
            style={{
              flex: 1,
              background: 'transparent',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              padding: '2px 6px',
              color: 'var(--text-primary)',
              fontSize: '0.8rem',
            }}
          />
        ) : (
          <span style={{ flex: 1, fontSize: '0.8rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {artifact.name}
          </span>
        )}
        <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{formatBytes(artifact.size)}</span>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>v{artifact.version}</span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <span className="artifact-badge">{artifact.presentationType}</span>
        {artifact.bundleRole && <span className="artifact-badge">{artifact.bundleRole}</span>}
        {artifact.previewSummary && <span className="artifact-badge artifact-badge-subtle">{artifact.previewSummary}</span>}
        {artifact.sourceArtifactId && <span className="artifact-badge artifact-badge-subtle">derived</span>}
        {artifact.derivedArtifactIds && artifact.derivedArtifactIds.length > 0 && (
          <span className="artifact-badge artifact-badge-subtle">{artifact.derivedArtifactIds.length} derived</span>
        )}
        {artifact.previewWidth && artifact.previewHeight && (
          <span className="artifact-badge artifact-badge-subtle">{artifact.previewWidth}×{artifact.previewHeight}</span>
        )}
      </div>

      {error && (
        <div style={{ padding: '6px 10px', background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', fontSize: '0.75rem' }}>
          {error}
        </div>
      )}

      <div style={{ padding: '10px' }}>
        <ArtifactPreviewContent
          artifact={artifact}
          content={content}
          expanded={expanded}
          renderFullContent={renderFullContent}
          editing={editing}
          editContent={editContent}
          onContentChange={onContentChange}
        />
        {expanded && largeContent && !renderFullContent && (
          <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-start' }}>
            <button type="button" onClick={onLoadFullPreview} style={actionButtonStyle}>
              <ChevronDown size={11} />
              Load full preview
            </button>
          </div>
        )}
        {expanded && !supportsRichData && largeContent && (
          <div style={{ marginTop: '8px', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            Large artifact preview loaded on demand to avoid blocking the workspace.
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '6px 10px',
          borderTop: '1px solid var(--border-color)',
          background: 'rgba(255,255,255,0.01)',
          flexWrap: 'wrap',
        }}
      >
        <button type="button" onClick={onToggleExpand} style={actionButtonStyle}>
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          {expanded ? 'Collapse' : 'Expand'}
        </button>

        <button type="button" onClick={onCopy} style={{ ...actionButtonStyle, color: copied ? '#10b981' : undefined }}>
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>

        <button type="button" onClick={onDownload} style={actionButtonStyle}>
          <Download size={11} />
          Download
        </button>

        {artifact.exportTargets.map(target => (
          <button key={target} type="button" onClick={() => onExport(target)} style={actionButtonStyle}>
            <Download size={11} />
            {target}
          </button>
        ))}

        {editable && (
          <button type="button" onClick={onStartEdit} style={actionButtonStyle}>
            <Edit2 size={11} />
            Edit
          </button>
        )}

        {editing && (
          <>
            <button type="button" onClick={onSaveEdit} disabled={saving} style={{ ...actionButtonStyle, borderColor: '#10b981', color: '#10b981' }}>
              {saving ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={11} />}
              Save
            </button>
            <button type="button" onClick={onCancelEdit} style={actionButtonStyle}>
              <X size={11} />
              Cancel
            </button>
          </>
        )}

        <button type="button" onClick={onDelete} style={{ ...actionButtonStyle, color: 'var(--danger)', marginLeft: 'auto' }}>
          <X size={11} />
          Delete
        </button>
      </div>
    </div>
  )
}

export default function CanvasPanel({
  artifacts,
  onUpdate,
  onDelete,
  onDownload,
  onFetchContent,
}: CanvasPanelProps) {
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set())
  const [editingIds, setEditingIds] = React.useState<Set<string>>(new Set())
  const [fullPreviewIds, setFullPreviewIds] = React.useState<Set<string>>(new Set())
  const [editContentMap, setEditContentMap] = React.useState<Record<string, string>>({})
  const [editNameMap, setEditNameMap] = React.useState<Record<string, string>>({})
  const [copiedIds, setCopiedIds] = React.useState<Set<string>>(new Set())
  const [savingIds, setSavingIds] = React.useState<Set<string>>(new Set())
  const [errors, setErrors] = React.useState<Record<string, string | null>>({})
  const [fullContentMap, setFullContentMap] = React.useState<Record<string, CanvasArtifactRecord | null>>({})

  const rows = React.useMemo(() => createCanvasRows(artifacts), [artifacts])

  const toggleExpand = React.useCallback(async (artifact: CanvasArtifactRecord) => {
    const nextExpanded = new Set(expandedIds)
    if (nextExpanded.has(artifact.id)) {
      nextExpanded.delete(artifact.id)
      setExpandedIds(nextExpanded)
      return
    }

    nextExpanded.add(artifact.id)
    setExpandedIds(nextExpanded)

    if (fullContentMap[artifact.id]) return
    try {
      const full = await onFetchContent(artifact.id)
      if (!full) {
        setErrors(prev => ({ ...prev, [artifact.id]: 'Failed to load artifact content' }))
        return
      }
      setFullContentMap(prev => ({ ...prev, [artifact.id]: full }))
    } catch {
      setErrors(prev => ({ ...prev, [artifact.id]: 'Failed to load artifact content' }))
    }
  }, [expandedIds, fullContentMap, onFetchContent])

  const startEdit = React.useCallback((artifact: CanvasArtifactRecord) => {
    setEditingIds(prev => new Set(prev).add(artifact.id))
    const content = fullContentMap[artifact.id]?.content ?? artifact.content ?? ''
    setEditContentMap(prev => ({ ...prev, [artifact.id]: content }))
    setEditNameMap(prev => ({ ...prev, [artifact.id]: artifact.name }))
  }, [fullContentMap])

  const cancelEdit = React.useCallback((id: string) => {
    setEditingIds(prev => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    setErrors(prev => ({ ...prev, [id]: null }))
  }, [])

  const saveEdit = React.useCallback(async (id: string) => {
    const content = editContentMap[id]
    const name = editNameMap[id]
    if (!content || !name) return

    setSavingIds(prev => new Set(prev).add(id))
    setErrors(prev => ({ ...prev, [id]: null }))
    try {
      await onUpdate(id, content, name)
      setEditingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setFullContentMap(prev => {
        const existing = prev[id]
        if (!existing) return prev
        return {
          ...prev,
          [id]: { ...existing, content, name, version: existing.version + 1 },
        }
      })
    } catch {
      setErrors(prev => ({ ...prev, [id]: 'Failed to save changes' }))
    } finally {
      setSavingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [editContentMap, editNameMap, onUpdate])

  const handleCopy = React.useCallback(async (artifact: CanvasArtifactRecord) => {
    try {
      await navigator.clipboard.writeText(fullContentMap[artifact.id]?.content ?? artifact.content ?? '')
      setCopiedIds(prev => new Set(prev).add(artifact.id))
      window.setTimeout(() => {
        setCopiedIds(prev => {
          const next = new Set(prev)
          next.delete(artifact.id)
          return next
        })
      }, 2000)
    } catch {
      setErrors(prev => ({ ...prev, [artifact.id]: 'Failed to copy' }))
    }
  }, [fullContentMap])

  const handleDownload = React.useCallback((artifact: CanvasArtifactRecord) => {
    onDownload({ ...artifact, content: fullContentMap[artifact.id]?.content ?? artifact.content })
  }, [fullContentMap, onDownload])

  const handleDelete = React.useCallback(async (id: string) => {
    try {
      await onDelete(id)
      setExpandedIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setEditingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setFullPreviewIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setFullContentMap(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    } catch {
      setErrors(prev => ({ ...prev, [id]: 'Failed to delete artifact' }))
    }
  }, [onDelete])

  const handleExport = React.useCallback((artifact: CanvasArtifactRecord, target: CanvasArtifactRecord['exportTargets'][number]) => {
    try {
      const payload = buildArtifactExport(artifact, target, fullContentMap[artifact.id]?.content ?? artifact.content ?? '')
      downloadBlob(payload.filename, new Blob([payload.content], { type: payload.mimeType }))
    } catch {
      setErrors(prev => ({ ...prev, [artifact.id]: `Failed to export ${target}` }))
    }
  }, [fullContentMap])

  if (artifacts.length === 0) return null

  return (
    <VirtualizedList
      items={rows}
      getItemKey={(row) => row.type === 'bundle' ? `bundle-${row.id}` : row.artifact.id}
      estimateItemHeight={(row) => {
        if (row.type === 'bundle') return 44
        if (isImageArtifact(row.artifact)) return 380
        if (isMarkdownArtifact(row.artifact)) return 340
        return 360
      }}
      overscanPx={1200}
      renderItem={(row) => {
        if (row.type === 'bundle') {
          return (
            <div style={{ paddingBottom: '8px', paddingTop: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.76rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                <span>{row.label}</span>
                <span style={{ opacity: 0.7 }}>{row.count} item{row.count === 1 ? '' : 's'}</span>
              </div>
            </div>
          )
        }

        const artifact = fullContentMap[row.artifact.id] ?? row.artifact
        const content = artifact.content ?? ''
        const largeContent = isLargeArtifactContent(content)
        const renderFullContent = !largeContent || fullPreviewIds.has(artifact.id)

        return (
          <div style={{ paddingBottom: '8px' }}>
            <ArtifactCard
              artifact={artifact}
              expanded={expandedIds.has(artifact.id)}
              editing={editingIds.has(artifact.id)}
              renderFullContent={renderFullContent}
              editContent={editContentMap[artifact.id] ?? content}
              editName={editNameMap[artifact.id] ?? artifact.name}
              onToggleExpand={() => toggleExpand(row.artifact)}
              onLoadFullPreview={() => setFullPreviewIds(prev => new Set(prev).add(artifact.id))}
              onStartEdit={() => startEdit(artifact)}
              onCancelEdit={() => cancelEdit(artifact.id)}
              onSaveEdit={() => saveEdit(artifact.id)}
              onContentChange={(nextContent) => setEditContentMap(prev => ({ ...prev, [artifact.id]: nextContent }))}
              onNameChange={(nextName) => setEditNameMap(prev => ({ ...prev, [artifact.id]: nextName }))}
              onCopy={() => handleCopy(artifact)}
              onDownload={() => handleDownload(artifact)}
              onDelete={() => handleDelete(artifact.id)}
              onExport={(target) => handleExport(artifact, target)}
              copied={copiedIds.has(artifact.id)}
              saving={savingIds.has(artifact.id)}
              error={errors[artifact.id] ?? null}
            />
          </div>
        )
      }}
      style={{ display: 'block' }}
    />
  )
}
