"use client";

import React, { useState, useCallback } from 'react';
import { 
  Code, FileText, Image, Edit2, Save, X, ChevronDown, ChevronUp,
  Copy, Check, Download, FileJson, FileSpreadsheet, Eye, Loader2,
  Plus, Grid, List
} from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ObjectUrlImage from './ObjectUrlImage';
import VirtualizedList from './VirtualizedList';

export interface CanvasArtifactData {
  id: string;
  name: string;
  content?: string;
  mimeType: string;
  kind: string;
  extension: string | null;
  size: number;
  sessionId: string;
  messageId: string | null;
  version: number;
  createdAt: string;
  updatedAt?: string;
}

interface CanvasPanelProps {
  artifacts: CanvasArtifactData[];
  onUpdate: (id: string, content: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDownload: (artifact: CanvasArtifactData) => void;
  onFetchContent: (id: string) => Promise<CanvasArtifactData | null>;
}

const LANGUAGE_MAP: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java', cs: 'csharp',
  cpp: 'cpp', c: 'c', h: 'c', css: 'css', scss: 'scss', html: 'html',
  xml: 'xml', json: 'json', yaml: 'yaml', yml: 'yaml', md: 'markdown',
  sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell',
  toml: 'toml',
};

function getLanguage(filename: string, mimeType: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (LANGUAGE_MAP[ext]) return LANGUAGE_MAP[ext];
  if (mimeType.includes('python')) return 'python';
  if (mimeType.includes('json')) return 'json';
  if (mimeType.includes('xml')) return 'xml';
  if (mimeType.includes('html')) return 'html';
  if (mimeType.includes('css')) return 'css';
  if (mimeType.includes('javascript')) return 'javascript';
  if (mimeType.includes('typescript')) return 'typescript';
  return 'text';
}

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

