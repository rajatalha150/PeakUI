"use client";

import React from 'react';

type EstimateHeight<T> = number | ((item: T, index: number) => number);

interface VirtualizedListProps<T> {
  items: T[];
  getItemKey: (item: T, index: number) => React.Key;
  renderItem: (item: T, index: number) => React.ReactNode;
  estimateItemHeight?: EstimateHeight<T>;
  overscanPx?: number;
  enabled?: boolean;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
  style?: React.CSSProperties;
  className?: string;
}

function resolveEstimate<T>(estimate: EstimateHeight<T> | undefined, item: T, index: number) {
  if (typeof estimate === 'function') return estimate(item, index);
  return estimate ?? 220;
}

export default function VirtualizedList<T>({
  items,
  getItemKey,
  renderItem,
  estimateItemHeight,
  overscanPx = 800,
  enabled = true,
  scrollContainerRef,
  style,
  className,
}: VirtualizedListProps<T>) {
  const heightsRef = React.useRef(new Map<number, number>());
  const observersRef = React.useRef(new Map<number, ResizeObserver>());
  const [version, setVersion] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(0);
  const [scrollTop, setScrollTop] = React.useState(0);
  const localScrollRef = React.useRef<HTMLDivElement>(null);

  const scrollHost = scrollContainerRef?.current ?? localScrollRef.current;

  React.useEffect(() => {
    for (const index of Array.from(heightsRef.current.keys())) {
      if (index < items.length) continue;
      heightsRef.current.delete(index);
      observersRef.current.get(index)?.disconnect();
      observersRef.current.delete(index);
    }
  }, [items.length]);

  React.useEffect(() => {
    const host = scrollHost;
    if (!host) return;

    let frame = 0;

    const syncViewport = () => {
      setViewportHeight(host.clientHeight);
      setScrollTop(host.scrollTop);
    };

    const handleScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        syncViewport();
      });
    };

    syncViewport();

    const resizeObserver = new ResizeObserver(() => syncViewport());
    resizeObserver.observe(host, { box: 'border-box' });
    host.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      host.removeEventListener('scroll', handleScroll);
    };
  }, [scrollHost]);

  React.useEffect(() => {
    return () => {
      observersRef.current.forEach(observer => observer.disconnect());
      observersRef.current.clear();
    };
  }, []);

  const metrics = React.useMemo(() => {
    const tops: number[] = new Array(items.length);
    const heights: number[] = new Array(items.length);
    let totalHeight = 0;

    for (let index = 0; index < items.length; index += 1) {
      tops[index] = totalHeight;
      const measuredHeight = heightsRef.current.get(index);
      const resolvedHeight = measuredHeight ?? resolveEstimate(estimateItemHeight, items[index], index);
      heights[index] = resolvedHeight;
      totalHeight += resolvedHeight;
    }

    return { tops, heights, totalHeight };
  }, [items, estimateItemHeight, version]);

  const visibleRange = React.useMemo(() => {
    if (!enabled || items.length === 0) {
      return { startIndex: 0, endIndex: items.length - 1 };
    }

    const viewportTop = Math.max(0, scrollTop - overscanPx);
    const viewportBottom = scrollTop + Math.max(viewportHeight, 1) + overscanPx;

    let startIndex = 0;
    while (
      startIndex < items.length - 1
      && metrics.tops[startIndex] + metrics.heights[startIndex] < viewportTop
    ) {
      startIndex += 1;
    }

    let endIndex = startIndex;
    while (endIndex < items.length - 1 && metrics.tops[endIndex] < viewportBottom) {
      endIndex += 1;
    }

    return { startIndex, endIndex };
  }, [enabled, items.length, metrics.heights, metrics.tops, overscanPx, scrollTop, viewportHeight]);

  const measureItem = React.useCallback((index: number, node: HTMLDivElement | null) => {
    const previousObserver = observersRef.current.get(index);
    previousObserver?.disconnect();
    observersRef.current.delete(index);

    if (!node) return;

    const updateHeight = () => {
      const nextHeight = node.offsetHeight;
      if (!nextHeight || heightsRef.current.get(index) === nextHeight) return;
      heightsRef.current.set(index, nextHeight);
      setVersion(current => current + 1);
    };

    updateHeight();

    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(node, { box: 'border-box' });
    observersRef.current.set(index, observer);
  }, []);

  const content = (
    <div
      className={className}
      style={{
        position: 'relative',
        height: metrics.totalHeight,
        width: '100%',
        ...style,
      }}
    >
      {items.length === 0
        ? null
        : items
            .slice(enabled ? visibleRange.startIndex : 0, enabled ? visibleRange.endIndex + 1 : items.length)
            .map((item, offset) => {
              const index = (enabled ? visibleRange.startIndex : 0) + offset;
              return (
                <div
                  key={getItemKey(item, index)}
                  ref={node => measureItem(index, node)}
                  style={{
                    position: enabled ? 'absolute' : 'relative',
                    top: enabled ? metrics.tops[index] : undefined,
                    left: 0,
                    width: '100%',
                  }}
                >
                  {renderItem(item, index)}
                </div>
              );
            })}
    </div>
  );

  if (scrollContainerRef) {
    return content;
  }

  return (
    <div
      ref={localScrollRef}
      style={{
        overflowY: 'auto',
        maxHeight: '72vh',
        width: '100%',
      }}
    >
      {content}
    </div>
  );
}
