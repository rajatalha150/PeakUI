'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2, RotateCcw, Save, X } from 'lucide-react'
import {
  readWorkspaceFile,
  writeWorkspaceFile,
  type WorkspaceFilesError,
} from '@/lib/workspace-files-client'
import { classifyFile, isEditableFile } from './file-display'
import type { WorkspaceFileContent } from '@/lib/workspace-files-types'

export interface WorkspaceFileEditorProps {
  workspaceId: string
  /** Absolute path relative to the workspace root. */
  path: string
  /** The file content currently rendered in the preview, used as the seed. */
  initialContent: WorkspaceFileContent | null
  /** Notified when the user clicks "Reload from server" — parent should re-fetch preview content. */
  onSaved?: (newContent: { etag: string; modifiedAt: string; size: number }) => void
  onClose?: () => void
}

/**
 * In-place text editor for editable Workspace Files. Wires up:
 *
 *   - Load the latest content (if not already loaded)
 *   - Track dirty state (orange dot in the editor's own toolbar — the parent
 *     tree does not currently reflect per-row dirty state; that ships with
 *     Phase 6's right-click / F2 rename UX)
 *   - Save with `Cmd/Ctrl+S` (and a toolbar Save button)
 *   - ETag conflict detection: server returns 412 if the file changed since we
 *     loaded it; the editor then offers three actions — Reload (discard local
 *     edits and re-fetch), Overwrite (force-save by retrying without If-Match),
 *     Save as copy (write the new content to `<name>.edited` instead)
 *   - Reset (discard local edits back to last-loaded content)
 *   - Discard / close
 */
