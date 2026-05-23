"use client";

import React, { useState, useCallback } from 'react';
import { 
  Code, FileText, Image, Edit2, Save, X, ChevronDown, ChevronUp,
  Copy, Check, Download, FileJson, FileSpreadsheet, Eye
} from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ObjectUrlImage from './ObjectUrlImage';

interface CanvasArtifact {
  id: string;
  name: string;
  content: string;
  mimeType: string;
  kind: string;
  extension: string | null;
  size: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface CanvasPreviewProps {
  artifact: CanvasArtifact;
  onUpdate?: (id: string, content: string, name: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onDownload?: (artifact: CanvasArtifact) => void;
}

const LANGUAGE_MAP: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  cs: 'csharp',
  cpp: 'cpp',
  c: 'c',
  h: 'c',
  css: 'css',
  scss: 'scss',
  html: 'html',
  xml: 'xml',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  toml: 'toml',
};

const MIME_KIND_MAP: Record<string, string> = {
  'text/x-python': 'python',
  'text/x-java': 'java',
  'text/x-csharp': 'csharp',
  'text/x-c': 'c',
  'text/x-c++': 'cpp',
  'text/x-rust': 'rust',
  'text/x-go': 'go',
  'text/x-shellscript': 'bash',
  'text/x-yaml': 'yaml',
  'application/json': 'json',
  'application/xml': 'xml',
  'text/html': 'html',
  'text/css': 'css',
  'text/x-sql': 'sql',
};

function getLanguage(filename: string, mimeType: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (LANGUAGE_MAP[ext]) return LANGUAGE_MAP[ext];
  return MIME_KIND_MAP[mimeType] || 'text';
}

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

function isMarkdown(mimeType: string, extension: string | null): boolean {
  return mimeType === 'text/markdown' || extension === 'md' || extension === 'markdown';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function renderMarkdown(content: string): string {
  // Basic markdown rendering - convert to HTML-like structure
  let html = content
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="code-block"><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold/italic
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // Lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    // Line breaks
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');
  
  return `<p>${html}</p>`;
}

function buildCollapsedPreview(content: string, maxChars = 1600, maxLines = 28): string {
  const normalized = content.trim();
  if (!normalized) return 'No preview available.';

  const previewLines = normalized.split('\n').slice(0, maxLines);
  const preview = previewLines.join('\n').slice(0, maxChars);
  return preview.length < normalized.length ? `${preview}\n…` : preview;
}

export default function CanvasPreview({ artifact, onUpdate, onDelete, onDownload }: CanvasPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(artifact.content);
  const [editName, setEditName] = useState(artifact.name);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isImage = isImageMime(artifact.mimeType);
  const isMarkdownFile = isMarkdown(artifact.mimeType, artifact.extension);
  const isCode = !isImage && !isMarkdownFile && (
    artifact.mimeType.startsWith('text/') || 
    artifact.mimeType === 'application/json' ||
    artifact.mimeType === 'application/xml'
  );
  const language = getLanguage(artifact.name, artifact.mimeType);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(artifact.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Failed to copy to clipboard');
    }
  }, [artifact.content]);

  const handleSave = useCallback(async () => {
    if (!onUpdate) return;
    setSaving(true);
    setError(null);
    try {
      await onUpdate(artifact.id, editContent, editName);
      setEditing(false);
    } catch (err) {
      setError('Failed to save changes');
    } finally {
      setSaving(false);
    }
  }, [artifact.id, editContent, editName, onUpdate]);

  const handleCancel = useCallback(() => {
    setEditContent(artifact.content);
    setEditName(artifact.name);
    setEditing(false);
    setError(null);
  }, [artifact.content, artifact.name]);

  const handleDownload = useCallback(() => {
    onDownload?.(artifact);
  }, [artifact, onDownload]);

  const getKindIcon = () => {
    if (isImage) return <Image size={14} />;
    if (isMarkdownFile) return <FileText size={14} />;
    if (artifact.kind === 'data' || artifact.mimeType === 'application/json') return <FileJson size={14} />;
    if (artifact.mimeType === 'text/csv') return <FileSpreadsheet size={14} />;
    return <Code size={14} />;
  };

