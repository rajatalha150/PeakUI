"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Folder, FolderOpen, X } from 'lucide-react';
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
  anchorRef?: React.RefObject<HTMLElement>;
  /** Width override (defaults to 320px). */
  width?: number;
}

export default function KnowledgeBaseTreePopover({
  open,
  onClose,
  selectedPath,
  onSelect,
  onRefresh,
  anchorRef,
  width = 320,
}: KnowledgeBaseTreePopoverProps) {
  const [tree, setTree] = useState<KbFolderNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Click outside to close.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (containerRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open, onClose, anchorRef]);

  // Esc to close + arrow navigation.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIndex(prev => Math.min(prev + 1, flatRows.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && focusIndex >= 0 && flatRows[focusIndex]) {
        e.preventDefault();
        onSelect(flatRows[focusIndex]!.path);
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focusIndex]);

  // Anchor-relative fixed positioning. The popover is portaled to <body>, so
  // it's no longer bounded by the button's ancestor stacking contexts (e.g.
  // `.openclaw-main-panel { isolation: isolate }` traps a z-index inside it
  // and lets sibling grid rows paint over the dropdown). Recompute on every
  // open, on window resize, on any scroll, and if the anchor's box changes
  // (e.g. the button text grows when a folder is selected and a clear-X
  // appears).
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const compute = () => {
      const anchor = anchorRef?.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const gap = 6;
      const margin = 8;
      // Preferred: right-align with the anchor, drop below it. If the
      // popover would overflow the bottom, flip above the anchor. Always
      // clamp horizontally to the viewport.
      let left = rect.right - width;
      let top = rect.bottom + gap;
      const maxLeft = viewportWidth - width - margin;
      if (left < margin) left = margin;
      if (left > maxLeft) left = maxLeft;
      if (top + 420 > viewportHeight - margin) {
        const flipped = rect.top - gap - 420;
        if (flipped >= margin) {
          top = flipped;
        } else {
          // Neither below nor above fits fully; pick whichever leaves more
          // room and let the inner scroll handle the rest.
          top = Math.max(margin, Math.min(top, viewportHeight - 420 - margin));
        }
      }
      setPosition({ top, left });
    };
    compute();
    const onScroll = () => compute();
    const onResize = () => compute();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    let observer: ResizeObserver | null = null;
    if (anchorRef?.current && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => compute());
      observer.observe(anchorRef.current);
    }
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
      observer?.disconnect();
    };
  }, [open, anchorRef, width, selectedPath]);

  if (!open) return null;

  // Wait for client mount so the portal target (document.body) exists.
  if (!mounted) return null;

  const flatRows: FlattenedFolder[] = tree ? flattenForPopover(tree) : [];
  const hasFolders = flatRows.length > 0;
  const totalFiles = tree?.recursiveFileCount ?? 0;

  // Render the popover into <body> via a portal so it escapes every
  // ancestor's stacking context (`isolation: isolate`, `overflow: hidden`,
  // nested grid rows, etc.). Until the first layout pass computes a
  // position, fall back to a hidden sentinel so the first paint doesn't
  // flash at (0,0).
  const popoverStyle: React.CSSProperties = position
    ? {
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex: 1000,
        width: `${width}px`,
        maxHeight: '420px',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        boxShadow: '0 18px 40px rgba(0,0,0,0.45)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }
    : {
        position: 'fixed',
        top: '-9999px',
        left: '-9999px',
        zIndex: 1000,
        width: `${width}px`,
        maxHeight: '420px',
        visibility: 'hidden',
      };

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Choose a folder"
      style={popoverStyle}
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
    </div>,
    document.body,
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