export default function WorkspaceFileEditor({
  workspaceId,
  path,
  initialContent,
  onSaved,
  onClose,
}: WorkspaceFileEditorProps) {
  const kind = useMemo(() => {
    if (!initialContent) return classifyFile({ path })
    return classifyFile({ path: initialContent.path, content: initialContent })
  }, [path, initialContent])

  const editable = kind ? isEditableFile(kind) : true

  const [content, setContent] = useState<string>(initialContent?.content ?? '')
  const [baseContent, setBaseContent] = useState<string>(initialContent?.content ?? '')
  const [etag, setEtag] = useState<string | undefined>(initialContent?.etag)
  const [modifiedAt, setModifiedAt] = useState<string | undefined>(initialContent?.modifiedAt)
  const [size, setSize] = useState<number | undefined>(initialContent?.size)
  const [loading, setLoading] = useState<boolean>(!initialContent)
  const [saving, setSaving] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ currentEtag?: string } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const lineNumbersRef = useRef<HTMLDivElement | null>(null)
  const lastLoadedPathRef = useRef<string | null>(initialContent?.path ?? null)

  // Load the latest content from the server. We do this once on mount and
  // re-run only when the path changes — the parent passes a `key` to remount
  // us when the file changes, but we also handle in-place path changes for
  // robustness. Skipping the re-seed when `lastLoadedPathRef` already matches
  // the current path keeps the lint rule happy (we only setState when the
  // path actually changes).
  useEffect(() => {
    if (lastLoadedPathRef.current === path) return
    lastLoadedPathRef.current = path
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const fresh = await readWorkspaceFile(workspaceId, path)
        if (cancelled) return
        setContent(fresh.content)
        setBaseContent(fresh.content)
        setEtag(fresh.etag)
        setModifiedAt(fresh.modifiedAt)
        setSize(fresh.size)
      } catch (err) {
        if (cancelled) return
        const e = err as WorkspaceFilesError
        setError(e.message || `Failed to read ${path}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [workspaceId, path])

  const dirty = content !== baseContent

  const lineCount = useMemo(() => Math.max(1, content.split('\n').length), [content])

  // Scroll the gutter in lockstep with the textarea. We do this in a
  // callback ref because textarea's scroll handler fires on user scroll
  // and we need to mirror it without re-rendering.
  const handleTextareaScroll = useCallback(() => {
    if (lineNumbersRef.current && textareaRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }, [])

  const performSave = useCallback(
    async (options: { ifMatch?: string; renameTo?: string } = {}) => {
      setSaving(true)
      setError(null)
      setConflict(null)
      try {
        const target = options.renameTo ?? path
        const response = await writeWorkspaceFile(
          workspaceId,
          { action: 'write', path: target, content },
          options.ifMatch
        )
        if (response.etag) setEtag(response.etag)
        if (response.entry.modifiedAt) setModifiedAt(response.entry.modifiedAt)
        if (response.entry.size !== undefined) setSize(response.entry.size)
        if (options.renameTo) {
          // We've saved as a new file — switch the editor over to it.
          setBaseContent(content)
          onSaved?.({ etag: response.etag ?? '', modifiedAt: response.entry.modifiedAt ?? '', size: response.entry.size ?? 0 })
        } else {
          setBaseContent(content)
          onSaved?.({ etag: response.etag ?? '', modifiedAt: response.entry.modifiedAt ?? '', size: response.entry.size ?? 0 })
        }
      } catch (err) {
        const e = err as WorkspaceFilesError
        if (e.status === 412) {
          setConflict({ currentEtag: e.currentEtag })
        } else {
          setError(e.message || 'Failed to save file')
        }
      } finally {
        setSaving(false)
      }
    },
    [workspaceId, path, content, onSaved]
  )

  const handleSave = useCallback(() => {
    if (!dirty || saving) return
    void performSave(etag ? { ifMatch: etag } : {})
  }, [dirty, saving, performSave, etag])

  const handleReset = useCallback(() => {
    setContent(baseContent)
    setError(null)
    setConflict(null)
    // Move caret to start after reset.
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.selectionStart = 0
        el.selectionEnd = 0
        el.focus()
      }
    })
  }, [baseContent])

  const handleReload = useCallback(async () => {
    setConflict(null)
    setLoading(true)
    setError(null)
    try {
      const fresh = await readWorkspaceFile(workspaceId, path)
      setContent(fresh.content)
      setBaseContent(fresh.content)
      setEtag(fresh.etag)
      setModifiedAt(fresh.modifiedAt)
      setSize(fresh.size)
    } catch (err) {
      const e = err as WorkspaceFilesError
      setError(e.message || 'Failed to reload file')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, path])

  const handleOverwrite = useCallback(() => {
    setConflict(null)
    // Force-save by omitting If-Match; the server doesn't check then, but we
    // still update our own etag once the response lands.
    void performSave()
  }, [performSave])

  const handleSaveAsCopy = useCallback(() => {
    if (!path) return
    const dot = path.lastIndexOf('.')
    const slash = path.lastIndexOf('/')
    const insertAt = dot > slash ? dot : path.length
    const newPath = `${path.slice(0, insertAt)}.edited${path.slice(insertAt)}`
    setConflict(null)
    void performSave({ renameTo: newPath })
  }, [performSave, path])

  // Cmd/Ctrl+S to save.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (dirty) handleSave()
      } else if (event.key === 'Escape') {
        // Let the modal handle Escape for closing; only swallow it if the
        // editor has focus AND there are unsaved changes.
        if (dirty) {
          event.preventDefault()
          handleReset()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, handleSave, handleReset])

  if (!editable) {
    return (
      <div style={{ padding: 16, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
        This file type is not editable in the browser.
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        background: 'var(--bg-secondary)',
        borderTop: '1px solid var(--border-color)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: '0.74rem',
          color: 'var(--text-secondary)',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontWeight: 600 }}>Edit mode</span>
        {dirty && (
          <span
            title="Unsaved changes"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--accent-color, #f59e0b)',
              display: 'inline-block',
            }}
          />
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={handleReset}
            disabled={!dirty || saving || loading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              borderRadius: 5,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: '0.74rem',
              cursor: !dirty || saving || loading ? 'not-allowed' : 'pointer',
              opacity: !dirty || saving || loading ? 0.5 : 1,
            }}
          >
            <RotateCcw size={11} /> Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving || loading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              borderRadius: 5,
              border: '1px solid var(--accent-color, #6366f1)',
              background: 'var(--accent-color, #6366f1)',
              color: 'white',
              fontSize: '0.74rem',
              cursor: !dirty || saving || loading ? 'not-allowed' : 'pointer',
              opacity: !dirty || saving || loading ? 0.5 : 1,
            }}
          >
            {saving ? <Loader2 size={11} className="spin" /> : <Save size={11} />}
            {saving ? 'Saving…' : 'Save'}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 10px',
                borderRadius: 5,
                border: '1px solid var(--border-color)',
                background: 'var(--bg-primary)',
                color: 'var(--text-secondary)',
                fontSize: '0.74rem',
                cursor: 'pointer',
              }}
            >
              <X size={11} /> Close
            </button>
          )}
        </span>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            borderRadius: 6,
            background: 'rgba(239, 68, 68, 0.12)',
            color: 'var(--text-primary)',
            fontSize: '0.74rem',
            border: '1px solid rgba(239, 68, 68, 0.3)',
          }}
        >
          <AlertTriangle size={12} /> {error}
        </div>
      )}

      {conflict && (
        <div
          role="alert"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '8px 10px',
            borderRadius: 6,
            background: 'rgba(245, 158, 11, 0.12)',
            color: 'var(--text-primary)',
            fontSize: '0.74rem',
            border: '1px solid rgba(245, 158, 11, 0.35)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={12} color="#f59e0b" />
            <strong>File changed on server.</strong>
          </div>
          <span>Your edits are still in the buffer. Pick an action below to continue.</span>
          <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleReload}
              style={{
                padding: '4px 10px',
                borderRadius: 5,
                border: '1px solid var(--border-color)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontSize: '0.74rem',
                cursor: 'pointer',
              }}
            >
              Reload (discard edits)
            </button>
            <button
              type="button"
              onClick={handleOverwrite}
              style={{
                padding: '4px 10px',
                borderRadius: 5,
                border: '1px solid rgba(239, 68, 68, 0.5)',
                background: 'rgba(239, 68, 68, 0.12)',
                color: 'var(--text-primary)',
                fontSize: '0.74rem',
                cursor: 'pointer',
              }}
            >
              Overwrite (force save)
            </button>
            <button
              type="button"
              onClick={handleSaveAsCopy}
              style={{
                padding: '4px 10px',
                borderRadius: 5,
                border: '1px solid var(--border-color)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontSize: '0.74rem',
                cursor: 'pointer',
              }}
            >
              Save as copy
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          border: '1px solid var(--border-color)',
          borderRadius: 6,
          overflow: 'hidden',
          background: 'var(--bg-primary)',
        }}
      >
        <div
          ref={lineNumbersRef}
          aria-hidden="true"
          style={{
            padding: '8px 8px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '0.78rem',
            lineHeight: '1.45',
            color: 'var(--text-secondary)',
            background: 'var(--bg-secondary)',
            borderRight: '1px solid var(--border-color)',
            textAlign: 'right',
            userSelect: 'none',
            minWidth: 40,
            maxHeight: '40vh',
            overflow: 'hidden',
            whiteSpace: 'pre',
          }}
        >
          {Array.from({ length: lineCount }, (_, i) => `${i + 1}\n`).join('')}
        </div>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={event => {
            setContent(event.target.value)
          }}
          onScroll={handleTextareaScroll}
          spellCheck={false}
          aria-label={`Edit ${path}`}
          disabled={loading || saving}
          style={{
            flex: 1,
            minHeight: 0,
            maxHeight: '40vh',
            padding: '8px 10px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '0.78rem',
            lineHeight: '1.45',
            color: 'var(--text-primary)',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            resize: 'vertical',
            whiteSpace: 'pre',
            overflow: 'auto',
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          gap: 12,
          fontSize: '0.7rem',
          color: 'var(--text-secondary)',
        }}
      >
        <span>Lines: {lineCount}</span>
        {size !== undefined && <span>Size: {size} B</span>}
        {modifiedAt && <span>Modified: {new Date(modifiedAt).toLocaleString()}</span>}
        {etag && <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>ETag: {etag.replace(/"/g, '')}</span>}
        <span style={{ marginLeft: 'auto' }}>
          {loading ? 'Loading…' : saving ? 'Saving…' : dirty ? 'Unsaved changes (⌘S to save)' : 'Saved'}
        </span>
      </div>
    </div>
  )
}