function isMarkdownFile(mimeType: string, extension: string | null): boolean {
  return mimeType === 'text/markdown' || extension === 'md' || extension === 'markdown';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function buildCollapsedPreview(content: string, maxChars = 1600, maxLines = 28): string {
  const normalized = content.trim();
  if (!normalized) return 'No preview available.';

  const previewLines = normalized.split('\n').slice(0, maxLines);
  const preview = previewLines.join('\n').slice(0, maxChars);
  return preview.length < normalized.length ? `${preview}\n…` : preview;
}

// Simple markdown to HTML converter
function renderMarkdown(content: string): string {
  let html = content
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="code-block"><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');
  return `<p>${html}</p>`;
}

interface ArtifactCardProps {
  artifact: CanvasArtifactData;
  expanded: boolean;
  editing: boolean;
  editContent: string;
  editName: string;
  onToggleExpand: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => Promise<void>;
  onContentChange: (content: string) => void;
  onNameChange: (name: string) => void;
  onCopy: () => void;
  onDownload: () => void;
  onDelete: () => void;
  copied: boolean;
  saving: boolean;
  error: string | null;
}

function ArtifactCard({
  artifact, expanded, editing, editContent, editName,
  onToggleExpand, onStartEdit, onCancelEdit, onSaveEdit,
  onContentChange, onNameChange, onCopy, onDownload, onDelete,
  copied, saving, error
}: ArtifactCardProps) {
  const isImage = isImageMime(artifact.mimeType);
  const isMarkdown = isMarkdownFile(artifact.mimeType, artifact.extension);
  const isCode = !isImage && !isMarkdown && (
    artifact.mimeType.startsWith('text/') || 
    artifact.mimeType === 'application/json' ||
    artifact.mimeType === 'application/xml'
  );
  const language = getLanguage(artifact.name, artifact.mimeType);

  const getKindIcon = () => {
    if (isImage) return <Image size={14} />;
    if (isMarkdown) return <FileText size={14} />;
    if (artifact.kind === 'data' || artifact.mimeType === 'application/json') return <FileJson size={14} />;
    if (artifact.mimeType === 'text/csv') return <FileSpreadsheet size={14} />;
    return <Code size={14} />;
  };

  const renderPreview = () => {
    if (isImage) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', background: '#1a1a2e', borderRadius: '8px', padding: '12px' }}>
          <ObjectUrlImage
            base64Data={artifact.content || ''}
            mimeType={artifact.mimeType}
            alt={artifact.name}
            style={{ maxWidth: '100%', maxHeight: expanded ? 'none' : '200px', borderRadius: '6px' }}
          />
        </div>
      );
    }

    if (isMarkdown) {
      if (editing) {
        return (
          <textarea
            value={editContent}
            onChange={(e) => onContentChange(e.target.value)}
            style={{
              width: '100%', minHeight: '150px',
              background: 'var(--bg-secondary)', color: 'var(--text-primary)',
              border: '1px solid var(--border-color)', borderRadius: '8px',
              padding: '12px', fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical'
            }}
          />
        );
      }
      if (!expanded) {
        return (
          <pre style={{
            padding: '12px',
            background: 'var(--bg-secondary)',
            borderRadius: '8px',
            fontSize: '0.78rem',
            lineHeight: 1.55,
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {buildCollapsedPreview(artifact.content || '')}
          </pre>
        );
      }
      return (
        <div 
          dangerouslySetInnerHTML={{ __html: renderMarkdown(artifact.content || '') }}
          style={{ padding: '12px', lineHeight: 1.6, fontSize: '0.85rem', maxHeight: expanded ? 'none' : '200px', overflow: 'auto' }}
        />
      );
    }

    if (isCode) {
      if (editing) {
        return (
          <textarea
            value={editContent}
            onChange={(e) => onContentChange(e.target.value)}
            style={{
              width: '100%', minHeight: '150px',
              background: '#282c34', color: '#abb2bf',
              border: '1px solid var(--border-color)', borderRadius: '8px',
              padding: '12px', fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical'
            }}
          />
        );
      }
      if (!expanded) {
        return (
          <pre style={{
            padding: '12px',
            background: '#161922',
            color: '#abb2bf',
            borderRadius: '8px',
            fontSize: '0.75rem',
            lineHeight: 1.55,
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}>
            {buildCollapsedPreview(artifact.content || '', 2200, 36)}
          </pre>
        );
      }
      return (
        <SyntaxHighlighter
          language={language}
          style={oneDark}
          customStyle={{
            margin: 0, borderRadius: '8px', fontSize: '0.75rem',
            maxHeight: expanded ? 'none' : '200px',
            overflow: expanded ? 'visible' : 'auto'
          }}
          wrapLongLines
        >
          {artifact.content || ''}
        </SyntaxHighlighter>
      );
    }

    const content = artifact.content || '';
    return (
      <pre style={{
        padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px',
        fontSize: '0.75rem', maxHeight: expanded ? 'none' : '100px',
        overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
      }}>
        {content.slice(0, expanded ? undefined : 500)}
        {!expanded && content.length > 500 && '...\n(truncated)'}
      </pre>
    );
  };

  return (
    <div style={{
      border: '1px solid var(--border-color)', borderRadius: '12px',
      background: 'var(--bg-secondary)', overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 10px', borderBottom: '1px solid var(--border-color)',
        background: 'rgba(255,255,255,0.02)'
      }}>
        <span style={{ color: 'var(--accent-primary)', flexShrink: 0 }}>{getKindIcon()}</span>
        {editing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => onNameChange(e.target.value)}
            style={{
              flex: 1, background: 'transparent', border: '1px solid var(--border-color)',
              borderRadius: '4px', padding: '2px 6px', color: 'var(--text-primary)', fontSize: '0.8rem'
            }}
          />
        ) : (
          <span style={{ flex: 1, fontSize: '0.8rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {artifact.name}
          </span>
        )}
        <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', flexShrink: 0 }}>
          {formatBytes(artifact.size)}
        </span>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', flexShrink: 0 }}>
          v{artifact.version}
        </span>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          padding: '6px 10px', background: 'rgba(239,68,68,0.1)',
          color: 'var(--danger)', fontSize: '0.75rem'
        }}>
          {error}
        </div>
      )}

      {/* Preview */}
      <div style={{ padding: '10px' }}>
        {renderPreview()}
      </div>

      {/* Actions */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '4px',
        padding: '6px 10px', borderTop: '1px solid var(--border-color)',
        background: 'rgba(255,255,255,0.01)', flexWrap: 'wrap'
      }}>
        <button type="button" onClick={onToggleExpand} style={actionButtonStyle}>
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          {expanded ? 'Collapse' : 'Expand'}
        </button>

        <button type="button" onClick={onCopy} style={{ ...actionButtonStyle, color: copied ? '#10b981' : undefined }}>
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>

        <button type="button" onClick={onDownload} style={actionButtonStyle}>
          <Download size={11} />
          Download
        </button>

        <button type="button" onClick={onStartEdit} style={actionButtonStyle}>
          <Edit2 size={11} />
          Edit
        </button>

        {editing && (
          <>
            <button type="button" onClick={onSaveEdit} disabled={saving} style={{ ...actionButtonStyle, borderColor: '#10b981', color: '#10b981' }}>
              {saving ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={11} />}
              Save
            </button>
            <button type="button" onClick={onCancelEdit} style={actionButtonStyle}>
              <X size={11} />
              Cancel
            </button>
          </>
        )}

        <button type="button" onClick={onDelete} style={{ ...actionButtonStyle, color: 'var(--danger)', marginLeft: 'auto' }}>
          <X size={11} />
          Delete
        </button>
      </div>
    </div>
  );
}

const actionButtonStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '3px',
  padding: '3px 7px', border: '1px solid var(--border-color)', borderRadius: '5px',
  background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.7rem',
  cursor: 'pointer'
};

