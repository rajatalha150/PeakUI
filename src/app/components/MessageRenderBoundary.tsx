"use client";

import React from 'react';
import { reportClientError } from '@/lib/client-error-reporting';

type MessageRenderBoundaryProps = {
  children: React.ReactNode;
  fallbackText?: string;
};

type MessageRenderBoundaryState = {
  hasError: boolean;
};

export default class MessageRenderBoundary extends React.Component<
  MessageRenderBoundaryProps,
  MessageRenderBoundaryState
> {
  constructor(props: MessageRenderBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): MessageRenderBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Assistant message render failed:', error);
    reportClientError(error, {
      source: 'MessageRenderBoundary',
      componentStack: errorInfo.componentStack ?? undefined,
      extra: {
        hasFallbackText: Boolean(this.props.fallbackText?.trim()),
        fallbackTextLength: this.props.fallbackText?.length ?? 0,
      },
    });
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          padding: '12px',
          borderRadius: '12px',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          background: 'rgba(239, 68, 68, 0.06)',
        }}
      >
        <div style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          This response could not be fully rendered.
        </div>
        {this.props.fallbackText?.trim() ? (
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: '0.84rem',
              lineHeight: 1.6,
              color: 'var(--text-secondary)',
              fontFamily: 'inherit',
            }}
          >
            {this.props.fallbackText}
          </pre>
        ) : null}
      </div>
    );
  }
}
