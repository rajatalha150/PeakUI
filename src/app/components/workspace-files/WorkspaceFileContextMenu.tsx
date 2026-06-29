'use client'

import { useEffect } from 'react'
import { Copy, Download, ExternalLink, FileText, FolderInput, Pencil, Trash2 } from 'lucide-react'

export type WorkspaceContextMenuAction =
  | 'open'
  | 'rename'
  | 'copy-path'
  | 'download'
  | 'move'
  | 'delete'

export interface WorkspaceFileContextMenuProps {
  open: boolean
  /** Anchor for the menu — viewport coordinates (clientX/clientY from contextmenu event). */
  position: { x: number; y: number } | null
  kind: 'file' | 'directory'
  onPick: (action: WorkspaceContextMenuAction) => void
  onClose: () => void
}

interface MenuItem {
  action: WorkspaceContextMenuAction
  label: string
  icon: typeof FileText
  /** Items with destructive=true render in red. */
  destructive?: boolean
  /** Hide this item for a given row kind. */
  hideFor?: ReadonlyArray<'file' | 'directory'>
}

const ITEMS: MenuItem[] = [
  { action: 'open', label: 'Open', icon: ExternalLink, hideFor: ['directory'] },
  { action: 'rename', label: 'Rename…', icon: Pencil },
  { action: 'copy-path', label: 'Copy path', icon: Copy },
  { action: 'download', label: 'Download', icon: Download, hideFor: ['directory'] },
  { action: 'move', label: 'Move to…', icon: FolderInput },
  { action: 'delete', label: 'Delete', icon: Trash2, destructive: true },
]

/**
 * Right-click menu for tree rows. Anchors at the cursor position; renders
 * as a fixed-position panel with a click-outside backdrop, Esc dismiss, and
 * keyboard navigation (arrow keys move highlight, Enter picks, Esc closes).
 *
 * Menu items are derived from `kind` so a directory row never shows Open /
 * Download (which only make sense for files). Delete is rendered in red to
 * signal destructive intent.
 */
export default function WorkspaceFileContextMenu({
  open,
  position,
  kind,
  onPick,
  onClose,
}: WorkspaceFileContextMenuProps) {
  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !position) return null

  const visible = ITEMS.filter(item => !item.hideFor?.includes(kind))

  // Clamp to viewport so the menu doesn't get cropped at the right/bottom
  // edges. Defer the measurement to after first paint via CSS — fixed
  // positioning naturally allows overflow on smaller screens.
  const style: React.CSSProperties = {
    position: 'fixed',
    left: position.x,
    top: position.y,
    zIndex: 1400,
    minWidth: 168,
    background: 'var(--bg-base)',
    border: '1px solid var(--border-color)',
    borderRadius: 8,
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.4)',
    padding: 4,
    fontSize: '0.78rem',
    color: 'var(--text-primary)',
  }

  return (
    <>
      {/* Transparent backdrop that catches outside clicks. It is its own
          element (not on the menu itself) so clicks on the menu don't
          immediately close it. */}
      <div
        role="presentation"
        onClick={onClose}
        onContextMenu={event => {
          event.preventDefault()
          onClose()
        }}
        style={{ position: 'fixed', inset: 0, zIndex: 1399 }}
      />
      <div role="menu" style={style}>
        {visible.map(item => {
          const Icon = item.icon
          return (
            <div
              key={item.action}
              role="menuitem"
              tabIndex={0}
              onClick={() => {
                onPick(item.action)
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onPick(item.action)
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                borderRadius: 5,
                cursor: 'pointer',
                color: item.destructive ? 'var(--danger, #f87171)' : 'var(--text-primary)',
                userSelect: 'none',
              }}
              onMouseEnter={event => {
                event.currentTarget.style.background = item.destructive
                  ? 'rgba(239, 68, 68, 0.16)'
                  : 'var(--accent-soft, rgba(99,102,241,0.18))'
              }}
              onMouseLeave={event => {
                event.currentTarget.style.background = 'transparent'
              }}
            >
              <Icon size={12} />
              <span>{item.label}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}