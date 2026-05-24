"use client";

import React from 'react';
import type { ResponsePresentation } from '@/lib/response-format';
import { normalizeAssistantResponseContent } from '@/lib/response-normalizer';
import type { MessageSource } from '@/lib/message-sources';

type StructuredBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; lines: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'code'; info: string; code: string }
  | { type: 'rule' };

function isTableSeparatorRow(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length >= 2 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')));
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim());
}

function isListItem(line: string): boolean {
  return /^(\s*)(?:[-*+•]|\d+[.)])\s+\S/.test(line);
}

function isHeading(line: string): boolean {
  return /^#{1,6}\s+\S/.test(line);
}

function isRule(line: string): boolean {
  const normalized = line.trim();
  return /^(-{3,}|\*{3,}|_{3,})$/.test(normalized);
}

function isTableStart(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) return false;
  const current = lines[index].trim();
  const next = lines[index + 1].trim();
  return current.includes('|') && isTableSeparatorRow(next);
}

function startsStructuredBlock(lines: string[], index: number): boolean {
  if (index >= lines.length) return false;
  const line = lines[index].trim();
  return (
    !line
    || line.startsWith('```')
    || isHeading(line)
    || isRule(line)
    || isTableStart(lines, index)
    || isListItem(line)
    || line.startsWith('>')
  );
}

function CitationLink({ index, sources }: { index: number; sources?: MessageSource[] }) {
  const source = sources?.[index - 1];
  if (!source?.url) {
    return (
      <sup style={{ color: 'var(--accent-primary)', fontSize: '0.72em', fontWeight: 600, marginLeft: '1px' }}>
        [{index}]
      </sup>
    );
  }
  return (
    <a href={source.url} target="_blank" rel="noreferrer" title={`${source.title || source.filename} — ${source.url}`}
       style={{ color: 'var(--accent-primary)', fontSize: '0.72em', fontWeight: 600, marginLeft: '1px', textDecoration: 'none', cursor: 'pointer' }}
       onClick={e => e.stopPropagation()}>
      [{index}]
    </a>
  );
}

function getMarkdownImageUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed.slice(1, -1).trim();
  }
  const quotedTitleMatch = trimmed.match(/^(\S+)\s+["'][^"']*["']$/);
  return quotedTitleMatch?.[1] || trimmed;
}

function InlineMarkdownImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = React.useState(false);
  const imageUrl = getMarkdownImageUrl(src);

  React.useEffect(() => {
    setFailed(false);
  }, [imageUrl]);

  if (failed) {
    return (
      <a
        href={imageUrl}
        target="_blank"
        rel="noreferrer"
        style={{ color: 'var(--accent-primary)', textDecoration: 'underline', wordBreak: 'break-word' }}
        onClick={e => e.stopPropagation()}
      >
        {alt || imageUrl}
      </a>
    );
  }

  return (
    <img
      src={imageUrl}
      alt={alt || 'Image'}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      style={{
        maxWidth: 'min(100%, 720px)',
        maxHeight: '420px',
        width: 'auto',
        height: 'auto',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        display: 'block',
        margin: '8px 0',
        objectFit: 'contain',
      }}
    />
  );
}

