"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Position descriptor returned by `computePopoverPosition`. `side` tells the
 * caller whether the popover dropped below (`'bottom'`) or flipped above
 * (`'top'`) the anchor — useful for arrow indicators or animations.
 */
export interface PopoverPosition {
  top: number;
  left: number;
  side: 'bottom' | 'top';
}

/**
 * Pure positioning math used by `<Popover>`. Given the anchor's bounding
 * rect and the popover's width/height, returns the fixed-position
 * coordinates and whether the popover was flipped above. Clamps to the
 * viewport and respects `margin` on every edge.
 *
 * Exported for unit tests (see Popover.test.ts) and for advanced callers
 * that want to render a popover without the React wrapper.
 */
export function computePopoverPosition(
  anchor: { top: number; bottom: number; left: number; right: number; width: number; height: number },
  popoverWidth: number,
  popoverHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  options: { side?: 'bottom' | 'top'; align?: 'start' | 'center' | 'end'; gap?: number; margin?: number } = {},
): PopoverPosition {
  const side = options.side ?? 'bottom';
  const align = options.align ?? 'end';
  const gap = options.gap ?? 6;
  const margin = options.margin ?? 8;

  // Vertical: prefer below the anchor, flip above if it would overflow.
  let resolvedSide: 'bottom' | 'top' = side;
  let top = side === 'top'
    ? anchor.top - gap - popoverHeight
    : anchor.bottom + gap;
  if (side === 'bottom' && top + popoverHeight > viewportHeight - margin) {
    const flipped = anchor.top - gap - popoverHeight;
    if (flipped >= margin) {
      top = flipped;
      resolvedSide = 'top';
    } else {
      // Neither side fits fully — pick the one with more room, let the
      // inner scroll handle the rest.
      const roomBelow = viewportHeight - margin - anchor.bottom - gap;
      const roomAbove = anchor.top - gap - margin;
      if (roomAbove > roomBelow && roomAbove > 0) {
        top = margin;
        resolvedSide = 'top';
      } else {
        top = Math.max(margin, viewportHeight - popoverHeight - margin);
      }
    }
  } else if (side === 'top' && top < margin) {
    // Forced to top but it doesn't fit — fall back to bottom.
    top = anchor.bottom + gap;
    resolvedSide = 'bottom';
    if (top + popoverHeight > viewportHeight - margin) {
      top = Math.max(margin, viewportHeight - popoverHeight - margin);
    }
  }

  // Horizontal: align the popover to the anchor's edge.
  let left: number;
  if (align === 'start') {
    left = anchor.left;
  } else if (align === 'center') {
    left = anchor.left + (anchor.width - popoverWidth) / 2;
  } else {
    left = anchor.right - popoverWidth;
  }
  const maxLeft = viewportWidth - popoverWidth - margin;
  if (left < margin) left = margin;
  if (left > maxLeft) left = maxLeft;
  if (left < margin && popoverWidth + margin * 2 > viewportWidth) {
    // Popover wider than viewport minus margins — pin to left edge.
    left = margin;
  }

  return { top, left, side: resolvedSide };
}

export interface PopoverProps {
  /** Whether the popover is open. When false, nothing is rendered. */
  open: boolean;
  /** Called when the user clicks outside, presses Esc, or scrolls (if configured). */
  onClose: () => void;
  /**
   * Anchor element used for positioning and click-outside detection. Pass a
   * `RefObject<HTMLElement>` from `useRef`. The popover is positioned with
   * `position: fixed` computed from `anchor.getBoundingClientRect()`, so it
   * is portal-rendered to `<body>` and escapes every ancestor stacking
   * context (the bug this primitive exists to fix).
   */
  anchorRef: React.RefObject<HTMLElement | null>;
  /**
   * Optional second anchor: clicks on these elements are also treated as
   * "inside" (won't close the popover). Use for trigger buttons that live
   * outside `anchorRef` but should still keep the popover open on click.
   */
  additionalIgnoreRefs?: React.RefObject<HTMLElement | null>[];
  /** Content rendered inside the popover. */
  children: React.ReactNode;
  /** CSS class for the popover root (positioning is applied separately). */
  className?: string;
  /** Optional external ref to the portaled root, useful for nested popovers. */
  rootRef?: React.RefObject<HTMLDivElement | null>;
  /** Inline style merged AFTER the positioning styles. Use for content styling, not positioning. */
  style?: React.CSSProperties;
  /** Preferred width in px. The popover is also clamped to the viewport. */
  width?: number;
  /** Preferred max-height in px. The popover scrolls internally if content overflows. */
  maxHeight?: number;
  /**
   * Z-index for the popover. Convention: 1000 for popovers, 1100 for
   * previews, 1200-1300 for modals. Default 1000.
   */
  zIndex?: number;
  /** Preferred side relative to the anchor. `'bottom'` (default) drops below; `'top'` flips above. */
  side?: 'bottom' | 'top';
  /** Alignment along the anchor. `'end'` (default) right-aligns; `'start'` left-aligns; `'center'` centers. */
  align?: 'start' | 'center' | 'end';
  /** Gap between the anchor and the popover in px. Default 6. */
  gap?: number;
  /** Viewport margin in px. Default 8. */
  margin?: number;
  /**
   * Close the popover when the user scrolls any ancestor. Default false
   * because most popovers want to track the anchor instead.
   */
  closeOnScroll?: boolean;
  /** Close the popover on window resize. Default false. */
  closeOnResize?: boolean;
  /**
   * ARIA role for the popover root. Default `'dialog'`. Use `'menu'` for
   * menu-style dropdowns, `'listbox'` for option lists, etc.
   */
  role?: 'dialog' | 'menu' | 'listbox' | 'tooltip' | 'region';
  /** Accessible label for screen readers. */
  ariaLabel?: string;
  /**
   * Move keyboard focus into the popover when it opens and back to the
   * anchor when it closes. Default true. Disable if the caller manages
   * focus (e.g. for menu items that should keep trigger focus).
   */
  manageFocus?: boolean;
  /**
   * Selector for the element to focus on open, scoped to the popover. If
   * omitted, the popover root is focused. Set to `'[data-autofocus]'` to
   * delegate to a child element. Has no effect if `manageFocus` is false.
   */
  initialFocusSelector?: string;
}

