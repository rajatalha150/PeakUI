"use client";

import React from 'react';
import { Check, Download, FileText, Loader2, ChevronDown, Globe } from 'lucide-react';
import {
  getResponseDownloadExtension,
  getResponseDownloadMimeType,
  type ResponsePresentation,
} from '@/lib/response-format';
import { normalizeAssistantResponseContent } from '@/lib/response-normalizer';
import type { MessageSource } from '@/lib/message-sources';
import AssistantContent from './AssistantContent';

type GeneratedFile = {
  name: string;
  content: string;
  mimeType: string;
  binary: boolean;
};

type ImageDisplayFile = {
  name: string;
  dataUrl: string;
  mimeType: string;
  width?: number;
  height?: number;
  url?: string; // For external URLs
};

const MIME_BY_EXTENSION: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  jsx: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  json: 'application/json',
  csv: 'text/csv',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function sanitizeDownloadName(name: string, fallback: string) {
  const base = name.trim().split(/[\\/]/).pop()?.replace(/[^\w.\- ()[\]]+/g, '_') || fallback;
  return base.includes('.') ? base : fallback;
}

function inferMimeType(filename: string, binary: boolean) {
  const extension = filename.split('.').pop()?.toLowerCase() || '';
  return MIME_BY_EXTENSION[extension] || (binary ? 'application/octet-stream' : 'text/plain');
}

function getFilenameFromFence(info: string, body: string, index: number): { filename: string; body: string } | null {
  const metaMatch = info.match(/\b(?:file(?:name)?|path)\s*=\s*["']([^"']+)["']/i)
    || info.match(/\b(?:file(?:name)?|path)\s*=\s*([^\s]+)/i);
  if (metaMatch?.[1]) {
    const filename = sanitizeDownloadName(metaMatch[1], `generated-file-${index}.txt`);
    return { filename, body };
  }

  const firstLine = body.split(/\r?\n/, 1)[0] || '';
  const fileLineMatch = firstLine.match(/^\s*(?:\/\/|#|--|;|<!--|\/\*)\s*(?:file|filename|path):\s*([^*>\n]+?)(?:\s*\*\/|\s*-->)?\s*$/i);
  if (fileLineMatch?.[1]) {
    const filename = sanitizeDownloadName(fileLineMatch[1], `generated-file-${index}.txt`);
    return { filename, body: body.replace(firstLine, '').replace(/^\r?\n/, '') };
  }

  const likelyFilename = info
    .split(/\s+/)
    .find(part => /^[\w./\\()[\] -]+\.[A-Za-z0-9]{1,12}$/.test(part));

  if (!likelyFilename) return null;
  return {
    filename: sanitizeDownloadName(likelyFilename, `generated-file-${index}.txt`),
    body,
  };
}

export function extractGeneratedFiles(content: string): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const fenceRegex = /```([^\n\r`]*)\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let index = 1;

  while ((match = fenceRegex.exec(content)) !== null && files.length < 12) {
    const info = match[1] || '';
    const body = match[2] || '';
    const parsed = getFilenameFromFence(info, body, index);
    if (!parsed) continue;

    const binary = /\bbase64\b/i.test(info);
    files.push({
      name: parsed.filename,
      content: parsed.body.trim(),
      mimeType: inferMimeType(parsed.filename, binary),
      binary,
    });
    index += 1;
  }

  return files;
}


