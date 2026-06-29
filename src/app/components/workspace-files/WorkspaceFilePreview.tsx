'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, Edit3, FileText, Maximize2, X } from 'lucide-react'
import LazyMarkdownRenderer from '../LazyMarkdownRenderer'
import LazySyntaxHighlighter from '../LazySyntaxHighlighter'
import { downloadWorkspaceFile } from '@/lib/workspace-files-client'
import type { WorkspaceFileContent } from '@/lib/workspace-files-types'
import { classifyFile, fileBaseName, humanFileSize, isEditableFile } from './file-display'
import WorkspaceFileEditor from './WorkspaceFileEditor'

/**
 * Presentational component. Renders the file content with the right
 * renderer for the file kind. Designed to be embedded inside either the
 * side-panel preview pane or the full-size modal.
 *
 * The parent owns the data fetch + open/close state.
 */
export interface WorkspaceFilePreviewProps {
  content: WorkspaceFileContent | null
  loading: boolean
  error: string | null
  /** Used by the download button. */
  workspaceId: string
  /** Optional dense flag — when true the header + footer are tighter (panel). */
  dense?: boolean
  /** Footer slot (used by Phase 3 to inject the editor toggle). */
  footerSlot?: React.ReactNode
  /** Called after the editor successfully saves the file. */
  onEditorSaved?: () => void
}

function PreviewHeader({ path, size, modifiedAt, encoding }: {
  path: string
  size: number
  modifiedAt: string
  encoding: WorkspaceFileContent['encoding']
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-color)',
        fontSize: '0.78rem',
        color: 'var(--text-secondary)',
        background: 'var(--bg-secondary)',
      }}
    >
      <FileText size={14} />
      <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{fileBaseName(path)}</strong>
      <span style={{ marginLeft: 'auto' }}>{humanFileSize(size)}</span>
      <span>·</span>
      <span>{new Date(modifiedAt).toLocaleString()}</span>
      {encoding === 'base64' && <span style={{ fontSize: '0.68rem' }}>binary</span>}
    </div>
  )
}

function PreviewActions({
  workspaceId,
  path,
  editable,
  editing,
  onToggleEdit,
}: {
  workspaceId: string
  path: string
  editable: boolean
  editing: boolean
  onToggleEdit: () => void
}) {
  const handleDownload = async () => {
    try {
      const res = await downloadWorkspaceFile(workspaceId, path)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileBaseName(path)
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('[WorkspaceFilePreview] download failed', error)
    }
  }

  return (
    <div style={{ display: 'flex', gap: 6, padding: '8px 12px', justifyContent: 'flex-end', borderBottom: '1px solid var(--border-color)' }}>
      {editable && (
        <button
          type="button"
          onClick={onToggleEdit}
          title={editing ? 'Stop editing' : 'Edit'}
          aria-pressed={editing}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            borderRadius: 5,
            border: editing ? '1px solid var(--accent-color, #6366f1)' : '1px solid var(--border-color)',
            background: editing ? 'var(--accent-soft, rgba(99,102,241,0.18))' : 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontSize: '0.76rem',
            cursor: 'pointer',
          }}
        >
          <Edit3 size={12} /> {editing ? 'Preview' : 'Edit'}
        </button>
      )}
      <button
        type="button"
        onClick={handleDownload}
        title="Download"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 10px',
          borderRadius: 5,
          border: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          fontSize: '0.76rem',
          cursor: 'pointer',
        }}
      >
        <Download size={12} /> Download
      </button>
    </div>
  )
}

function LoadingPreview({ path }: { path: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        color: 'var(--text-secondary)',
        fontSize: '0.84rem',
        padding: 24,
      }}
    >
      Loading {fileBaseName(path)}…
    </div>
  )
}

function ErrorPreview({ message }: { message: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        color: 'var(--text-primary)',
        fontSize: '0.86rem',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div style={{ fontWeight: 600 }}>Could not preview file</div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', maxWidth: 480 }}>{message}</div>
    </div>
  )
}

