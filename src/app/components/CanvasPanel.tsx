"use client"

import React from 'react'
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Edit2,
  Eye,
  FileJson,
  FileSpreadsheet,
  FileText,
  GitBranch,
  History,
  Image as ImageIcon,
  Layers,
  Loader2,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import ArtifactPreviewContent from './ArtifactPreviewContent'
import VirtualizedList from './VirtualizedList'
import type { CanvasArtifactRecord, CanvasArtifactRevisionRecord } from '@/lib/canvas-artifacts'
import {
  isChartArtifact,
  isCodeArtifact,
  isImageArtifact,
  isMarkdownArtifact,
  isPdfArtifact,
  isTableArtifact,
  isWorkbookArtifact,
  isWordArtifact,
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
  onUpdate: (id: string, content: string, name: string) => Promise<CanvasArtifactRecord | void>
  onDelete: (id: string) => Promise<void>
  onDownload: (artifact: CanvasArtifactRecord) => void
  onFetchContent: (id: string) => Promise<CanvasArtifactRecord | null>
  onFetchRevisions?: (id: string) => Promise<CanvasArtifactRevisionRecord[]>
  onRestoreRevision?: (id: string, version: number) => Promise<CanvasArtifactRecord | null>
  onLoadMore?: () => Promise<void> | void
  onSearch?: (query: string) => Promise<void> | void
  hasMore?: boolean
  loading?: boolean
  error?: string | null
  searchQuery?: string
  totalCount?: number | null
}

type CanvasRow =
  | { type: 'bundle'; id: string; label: string; count: number; artifacts: CanvasArtifactRecord[]; collapsed: boolean }
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

const inputStyle: React.CSSProperties = {
  minWidth: 0,
  border: '1px solid var(--border-color)',
  borderRadius: '6px',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  fontSize: '0.76rem',
  padding: '6px 8px',
}

const fallbackHistoryPreStyle: React.CSSProperties = {
  margin: 0,
  maxHeight: '260px',
  overflow: 'auto',
  border: '1px solid var(--border-color)',
  borderRadius: '8px',
  background: 'var(--bg-primary)',
  color: 'var(--text-secondary)',
  fontSize: '0.72rem',
  lineHeight: 1.5,
  padding: '10px',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}

function getRevisionLabel(revision: CanvasArtifactRevisionRecord): string {
  return `v${revision.version} · ${revision.name}`
}

function buildRevisionComparison(left?: CanvasArtifactRevisionRecord, right?: CanvasArtifactRevisionRecord): string {
  if (!left || !right) return 'Select two revisions to compare.'
  const leftLines = (left.content ?? '').split('\n')
  const rightLines = (right.content ?? '').split('\n')
  const maxLines = Math.max(leftLines.length, rightLines.length)
  let changedLines = 0

  for (let index = 0; index < maxLines; index += 1) {
    if ((leftLines[index] ?? '') !== (rightLines[index] ?? '')) changedLines += 1
  }

  const leftPreview = (left.content ?? '').trim().slice(0, 900) || '[empty]'
  const rightPreview = (right.content ?? '').trim().slice(0, 900) || '[empty]'

  return [
    `${getRevisionLabel(left)} -> ${getRevisionLabel(right)}`,
    `${changedLines} changed line${changedLines === 1 ? '' : 's'} across ${maxLines} line${maxLines === 1 ? '' : 's'}.`,
    '',
    `--- ${getRevisionLabel(left)} preview ---`,
    leftPreview,
    '',
    `--- ${getRevisionLabel(right)} preview ---`,
    rightPreview,
  ].join('\n')
}

function getArtifactIcon(artifact: CanvasArtifactRecord) {
  if (isImageArtifact(artifact)) return <ImageIcon size={14} />
  if (isPdfArtifact(artifact)) return <FileText size={14} />
  if (isWorkbookArtifact(artifact)) return <FileSpreadsheet size={14} />
  if (isWordArtifact(artifact)) return <FileText size={14} />
  if (isMarkdownArtifact(artifact)) return <FileText size={14} />
  if (isTableArtifact(artifact)) return <FileSpreadsheet size={14} />
  if (artifact.kind === 'data' || artifact.mimeType === 'application/json') return <FileJson size={14} />
  return <FileText size={14} />
}