function extractInlineImages(content: string): ImageDisplayFile[] {
  const images: ImageDisplayFile[] = [];
  
  // Match markdown image syntax with external URLs (https/http)
  const mdExternalRegex = /!\[([^\]]*)\]\(https?:\/\/([^)\s]+)\)/g;
  let match;
  while ((match = mdExternalRegex.exec(content)) !== null && images.length < 20) {
    const alt = match[1] || 'Generated image';
    const url = match[2];
    // Determine extension from URL
    const urlParts = url.split('/');
    const filename = urlParts[urlParts.length - 1] || 'image';
    const ext = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() : 'jpg';
    const mimeType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    images.push({
      name: alt.includes('.') ? alt : `${alt}.${ext}`,
      dataUrl: `https://${url}`,
      mimeType,
      url: `https://${url}`,
    });
  }
  
  // Match markdown image syntax: ![alt](data:image/...;base64,...)
  const mdImageRegex = /!\[([^\]]*)\]\(data:([^;]+);base64,([^)\s]+)\)/g;
  while ((match = mdImageRegex.exec(content)) !== null && images.length < 20) {
    const alt = match[1] || 'Generated image';
    const mimeType = match[2];
    const base64 = match[3];
    const extension = mimeType?.split('/')[1] || 'png';
    const name = alt.includes('.') ? alt : `${alt}.${extension}`;
    images.push({
      name,
      dataUrl: `data:${mimeType};base64,${base64}`,
      mimeType,
    });
  }
  
  // Also match standalone base64 data URLs that might be images
  const base64ImgRegex = /(?:^|\n)\s*<img[^>]+src=["']data:([^"']+)["'][^>]*>/gi;
  while ((match = base64ImgRegex.exec(content)) !== null && images.length < 20) {
    try {
      const parts = match[1].split(';base64,');
      if (parts.length === 2) {
        const mimeType = parts[0];
        const base64 = parts[1];
        images.push({
          name: `generated-image-${images.length + 1}.${mimeType.split('/')[1] || 'png'}`,
          dataUrl: `data:${mimeType};base64,${base64}`,
          mimeType,
        });
      }
    } catch {}
  }
  
  return images;
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadGeneratedFile(file: GeneratedFile) {
  if (!file.binary) {
    downloadBlob(file.name, new Blob([file.content], { type: file.mimeType }));
    return;
  }

  try {
    const cleanBase64 = file.content.replace(/\s+/g, '');
    const raw = atob(cleanBase64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    downloadBlob(file.name, new Blob([bytes], { type: file.mimeType }));
  } catch {
    downloadBlob(`${file.name}.txt`, new Blob([file.content], { type: 'text/plain' }));
  }
}


export function ThinkingBlock({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const [open, setOpen] = React.useState(true);
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

  React.useEffect(() => {
    const timer = setTimeout(() => setOpen(isStreaming), isStreaming ? 0 : 800);
    return () => clearTimeout(timer);
  }, [isStreaming]);

  return (
    <div style={{
      marginBottom: '12px',
      borderRadius: '10px',
      border: '1px solid var(--accent-border)',
      overflow: 'hidden',
      background: 'var(--accent-faint)'
    }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          cursor: 'pointer',
          userSelect: 'none',
          borderBottom: open ? '1px solid var(--accent-soft)' : 'none',
        }}
      >
        {isStreaming
          ? <Loader2 size={13} color="var(--accent-primary)" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
          : <ChevronDown size={13} color="var(--accent-primary)" style={{ flexShrink: 0, transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s' }} />
        }
        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent-primary)', letterSpacing: '0.5px' }}>
          {isStreaming ? 'Thinking…' : 'Thought process'}
        </span>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {wordCount} words {!open && !isStreaming ? '· click to expand' : ''}
        </span>
      </div>

      {open && (
        <div style={{
          padding: '10px 14px',
          fontSize: '0.82rem',
          color: 'var(--text-secondary)',
          fontStyle: 'italic',
          lineHeight: 1.65,
          whiteSpace: 'pre-wrap',
          maxHeight: '260px',
          overflowY: 'auto',
        }}>
          {content}
          {isStreaming && <span style={{ opacity: 0.5 }}> ▍</span>}
        </div>
      )}
    </div>
  );
}

function parseThinkSegments(content: string, presentation?: ResponsePresentation, sources?: MessageSource[]): React.ReactNode[] {
  const elements: React.ReactNode[] = [];

  if (!content.includes('<think>')) {
    elements.push(<AssistantContent key="content" content={content} presentation={presentation} sources={sources} />);
    return elements;
  }

  const openIdx = content.indexOf('<think>');
  const closeIdx = content.indexOf('</think>');

  if (openIdx !== -1 && closeIdx === -1) {
    const before = content.slice(0, openIdx);
    const thinkContent = content.slice(openIdx + 7);
    if (before) elements.push(<AssistantContent key="before" content={before} presentation={presentation} sources={sources} />);
    if (thinkContent) elements.push(<ThinkingBlock key="thinking" content={thinkContent} isStreaming={true} />);
    return elements;
  }

  const parts = content.split(/(<think>|<\/think>)/);
  let insideThink = false;
  let thinkBuffer = '';
  let partIdx = 0;

  for (const part of parts) {
    if (part === '<think>') {
      insideThink = true;
      thinkBuffer = '';
      continue;
    }

    if (part === '</think>') {
      insideThink = false;
      if (thinkBuffer.trim()) {
        elements.push(<ThinkingBlock key={`think-${partIdx++}`} content={thinkBuffer} isStreaming={false} />);
      }
      thinkBuffer = '';
      continue;
    }

    if (!part) continue;

    if (insideThink) {
      thinkBuffer += part;
    } else {
      elements.push(<AssistantContent key={`text-${partIdx++}`} content={part} presentation={presentation} sources={sources} />);
    }
  }

  return elements;
}



function ImageGallery({ images, sessionId, messageId, persistedImageIds, saveImageToCanvas, savingIds }: { 
  images: ImageDisplayFile[]; 
  sessionId?: string | null;
  messageId?: string | null;
  persistedImageIds: Record<number, string>;
  saveImageToCanvas: (image: ImageDisplayFile, index: number) => void;
  savingIds: Record<string, boolean>;
}) {
  if (images.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '8px 0' }}>
      {images.map((img, i) => (
        <div key={i} style={{ position: 'relative' }}>
          <img
            src={img.url || img.dataUrl}
            alt={img.name}
            style={{
              maxWidth: '200px',
              maxHeight: '200px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              objectFit: 'cover',
            }}
            onClick={() => window.open(img.url || img.dataUrl, '_blank')}
            title="Click to view full size"
          />
          {img.url ? (
            <div style={{ position: 'absolute', top: '4px', right: '4px', display: 'flex', gap: '2px' }}>
              <button
                type="button"
                onClick={() => window.open(img.url, '_blank')}
                style={{
                  background: 'rgba(0,0,0,0.7)',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px',
                  cursor: 'pointer',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                }}
                title="Open in new tab"
              >
                <Globe size={12} />
              </button>
              <button
                type="button"
                onClick={() => {
                  const link = document.createElement('a');
                  link.href = img.url || img.dataUrl;
                  link.download = img.name;
                  link.click();
                }}
                style={{
                  background: 'rgba(0,0,0,0.7)',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px',
                  cursor: 'pointer',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                }}
                title="Download image"
              >
                <Download size={12} />
              </button>
            </div>
          ) : (
            <div style={{ position: 'absolute', top: '4px', right: '4px', display: 'flex', gap: '2px' }}>
              <button
                type="button"
                onClick={() => saveImageToCanvas(img, i)}
                disabled={!sessionId || !!persistedImageIds[i] || !!savingIds['img-' + i]}
                style={{
                  background: persistedImageIds[i] ? 'rgba(16,185,129,0.8)' : 'rgba(0,0,0,0.7)',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px',
                  cursor: (!sessionId || persistedImageIds[i] || savingIds['img-' + i]) ? 'not-allowed' : 'pointer',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  opacity: (!sessionId || persistedImageIds[i] || savingIds['img-' + i]) ? 0.6 : 1,
                }}
                title={persistedImageIds[i] ? 'Saved to Canvas' : 'Save to Canvas'}
              >
                {savingIds['img-' + i] ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={12} />}
              </button>
              <button
                type="button"
                onClick={() => {
                  const link = document.createElement('a');
                  link.href = img.dataUrl;
                  link.download = img.name;
                  link.click();
                }}
                style={{
                  background: 'rgba(0,0,0,0.7)',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px',
                  cursor: 'pointer',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                }}
                title="Download image"
              >
                <Download size={12} />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function ChatMessageContent({
  content,
  isStreaming,
  isLast,
  presentation,
  sources,
}: {
  content: string;
  isStreaming: boolean;
  isLast: boolean;
  presentation?: ResponsePresentation;
  sources?: MessageSource[];
}) {
  const normalizedContent = normalizeAssistantResponseContent(content, presentation);

  if (!normalizedContent) {
    if (isStreaming && isLast) return <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />;
    return null;
  }

  return <>{parseThinkSegments(normalizedContent, presentation, sources)}</>;
}

export function AssistantDownloads({
  content,
  index,
  presentation,
  showImages = true,
  sessionId,
  messageId,
  onPersisted,
}: {
  content: string;
  index: number;
  presentation?: ResponsePresentation;
  showImages?: boolean;
  sessionId?: string | null;
  messageId?: string | null;
  onPersisted?: (artifacts: { name: string; id: string }[]) => void;
}) {
  const normalizedContent = normalizeAssistantResponseContent(content, presentation);
  const generatedFiles = extractGeneratedFiles(normalizedContent);
  const inlineImages = showImages ? extractInlineImages(normalizedContent) : [];
  const [persistedIds, setPersistedIds] = React.useState<Record<string, string>>({});
  const [savingIds, setSavingIds] = React.useState<Record<string, boolean>>({});
  const [persistedImageIds, setPersistedImageIds] = React.useState<Record<number, string>>({});

  const saveImageToCanvas = React.useCallback(async (image: ImageDisplayFile, index: number) => {
    if (!sessionId || persistedImageIds[index] || savingIds['img-' + index]) return;
    setSavingIds(prev => ({ ...prev, ['img-' + index]: true }));
    try {
      const base64Data = image.dataUrl.split(',')[1] || '';
      const res = await fetch('/api/canvas/artifacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: image.name,
          content: base64Data,
          mimeType: image.mimeType,
          kind: 'diagram',
          extension: image.mimeType.split('/')[1] || 'png',
          sessionId,
          messageId: messageId || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setPersistedImageIds(prev => ({ ...prev, [index]: data.artifact.id }));
        onPersisted?.([{ name: image.name, id: data.artifact.id }]);
      }
    } finally {
      setSavingIds(prev => { const next = { ...prev }; delete next['img-' + index]; return next; });
    }
  }, [sessionId, messageId, persistedImageIds, savingIds, onPersisted]);

  if (!normalizedContent.trim() && generatedFiles.length === 0 && inlineImages.length === 0) return null;

  const downloadExtension = getResponseDownloadExtension(presentation ?? { mode: 'general' });
  const downloadMimeType = getResponseDownloadMimeType(presentation ?? { mode: 'general' });

  const saveToCanvas = React.useCallback(async (file: GeneratedFile) => {
    if (!sessionId || persistedIds[file.name] || savingIds[file.name]) return;
    setSavingIds(prev => ({ ...prev, [file.name]: true }));
    try {
      const res = await fetch('/api/canvas/artifacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          content: file.content,
          mimeType: file.mimeType,
          kind: inferArtifactKind(file.name, file.mimeType),
          extension: file.name.split('.').pop() || null,
          sessionId,
          messageId: messageId || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setPersistedIds(prev => ({ ...prev, [file.name]: data.artifact.id }));
        onPersisted?.([{ name: file.name, id: data.artifact.id }]);
      }
    } finally {
      setSavingIds(prev => { const next = { ...prev }; delete next[file.name]; return next; });
    }
  }, [sessionId, messageId, persistedIds, savingIds, onPersisted]);

  return (
    <div style={{
      marginTop: '12px',
      paddingTop: '10px',
      borderTop: '1px solid var(--border-color)',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px'
    }}>
      {inlineImages.length > 0 && (
        <ImageGallery 
          images={inlineImages}
          sessionId={sessionId}
          messageId={messageId}
          persistedImageIds={persistedImageIds}
          saveImageToCanvas={saveImageToCanvas}
          savingIds={savingIds}
        />
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        <button
          type="button"
          onClick={() => downloadBlob('assistant-response-' + (index + 1) + '.' + downloadExtension, new Blob([normalizedContent], { type: downloadMimeType }))}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '4px 9px', borderRadius: '8px',
            border: '1px solid var(--border-color)',
            background: 'rgba(255,255,255,0.04)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '0.72rem'
          }}
        >
          <Download size={12} /> response.{downloadExtension}
        </button>
        {generatedFiles.map(file => (
          <button
            key={file.name}
            type="button"
            onClick={() => { downloadGeneratedFile(file); saveToCanvas(file); }}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '4px 9px', borderRadius: '8px',
              border: '1px solid var(--accent-border)',
              background: persistedIds[file.name] ? 'rgba(16,185,129,0.15)' : 'var(--accent-faint)',
              color: persistedIds[file.name] ? '#10b981' : 'var(--accent-primary)',
              cursor: 'pointer',
              fontSize: '0.72rem'
            }}
            title={file.binary ? 'Download decoded base64 file' : 'Download generated file'}
          >
            {savingIds[file.name] ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : persistedIds[file.name] ? <Check size={12} /> : <FileText size={12} />}
            {file.name}{persistedIds[file.name] ? ' (saved)' : ''}
          </button>
        ))}
      </div>
    </div>
  );
}

function inferArtifactKind(name: string, mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'diagram';
  if (mimeType === 'text/markdown') return 'markdown';
  const ext = name.split('.').pop()?.toLowerCase();
  if (['json', 'csv', 'xml', 'yaml', 'yml'].includes(ext || '')) return 'data';
  return 'file';
}