function BinaryPreview({ content }: { content: WorkspaceFileContent }) {
  return (
    <div style={{ padding: 24, fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
      This file is binary ({humanFileSize(content.size)}) and cannot be previewed inline. Use the Download button
      above to save it to your computer.
    </div>
  )
}

function ImagePreview({ content }: { content: WorkspaceFileContent }) {
  const [zoom, setZoom] = useState(false)

  if (content.encoding !== 'base64') {
    return <div style={{ padding: 12 }}>Image content is not base64-encoded.</div>
  }
  const dataUrl = `data:${content.mimeType ?? 'application/octet-stream'};base64,${content.content}`

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'auto',
        background: zoom ? 'var(--bg-secondary)' : 'transparent',
        padding: 12,
      }}
    >
      <div style={{ position: 'relative', maxWidth: '100%' }}>
        <button
          type="button"
          onClick={() => setZoom(z => !z)}
          title={zoom ? 'Fit' : 'Zoom'}
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            padding: 6,
            borderRadius: 6,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-primary)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            zIndex: 1,
          }}
        >
          <Maximize2 size={14} />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element -- base64 data URLs bypass next/image optimization */}
        <img
          src={dataUrl}
          alt={fileBaseName(content.path)}
          style={{
            display: 'block',
            maxWidth: zoom ? 'none' : '100%',
            maxHeight: zoom ? 'none' : '78vh',
            width: 'auto',
            height: 'auto',
            objectFit: 'contain',
          }}
        />
      </div>
    </div>
  )
}

function PdfPreview({ content }: { content: WorkspaceFileContent }) {
  if (content.encoding !== 'base64') {
    return <div style={{ padding: 12 }}>PDF content is not base64-encoded.</div>
  }
  const dataUrl = `data:${content.mimeType ?? 'application/pdf'};base64,${content.content}`
  return (
    <iframe
      title={fileBaseName(content.path)}
      src={dataUrl}
      style={{ flex: 1, minHeight: 0, width: '100%', border: 'none', background: 'white' }}
    />
  )
}

function JsonPreview({ content }: { content: WorkspaceFileContent }) {
  let pretty: string
  let parseError: string | null = null
  try {
    pretty = JSON.stringify(JSON.parse(content.content), null, 2)
  } catch (error) {
    pretty = content.content
    parseError = error instanceof Error ? error.message : 'Invalid JSON'
  }
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {parseError && (
        <div style={{ padding: '6px 10px', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
          Showing raw content ({parseError})
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <LazySyntaxHighlighter code={pretty} language="json" />
      </div>
    </div>
  )
}

function detectLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'ts':
    case 'tsx': return 'typescript'
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs': return 'javascript'
    case 'py': return 'python'
    case 'rb': return 'ruby'
    case 'go': return 'go'
    case 'rs': return 'rust'
    case 'java': return 'java'
    case 'kt': return 'kotlin'
    case 'swift': return 'swift'
    case 'c':
    case 'h': return 'c'
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp': return 'cpp'
    case 'php': return 'php'
    case 'sh':
    case 'bash':
    case 'zsh': return 'bash'
    case 'sql': return 'sql'
    case 'yaml':
    case 'yml': return 'yaml'
    case 'json': return 'json'
    case 'xml':
    case 'html':
    case 'htm':
    case 'vue':
    case 'svelte':
    case 'jsx': return 'jsx'
    case 'css':
    case 'scss':
    case 'sass':
    case 'less': return 'css'
    case 'md':
    case 'markdown': return 'markdown'
    case 'dockerfile': return 'dockerfile'
    case 'lua': return 'lua'
    default: return 'text'
  }
}

function FileBody({ content }: { content: WorkspaceFileContent }) {
  const kind = classifyFile({ path: content.path, content })

  if (kind === 'image') return <ImagePreview content={content} />
  if (kind === 'pdf') return <PdfPreview content={content} />
  if (kind === 'markdown') {
    return (
      <div style={{ padding: 16 }}>
        <LazyMarkdownRenderer content={content.content} />
      </div>
    )
  }
  if (kind === 'json') return <JsonPreview content={content} />
  if (kind === 'code') {
    return <LazySyntaxHighlighter code={content.content} language={detectLanguageFromPath(content.path)} />
  }
  if (kind === 'csv') {
    return (
      <pre
        style={{
          margin: 0,
          padding: 16,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '0.8rem',
          whiteSpace: 'pre',
          overflow: 'auto',
        }}
      >
        {content.content}
      </pre>
    )
  }
  if (kind === 'text') {
    return (
      <pre
        style={{
          margin: 0,
          padding: 16,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '0.8rem',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {content.content}
      </pre>
    )
  }
  return <BinaryPreview content={content} />
}

export default function WorkspaceFilePreview({
  content,
  loading,
  error,
  workspaceId,
  footerSlot,
  onEditorSaved,
}: WorkspaceFilePreviewProps) {
  const [editing, setEditing] = useState(false)

  // Editing state. When the file changes (new path or new ETag), exit edit
  // mode automatically — the editor buffer would otherwise be stale. We
  // gate the reset on a ref so this effect doesn't fire on every parent
  // render; it only fires when the watched path/etag actually changes.
  /* eslint-disable react-hooks/set-state-in-effect -- resetting local UI state when the displayed file changes is a canonical React pattern */
  useEffect(() => {
    setEditing(false)
  }, [content?.path, content?.etag])
  /* eslint-enable react-hooks/set-state-in-effect */

  if (loading) return <LoadingPreview path={content?.path ?? ''} />
  if (error) return <ErrorPreview message={error} />
  if (!content) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
          fontSize: '0.82rem',
          padding: 24,
          textAlign: 'center',
        }}
      >
        Loading…
      </div>
    )
  }

  const kind = classifyFile({ path: content.path, content })
  const editable = kind ? isEditableFile(kind) && content.encoding === 'utf-8' : false

  if (editing && editable && workspaceId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <PreviewHeader
          path={content.path}
          size={content.size}
          modifiedAt={content.modifiedAt}
          encoding={content.encoding}
        />
        <PreviewActions
          workspaceId={workspaceId}
          path={content.path}
          editable
          editing={editing}
          onToggleEdit={() => setEditing(false)}
        />
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <WorkspaceFileEditor
            // Remount on path or etag change so the editor's internal state
            // (buffer, dirty flag, ETag) is fresh and we never have to sync
            // props into state in the editor's own effects.
            key={`${content.path}:${content.etag ?? ''}`}
            workspaceId={workspaceId}
            path={content.path}
            initialContent={content}
            onSaved={onEditorSaved}
            onClose={() => setEditing(false)}
          />
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <PreviewHeader
        path={content.path}
        size={content.size}
        modifiedAt={content.modifiedAt}
        encoding={content.encoding}
      />
      <PreviewActions
        workspaceId={workspaceId}
        path={content.path}
        editable={editable}
        editing={editing}
        onToggleEdit={() => setEditing(true)}
      />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <FileBody content={content} />
      </div>
      {kind && isEditableFile(kind) && content.encoding === 'utf-8' && !footerSlot && (
        <div style={{ padding: '6px 10px', fontSize: '0.72rem', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)' }}>
          Click <strong>Edit</strong> above to modify this file in the browser.
        </div>
      )}
      {footerSlot}
    </div>
  )
}

