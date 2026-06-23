'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface UseStickyScrollOptions {
  contentKey: unknown;
  isStreaming: boolean;
  threshold?: number;
}

export function useStickyScroll(options: UseStickyScrollOptions) {
  const { contentKey, isStreaming, threshold = 140 } = options;
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const rafIdRef = useRef<number>(0);
  const scrollFrameRef = useRef<number>(0);
  const prevContentKeyRef = useRef<unknown>(null);
  const prevStreamingRef = useRef(isStreaming);
  const prevHeightRef = useRef<number>(0);
  const programmaticScrollRef = useRef(false);
  const ignoreScrollUntilRef = useRef<number>(0);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const area = scrollAreaRef.current;
    if (!area) return;
    shouldStickToBottomRef.current = true;
    setShowScrollToBottom(false);
    programmaticScrollRef.current = true;
    ignoreScrollUntilRef.current = Date.now() + (behavior === 'smooth' ? 300 : 80);
    area.scrollTo({ top: area.scrollHeight, behavior });
  }, []);

  const pinToBottom = useCallback(() => {
    shouldStickToBottomRef.current = true;
    setShowScrollToBottom(false);
    // Scroll immediately rather than waiting for the next render cycle.
    // This ensures the view scrolls when the user presses Enter.
    requestAnimationFrame(() => {
      const area = scrollAreaRef.current;
      if (!area) return;
      programmaticScrollRef.current = true;
      ignoreScrollUntilRef.current = Date.now() + 80;
      area.scrollTo({ top: area.scrollHeight, behavior: 'auto' });
    });
  }, []);

  const requestScrollReset = useCallback(() => {
    setShowScrollToBottom(false);
    setResetToken(token => token + 1);
  }, []);

  const syncScrollState = useCallback(() => {
    const area = scrollAreaRef.current;
    if (!area) return;

    // Ignore scroll events that are caused by our own programmatic scrolling
    // so that a smooth auto-scroll does not accidentally disable sticky mode.
    if (programmaticScrollRef.current && Date.now() < ignoreScrollUntilRef.current) {
      return;
    }
    programmaticScrollRef.current = false;

    const distanceFromBottom = area.scrollHeight - area.scrollTop - area.clientHeight;
    const nearBottom = distanceFromBottom < threshold;
    shouldStickToBottomRef.current = nearBottom;
    setShowScrollToBottom(!nearBottom && area.scrollHeight > area.clientHeight);
  }, [threshold]);

  const handleScroll = useCallback(() => {
    if (scrollFrameRef.current) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = 0;
      syncScrollState();
    });
  }, [syncScrollState]);

  // Auto-scroll when content changes while pinned to bottom.
  // Uses a single RAF to batch multiple state updates into one scroll per frame.
  // Only fires when contentKey actually changes (new reference) or streaming state toggles.
  useEffect(() => {
    if (!shouldStickToBottomRef.current) return;

    // Only scroll when content or streaming state actually changed
    const contentChanged = contentKey !== prevContentKeyRef.current;
    const streamingToggled = isStreaming !== prevStreamingRef.current;
    if (!contentChanged && !streamingToggled) return;

    prevContentKeyRef.current = contentKey;
    prevStreamingRef.current = isStreaming;

    cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(() => {
      if (!shouldStickToBottomRef.current) return;
      const area = scrollAreaRef.current;
      if (!area) return;
      programmaticScrollRef.current = true;
      // Use instant scrolling while streaming so the view keeps up with tokens
      // and does not fall behind a smooth animation. For non-streaming updates
      // we keep a smooth scroll so the UI feels polished.
      const behavior: ScrollBehavior = isStreaming ? 'auto' : 'smooth';
      const cooldown = behavior === 'smooth' ? 300 : 80;
      ignoreScrollUntilRef.current = Date.now() + cooldown;
      area.scrollTo({ top: area.scrollHeight, behavior });
    });

    return () => cancelAnimationFrame(rafIdRef.current);
  }, [contentKey, isStreaming]);

  // Watch the scroll area's actual content height. When it grows while the
  // user is pinned to the bottom (especially during streaming), we scroll
  // down immediately. This covers cases where the state key changed before the
  // DOM had grown, or where React deferred the visible update.
  useEffect(() => {
    const area = scrollAreaRef.current;
    if (!area) return;

    let prevHeight = area.scrollHeight;
    let prevStreaming = isStreaming;
    let raf: number | null = null;

    const maybeScrollOnResize = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        if (!area) return;
        const currentHeight = area.scrollHeight;
        const heightGrew = currentHeight > prevHeight;
        const streamingStartedOrActive = isStreaming || prevStreaming;
        prevHeight = currentHeight;
        prevStreaming = isStreaming;

        if (heightGrew && shouldStickToBottomRef.current) {
          programmaticScrollRef.current = true;
          const behavior: ScrollBehavior = streamingStartedOrActive ? 'auto' : 'smooth';
          ignoreScrollUntilRef.current = Date.now() + (behavior === 'smooth' ? 300 : 80);
          area.scrollTo({ top: area.scrollHeight, behavior });
        }
      });
    };

    const resizeObserver = new ResizeObserver(() => {
      maybeScrollOnResize();
    });

    resizeObserver.observe(area, { box: 'border-box' });
    return () => {
      resizeObserver.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isStreaming]);

  // Immediate scroll on reset (e.g., session switch)
  useEffect(() => {
    if (resetToken === 0) return;
    const frame = requestAnimationFrame(() => {
      scrollToBottom('auto');
    });
    return () => cancelAnimationFrame(frame);
  }, [resetToken, scrollToBottom]);

  // When the input area resizes (textarea auto-grow), preserve the user's
  // scroll position relative to the bottom of the content. Without this,
  // growing the textarea shrinks the chat area and shifts the visible content.
  useEffect(() => {
    const area = scrollAreaRef.current;
    if (!area) return;

    let prevHeight = area.clientHeight;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newHeight = entry.contentRect.height;
        if (newHeight !== prevHeight && shouldStickToBottomRef.current) {
          // If we were pinned to bottom, stay pinned after resize
          requestAnimationFrame(() => {
            if (!area) return;
            programmaticScrollRef.current = true;
            ignoreScrollUntilRef.current = Date.now() + 80;
            area.scrollTo({ top: area.scrollHeight, behavior: 'auto' });
          });
        }
        prevHeight = newHeight;
      }
    });

    observer.observe(area, { box: 'border-box' });
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    cancelAnimationFrame(rafIdRef.current);
    cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  return {
    handleScroll,
    messagesEndRef,
    pinToBottom,
    requestScrollReset,
    scrollAreaRef,
    scrollToBottom,
    showScrollToBottom,
  };
}