export default function CanvasPanel({ artifacts, onUpdate, onDelete, onDownload, onFetchContent }: CanvasPanelProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());
  const [editContentMap, setEditContentMap] = useState<Record<string, string>>({});
  const [editNameMap, setEditNameMap] = useState<Record<string, string>>({});
  const [copiedIds, setCopiedIds] = useState<Set<string>>(new Set());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [fullContentMap, setFullContentMap] = useState<Record<string, CanvasArtifactData | null>>({});

  const toggleExpand = useCallback(async (artifact: CanvasArtifactData) => {
    const newExpanded = new Set(expandedIds);
    if (newExpanded.has(artifact.id)) {
      newExpanded.delete(artifact.id);
    } else {
      newExpanded.add(artifact.id);
      // Fetch full content when expanding if not already loaded
      if (!fullContentMap[artifact.id]) {
        const full = await onFetchContent(artifact.id);
        if (full) {
          setFullContentMap(prev => ({ ...prev, [artifact.id]: full }));
        }
      }
    }
    setExpandedIds(newExpanded);
  }, [expandedIds, fullContentMap, onFetchContent]);

  const startEdit = useCallback((artifact: CanvasArtifactData) => {
    setEditingIds(prev => { const next = new Set(prev); next.add(artifact.id); return next; });
    // Initialize edit state with current content
    const content = fullContentMap[artifact.id]?.content ?? artifact.content ?? '';
    setEditContentMap(prev => ({ ...prev, [artifact.id]: content }));
    setEditNameMap(prev => ({ ...prev, [artifact.id]: artifact.name }));
  }, [fullContentMap]);

  const cancelEdit = useCallback((id: string) => {
    setEditingIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setErrors(prev => ({ ...prev, [id]: null }));
  }, []);

  const saveEdit = useCallback(async (id: string) => {
    const content = editContentMap[id];
    const name = editNameMap[id];
    if (!content || !name) return;

    setSavingIds(prev => new Set(prev).add(id));
    setErrors(prev => ({ ...prev, [id]: null }));
    try {
      await onUpdate(id, content, name);
      setEditingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      // Update local content cache
      const updated = fullContentMap[id];
      if (updated) {
        setFullContentMap(prev => ({ 
          ...prev, 
          [id]: { ...updated, content, name, version: updated.version + 1 }
        }));
      }
    } catch (err) {
      setErrors(prev => ({ ...prev, [id]: 'Failed to save changes' }));
    } finally {
      setSavingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [editContentMap, editNameMap, onUpdate, fullContentMap]);

  const handleCopy = useCallback(async (artifact: CanvasArtifactData) => {
    const content = fullContentMap[artifact.id]?.content ?? artifact.content ?? '';
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIds(prev => { const next = new Set(prev); next.add(artifact.id); return next; });
      setTimeout(() => setCopiedIds(prev => { const next = new Set(prev); next.delete(artifact.id); return next; }), 2000);
    } catch {
      setErrors(prev => ({ ...prev, [artifact.id]: 'Failed to copy' }));
    }
  }, [fullContentMap]);

  const handleDownload = useCallback((artifact: CanvasArtifactData) => {
    const content = fullContentMap[artifact.id]?.content ?? artifact.content ?? '';
    onDownload({ ...artifact, content });
  }, [fullContentMap, onDownload]);

  const handleDelete = useCallback(async (id: string) => {
    await onDelete(id);
    // Clean up local state
    setExpandedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    setEditingIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    setFullContentMap(prev => { const next = { ...prev }; delete next[id]; return next; });
  }, [onDelete]);

  if (artifacts.length === 0) {
    return null;
  }

  return (
    <VirtualizedList
      items={artifacts}
      getItemKey={(artifact) => artifact.id}
      estimateItemHeight={(artifact) => {
        if (isImageMime(artifact.mimeType)) return 360;
        if (isMarkdownFile(artifact.mimeType, artifact.extension)) return 300;
        return 340;
      }}
      overscanPx={1200}
      renderItem={(artifact) => {
        const content = fullContentMap[artifact.id]?.content ?? artifact.content;
        return (
          <div style={{ paddingBottom: '8px' }}>
            <ArtifactCard
              artifact={{ ...artifact, content }}
              expanded={expandedIds.has(artifact.id)}
              editing={editingIds.has(artifact.id)}
              editContent={editContentMap[artifact.id] ?? artifact.content}
              editName={editNameMap[artifact.id] ?? artifact.name}
              onToggleExpand={() => toggleExpand(artifact)}
              onStartEdit={() => startEdit(artifact)}
              onCancelEdit={() => cancelEdit(artifact.id)}
              onSaveEdit={() => saveEdit(artifact.id)}
              onContentChange={(c) => setEditContentMap(prev => ({ ...prev, [artifact.id]: c }))}
              onNameChange={(n) => setEditNameMap(prev => ({ ...prev, [artifact.id]: n }))}
              onCopy={() => handleCopy(artifact)}
              onDownload={() => handleDownload(artifact)}
              onDelete={() => handleDelete(artifact.id)}
              copied={copiedIds.has(artifact.id)}
              saving={savingIds.has(artifact.id)}
              error={errors[artifact.id] ?? null}
            />
          </div>
        );
      }}
      style={{ display: 'block' }}
    />
  );
}