  const renderPreview = () => {
    if (isImage) {
      return (
        <div className="canvas-preview-image">
          <ObjectUrlImage
            base64Data={artifact.content}
            mimeType={artifact.mimeType}
            alt={artifact.name}
            style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '8px' }}
          />
        </div>
      );
    }

    if (isMarkdownFile) {
      if (editing) {
        return (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            style={{
              width: '100%',
              minHeight: '200px',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '12px',
              fontFamily: 'monospace',
              fontSize: '0.85rem',
              resize: 'vertical'
            }}
          />
        );
      }
      if (!expanded) {
        return (
          <pre
            style={{
              padding: '12px',
              lineHeight: 1.6,
              fontSize: '0.85rem',
              background: 'var(--bg-secondary)',
              borderRadius: '8px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {buildCollapsedPreview(artifact.content)}
          </pre>
        );
      }
      return (
        <div 
          className="canvas-preview-markdown"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(artifact.content) }}
          style={{
            padding: '12px',
            lineHeight: 1.6,
            fontSize: '0.9rem'
          }}
        />
      );
    }

    if (isCode) {
      if (editing) {
        return (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            style={{
              width: '100%',
              minHeight: '200px',
              background: '#282c34',
              color: '#abb2bf',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '12px',
              fontFamily: 'monospace',
              fontSize: '0.85rem',
              resize: 'vertical'
            }}
          />
        );
      }
      if (!expanded) {
        return (
          <pre
            style={{
              width: '100%',
              minHeight: '200px',
              background: '#161922',
              color: '#abb2bf',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '12px',
              fontFamily: 'monospace',
              fontSize: '0.85rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {buildCollapsedPreview(artifact.content, 2200, 36)}
          </pre>
        );
      }
      return (
        <SyntaxHighlighter
          language={language}
          style={oneDark}
          customStyle={{
            margin: 0,
            borderRadius: '8px',
            fontSize: '0.8rem',
            maxHeight: expanded ? 'none' : '300px',
            overflow: expanded ? 'visible' : 'auto'
          }}
          wrapLongLines
        >
          {artifact.content}
        </SyntaxHighlighter>
      );
    }

    // Plain text or unknown
    return (
      <pre style={{
        padding: '12px',
        background: 'var(--bg-secondary)',
        borderRadius: '8px',
        fontSize: '0.8rem',
        maxHeight: expanded ? 'none' : '150px',
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word'
      }}>
        {artifact.content.slice(0, 2000)}
        {artifact.content.length > 2000 && !expanded && '\n\n... (truncated)'}
      </pre>
    );
  };

  return (
    <div className="canvas-preview-card" style={{
      border: '1px solid var(--border-color)',
      borderRadius: '12px',
      background: 'var(--bg-secondary)',
      overflow: 'hidden',
      marginBottom: '12px'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 12px',
        borderBottom: '1px solid var(--border-color)',
        background: 'rgba(255,255,255,0.02)'
      }}>
        <span style={{ color: 'var(--accent-primary)' }}>{getKindIcon()}</span>
        {editing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            style={{
              flex: 1,
              background: 'transparent',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              padding: '4px 8px',
              color: 'var(--text-primary)',
              fontSize: '0.85rem'
            }}
          />
        ) : (
          <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {artifact.name}
          </span>
        )}
        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
          {formatBytes(artifact.size)}
        </span>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
          v{artifact.version}
        </span>
      </div>

      {/* Preview Content */}
      <div style={{ padding: '12px' }}>
        {error && (
          <div style={{
            padding: '8px 12px',
            marginBottom: '8px',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid var(--danger)',
            borderRadius: '6px',
            color: 'var(--danger)',
            fontSize: '0.8rem'
          }}>
            {error}
          </div>
        )}
        {renderPreview()}
      </div>

      {/* Actions */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '8px 12px',
        borderTop: '1px solid var(--border-color)',
        background: 'rgba(255,255,255,0.01)'
      }}>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 8px',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            background: 'transparent',
            color: 'var(--text-secondary)',
            fontSize: '0.75rem',
            cursor: 'pointer'
          }}
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? 'Collapse' : 'Expand'}
        </button>

        <button
          type="button"
          onClick={handleCopy}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 8px',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            background: 'transparent',
            color: copied ? '#10b981' : 'var(--text-secondary)',
            fontSize: '0.75rem',
            cursor: 'pointer'
          }}
          title="Copy to clipboard"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>

        <button
          type="button"
          onClick={handleDownload}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 8px',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            background: 'transparent',
            color: 'var(--text-secondary)',
            fontSize: '0.75rem',
            cursor: 'pointer'
          }}
          title="Download artifact"
        >
          <Download size={12} />
          Download
        </button>

        {onUpdate && (
          editing ? (
            <>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  border: '1px solid #10b981',
                  borderRadius: '6px',
                  background: 'rgba(16,185,129,0.15)',
                  color: '#10b981',
                  fontSize: '0.75rem',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.6 : 1
                }}
              >
                {saving ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={12} />}
                Save
              </button>
              <button
                type="button"
                onClick={handleCancel}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  fontSize: '0.75rem',
                  cursor: 'pointer'
                }}
              >
                <X size={12} />
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                background: 'transparent',
                color: 'var(--text-secondary)',
                fontSize: '0.75rem',
                cursor: 'pointer'
              }}
              title="Edit artifact"
            >
              <Edit2 size={12} />
              Edit
            </button>
          )
        )}

        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(artifact.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              border: '1px solid var(--danger)',
              borderRadius: '6px',
              background: 'transparent',
              color: 'var(--danger)',
              fontSize: '0.75rem',
              cursor: 'pointer',
              marginLeft: 'auto'
            }}
            title="Delete artifact"
          >
            <X size={12} />
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// Loading spinner component
function Loader2({ size, style }: { size: number; style?: React.CSSProperties }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2"
      style={{ animation: 'spin 1s linear infinite', ...style }}
    >
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  );
}