function renderInline(text: string, keyPrefix: string, sources?: MessageSource[]): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  
  // Process inline markdown images ![alt](url)
  const imgRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let m = imgRe.exec(text);
  if (m) {
    imgRe.lastIndex = 0;
    let i = 0;
    let pos = 0;
    const process = (t: string, p: string) => {
      const segs = t.split(/(`[^`]+`)/g);
      segs.forEach((s: string) => {
        if (!s) return;
        if (s.startsWith('`') && s.endsWith('`')) {
          nodes.push(<code key={`${p}-c-${i++}`} style={{padding:'1px 5px',borderRadius:'6px',background:'rgba(255,255,255,0.06)',border:'1px solid var(--border-color)',fontSize:'0.92em'}}>{s.slice(1,-1)}</code>);
        } else {
          nodes.push(<span key={`${p}-s-${i++}`}>{s}</span>);
        }
      });
    };
    while ((m = imgRe.exec(text)) !== null) {
      if (m.index > pos) process(text.slice(pos, m.index), keyPrefix);
      nodes.push(<InlineMarkdownImage key={`${keyPrefix}-i-${i++}`} src={m[2]} alt={m[1] || 'Image'} />);
      pos = imgRe.lastIndex;
    }
    if (pos < text.length) process(text.slice(pos), keyPrefix);
    return nodes;
  }
  
  const codeSegments = text.split(/(`[^`]+`)/g);
  let tokenIndex = 0;

  const pushTextWithEmphasis = (segment: string, segmentPrefix: string) => {
    // First pass: extract markdown links [text](url) and citations [^N]
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const citationRegex = /\[\^(\d+)\]/g;
    type Extracted = { type: 'text'; value: string } | { type: 'citation'; index: number } | { type: 'link'; text: string; url: string };
    const parts: Extracted[] = [];
    // Combined regex to match both links and citations in order of appearance
    const combinedRegex = /\[([^\]]+)\]\(([^)]+)\)|\[\^(\d+)\]/g;
    let lastIndex = 0;
    let combinedMatch: RegExpExecArray | null;
    while ((combinedMatch = combinedRegex.exec(segment)) !== null) {
      if (combinedMatch.index > lastIndex) {
        parts.push({ type: 'text', value: segment.slice(lastIndex, combinedMatch.index) });
      }
      if (combinedMatch[3] !== undefined) {
        // Citation [^N]
        parts.push({ type: 'citation', index: Number(combinedMatch[3]) });
      } else {
        // Markdown link [text](url)
        parts.push({ type: 'link', text: combinedMatch[1], url: combinedMatch[2] });
      }
      lastIndex = combinedMatch.index + combinedMatch[0].length;
    }
    if (lastIndex < segment.length) {
      parts.push({ type: 'text', value: segment.slice(lastIndex) });
    }
    if (parts.length === 0) {
      parts.push({ type: 'text', value: segment });
    }
    for (const part of parts) {
      if (part.type === 'citation') {
        nodes.push(<CitationLink key={`${segmentPrefix}-cite-${tokenIndex++}`} index={part.index} sources={sources} />);
        continue;
      }
      if (part.type === 'link') {
        nodes.push(
          <a key={`${segmentPrefix}-link-${tokenIndex++}`} href={part.url} target="_blank" rel="noreferrer"
            style={{ color: 'var(--accent-primary)', textDecoration: 'underline', wordBreak: 'break-word' }}
            onClick={e => e.stopPropagation()}>
            {part.text}
          </a>
        );
        continue;
      }
      const strongSegments = part.value.split(/(\*\*[^*]+\*\*|__[^_]+__)/g);

    for (const strongSegment of strongSegments) {
      if (!strongSegment) continue;

      if (
        (strongSegment.startsWith('**') && strongSegment.endsWith('**'))
        || (strongSegment.startsWith('__') && strongSegment.endsWith('__'))
      ) {
        const inner = strongSegment.slice(2, -2);
        const italicSegments = inner.split(/(\*[^*\n]+\*|_[^_\n]+_)/g);
        const strongNodes: React.ReactNode[] = [];

        italicSegments.forEach((italicSegment, italicIndex) => {
          if (!italicSegment) return;
          if (
            (italicSegment.startsWith('*') && italicSegment.endsWith('*'))
            || (italicSegment.startsWith('_') && italicSegment.endsWith('_'))
          ) {
            strongNodes.push(
              <em key={`${segmentPrefix}-em-${italicIndex}`}>{italicSegment.slice(1, -1)}</em>
            );
          } else {
            strongNodes.push(italicSegment);
          }
        });

        nodes.push(
          <strong key={`${keyPrefix}-strong-${tokenIndex++}`}>{strongNodes}</strong>
        );
        continue;
      }

      const italicSegments = strongSegment.split(/(\*[^*\n]+\*|_[^_\n]+_)/g);
      italicSegments.forEach((italicSegment, italicIndex) => {
        if (!italicSegment) return;
        if (
          (italicSegment.startsWith('*') && italicSegment.endsWith('*'))
          || (italicSegment.startsWith('_') && italicSegment.endsWith('_'))
        ) {
          nodes.push(
            <em key={`${segmentPrefix}-em-${italicIndex}`}>{italicSegment.slice(1, -1)}</em>
          );
        } else {
          nodes.push(italicSegment);
        }
      });
    }
    }
  };

  for (const segment of codeSegments) {
    if (!segment) continue;

    if (segment.startsWith('`') && segment.endsWith('`')) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${tokenIndex++}`}
          style={{
            padding: '1px 5px',
            borderRadius: '6px',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid var(--border-color)',
            fontSize: '0.92em',
          }}
        >
          {segment.slice(1, -1)}
        </code>
      );
      continue;
    }

    pushTextWithEmphasis(segment, `${keyPrefix}-segment-${tokenIndex++}`);
  }

  return nodes;
}

function prettyPrintData(content: string, presentation?: ResponsePresentation): string {
  if (presentation?.mode !== 'data') return content;
  if (presentation.dataFormat !== 'json') return content;

  try {
    const parsed = JSON.parse(content);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return content;
  }
}

function parseStructuredBlocks(content: string): StructuredBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: StructuredBlock[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const info = trimmed.slice(3).trim();
      index += 1;
      const codeLines: string[] = [];

      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', info, code: codeLines.join('\n') });
      continue;
    }

    if (isHeading(trimmed)) {
      const match = trimmed.match(/^(#{1,6})\s+(.*)$/);
      blocks.push({
        type: 'heading',
        level: match?.[1].length || 1,
        text: match?.[2]?.trim() || '',
      });
      index += 1;
      continue;
    }

    if (isRule(trimmed)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const headers = splitTableRow(lines[index]);
      index += 2;
      const rows: string[][] = [];

      while (index < lines.length) {
        const rowLine = lines[index].trim();
        if (!rowLine || !rowLine.includes('|') || isHeading(rowLine) || isListItem(rowLine) || rowLine.startsWith('```')) break;
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }

      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    if (isListItem(trimmed)) {
      const ordered = /^\s*\d+[.)]\s+\S/.test(trimmed);
      const items: string[] = [];
      let currentItem = '';

      while (index < lines.length) {
        const rawLine = lines[index];
        const itemLine = rawLine.trim();

        if (!itemLine) {
          index += 1;
          break;
        }

        const match = ordered
          ? itemLine.match(/^\d+[.)]\s+(.*)$/)
          : itemLine.match(/^[-*+•]\s+(.*)$/);

        if (match) {
          if (currentItem) items.push(currentItem.trim());
          currentItem = match[1].trim();
          index += 1;
          continue;
        }

        if (/^\s{2,}\S/.test(rawLine) && currentItem) {
          currentItem += ` ${itemLine}`;
          index += 1;
          continue;
        }

        break;
      }

      if (currentItem) items.push(currentItem.trim());
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];

      while (index < lines.length) {
        const quoteLine = lines[index].trim();
        if (!quoteLine.startsWith('>')) break;
        quoteLines.push(quoteLine.replace(/^>\s?/, '').trim());
        index += 1;
      }

      blocks.push({ type: 'quote', lines: quoteLines });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index];
      const currentTrimmed = current.trim();
      if (!currentTrimmed || startsStructuredBlock(lines, index)) break;
      paragraphLines.push(currentTrimmed);
      index += 1;
    }

    blocks.push({ type: 'paragraph', text: paragraphLines.join('\n') });
  }

  return blocks;
}

