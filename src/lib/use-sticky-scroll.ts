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

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const area = scrollAreaRef.current;
    if (!area) return;
    shouldStickToBottomRef.current = true;
    setShowScrollToBottom(false);
    area.scrollTo({ top: area.scrollHeight, behavior });
  }, []);

  const pinToBottom = useCallback(() => {
    shouldStickToBottomRef.current = true;
    setShowScrollToBottom(false);
  }, []);

  const requestScrollReset = useCallback(() => {
    setShowScrollToBottom(false);
    setResetToken(token => token + 1);
  }, []);

  const handleScroll = useCallback(() => {
    const area = scrollAreaRef.current;
    if (!area) return;

    const distanceFromBottom = area.scrollHeight - area.scrollTop - area.clientHeight;
    const nearBottom = distanceFromBottom < threshold;
    shouldStickToBottomRef.current = nearBottom;
    setShowScrollToBottom(!nearBottom && area.scrollHeight > area.clientHeight);
  }, [threshold]);

  useEffect(() => {
    if (!shouldStickToBottomRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      scrollToBottom(isStreaming ? 'auto' : 'smooth');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [contentKey, isStreaming, scrollToBottom]);

  useEffect(() => {
    if (resetToken === 0) return;
    const frame = window.requestAnimationFrame(() => {
      scrollToBottom('auto');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [resetToken, scrollToBottom]);

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
