"use client";

import React, { useEffect, useState } from 'react';
import { Folder, FolderOpen, X } from 'lucide-react';
import Popover from './Popover';
import type { FlattenedFolder, KbFolderNode } from '@/lib/kb-folders';

interface KnowledgeBaseTreePopoverProps {
  open: boolean;
  onClose: () => void;
  selectedPath: string | null;
  onSelect: (path: string | null) => void;
  onRefresh?: () => void | Promise<void>;
  /**
   * Anchor element (e.g. the button that opened the popover). The popover
   * is portaled to <body> and uses this ref to compute its fixed position
   * (drop-down below the anchor, flip above if it would overflow the
   * bottom of the viewport) and to ignore clicks on the anchor itself
   * when the click-outside handler fires.
   */
  anchorRef?: React.RefObject<HTMLElement | null>;
  /** Width override (defaults to 320px). */
  width?: number;
  /** Max-height override (defaults to 420px). */
  maxHeight?: number;
  /** External root ref so a parent popover can ignore clicks inside this child. */
  popoverRef?: React.RefObject<HTMLDivElement | null>;
  /**
   * Z-index override. Defaults to 1000. Raise this when the popover is
   * rendered inside another portaled popover (e.g. the Workspace modes
   * menu in the WorkSpaces composer sits at 1400, so the folder popover
   * needs to be above that to stay visible).
   */
  zIndex?: number;
}

export default function KnowledgeBaseTreePopover({
  open,
  onClose,
  selectedPath,
  onSelect,
  onRefresh,
  anchorRef,
  width = 320,
  maxHeight = 420,
  zIndex = 1000,
  popoverRef,
}: KnowledgeBaseTreePopoverProps) {
  const [tree, setTree] = useState<KbFolderNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState<number>(-1);

  // Fetch the tree when the popover opens (or on demand).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/rag/folders')
      .then(res => res.json().then(j => ({ ok: res.ok, j })))
      .then(({ ok, j }) => {
        if (cancelled) return;
        if (!ok) {
          setError(typeof j?.error === 'string' ? j.error : 'Could not load folder tree.');
          setLoading(false);
          return;
        }
        setTree(j.tree as KbFolderNode);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not load folder tree.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, onRefresh]);

  // Reset keyboard focus index whenever the tree (and thus the row count) changes.
  useEffect(() => {
    setFocusIndex(-1);
  }, [tree]);

  const flatRows: FlattenedFolder[] = tree ? flattenForPopover(tree) : [];

  // Arrow-key navigation between folder rows. The Popover primitive owns
  // Esc-to-close; this adds Up/Down/Enter within the row list.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setFocusIndex(prev => Math.min(prev + 1, flatRows.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setFocusIndex(prev => Math.max(prev - 1, 0));
      } else if (event.key === 'Enter' && focusIndex >= 0 && flatRows[focusIndex]) {
        event.preventDefault();
        onSelect(flatRows[focusIndex]!.path);
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, focusIndex, flatRows, onSelect, onClose]);
  const hasFolders = flatRows.length > 0;
  const totalFiles = tree?.recursiveFileCount ?? 0;

  if (!anchorRef) return null;

  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      rootRef={popoverRef}
      width={width}
      maxHeight={maxHeight}
      zIndex={zIndex}
      side="bottom"
      align="end"
      ariaLabel="Choose a folder"
      role="dialog"
      style={{
        background: 'color-mix(in srgb, var(--bg-base) 98%, black 2%)',
        backdropFilter: 'none',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        boxShadow: '0 24px 60px rgba(0,0,0,0.58)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        color: 'var(--text-primary)',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', borderBottom: '1px solid var(--border-color)',
      }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Scope RAG to a folder
        </div>
        <button
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px' }}
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, padding: '6px' }}>
        {loading && (
          <div style={{ padding: '12px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            Loading folders…
          </div>
        )}
        {error && (
          <div style={{ padding: '12px', fontSize: '0.78rem', color: '#fca5a5' }}>
            {error}
          </div>
        )}
        {!loading && !error && !hasFolders && (
          <div style={{ padding: '12px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            No folders in your Knowledge Base yet. Upload some files to create one.
          </div>
        )}
        {!loading && !error && (
          <button
            onClick={() => { onSelect(null); onClose(); }}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
              background: selectedPath === null ? 'var(--accent-soft)' : 'transparent',
              border: 'none', borderRadius: '6px', cursor: 'pointer',
              color: selectedPath === null ? 'var(--accent-primary)' : 'var(--text-primary)',
              padding: '6px 8px', textAlign: 'left', fontSize: '0.82rem',
            }}
            title="Search all files in your Knowledge Base"
          >
            <FolderOpen size={14} />
            <span style={{ flex: 1 }}>All folders (root)</span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{totalFiles} files</span>
          </button>
        )}
        {!loading && !error && flatRows.map((row, i) => {
          const isSelected = selectedPath === row.path;
          const isFocused = focusIndex === i;
          return (
            <button
              key={row.path}
              onClick={() => { onSelect(row.path); onClose(); }}
              onMouseEnter={() => setFocusIndex(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                background: isSelected ? 'var(--accent-soft)' : (isFocused ? 'rgba(255,255,255,0.04)' : 'transparent'),
                border: 'none', borderRadius: '6px', cursor: 'pointer',
                color: isSelected ? 'var(--accent-primary)' : 'var(--text-primary)',
                padding: '6px 8px', textAlign: 'left', fontSize: '0.82rem',
                paddingLeft: `${8 + row.depth * 14}px`,
              }}
              title={`folder: ${row.path}`}
            >
              <Folder size={14} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.name}
              </span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{row.recursiveFileCount}</span>
            </button>
          );
        })}
      </div>

      {selectedPath !== null && (
        <div style={{
          padding: '8px 12px', borderTop: '1px solid var(--border-color)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
          fontSize: '0.78rem',
        }}>
          <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Selected: <code style={{ color: 'var(--accent-primary)' }}>folder:{selectedPath}</code>
          </span>
          <button
            onClick={() => { onSelect(null); onClose(); }}
            style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px 8px', borderRadius: '6px', fontSize: '0.74rem' }}
          >
            Clear
          </button>
        </div>
      )}
    </Popover>
  );
}

function flattenForPopover(root: KbFolderNode): FlattenedFolder[] {
  const out: FlattenedFolder[] = [];
  const walk = (node: KbFolderNode) => {
    for (const child of node.children) {
      out.push({
        type: 'folder',
        path: child.path,
        name: child.name,
        depth: child.depth,
        recursiveFileCount: child.recursiveFileCount,
        recursiveSize: child.recursiveSize,
      });
      walk(child);
    }
  };
  walk(root);
  return out;
}