/**
 * Reusable popover primitive that portal-renders to `<body>` and uses
 * `position: fixed` so it escapes every ancestor stacking context.
 *
 * Replaces the hand-rolled `position: absolute` dropdowns that were
 * getting covered by sibling elements (notably `.workspace-tool-main-panel {
 * isolation: isolate }` and `.main-content { overflow: hidden }`).
 *
 * The primitive owns:
 *  - Portal to `<body>` (SSR-safe via a `mounted` guard).
 *  - Fixed positioning with `getBoundingClientRect()` on the anchor.
 *  - Recompute on `resize`, on `scroll` (capture phase, passive), and via
 *    a `ResizeObserver` on the anchor — tracks the button if it moves.
 *  - Viewport clamping (horizontal and vertical) with a "flip above"
 *    fallback when the popover would overflow the bottom.
 *  - Click outside (ignores the anchor and any `additionalIgnoreRefs`).
 *  - Esc to close.
 *  - Optional close-on-scroll / close-on-resize.
 *  - ARIA (`role`, `aria-label`).
 *  - Optional focus management (focus on open, return focus on close).
 *
 * The caller provides the visual styling via `className` / `style`.
 */
export default function Popover({
  open,
  onClose,
  anchorRef,
  additionalIgnoreRefs,
  children,
  className,
  rootRef,
  style,
  width = 320,
  maxHeight = 420,
  zIndex = 1000,
  side = 'bottom',
  align = 'end',
  gap = 6,
  margin = 8,
  closeOnScroll = false,
  closeOnResize = false,
  role = 'dialog',
  ariaLabel,
  manageFocus = true,
  initialFocusSelector,
}: PopoverProps) {
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // SSR safety: don't portal until we're on the client.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Track the anchor's position; recompute on viewport changes and when
  // the anchor's box itself changes (button text grows on selection, etc.).
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const compute = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const next = computePopoverPosition(
        {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
        },
        width,
        maxHeight,
        window.innerWidth,
        window.innerHeight,
        { side, align, gap, margin },
      );
      setPosition(next);
    };
    compute();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && anchorRef.current) {
      observer = new ResizeObserver(compute);
      observer.observe(anchorRef.current);
    }
    const onScroll = () => {
      if (closeOnScroll) onClose();
      else compute();
    };
    const onResize = () => {
      if (closeOnResize) onClose();
      else compute();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
      observer?.disconnect();
    };
  }, [open, anchorRef, width, maxHeight, side, align, gap, margin, closeOnScroll, closeOnResize, onClose]);

  // Click outside: ignore clicks on the anchor or any additional ignore refs.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (containerRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      if (additionalIgnoreRefs) {
        for (const ref of additionalIgnoreRefs) {
          if (ref?.current?.contains(target)) return;
        }
      }
      onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open, onClose, anchorRef, additionalIgnoreRefs]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Focus management: focus the popover (or the configured child) on open,
  // return focus to the previously-focused element on close.
  useEffect(() => {
    if (!open || !manageFocus) return;
    previousFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
    // Defer one frame so the portal content is mounted.
    const id = window.setTimeout(() => {
      const root = containerRef.current;
      if (!root) return;
      if (initialFocusSelector) {
        const target = root.querySelector<HTMLElement>(initialFocusSelector);
        if (target) {
          target.focus();
          return;
        }
      }
      // Fall back to the first focusable child, otherwise the root.
      const focusable = root.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable) {
        focusable.focus();
      } else {
        root.tabIndex = -1;
        root.focus();
      }
    }, 0);
    return () => {
      window.clearTimeout(id);
    };
  }, [open, manageFocus, initialFocusSelector]);

  useEffect(() => {
    if (open || !manageFocus) return;
    // On close, return focus to wherever it was before the popover opened.
    // We only do this if the popover currently contains focus, to avoid
    // stealing focus from something the user moved to.
    if (
      previousFocusRef.current &&
      containerRef.current &&
      document.activeElement &&
      (document.activeElement === containerRef.current || containerRef.current.contains(document.activeElement))
    ) {
      previousFocusRef.current.focus();
    }
    previousFocusRef.current = null;
  }, [open, manageFocus]);

  if (!open || !mounted) return null;

  const baseStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex,
    width: `${width}px`,
    maxHeight: `${maxHeight}px`,
  };
  const positionedStyle: React.CSSProperties = position
    ? { ...baseStyle, top: `${position.top}px`, left: `${position.left}px` }
    : { ...baseStyle, top: '-9999px', left: '-9999px', visibility: 'hidden' };

  return createPortal(
    <div
      ref={(node) => {
        containerRef.current = node;
        if (rootRef) {
          (rootRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }
      }}
      role={role}
      aria-label={ariaLabel}
      data-popover-root
      className={className}
      style={{ ...positionedStyle, ...style }}
    >
      {children}
    </div>,
    document.body,
  );
}
