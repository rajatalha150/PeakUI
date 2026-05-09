"use client";

import type { CSSProperties } from 'react';
import type { MessageSource } from '@/lib/message-sources';

function getWebSourceMeta(source: MessageSource) {
  if (!source.url) return 'web';

  try {
    const hostname = new URL(source.url).hostname.replace(/^www\./, '');
    return hostname;
  } catch {
    return 'web';
  }
}

function isOnionUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.onion')
  } catch {
    return false
  }
}

function getNetworkModeLabel(source: MessageSource): string | null {
  if (source.networkMode === 'stealth' || (source.url && isOnionUrl(source.url))) {
    return 'Dark Web'
  }
  if (source.networkMode === 'direct') {
    return 'Clear Web'
  }
  return null
}

function getNetworkModeStyle(networkMode: string | null | undefined, url?: string): Partial<CSSProperties> {
  const isOnion = url ? isOnionUrl(url) : false
  if (networkMode === 'stealth' || isOnion) {
    return {
      borderColor: 'rgba(168, 85, 247, 0.4)',
      background: 'rgba(168, 85, 247, 0.08)',
    }
  }
  if (networkMode === 'direct') {
    return {
      borderColor: 'rgba(59, 130, 246, 0.4)',
      background: 'rgba(59, 130, 246, 0.08)',
    }
  }
  return {}
}

export default function SourceChips({ sources }: { sources: MessageSource[] }) {
  if (!sources.length) return null;

  return (
    <div style={{
      marginTop: '12px',
      paddingTop: '10px',
      borderTop: '1px solid var(--border-color)',
      display: 'flex',
      flexWrap: 'wrap',
      gap: '8px',
    }}>
      {sources.slice(0, 8).map((source, index) => {
        const label = source.title || (source.sourcePath && source.sourcePath !== source.filename
          ? `${source.filename} · ${source.sourcePath}`
          : source.filename);
        const meta = source.mode === 'web'
          ? getWebSourceMeta(source)
          : [
              source.wholeDocument
                ? 'full document'
                : typeof source.chunkIndex === 'number'
                  ? typeof source.documentChunkCount === 'number'
                    ? `chunk ${source.chunkIndex + 1}/${source.documentChunkCount}`
                    : `chunk ${source.chunkIndex + 1}`
                  : null,
              `${Math.round(source.score * 100)}%`,
              source.mode || 'semantic',
            ].filter(Boolean).join(' · ');
        const networkLabel = getNetworkModeLabel(source);
        const tooltip = source.url
          || [source.sourcePath, source.wholeDocument
              ? 'full document'
              : typeof source.chunkIndex === 'number'
                ? typeof source.documentChunkCount === 'number'
                  ? `chunk ${source.chunkIndex + 1}/${source.documentChunkCount}`
                  : `chunk ${source.chunkIndex + 1}`
                : null, source.excerpt || source.content]
            .filter(Boolean)
            .join(' · ');
        const networkStyle = getNetworkModeStyle(source.networkMode, source.url);
        const chipStyle: CSSProperties = {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          borderRadius: '999px',
          border: networkStyle.borderColor ? `1px solid ${networkStyle.borderColor}` : '1px solid var(--border-color)',
          background: networkStyle.background || 'rgba(255,255,255,0.04)',
          color: 'var(--text-secondary)',
          fontSize: '0.72rem',
          lineHeight: 1.3,
          maxWidth: '100%',
          textDecoration: 'none',
        };

        const inner = (
          <>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '18px',
              height: '18px',
              borderRadius: '999px',
              background: 'var(--accent-faint)',
              color: 'var(--accent-primary)',
              fontSize: '0.65rem',
              fontWeight: 600,
              padding: '0 5px',
            }}>
              {index + 1}
            </span>
            <span style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '240px',
            }}>
              {label}
            </span>
            <span style={{ opacity: 0.6, fontSize: '0.65rem' }}>{meta}</span>
            {networkLabel && (
              <span style={{
                fontSize: '0.58rem',
                fontWeight: 600,
                padding: '1px 4px',
                borderRadius: 3,
                background: source.networkMode === 'stealth' || (source.url && isOnionUrl(source.url))
                  ? 'rgba(168, 85, 247, 0.15)'
                  : 'rgba(59, 130, 246, 0.15)',
                color: source.networkMode === 'stealth' || (source.url && isOnionUrl(source.url))
                  ? '#a855f7'
                  : '#3b82f6',
              }}>
                {networkLabel}
              </span>
            )}
          </>
        );

        if (source.url) {
          return (
            <a
              key={`${source.url}-${index}`}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              title={tooltip}
              style={chipStyle}
            >
              {inner}
            </a>
          );
        }

        return (
          <span
            key={`${source.chunkId || source.filename}-${index}`}
            title={tooltip}
            style={chipStyle}
          >
            {inner}
          </span>
        );
      })}
    </div>
  );
}
