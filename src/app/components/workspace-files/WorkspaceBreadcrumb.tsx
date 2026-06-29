'use client'

import { ArrowLeft, ChevronRight, Home } from 'lucide-react'

export interface WorkspaceBreadcrumbProps {
  /** The current path relative to workspace root. Empty string = root. */
  path: string
  /** Called when the user clicks a segment. Empty string = root. */
  onNavigate: (path: string) => void
}

/**
 * Renders a back-nav + path strip. Click the back button (or any segment) to
 * jump to that directory. Click "root" to go back to the workspace root.
 *
 * Used both as in-place navigation inside the tree (Phase 2 cwd-style) and
 * as the breadcrumb at the top of the preview pane.
 */
export default function WorkspaceBreadcrumb({ path, onNavigate }: WorkspaceBreadcrumbProps) {
  const segments = path ? path.split('/').filter(Boolean) : []
  const canGoBack = segments.length > 0
  const parentPath = segments.length > 1 ? segments.slice(0, -1).join('/') : ''

  return (
    <nav
      aria-label="Workspace path"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        fontSize: '0.74rem',
        color: 'var(--text-secondary)',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-secondary)',
      }}
    >
      <button
        type="button"
        onClick={() => onNavigate(parentPath)}
        disabled={!canGoBack}
        title="Back"
        aria-label="Go back"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 22,
          height: 22,
          borderRadius: 4,
          border: '1px solid var(--border-color)',
          background: canGoBack ? 'var(--bg-primary)' : 'transparent',
          color: canGoBack ? 'var(--text-primary)' : 'var(--text-secondary)',
          cursor: canGoBack ? 'pointer' : 'not-allowed',
          padding: 0,
          opacity: canGoBack ? 1 : 0.5,
          flexShrink: 0,
        }}
      >
        <ArrowLeft size={12} />
      </button>
      <button
        type="button"
        onClick={() => onNavigate('')}
        title="Workspace root"
        aria-label="Workspace root"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          padding: '2px 6px',
          borderRadius: 4,
          border: 'none',
          background: segments.length === 0 ? 'var(--accent-soft, rgba(99,102,241,0.18))' : 'transparent',
          color: 'var(--text-primary)',
          cursor: 'pointer',
          fontSize: '0.74rem',
          flexShrink: 0,
        }}
      >
        <Home size={11} /> root
      </button>
      {segments.map((segment, index) => {
        const cumulativePath = segments.slice(0, index + 1).join('/')
        const isLast = index === segments.length - 1
        return (
          <span key={cumulativePath} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <ChevronRight size={11} color="var(--text-secondary)" />
            <button
              type="button"
              onClick={() => onNavigate(cumulativePath)}
              title={cumulativePath}
              style={{
                padding: '2px 6px',
                borderRadius: 4,
                border: 'none',
                background: isLast ? 'var(--accent-soft, rgba(99,102,241,0.18))' : 'transparent',
                color: isLast ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '0.74rem',
                fontWeight: isLast ? 600 : 400,
              }}
            >
              {segment}
            </button>
          </span>
        )
      })}
    </nav>
  )
}