function CodeBlock({ info, code, blockIndex }: { info: string; code: string; blockIndex: number }) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = React.useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [code]);
  return (
    <div
      key={`code-${blockIndex}`}
      style={{
        borderRadius: '12px',
        border: '1px solid var(--border-color)',
        background: 'rgba(255,255,255,0.03)',
        padding: '12px',
        overflowX: 'auto',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: info.trim() ? '8px' : '4px' }}>
        {info.trim() && (
          <div
            style={{
              fontSize: '0.74rem',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            {info.trim()}
          </div>
        )}
        <button
          onClick={handleCopy}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            padding: '2px 8px',
            fontSize: '0.72rem',
            color: copied ? 'var(--accent-primary)' : 'var(--text-secondary)',
            cursor: 'pointer',
            marginLeft: 'auto',
            transition: 'color 0.2s',
            fontFamily: 'inherit',
          }}
          title={copied ? 'Copied!' : 'Copy code'}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          whiteSpace: 'pre',
          overflowX: 'auto',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: '0.86rem',
          lineHeight: 1.65,
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderBlock(block: StructuredBlock, blockIndex: number, sources?: MessageSource[]): React.ReactNode {
  switch (block.type) {
    case 'heading': {
      const level = Math.min(Math.max(block.level, 1), 6);
      const HeadingTag = (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const)[level - 1];
      const sizeByLevel: Record<number, string> = {
        1: '1.5rem',
        2: '1.25rem',
        3: '1.1rem',
        4: '1rem',
        5: '0.95rem',
        6: '0.9rem',
      };

      return (
        <HeadingTag
          key={`heading-${blockIndex}`}
          style={{
            margin: 0,
            fontSize: sizeByLevel[level],
            fontWeight: 700,
            letterSpacing: level <= 2 ? '-0.02em' : '0',
            lineHeight: 1.25,
          }}
        >
          {renderInline(block.text, `heading-${blockIndex}`, sources)}
        </HeadingTag>
      );
    }
    case 'paragraph':
      return (
        <p
          key={`paragraph-${blockIndex}`}
          style={{
            margin: 0,
            lineHeight: 1.7,
            whiteSpace: 'pre-wrap',
          }}
        >
          {renderInline(block.text, `paragraph-${blockIndex}`, sources)}
        </p>
      );
    case 'list':
      return block.ordered ? (
        <ol
          key={`list-${blockIndex}`}
          style={{
            margin: 0,
            paddingLeft: '1.4rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          {block.items.map((item, itemIndex) => (
            <li key={`ordered-${blockIndex}-${itemIndex}`} style={{ lineHeight: 1.65 }}>
              <span style={{ whiteSpace: 'pre-wrap' }}>{renderInline(item, `ordered-${blockIndex}-${itemIndex}`, sources)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <ul
          key={`list-${blockIndex}`}
          style={{
            margin: 0,
            paddingLeft: '1.4rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          {block.items.map((item, itemIndex) => (
            <li key={`unordered-${blockIndex}-${itemIndex}`} style={{ lineHeight: 1.65 }}>
              <span style={{ whiteSpace: 'pre-wrap' }}>{renderInline(item, `unordered-${blockIndex}-${itemIndex}`, sources)}</span>
            </li>
          ))}
        </ul>
      );
    case 'quote':
      return (
        <blockquote
          key={`quote-${blockIndex}`}
          style={{
            margin: 0,
            padding: '0.2rem 0 0.2rem 1rem',
            borderLeft: '3px solid var(--accent-border)',
            color: 'var(--text-secondary)',
            lineHeight: 1.7,
          }}
        >
          {block.lines.map((line, lineIndex) => (
            <div key={`quote-${blockIndex}-${lineIndex}`} style={{ whiteSpace: 'pre-wrap' }}>
              {renderInline(line, `quote-${blockIndex}-${lineIndex}`, sources)}
            </div>
          ))}
        </blockquote>
      );
    case 'table':
      return (
        <div key={`table-${blockIndex}`} style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              overflow: 'hidden',
              fontSize: '0.9rem',
            }}
          >
            <thead>
              <tr>
                {block.headers.map((header, headerIndex) => (
                  <th
                    key={`table-${blockIndex}-header-${headerIndex}`}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      background: 'rgba(255,255,255,0.05)',
                      borderBottom: '1px solid var(--border-color)',
                      fontWeight: 700,
                      verticalAlign: 'top',
                    }}
                  >
                    <span style={{ whiteSpace: 'pre-wrap' }}>{renderInline(header, `table-${blockIndex}-header-${headerIndex}`, sources)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`table-${blockIndex}-row-${rowIndex}`}>
                  {block.headers.map((_, cellIndex) => {
                    const cell = row[cellIndex] ?? '';
                    return (
                      <td
                        key={`table-${blockIndex}-row-${rowIndex}-cell-${cellIndex}`}
                        style={{
                          textAlign: 'left',
                          padding: '10px 12px',
                          borderBottom: '1px solid var(--border-color)',
                          verticalAlign: 'top',
                        }}
                      >
                        <span style={{ whiteSpace: 'pre-wrap' }}>{renderInline(cell, `table-${blockIndex}-row-${rowIndex}-cell-${cellIndex}`, sources)}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'code':
      return (
        <CodeBlock key={`code-${blockIndex}`} info={block.info} code={block.code} blockIndex={blockIndex} />
      );
    case 'rule':
      return (
        <hr
          key={`rule-${blockIndex}`}
          style={{
            width: '100%',
            border: 0,
            borderTop: '1px solid var(--border-color)',
            margin: '0.25rem 0',
          }}
        />
      );
    default:
      return null;
  }
}

function shouldRenderStructured(content: string, presentation?: ResponsePresentation): boolean {
  if (presentation?.mode && presentation.mode !== 'general') return true;

  return (
    content.includes('```')
    || /!\[[^\]]*\]\([^)]+\)/.test(content)
    || /^#{1,6}\s+\S/m.test(content)
    || /^\s*(?:[-*+•]|\d+\.)\s+\S/m.test(content)
    || /\n\s*\|.+\|\s*\n\s*\|[\s:-|]+\|/m.test(content)
    || /^\s*>\s+\S/m.test(content)
  );
}

export default function AssistantContent({
  content,
  presentation,
  sources,
}: {
  content: string;
  presentation?: ResponsePresentation;
  sources?: MessageSource[];
}) {
  const normalizedContent = normalizeAssistantResponseContent(content, presentation);

  if (!shouldRenderStructured(normalizedContent, presentation)) {
    return <span style={{ whiteSpace: 'pre-wrap', lineHeight: '1.7' }}>{renderInline(normalizedContent, 'plain', sources)}</span>;
  }

  const mode = presentation?.mode ?? 'general';

  if (mode === 'data') {
    return (
      <div
        style={{
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          background: 'rgba(255,255,255,0.03)',
          padding: '12px',
          overflowX: 'auto',
        }}
      >
        <pre
          style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: '0.86rem',
            lineHeight: 1.65,
          }}
        >
          <code>{prettyPrintData(normalizedContent, presentation)}</code>
        </pre>
      </div>
    );
  }

  if (mode === 'code') {
    return (
      <div
        style={{
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          background: 'rgba(255,255,255,0.03)',
          padding: '12px',
          overflowX: 'auto',
        }}
      >
        <pre
          style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: '0.86rem',
            lineHeight: 1.65,
          }}
        >
          <code>{normalizedContent}</code>
        </pre>
      </div>
    );
  }

  const blocks = parseStructuredBlocks(normalizedContent);

  if (!blocks.length) {
    return <span style={{ whiteSpace: 'pre-wrap', lineHeight: '1.7' }}>{normalizedContent}</span>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {blocks.map((block, blockIndex) => renderBlock(block, blockIndex, sources))}
    </div>
  );
}