/**
 * Full-size modal wrapper. Mirrors the CanvasPanel ArtifactPreviewModal
 * pattern: dimmed backdrop, click-outside to dismiss, Escape to close.
 */
export function WorkspaceFilePreviewModal({
  workspaceId,
  path,
  content,
  loading,
  error,
  onClose,
  onRequestContent,
  onSaved,
  footerSlot,
}: WorkspaceFilePreviewProps & {
  path: string | null
  onClose: () => void
  onRequestContent: (path: string) => void
  onSaved?: () => void
}) {
  // Trigger content fetch when path changes.
  useEffect(() => {
    if (path && (!content || content.path !== path)) {
      onRequestContent(path)
    }
  }, [path, content, onRequestContent])

  // Escape closes the modal.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Listen for editor saves — refresh the cached content so the modal's
  // "Preview" mode (after toggling Edit off) shows the new version.
  const handleEditorSaved = useCallback(() => {
    if (path) onRequestContent(path)
    onSaved?.()
  }, [path, onRequestContent, onSaved])

  if (!path) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${path}`}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1350,
        background: 'rgba(2, 6, 12, 0.76)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        style={{
          width: 'min(1100px, 96vw)',
          height: '88vh',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--border-color)',
          borderRadius: 16,
          background: 'var(--bg-base)',
          boxShadow: '0 30px 90px rgba(0,0,0,0.55)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
          }}
        >
          <FileText size={14} color="var(--accent-color, #6366f1)" />
          <strong style={{ flex: 1, fontSize: '0.84rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {path}
          </strong>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            title="Close (Esc)"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-primary)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={14} />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <WorkspaceFilePreview
            workspaceId={workspaceId}
            content={content}
            loading={loading}
            error={error}
            footerSlot={footerSlot}
            onEditorSaved={handleEditorSaved}
          />
        </div>
      </div>
    </div>
  )
}