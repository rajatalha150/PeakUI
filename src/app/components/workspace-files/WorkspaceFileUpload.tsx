'use client'

import { useCallback, useRef, useState } from 'react'
import { Upload, Loader2 } from 'lucide-react'

export interface WorkspaceFileUploadProps {
  /** Where uploaded files land. Relative to workspace root. */
  cwd: string
  /** Disabled while the panel is loading or no workspace is selected. */
  disabled?: boolean
  /** Called when the user drops or picks one or more files. Return the relative target paths. */
  onUpload: (files: { file: File; targetPath: string }[]) => void
}

/**
 * Native drag-and-drop + click-to-pick upload zone. The component is a
 * passive surface — it doesn't perform the upload itself; the parent owns
 * the network call (via `uploadWorkspaceFiles`). Keeping the surface dumb
 * means the parent can show its own progress UI and error toasts.
 *
 * Drag/drop is implemented with native HTML5 events rather than a library
 * to keep the bundle small — we don't need a full-featured dropzone, just
 * dragover styling and File[] extraction.
 */
export default function WorkspaceFileUpload({
  cwd,
  disabled,
  onUpload,
}: WorkspaceFileUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)

  const buildTargetPath = useCallback(
    (file: File): string => {
      // If the dropped file has a relative path (webkitGetAsEntry), honor it
      // — that lets drag-from-Finder/Explorer preserve folder structure. If
      // not, place it at the cwd root with the file's plain name.
      // For Phase 4 we only honor plain `name`; folder upload is a Phase 6+
      // nicety that requires the DataTransferItem API.
      const baseName = file.name.replace(/[\\/]/g, '_')
      if (!cwd) return baseName
      return `${cwd.replace(/\/$/, '')}/${baseName}`
    },
    [cwd]
  )

  const handleFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList)
      if (files.length === 0) return
      const targets = files.map(file => ({ file, targetPath: buildTargetPath(file) }))
      onUpload(targets)
    },
    [buildTargetPath, onUpload]
  )

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.target.files) {
        handleFiles(event.target.files)
        // Reset so picking the same file twice fires `change` again.
        event.target.value = ''
      }
    },
    [handleFiles]
  )

  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (disabled) return
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer.types.includes('Files')) {
      event.dataTransfer.dropEffect = 'copy'
      setDragging(true)
    }
  }, [disabled])

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    // Only clear the dragging flag when we leave the surface itself, not
    // when crossing into a child element.
    if (event.currentTarget === event.target) {
      setDragging(false)
    }
  }, [])

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      if (disabled) return
      event.preventDefault()
      event.stopPropagation()
      setDragging(false)
      const files = event.dataTransfer?.files
      if (files && files.length > 0) handleFiles(files)
    },
    [disabled, handleFiles]
  )

  return (
    <label
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      title={disabled ? 'Select a workspace to upload files' : `Drop files here or click to upload into ${cwd || '/'}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderRadius: 5,
        border: dragging
          ? '1px dashed var(--accent-color, #6366f1)'
          : '1px solid var(--border-color)',
        background: dragging ? 'var(--accent-soft, rgba(99,102,241,0.18))' : 'var(--bg-secondary)',
        color: disabled ? 'var(--text-secondary)' : 'var(--text-primary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: '0.72rem',
        opacity: disabled ? 0.6 : 1,
        userSelect: 'none',
      }}
    >
      {disabled ? <Loader2 size={11} /> : <Upload size={11} />}
      Upload
      <input
        ref={inputRef}
        type="file"
        multiple
        onChange={handleInputChange}
        disabled={disabled}
        aria-label="Upload files"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
    </label>
  )
}