function getArtifactTypeLabel(artifact: CanvasArtifactRecord) {
  if (isPdfArtifact(artifact)) return 'PDF'
  if (isWorkbookArtifact(artifact)) return 'Excel'
  if (isWordArtifact(artifact)) return 'Word'
  if (isImageArtifact(artifact)) return 'Image'
  if (isMarkdownArtifact(artifact)) return 'Markdown'
  if (isTableArtifact(artifact)) return 'Table'
  if (isCodeArtifact(artifact)) return 'Code'
  return artifact.presentationType || artifact.kind || 'File'
}

function usePhoneViewport() {
  const [isPhone, setIsPhone] = React.useState(false)

  React.useEffect(() => {
    const query = window.matchMedia('(max-width: 560px)')
    const sync = () => setIsPhone(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  return isPhone
}

function createCanvasRows(artifacts: CanvasArtifactRecord[], collapsedBundleIds: Set<string>): CanvasRow[] {
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
    const bundleId = artifactsInBundle[0]?.bundleId || bundleLabel
    const collapsed = collapsedBundleIds.has(bundleId)
    rows.push({
      type: 'bundle',
      id: bundleId,
      label: bundleLabel,
      count: artifactsInBundle.length,
      artifacts: artifactsInBundle,
      collapsed,
    })
    if (collapsed) continue
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
  onRetryLoad,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onContentChange,
  onNameChange,
  onCopy,
  onDownload,
  onDelete,
  onExport,
  onToggleHistory,
  onRestoreRevision,
  onSelectCompareRevision,
  onOpenRelated,
  copied,
  saving,
  restoring,
  historyAvailable,
  error,
  historyOpen,
  revisions,
  revisionsLoading,
  revisionsError,
  compareLeftVersion,
  compareRightVersion,
}: {
  artifact: CanvasArtifactRecord
  expanded: boolean
  editing: boolean
  renderFullContent: boolean
  editContent: string
  editName: string
  onToggleExpand: () => void
  onLoadFullPreview: () => void
  onRetryLoad: () => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => Promise<void>
  onContentChange: (content: string) => void
  onNameChange: (name: string) => void
  onCopy: () => void
  onDownload: () => void
  onDelete: () => void
  onExport: (target: CanvasArtifactRecord['exportTargets'][number]) => void
  onToggleHistory: () => void
  onRestoreRevision: (version: number) => Promise<void>
  onSelectCompareRevision: (side: 'left' | 'right', version: number) => void
  onOpenRelated: (id: string) => void
  copied: boolean
  saving: boolean
  restoring: boolean
  historyAvailable: boolean
  error: string | null
  historyOpen: boolean
  revisions: CanvasArtifactRevisionRecord[] | null
  revisionsLoading: boolean
  revisionsError: string | null
  compareLeftVersion?: number
  compareRightVersion?: number
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
        <div style={{ padding: '6px 10px', background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <span>{error}</span>
          {expanded && (
            <button type="button" onClick={onRetryLoad} style={{ ...actionButtonStyle, color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.45)' }}>
              Retry
            </button>
          )}
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

        {historyAvailable && (
          <button type="button" onClick={onToggleHistory} style={actionButtonStyle}>
            <History size={11} />
            History
          </button>
        )}

        {artifact.sourceArtifact && (
          <button type="button" onClick={() => onOpenRelated(artifact.sourceArtifact!.id)} style={actionButtonStyle}>
            <GitBranch size={11} />
            Source
          </button>
        )}

        {artifact.derivedArtifacts?.slice(0, 2).map(derived => (
          <button key={derived.id} type="button" onClick={() => onOpenRelated(derived.id)} style={actionButtonStyle}>
            <GitBranch size={11} />
            {derived.name}
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
          <Trash2 size={11} />
          Delete
        </button>
      </div>

      {historyOpen && (
        <div style={{ borderTop: '1px solid var(--border-color)', padding: '10px', display: 'grid', gap: '10px' }}>
          {revisionsLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: '0.76rem' }}>
              <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
              Loading revisions
            </div>
          )}
          {revisionsError && (
            <div style={{ padding: '8px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.35)', color: 'var(--danger)', fontSize: '0.76rem' }}>
              {revisionsError}
            </div>
          )}
          {revisions && revisions.length > 0 && (
            <>
              <div style={{ display: 'grid', gap: '6px' }}>
                {revisions.slice(0, 8).map(revision => (
                  <div key={revision.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 8px', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'rgba(255,255,255,0.02)' }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: '0.74rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {getRevisionLabel(revision)} · {formatBytes(revision.size)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRestoreRevision(revision.version)}
                      disabled={restoring || revision.version === artifact.version}
                      style={actionButtonStyle}
                    >
                      {restoring ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <RotateCcw size={11} />}
                      Restore
                    </button>
                  </div>
                ))}
              </div>
              {revisions.length > 1 && (
                <div style={{ display: 'grid', gap: '8px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <select
                      value={compareLeftVersion ?? revisions[1]?.version ?? revisions[0]?.version}
                      onChange={(event) => onSelectCompareRevision('left', Number(event.target.value))}
                      style={inputStyle}
                    >
                      {revisions.map(revision => <option key={revision.id} value={revision.version}>{getRevisionLabel(revision)}</option>)}
                    </select>
                    <select
                      value={compareRightVersion ?? revisions[0]?.version}
                      onChange={(event) => onSelectCompareRevision('right', Number(event.target.value))}
                      style={inputStyle}
                    >
                      {revisions.map(revision => <option key={revision.id} value={revision.version}>{getRevisionLabel(revision)}</option>)}
                    </select>
                  </div>
                  <pre style={{ ...fallbackHistoryPreStyle }}>
                    {buildRevisionComparison(
                      revisions.find(revision => revision.version === (compareLeftVersion ?? revisions[1]?.version ?? revisions[0]?.version)),
                      revisions.find(revision => revision.version === (compareRightVersion ?? revisions[0]?.version)),
                    )}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function CompactArtifactRow({
  artifact,
  onCopy,
  onDownload,
  onDelete,
  onPreview,
  copied,
  error,
  compact = false,
}: {
  artifact: CanvasArtifactRecord
  onCopy: () => void
  onDownload: () => void
  onDelete: () => void
  onPreview: () => void
  copied: boolean
  error: string | null
  compact?: boolean
}) {
  return (
    <div
      style={{
        display: compact ? 'grid' : 'flex',
        gridTemplateColumns: compact ? 'auto minmax(0, 1fr)' : undefined,
        alignItems: compact ? 'start' : 'center',
        gap: '8px',
        minHeight: '44px',
        padding: '7px 8px',
        border: '1px solid var(--border-color)',
        borderRadius: '10px',
        background: 'var(--bg-secondary)',
      }}
    >
      <span style={{ color: 'var(--accent-primary)', flexShrink: 0, paddingTop: compact ? 2 : 0 }}>{getArtifactIcon(artifact)}</span>
      <div style={{ minWidth: 0, flex: 1, display: 'grid', gap: '2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {artifact.name}
          </span>
          <span className="artifact-badge" style={{ flexShrink: 0 }}>{getArtifactTypeLabel(artifact)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, fontSize: '0.68rem', color: error ? 'var(--danger)' : 'var(--text-secondary)' }}>
          <span>{formatBytes(artifact.size)}</span>
          <span>v{artifact.version}</span>
          {artifact.bundleRole && <span>{artifact.bundleRole}</span>}
          {error && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{error}</span>}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: compact ? '6px' : '4px',
          flexShrink: 0,
          gridColumn: compact ? '1 / -1' : undefined,
          justifyContent: compact ? 'space-between' : undefined,
          minWidth: 0,
        }}
      >
        <button type="button" onClick={onCopy} style={{ ...actionButtonStyle, width: compact ? 'auto' : 28, minWidth: 28, height: 28, padding: compact ? '0 8px' : 0, justifyContent: 'center', flex: compact ? 1 : undefined }} title="Copy artifact content" aria-label={`Copy ${artifact.name}`}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {compact && <span>{copied ? 'Copied' : 'Copy'}</span>}
        </button>
        <button type="button" onClick={onDownload} style={{ ...actionButtonStyle, width: compact ? 'auto' : 28, minWidth: 28, height: 28, padding: compact ? '0 8px' : 0, justifyContent: 'center', flex: compact ? 1 : undefined }} title="Download" aria-label={`Download ${artifact.name}`}>
          <Download size={12} />
          {compact && <span>Save</span>}
        </button>
        <button type="button" onClick={onPreview} style={{ ...actionButtonStyle, width: compact ? 'auto' : 28, minWidth: 28, height: 28, padding: compact ? '0 8px' : 0, justifyContent: 'center', flex: compact ? 1 : undefined }} title="Preview" aria-label={`Preview ${artifact.name}`}>
          <Eye size={12} />
          {compact && <span>Preview</span>}
        </button>
        <button type="button" onClick={onDelete} style={{ ...actionButtonStyle, width: compact ? 'auto' : 28, minWidth: 28, height: 28, padding: compact ? '0 8px' : 0, justifyContent: 'center', color: 'var(--danger)', flex: compact ? 1 : undefined }} title="Delete" aria-label={`Delete ${artifact.name}`}>
          <Trash2 size={12} />
          {compact && <span>Delete</span>}
        </button>
      </div>
    </div>
  )
}

function ArtifactPreviewModal({
  artifact,
  onClose,
  onCopy,
  onDownload,
  onDelete,
  copied,
}: {
  artifact: CanvasArtifactRecord
  onClose: () => void
  onCopy: () => void
  onDownload: () => void
  onDelete: () => void
  copied: boolean
}) {
  const content = artifact.content || ''
  const isOfficeDoc = isWorkbookArtifact(artifact) || isWordArtifact(artifact)
  const isPhone = usePhoneViewport()

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${artifact.name}`}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1350,
        background: 'rgba(2, 6, 12, 0.76)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: isPhone ? 'stretch' : 'center',
        justifyContent: 'center',
        padding: isPhone ? '8px' : '24px',
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        style={{
          width: isPhone ? 'calc(100vw - 16px)' : 'min(960px, 96vw)',
          maxHeight: isPhone ? 'calc(100dvh - 16px)' : '88vh',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--border-color)',
          borderRadius: isPhone ? '12px' : '16px',
          background: 'var(--bg-base)',
          boxShadow: '0 30px 90px rgba(0,0,0,0.55)',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: isPhone ? '10px' : '12px 14px', borderBottom: '1px solid var(--border-color)', flexWrap: isPhone ? 'wrap' : 'nowrap' }}>
          <span style={{ color: 'var(--accent-primary)', flexShrink: 0 }}>{getArtifactIcon(artifact)}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {artifact.name}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
              {getArtifactTypeLabel(artifact)} · {formatBytes(artifact.size)} · v{artifact.version}
            </div>
          </div>
          <button type="button" onClick={onCopy} style={{ ...actionButtonStyle, color: copied ? '#10b981' : undefined, flex: isPhone ? '1 1 42%' : undefined, justifyContent: 'center' }}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" onClick={onDownload} style={{ ...actionButtonStyle, flex: isPhone ? '1 1 42%' : undefined, justifyContent: 'center' }}>
            <Download size={12} />
            Download
          </button>
          <button type="button" onClick={onDelete} style={{ ...actionButtonStyle, color: 'var(--danger)', flex: isPhone ? '1 1 42%' : undefined, justifyContent: 'center' }}>
            <Trash2 size={12} />
            Delete
          </button>
          <button type="button" onClick={onClose} style={{ ...actionButtonStyle, width: 30, height: 30, padding: 0, justifyContent: 'center' }} aria-label="Close preview">
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: isPhone ? '10px' : '14px', overflow: 'auto', flex: 1, minHeight: 0, WebkitOverflowScrolling: 'touch' }}>
          {isOfficeDoc ? (
            <div style={{ display: 'grid', gap: '12px', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '16px', background: 'var(--bg-secondary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ color: 'var(--accent-primary)' }}>{getArtifactIcon(artifact)}</span>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{getArtifactTypeLabel(artifact)} document</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    Browser-native inline preview is limited for generated Office files. Download to open the full formatted document.
                  </div>
                </div>
              </div>
              {artifact.previewSummary && (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{artifact.previewSummary}</div>
              )}
              <button type="button" onClick={onDownload} style={{ ...actionButtonStyle, width: 'fit-content' }}>
                <Download size={12} />
                Download {artifact.extension?.toUpperCase() || 'file'}
              </button>
            </div>
          ) : (
            <ArtifactPreviewContent
              artifact={artifact}
              content={content}
              expanded
              renderFullContent
              editing={false}
              editContent={content}
              onContentChange={() => undefined}
            />
          )}
        </div>
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
  onFetchRevisions,
  onRestoreRevision,
  onLoadMore,
  onSearch,
  hasMore = false,
  loading = false,
  error = null,
  searchQuery = '',
  totalCount = null,
}: CanvasPanelProps) {
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set())
  const [editingIds, setEditingIds] = React.useState<Set<string>>(new Set())
  const [fullPreviewIds, setFullPreviewIds] = React.useState<Set<string>>(new Set())
  const [collapsedBundleIds, setCollapsedBundleIds] = React.useState<Set<string>>(new Set())
  const [historyOpenIds, setHistoryOpenIds] = React.useState<Set<string>>(new Set())
  const [editContentMap, setEditContentMap] = React.useState<Record<string, string>>({})
  const [editNameMap, setEditNameMap] = React.useState<Record<string, string>>({})
  const [copiedIds, setCopiedIds] = React.useState<Set<string>>(new Set())
  const [savingIds, setSavingIds] = React.useState<Set<string>>(new Set())
  const [restoringIds, setRestoringIds] = React.useState<Set<string>>(new Set())
  const [errors, setErrors] = React.useState<Record<string, string | null>>({})
  const [fullContentMap, setFullContentMap] = React.useState<Record<string, CanvasArtifactRecord | null>>({})
  const [revisionsMap, setRevisionsMap] = React.useState<Record<string, CanvasArtifactRevisionRecord[] | null>>({})
  const [revisionLoadingIds, setRevisionLoadingIds] = React.useState<Set<string>>(new Set())
  const [revisionErrors, setRevisionErrors] = React.useState<Record<string, string | null>>({})
  const [compareMap, setCompareMap] = React.useState<Record<string, { left?: number; right?: number }>>({})
  const [searchDraft, setSearchDraft] = React.useState(searchQuery)
  const [previewArtifactId, setPreviewArtifactId] = React.useState<string | null>(null)
  const listScrollRef = React.useRef<HTMLDivElement>(null)
  const isPhone = usePhoneViewport()

  const rows = React.useMemo(() => createCanvasRows(artifacts, collapsedBundleIds), [artifacts, collapsedBundleIds])
  const previewArtifact = previewArtifactId
    ? (fullContentMap[previewArtifactId] ?? artifacts.find(artifact => artifact.id === previewArtifactId) ?? null)
    : null

  const loadFullArtifact = React.useCallback(async (artifact: CanvasArtifactRecord) => {
    if (fullContentMap[artifact.id]) return fullContentMap[artifact.id]
    try {
      setErrors(prev => ({ ...prev, [artifact.id]: null }))
      const full = await onFetchContent(artifact.id)
      if (!full) {
        setErrors(prev => ({ ...prev, [artifact.id]: 'Failed to load artifact content' }))
        return null
      }
      setFullContentMap(prev => ({ ...prev, [artifact.id]: full }))
      return full
    } catch {
      setErrors(prev => ({ ...prev, [artifact.id]: 'Failed to load artifact content' }))
      return null
    }
  }, [fullContentMap, onFetchContent])

  const toggleExpand = React.useCallback(async (artifact: CanvasArtifactRecord) => {
    const nextExpanded = new Set(expandedIds)
    if (nextExpanded.has(artifact.id)) {
      nextExpanded.delete(artifact.id)
      setExpandedIds(nextExpanded)
      return
    }

    nextExpanded.add(artifact.id)
    setExpandedIds(nextExpanded)

    await loadFullArtifact(artifact)
  }, [expandedIds, loadFullArtifact])

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
    if (content === undefined || name === undefined || !name.trim()) {
      setErrors(prev => ({ ...prev, [id]: 'Artifact name is required' }))
      return
    }

    setSavingIds(prev => new Set(prev).add(id))
    setErrors(prev => ({ ...prev, [id]: null }))
    try {
      const updated = await onUpdate(id, content, name.trim())
      setEditingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      if (updated) {
        setFullContentMap(prev => ({ ...prev, [id]: updated }))
        setRevisionsMap(prev => {
          const next = { ...prev }
          delete next[id]
          return next
        })
      } else {
        setFullContentMap(prev => {
          const existing = prev[id]
          if (!existing) return prev
          return {
            ...prev,
            [id]: { ...existing, content, name: name.trim(), version: existing.version + 1 },
          }
        })
      }
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
      const full = await loadFullArtifact(artifact)
      await navigator.clipboard.writeText(full?.content ?? artifact.content ?? '')
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
  }, [loadFullArtifact])

  const handleDownload = React.useCallback(async (artifact: CanvasArtifactRecord) => {
    const full = await loadFullArtifact(artifact)
    if (!full && !artifact.content) return
    onDownload({ ...artifact, ...(full ?? {}), content: full?.content ?? artifact.content })
  }, [loadFullArtifact, onDownload])

  const openPreview = React.useCallback(async (artifact: CanvasArtifactRecord) => {
    setPreviewArtifactId(artifact.id)
    await loadFullArtifact(artifact)
  }, [loadFullArtifact])

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
      setRevisionsMap(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      setPreviewArtifactId(current => current === id ? null : current)
    } catch {
      setErrors(prev => ({ ...prev, [id]: 'Failed to delete artifact' }))
    }
  }, [onDelete])

  const handleExport = React.useCallback(async (artifact: CanvasArtifactRecord, target: CanvasArtifactRecord['exportTargets'][number]) => {
    try {
      const full = await loadFullArtifact(artifact)
      const payload = buildArtifactExport(full ?? artifact, target, full?.content ?? artifact.content ?? '')
      downloadBlob(payload.filename, new Blob([payload.content], { type: payload.mimeType }))
    } catch {
      setErrors(prev => ({ ...prev, [artifact.id]: `Failed to export ${target}` }))
    }
  }, [loadFullArtifact])

  const loadRevisions = React.useCallback(async (artifactId: string) => {
    if (!onFetchRevisions) {
      setRevisionErrors(prev => ({ ...prev, [artifactId]: 'Revision history is unavailable in this view' }))
      return
    }
    setRevisionLoadingIds(prev => new Set(prev).add(artifactId))
    setRevisionErrors(prev => ({ ...prev, [artifactId]: null }))
    try {
      const revisions = await onFetchRevisions(artifactId)
      setRevisionsMap(prev => ({ ...prev, [artifactId]: revisions }))
      setCompareMap(prev => ({
        ...prev,
        [artifactId]: {
          left: revisions[1]?.version ?? revisions[0]?.version,
          right: revisions[0]?.version,
        },
      }))
    } catch {
      setRevisionErrors(prev => ({ ...prev, [artifactId]: 'Failed to load revision history' }))
    } finally {
      setRevisionLoadingIds(prev => {
        const next = new Set(prev)
        next.delete(artifactId)
        return next
      })
    }
  }, [onFetchRevisions])

  const toggleHistory = React.useCallback(async (artifact: CanvasArtifactRecord) => {
    const next = new Set(historyOpenIds)
    if (next.has(artifact.id)) {
      next.delete(artifact.id)
      setHistoryOpenIds(next)
      return
    }

    next.add(artifact.id)
    setHistoryOpenIds(next)
    if (!revisionsMap[artifact.id]) {
      await loadRevisions(artifact.id)
    }
  }, [historyOpenIds, loadRevisions, revisionsMap])

  const restoreRevision = React.useCallback(async (artifact: CanvasArtifactRecord, version: number) => {
    setRestoringIds(prev => new Set(prev).add(artifact.id))
    setRevisionErrors(prev => ({ ...prev, [artifact.id]: null }))
    try {
      if (!onRestoreRevision) {
        setRevisionErrors(prev => ({ ...prev, [artifact.id]: 'Revision restore is unavailable in this view' }))
        return
      }
      const restored = await onRestoreRevision(artifact.id, version)
      if (!restored) {
        setRevisionErrors(prev => ({ ...prev, [artifact.id]: 'Failed to restore revision' }))
        return
      }
      setFullContentMap(prev => ({ ...prev, [artifact.id]: restored }))
      setRevisionsMap(prev => {
        const next = { ...prev }
        delete next[artifact.id]
        return next
      })
      await loadRevisions(artifact.id)
    } catch {
      setRevisionErrors(prev => ({ ...prev, [artifact.id]: 'Failed to restore revision' }))
    } finally {
      setRestoringIds(prev => {
        const next = new Set(prev)
        next.delete(artifact.id)
        return next
      })
    }
  }, [loadRevisions, onRestoreRevision])

  const openRelatedArtifact = React.useCallback((id: string) => {
    const related = artifacts.find(artifact => artifact.id === id)
    if (!related) return
    setExpandedIds(prev => new Set(prev).add(id))
    void loadFullArtifact(related)
  }, [artifacts, loadFullArtifact])

  const toggleBundle = React.useCallback((bundleId: string) => {
    setCollapsedBundleIds(prev => {
      const next = new Set(prev)
      if (next.has(bundleId)) next.delete(bundleId)
      else next.add(bundleId)
      return next
    })
  }, [])

  const downloadBundle = React.useCallback(async (label: string, bundleArtifacts: CanvasArtifactRecord[]) => {
    const fullArtifacts = await Promise.all(bundleArtifacts.map(async artifact => await loadFullArtifact(artifact) ?? artifact))
    const bundle = {
      name: label,
      exportedAt: new Date().toISOString(),
      artifacts: fullArtifacts.map(artifact => ({
        name: artifact.name,
        mimeType: artifact.mimeType,
        kind: artifact.kind,
        version: artifact.version,
        content: artifact.content ?? '',
      })),
    }
    downloadBlob(`${label.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'canvas-bundle'}.json`, new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }))
  }, [loadFullArtifact])

  const deleteBundle = React.useCallback(async (label: string, bundleArtifacts: CanvasArtifactRecord[]) => {
    if (!window.confirm(`Delete ${bundleArtifacts.length} artifact${bundleArtifacts.length === 1 ? '' : 's'} from "${label}"?`)) return
    await Promise.all(bundleArtifacts.map(artifact => handleDelete(artifact.id)))
  }, [handleDelete])

  const submitSearch = React.useCallback((event: React.FormEvent) => {
    event.preventDefault()
    void onSearch?.(searchDraft.trim())
  }, [onSearch, searchDraft])

  if (artifacts.length === 0 && !searchQuery && !error && !loading) return null

  return (
    <div style={{ display: 'grid', gap: '10px', minWidth: 0 }}>
      <form onSubmit={submitSearch} style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: isPhone ? 'wrap' : 'nowrap' }}>
        <input
          type="search"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          placeholder="Search artifacts"
          style={{ ...inputStyle, flex: isPhone ? '1 0 100%' : 1 }}
        />
        <button type="submit" style={{ ...actionButtonStyle, flex: isPhone ? 1 : undefined, justifyContent: 'center' }} disabled={loading}>
          {loading ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={12} />}
          Search
        </button>
        {searchQuery && (
          <button
            type="button"
            style={{ ...actionButtonStyle, flex: isPhone ? 1 : undefined, justifyContent: 'center' }}
            onClick={() => {
              setSearchDraft('')
              void onSearch?.('')
            }}
          >
            Clear
          </button>
        )}
      </form>

      {error && (
        <div style={{ padding: '8px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.35)', color: 'var(--danger)', fontSize: '0.76rem', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
          <span>{error}</span>
          {onSearch && (
            <button type="button" style={{ ...actionButtonStyle, color: 'var(--danger)' }} onClick={() => void onSearch(searchQuery)}>
              Retry
            </button>
          )}
        </div>
      )}

      {artifacts.length === 0 ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', padding: '8px 0' }}>
          No Canvas artifacts match this view.
        </div>
      ) : (
        <div
          ref={listScrollRef}
          style={{
            maxHeight: 'min(52vh, 620px)',
            overflowY: 'auto',
            paddingRight: '2px',
            minHeight: 0,
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <VirtualizedList
            items={rows}
            scrollContainerRef={listScrollRef}
            getItemKey={(row) => row.type === 'bundle' ? `bundle-${row.id}` : row.artifact.id}
            estimateItemHeight={(row) => row.type === 'bundle' ? 52 : 58}
            overscanPx={600}
            renderItem={(row) => {
        if (row.type === 'bundle') {
          return (
            <div style={{ paddingBottom: '8px', paddingTop: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.76rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', flexWrap: isPhone ? 'wrap' : 'nowrap' }}>
                <button type="button" onClick={() => toggleBundle(row.id)} style={{ ...actionButtonStyle, textTransform: 'none', letterSpacing: 0 }}>
                  {row.collapsed ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
                  <Layers size={11} />
                </button>
                <span style={{ flex: '1 1 120px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
                <span style={{ opacity: 0.7 }}>{row.count} item{row.count === 1 ? '' : 's'}</span>
                <button type="button" onClick={() => void downloadBundle(row.label, row.artifacts)} style={{ ...actionButtonStyle, textTransform: 'none', letterSpacing: 0, flex: isPhone ? '1 1 120px' : undefined, justifyContent: 'center' }}>
                  <Download size={11} />
                  Bundle
                </button>
                <button type="button" onClick={() => void deleteBundle(row.label, row.artifacts)} style={{ ...actionButtonStyle, color: 'var(--danger)', textTransform: 'none', letterSpacing: 0 }}>
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          )
        }

        const artifact = fullContentMap[row.artifact.id] ?? row.artifact

        return (
          <div style={{ paddingBottom: '7px' }}>
            <CompactArtifactRow
              artifact={artifact}
              onCopy={() => handleCopy(artifact)}
              onDownload={() => void handleDownload(artifact)}
              onDelete={() => handleDelete(artifact.id)}
              onPreview={() => void openPreview(artifact)}
              copied={copiedIds.has(artifact.id)}
              error={errors[artifact.id] ?? null}
              compact={isPhone}
            />
          </div>
        )
      }}
            style={{ display: 'block' }}
          />
        </div>
      )}

      {(hasMore || loading || totalCount !== null) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
          <span>{totalCount !== null ? `${artifacts.length} of ${totalCount} loaded` : `${artifacts.length} loaded`}</span>
          {hasMore && (
            <button type="button" onClick={() => void onLoadMore?.()} disabled={loading} style={actionButtonStyle}>
              {loading ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <ChevronDown size={11} />}
              Load more
            </button>
          )}
        </div>
      )}

      {previewArtifact && (
        <ArtifactPreviewModal
          artifact={previewArtifact}
          onClose={() => setPreviewArtifactId(null)}
          onCopy={() => handleCopy(previewArtifact)}
          onDownload={() => void handleDownload(previewArtifact)}
          onDelete={() => handleDelete(previewArtifact.id)}
          copied={copiedIds.has(previewArtifact.id)}
        />
      )}
    </div>
  )
}
