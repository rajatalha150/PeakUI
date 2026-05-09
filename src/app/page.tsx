"use client";

import React, { useState, useEffect, useRef } from 'react';
import { randomUUID } from '@/lib/uuid';
import { 
  MessageSquare, Terminal, Database, Box, Settings, Cpu,
  Send, Bot, User, Paperclip, Code2, ChevronDown, ChevronLeft, ChevronRight, Activity, AlertCircle, Loader2, RefreshCw, Square, Plus, MessageCircle, LogOut, BookOpen, Check, Wand2, Globe, Redo2, Wifi, WifiOff,
  Download, FileText, Copy, Folder, Search, X, MoreHorizontal, Menu
} from 'lucide-react';
import KnowledgeBase from './components/KnowledgeBase';
import AssistantContent from './components/AssistantContent';
import SettingsPanel from './components/SettingsPanel';
import OpenClawWorkspace from './components/OpenClawWorkspace';
import CanvasPanel from './components/CanvasPanel';
import HelpHint from './components/HelpHint';
import SourceChips from './components/SourceChips';
import { mergeMessageSources, type MessageSource } from '@/lib/message-sources';
import { extractOpenClawToolRequest, type OpenClawWebToolRequest } from '@/lib/openclaw-tools';
import { applyTheme } from '@/lib/theme-options';
import { getStreamPhaseLabel, isServerStreamStatus, type UiStreamPhase } from '@/lib/stream-status';
import {
  inferResponsePresentation,
  getResponseDownloadExtension,
  getResponseDownloadMimeType,
  type ResponsePresentation,
} from '@/lib/response-format';
import { normalizeAssistantResponseContent } from '@/lib/response-normalizer';
import {
  CHAT_ATTACHMENT_TEXT_LIMIT,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  formatBytes,
  type ExtractedFilePayload,
} from '@/lib/file-shared';
import type { OllamaHealthSummary } from '@/lib/ollama-health';
import { useStickyScroll } from '@/lib/use-sticky-scroll';
import {
  DEFAULT_HUGGING_FACE_BASE_URL,
  buildChatModelOptionId,
  isHuggingFaceRouterUrl,
  type ChatModelOption,
  type ChatModelProvider,
  type ChatPlatform,
} from '@/lib/chat-platforms';

const CHAT_INTERNET_STORAGE = 'view-llama-chat-internet-enabled';
const SIDEBAR_COLLAPSE_STORAGE = 'view-llama-sidebar-collapsed';
const HUGGING_FACE_API_KEY_STORAGE = 'view-llama-huggingface-api-key';
const ACTIVE_TAB_STORAGE = 'view-llama-active-tab';
const CHAT_CURRENT_SESSION_STORAGE = 'view-llama-chat-current-session';
const OPENCLAW_VIEW_STORAGE = 'view-llama-openclaw-view';
const CHAT_DRAFT_SESSION_SENTINEL = '__draft__';
const MOBILE_BREAKPOINT = 960;

type AppTab = 'chat' | 'docs' | 'openclaw' | 'code' | 'vm' | 'docker' | 'settings';
type OpenClawView = 'workspace' | 'knowledge-base';

function normalizeActiveTab(value: unknown): AppTab {
  return value === 'docs'
    || value === 'openclaw'
    || value === 'code'
    || value === 'vm'
    || value === 'docker'
    || value === 'settings'
    ? value
    : 'chat';
}

function normalizeOpenClawView(value: unknown): OpenClawView {
  return value === 'knowledge-base' ? 'knowledge-base' : 'workspace';
}

function ThinkingBlock({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const [open, setOpen] = React.useState(true);
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

  // Auto-collapse when streaming finishes
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
      {/* Header row */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '8px 12px', cursor: 'pointer',
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

      {/* Content */}
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

const renderMessageContent = (content: string, isStreaming: boolean, isLast: boolean, presentation?: ResponsePresentation, sources?: MessageSource[]) => {
  if (!content) {
    if (isStreaming && isLast) return <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />;
    return null;
  }

  // No thinking tags at all
  if (!content.includes('<think>')) return <AssistantContent content={content} presentation={presentation} />;

  const elements: React.ReactNode[] = [];

  // Handle still-streaming thinking (opening tag exists but closing tag not yet)
  const openIdx = content.indexOf('<think>');
  const closeIdx = content.indexOf('</think>');

  if (openIdx !== -1 && closeIdx === -1) {
    // Mid-think: everything before <think> is regular text, everything after is live thinking
    const before = content.slice(0, openIdx);
    const thinkContent = content.slice(openIdx + 7); // len('<think>') = 7
    if (before) elements.push(<AssistantContent key="before" content={before} presentation={presentation} sources={sources} />);
    if (thinkContent) elements.push(<ThinkingBlock key="thinking" content={thinkContent} isStreaming={isStreaming && isLast} />);
    return <>{elements}</>;
  }

  // Full parse — may have multiple think blocks
  const parts = content.split(/(<think>|<\/think>)/);
  let insideThink = false;
  let thinkBuffer = '';
  let partIdx = 0;

  for (const part of parts) {
    if (part === '<think>') { insideThink = true; thinkBuffer = ''; continue; }
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

  return <>{elements}</>;
};

interface GeneratedFile {
  name: string;
  content: string;
  mimeType: string;
  binary: boolean;
}

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

function extractGeneratedFiles(content: string): GeneratedFile[] {
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
  
  // Match markdown image syntax with base64 data
  const mdImageRegex = /!\[([^\]]*)\]\(data:([^;]+);base64,([^)\s]+)\)/g;
  while ((match = mdImageRegex.exec(content)) !== null && images.length < 20) {
    const alt = match[1] || 'Generated image';
    const mimeType = match[2];
    const base64 = match[3];
    const extension = mimeType.split('/')[1] || 'png';
    const name = alt.includes('.') ? alt : `${alt}.${extension}`;
    images.push({ name, dataUrl: `data:${mimeType};base64,${base64}`, mimeType });
  }
  return images;
}



function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadGeneratedFile(file: GeneratedFile) {
  if (!file.binary) {
    downloadBlob(file.name, new Blob([file.content], { type: file.mimeType }));
    return;
  }

  try {
    const cleanBase64 = file.content.replace(/\s+/g, '');
    const raw = atob(cleanBase64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    downloadBlob(file.name, new Blob([bytes], { type: file.mimeType }));
  } catch {
    downloadBlob(`${file.name}.txt`, new Blob([file.content], { type: 'text/plain' }));
  }
}


function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  return (
    <button type="button" onClick={handleCopy} style={{
      display: 'flex', alignItems: 'center', gap: '4px',
      padding: '4px 8px', borderRadius: '6px',
      border: '1px solid var(--border-color)',
      background: 'rgba(255,255,255,0.04)',
      color: copied ? 'var(--success)' : 'var(--text-secondary)',
      cursor: 'pointer', fontSize: '0.72rem',
    }}>
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied!' : label}
    </button>
  );
}

function AssistantDownloads({ content, index, presentation, sessionId, messageId, onSaveArtifact }: { 
  content: string; 
  index: number; 
  presentation?: ResponsePresentation;
  sessionId?: string | null;
  messageId?: string;
  onSaveArtifact?: (artifact: { name: string; id: string }) => void;
}) {
  const [savedFiles, setSavedFiles] = React.useState<Record<string, string>>({});
  const normalizedContent = normalizeAssistantResponseContent(content, presentation);
  const generatedFiles = extractGeneratedFiles(normalizedContent);
  const inlineImages = extractInlineImages(normalizedContent);
  if (!normalizedContent.trim() && generatedFiles.length === 0 && inlineImages.length === 0) return null;
  const downloadExtension = getResponseDownloadExtension(presentation ?? { mode: 'general' });
  const downloadMimeType = getResponseDownloadMimeType(presentation ?? { mode: 'general' });

  const saveToCanvas = React.useCallback(async (file: GeneratedFile) => {
    if (!sessionId || savedFiles[file.name] || !onSaveArtifact) return;
    try {
      const res = await fetch('/api/canvas/artifacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          content: file.content,
          mimeType: file.mimeType,
          kind: file.mimeType.startsWith('image/') ? 'diagram' : file.mimeType === 'text/markdown' ? 'markdown' : 'file',
          extension: file.name.split('.').pop() || null,
          sessionId,
          messageId: messageId || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSavedFiles(prev => ({ ...prev, [file.name]: data.artifact.id }));
        onSaveArtifact?.({ name: file.name, id: data.artifact.id });
      }
    } catch (error) {
      console.error("Failed to save artifact to canvas:", error);
    }
  }, [sessionId, messageId, savedFiles, onSaveArtifact]);

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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '8px 0' }}>
          {inlineImages.map((img, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img src={img.url || img.dataUrl} alt={img.name} style={{
                maxWidth: '200px', maxHeight: '200px',
                borderRadius: '8px', border: '1px solid var(--border-color)',
                cursor: 'pointer', objectFit: 'cover',
              }} onClick={() => window.open(img.url || img.dataUrl, '_blank')} title="Click to view full size" />
              <div style={{ position: 'absolute', top: '4px', right: '4px', display: 'flex', gap: '2px' }}>
                {img.url && (
                  <button type="button" onClick={() => window.open(img.url, '_blank')} style={{
                    background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: '4px',
                    padding: '4px', cursor: 'pointer', color: 'white', display: 'flex', alignItems: 'center',
                  }} title="Open in new tab"><Globe size={12} /></button>
                )}
                <button type="button" onClick={() => {
                  const link = document.createElement('a');
                  link.href = img.url || img.dataUrl;
                  link.download = img.name;
                  link.click();
                }} style={{
                  background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: '4px',
                  padding: '4px', cursor: 'pointer', color: 'white', display: 'flex', alignItems: 'center',
                }} title="Download image"><Download size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        <button
        type="button"
        onClick={() => downloadBlob(`assistant-response-${index + 1}.${downloadExtension}`, new Blob([normalizedContent], { type: downloadMimeType }))}
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
            border: '1px solid ' + (savedFiles[file.name] ? '#10b981' : 'var(--accent-border)'),
            background: savedFiles[file.name] ? 'rgba(16,185,129,0.15)' : 'var(--accent-faint)',
            color: savedFiles[file.name] ? '#10b981' : 'var(--accent-primary)',
            cursor: 'pointer',
            fontSize: '0.72rem'
          }}
          title={file.binary ? 'Download decoded base64 file' : 'Download generated file'}
        >
          <FileText size={12} /> {file.name}{savedFiles[file.name] ? ' ✓' : ''}
        </button>
      ))}
      </div>
    </div>
  );
}

type Model = ChatModelOption;

interface ChatImageAttachment {
  name: string;
  type: string;
  size: number;
  data: string;
  dataUrl: string;
}

interface ImageDisplayFile {
  name: string;
  dataUrl: string;
  mimeType: string;
  url?: string; // For external URLs
}

type StoredChatImage = string | ChatImageAttachment;

interface ChatFileAttachment {
  name: string;
  type: string;
  size?: number;
  extension?: string;
  kind?: ExtractedFilePayload['kind'];
  text?: string;
  content?: string;
  textCharCount?: number;
  truncated?: boolean;
  extractionStatus?: ExtractedFilePayload['extractionStatus'];
  modelInput?: ExtractedFilePayload['modelInput'];
  statusMessage?: string;
}

interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  sources?: MessageSource[];
  images?: StoredChatImage[];   // base64 image data or richer image metadata
  attachments?: ChatFileAttachment[];
  presentation?: ResponsePresentation;
  meta?: {
    tokens: number;
    duration: number;
    tps: number;
  };
}

interface UserSettings {
  chatPlatform?: ChatPlatform;
  chatModel?: string;
  chatModelProvider?: ChatModelProvider;
  huggingFaceBaseUrl?: string;
  exclusiveOllamaModels?: boolean;
  temperature?: number;
  contextLength?: number;
  systemPrompt?: string;
  ragMode?: string;
  ragModel?: string;
  ollamaHost?: string;
  theme?: string;
}

interface ChatSession {
  id: string;
  title: string;
  updatedAt: number;
  pinned: boolean;
  surface?: string;
  messages: ChatMessage[];
  folderId?: string | null;
  tags?: { id: string; name: string; color: string }[];
  createdAt?: Date;
}

interface RetryableChatDraft {
  content: string;
  images: ChatImageAttachment[];
  attachments: ChatFileAttachment[];
  internetEnabled: boolean;
  ragContext: string | null;
  ragContextSources: MessageSource[];
}

export default function Home() {
  const getStoredInternetEnabled = () => {
    if (typeof window === 'undefined') return false;
    try {
      return window.sessionStorage.getItem(CHAT_INTERNET_STORAGE) === 'true';
    } catch {
      return false;
    }
  };

  const getStoredSidebarCollapsed = () => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE) === 'true';
    } catch {
      return false;
    }
  };

  const getStoredHuggingFaceApiKey = () => {
    if (typeof window === 'undefined') return '';
    try {
      return window.localStorage.getItem(HUGGING_FACE_API_KEY_STORAGE) || '';
    } catch {
      return '';
    }
  };

  const getStoredActiveTab = (): AppTab => {
    if (typeof window === 'undefined') return 'chat';
    try {
      return normalizeActiveTab(window.sessionStorage.getItem(ACTIVE_TAB_STORAGE));
    } catch {
      return 'chat';
    }
  };

  const getStoredChatSessionSelection = () => {
    if (typeof window === 'undefined') return '';
    try {
      return window.sessionStorage.getItem(CHAT_CURRENT_SESSION_STORAGE) || '';
    } catch {
      return '';
    }
  };

  const getStoredOpenClawView = (): OpenClawView => {
    if (typeof window === 'undefined') return 'workspace';
    try {
      return normalizeOpenClawView(window.sessionStorage.getItem(OPENCLAW_VIEW_STORAGE));
    } catch {
      return 'workspace';
    }
  };

  const getIsMobileViewport = () => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= MOBILE_BREAKPOINT;
  };

  const [activeTab, setActiveTab] = useState<AppTab>(getStoredActiveTab);
  const [openClawView, setOpenClawView] = useState<OpenClawView>(getStoredOpenClawView);
  const [message, setMessage] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [huggingFaceApiKey, setHuggingFaceApiKey] = useState(getStoredHuggingFaceApiKey);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => {
    const storedSelection = getStoredChatSessionSelection();
    return storedSelection && storedSelection !== CHAT_DRAFT_SESSION_SENTINEL ? storedSelection : null;
  });
  const [liveStats, setLiveStats] = useState<{tps: number, tokens: number} | null>(null);
  const [streamPhase, setStreamPhase] = useState<UiStreamPhase | null>(null);
  const [ragEnabled, setRagEnabled] = useState(false);
  const [ragContext, setRagContext] = useState<string | null>(null);
  const [ragContextSources, setRagContextSources] = useState<MessageSource[]>([]);
  const [internetEnabled, setInternetEnabled] = useState(getStoredInternetEnabled);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [mobileHeaderMenuOpen, setMobileHeaderMenuOpen] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [folders, setFolders] = useState<{ id: string; name: string; color: string; _count: { sessions: number } }[]>([]);
  const [tags, setTags] = useState<{ id: string; name: string; color: string; _count: { sessions: number } }[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatSession[]>([]);
  const [searching, setSearching] = useState(false);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [showNewTagModal, setShowNewTagModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState('#6366f1');
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#10b981');
  const [pendingImages, setPendingImages] = useState<ChatImageAttachment[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<ChatFileAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [processingAttachments, setProcessingAttachments] = useState(false);
  const [stoppingModel, setStoppingModel] = useState(false);
  const [modelControlNote, setModelControlNote] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getStoredSidebarCollapsed);
  const [isMobileViewport, setIsMobileViewport] = useState(getIsMobileViewport);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const inChatMode = activeTab === 'chat';
  const isDocs = activeTab === 'docs';
  const isOpenClaw = activeTab === 'openclaw';
  const isCode = activeTab === 'code';
  const isVm = activeTab === 'vm';
  const isDocker = activeTab === 'docker';
  const isSettings = activeTab === 'settings';
  const [canvasArtifacts, setCanvasArtifacts] = useState<Array<{
    id: string;
    name: string;
    content?: string;
    kind: string;
    mimeType: string;
    extension: string | null;
    size: number;
    sessionId: string;
    messageId: string | null;
    version: number;
    createdAt: string;
    updatedAt?: string;
  }>>([]);
  const [canvasRailCollapsed, setCanvasRailCollapsed] = useState(false);
  const [ollamaHealth, setOllamaHealth] = useState<OllamaHealthSummary | null>(null);
  const [ollamaHealthLoading, setOllamaHealthLoading] = useState(false);
  const [lastSubmittedDraft, setLastSubmittedDraft] = useState<RetryableChatDraft | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const clientSessionIdRef = useRef<string>('');
  const activeTaskIdRef = useRef<string | null>(null);
  const startTimeRef = useRef<number>(0);
  const tokenCountRef = useRef<number>(0);
  const {
    handleScroll: handleChatScroll,
    messagesEndRef,
    pinToBottom,
    requestScrollReset,
    scrollAreaRef: chatAreaRef,
    scrollToBottom,
    showScrollToBottom,
  } = useStickyScroll({
    contentKey: chatHistory,
    isStreaming,
  });

  const selectedModelOption = models.find(model => model.id === selectedModel) || null;
  const selectedModelName = selectedModelOption?.name || '';
  const selectedModelProvider: ChatModelProvider = selectedModelOption?.provider
    || (userSettings?.chatPlatform === 'huggingface'
      ? 'huggingface'
      : userSettings?.chatModelProvider || 'ollama');
  const selectedModelIsOllama = selectedModelProvider === 'ollama';
  const selectedHuggingFaceBaseUrl = userSettings?.huggingFaceBaseUrl || DEFAULT_HUGGING_FACE_BASE_URL;
  const ollamaChatModels = models.filter(model => model.provider === 'ollama');
  const huggingFaceChatModels = models.filter(model => model.provider === 'huggingface');
  const needsHuggingFaceTokenForDiscovery = (
    userSettings?.chatPlatform === 'huggingface' || userSettings?.chatPlatform === 'hybrid'
  ) && isHuggingFaceRouterUrl(selectedHuggingFaceBaseUrl) && !huggingFaceApiKey.trim();
  const sidebarIsCompact = sidebarCollapsed && !isMobileViewport;
  const selectedModelButtonLabel = selectedModelName || (modelsLoading
    ? 'Loading models...'
    : models.length === 0
      ? 'No models found'
      : 'Select a model');

  // File helpers
  const readAsBase64 = (file: File): Promise<string> =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => { const d = r.result as string; res(d.split(',')[1]); };
      r.onerror = rej;
      r.readAsDataURL(file);
    });

  const getImageData = (image: StoredChatImage) => typeof image === 'string' ? image : image.data;
  const getImageSrc = (image: StoredChatImage) =>
    typeof image === 'string' ? `data:image/jpeg;base64,${image}` : image.dataUrl;
  const getImageName = (image: StoredChatImage, index: number) =>
    typeof image === 'string' ? `attachment-${index}` : image.name;
  const getAttachmentContent = (attachment: ChatFileAttachment) =>
    attachment.text ?? attachment.content ?? '';
  const getAttachmentSize = (attachment: ChatFileAttachment) =>
    typeof attachment.size === 'number' ? attachment.size : 0;

  const extractAttachment = async (file: File): Promise<ChatFileAttachment> => {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/files/extract', { method: 'POST', body: formData });
    const data = await res.json() as (ExtractedFilePayload & { error?: string });

    if (!res.ok) {
      throw new Error(data.error || `Could not process "${file.name}"`);
    }

    return data;
  };

  const buildAttachmentContext = (attachments: ChatFileAttachment[] = [], images: StoredChatImage[] = [], userText = '') => {
    const imageContext = images.map((image, idx) => {
      if (typeof image === 'string') return `[Attached image ${idx + 1}: native image input]`;
      return [
        `[Attached image ${idx + 1}: ${image.name}]`,
        `MIME: ${image.type || 'image/*'}`,
        `Size: ${formatBytes(image.size)}`,
        'Model input: original image bytes via Ollama images array',
      ].join('\n');
    });

    const fileContext = attachments.map((attachment, idx) => {
      const lines = [
        `--- Attached file ${idx + 1}: ${attachment.name} ---`,
        `MIME: ${attachment.type}`,
        `Size: ${formatBytes(getAttachmentSize(attachment))}`,
        `Original extension: ${attachment.extension || 'unknown'}`,
        `Model input: ${attachment.modelInput || 'extracted-text'}`,
        `Extraction status: ${attachment.extractionStatus || 'text'}`,
        `Status: ${attachment.statusMessage || 'Read file as text.'}`,
      ];

      const attachmentText = getAttachmentContent(attachment);
      if (attachmentText.trim()) {
        lines.push('', attachmentText);
      }

      return lines.join('\n');
    });

    return [...imageContext, ...fileContext, userText.trim()].filter(Boolean).join('\n\n');
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const newImages: ChatImageAttachment[] = [];
    const newAttachments: ChatFileAttachment[] = [];

    setAttachmentError(null);
    setProcessingAttachments(true);

    try {
      for (const file of files) {
        if (file.size > MAX_UPLOAD_BYTES) {
          setAttachmentError(`"${file.name}" is too large. Files are limited to ${MAX_UPLOAD_LABEL}.`);
          break;
        }

        if (file.type.startsWith('image/')) {
          const b64 = await readAsBase64(file);
          newImages.push({
            name: file.name,
            type: file.type || 'image/*',
            size: file.size,
            data: b64,
            dataUrl: `data:${file.type || 'image/jpeg'};base64,${b64}`,
          });
        } else {
          const attachment = await extractAttachment(file);
          newAttachments.push(attachment);
        }
      }
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'Could not process attachment');
    } finally {
      setPendingImages(p => [...p, ...newImages]);
      setPendingAttachments(p => [...p, ...newAttachments]);
      setProcessingAttachments(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
      setStreamPhase(null);
      activeTaskIdRef.current = null;
      setChatHistory(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant' && !last.content.trim() && !last.thinking?.trim()) {
          updated.pop();
        }
        return updated;
      });
    }
  };

  const resetComposerState = () => {
    setMessage('');
    setRagContext(null);
    setRagContextSources([]);
    setPendingImages([]);
    setPendingAttachments([]);
    setAttachmentError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleNewChat = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    closeMobileChrome();
    setActiveTab('chat');
    setIsStreaming(false);
    setLiveStats(null);
    setStreamPhase(null);
    activeTaskIdRef.current = null;
    setChatMenuOpen(null);
    setRenamingId(null);
    setRenameValue('');
    setModelControlNote(null);
    setLastSubmittedDraft(null);
    resetComposerState();
    switchSession(null, []);
  };

  const upsertSessionInState = (session: ChatSession) => {
    setSessions(prev => {
      const existingIndex = prev.findIndex(item => item.id === session.id);
      if (existingIndex === -1) {
        return [session, ...prev];
      }

      const next = [...prev];
      next[existingIndex] = session;
      return next;
    });
  };

  const saveSession = async (
    sessionId: string,
    title: string,
    messages: ChatMessage[],
    createIfMissing = false,
    persistTitle = false,
  ) => {
    const endpoint = createIfMissing ? '/api/chats/new' : '/api/chats';
    const body = createIfMissing || persistTitle
      ? { id: sessionId, title, messages }
      : { id: sessionId, messages };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Failed to save chat session');
    }

    const session = data.session as ChatSession | undefined;
    if (!session) {
      throw new Error('Missing session payload');
    }

    return session;
  };

  const fetchChatModels = async (settingsOverride?: UserSettings | null) => {
    const effectiveSettings = settingsOverride ?? userSettings;
    if (!effectiveSettings) return [] as Model[];

    setModelsLoading(true);
    try {
      const response = await fetch('/api/chat/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: effectiveSettings.chatPlatform || 'ollama',
          ollamaHost: effectiveSettings.ollamaHost,
          huggingFaceBaseUrl: effectiveSettings.huggingFaceBaseUrl,
          apiKey: huggingFaceApiKey,
        }),
      });

      const data = await response.json().catch(() => ({})) as {
        models?: Model[];
        warnings?: string[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load chat models');
      }

      const nextModels = Array.isArray(data.models) ? [...data.models] : [];
      const savedModelName = typeof effectiveSettings.chatModel === 'string' ? effectiveSettings.chatModel.trim() : '';
      const savedModelProvider = effectiveSettings.chatModelProvider || 'ollama';
      const savedModelId = savedModelName ? buildChatModelOptionId(savedModelProvider, savedModelName) : '';
      if (savedModelName && savedModelProvider === 'huggingface' && !nextModels.some(model => model.id === savedModelId)) {
        nextModels.unshift({
          id: savedModelId,
          name: savedModelName,
          model: savedModelName,
          provider: 'huggingface',
          sourceLabel: isHuggingFaceRouterUrl(effectiveSettings.huggingFaceBaseUrl || DEFAULT_HUGGING_FACE_BASE_URL)
            ? 'Hugging Face'
            : effectiveSettings.huggingFaceBaseUrl || DEFAULT_HUGGING_FACE_BASE_URL,
        });
      }
      setModels(nextModels);
      return nextModels;
    } catch (error) {
      console.error('Failed to load chat models:', error);
      setModels([]);
      return [] as Model[];
    } finally {
      setModelsLoading(false);
    }
  };

  const loadChatSessions = () => {
    return fetch('/api/chats?surface=chat')
      .then(res => res.json())
      .then(parsed => {
        if (Array.isArray(parsed)) {
          setSessions(parsed);
          return parsed as ChatSession[];
        }
        return [] as ChatSession[];
      });
  };

  const loadFolders = () => {
    return fetch('/api/folders')
      .then(res => res.json())
      .then(data => {
        setFolders(Array.isArray(data) ? data : []);
      });
  };

  const loadChatTags = () => {
    return fetch('/api/chat-tags')
      .then(res => res.json())
      .then(data => {
        setTags(Array.isArray(data) ? data : []);
      });
  };

  const loadCanvasArtifacts = (sessionId: string) => {
    try {
      fetch(`/api/canvas/artifacts?sessionId=${sessionId}&limit=100`)
        .then(res => res.json())
        .then(data => {
          setCanvasArtifacts(data.artifacts || []);
        });
    } catch (error) {
      console.error("Failed to load canvas artifacts:", error);
    }
  };

  const deleteArtifactById = async (id: string) => {
    try {
      const res = await fetch(`/api/canvas/artifacts/${id}`, { method: "DELETE" });
      if (res.ok) {
        setCanvasArtifacts(prev => prev.filter(a => a.id !== id));
      }
    } catch (error) {
      console.error("Failed to delete artifact:", error);
    }
  };

  useEffect(() => {
    try {
      const storageKey = 'view-llama-client-session-id';
      const existing = window.localStorage.getItem(storageKey);
      if (existing) {
        clientSessionIdRef.current = existing;
      } else {
        const next = randomUUID();
        window.localStorage.setItem(storageKey, next);
        clientSessionIdRef.current = next;
      }
    } catch {
      clientSessionIdRef.current = randomUUID();
    }
  }, []);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(ACTIVE_TAB_STORAGE, activeTab);
    } catch {
      // Ignore browser storage failures.
    }
  }, [activeTab]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(OPENCLAW_VIEW_STORAGE, openClawView);
    } catch {
      // Ignore browser storage failures.
    }
  }, [openClawView]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        CHAT_CURRENT_SESSION_STORAGE,
        currentSessionId || CHAT_DRAFT_SESSION_SENTINEL,
      );
    } catch {
      // Ignore browser storage failures.
    }
  }, [currentSessionId]);

  useEffect(() => {
    void loadChatSessions()
      .then(parsed => {
        if (Array.isArray(parsed)) {
          const storedSelection = getStoredChatSessionSelection();
          if (storedSelection === CHAT_DRAFT_SESSION_SENTINEL) {
            setCurrentSessionId(null);
            setChatHistory([]);
            return;
          }

          const preferredSession = storedSelection
            ? parsed.find(session => session.id === storedSelection)
            : null;
          const nextSession = preferredSession || parsed[0];

          if (nextSession) {
            setCurrentSessionId(nextSession.id);
            setChatHistory(nextSession.messages);
            loadCanvasArtifacts(nextSession.id);
            return;
          }

          setCurrentSessionId(null);
          setChatHistory([]);
          setCanvasArtifacts([]);
        }
      })
      .catch(e => console.error("Failed to load chats:", e));

    fetch('/api/settings')
      .then(res => res.json())
      .then(settings => {
        if (!settings.error) {
          setUserSettings(settings);
          applyTheme(settings.theme);
          void fetchChatModels(settings);
        }
      })
      .catch(err => console.error("Failed to load settings:", err));

    void loadFolders()
      .catch(err => console.error("Failed to load folders:", err));

    void loadChatTags()
      .catch(err => console.error("Failed to load chat tags:", err));
  }, []);

  useEffect(() => {
    applyTheme(userSettings?.theme);
  }, [userSettings?.theme]);

  useEffect(() => {
    const syncHuggingFaceApiKey = () => {
      try {
        setHuggingFaceApiKey(window.localStorage.getItem(HUGGING_FACE_API_KEY_STORAGE) || '');
      } catch {
        // Ignore browser storage failures.
      }
    };

    window.addEventListener('view-llama-hf-token-change', syncHuggingFaceApiKey);
    return () => window.removeEventListener('view-llama-hf-token-change', syncHuggingFaceApiKey);
  }, []);

  useEffect(() => {
    if (!userSettings) return;
    const timer = window.setTimeout(() => {
      void fetchChatModels(userSettings);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [userSettings?.chatPlatform, userSettings?.ollamaHost, userSettings?.huggingFaceBaseUrl, huggingFaceApiKey]);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    const host = userSettings?.ollamaHost;
    if (!host || !selectedModelIsOllama) return;
    const timer = window.setTimeout(() => {
      void refreshOllamaHealth(selectedModelName, host);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedModelName, selectedModelIsOllama, userSettings?.ollamaHost]);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    if (!models.length) {
      if (selectedModel) {
        const timer = window.setTimeout(() => setSelectedModel(''), 0);
        return () => window.clearTimeout(timer);
      }
      return;
    }

    if (selectedModel && models.some((model: Model) => model.id === selectedModel)) return;

    const savedModelId = userSettings?.chatModel
      ? buildChatModelOptionId(userSettings?.chatModelProvider || 'ollama', userSettings.chatModel)
      : '';
    const modelToSelect = savedModelId && models.some((model: Model) => model.id === savedModelId)
      ? savedModelId
      : models[0].id;
    const timer = setTimeout(() => setSelectedModel(modelToSelect), 0);
    return () => clearTimeout(timer);
  }, [models, selectedModel, userSettings?.chatModel, userSettings?.chatModelProvider]);

  useEffect(() => {
    const syncViewport = () => {
      const nextIsMobile = window.innerWidth <= MOBILE_BREAKPOINT;
      setIsMobileViewport(nextIsMobile);
      if (!nextIsMobile) {
        setMobileSidebarOpen(false);
        setMobileHeaderMenuOpen(false);
      }
    };

    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  const closeMobileChrome = () => {
    setMobileSidebarOpen(false);
    setMobileHeaderMenuOpen(false);
    setModelMenuOpen(false);
  };

  const getChatTitle = (messages: ChatMessage[]) => {
    const firstMessage = messages[0];
    const titleSource = firstMessage?.content.trim()
      || firstMessage?.attachments?.map(attachment => attachment.name).join(', ')
      || (firstMessage?.images?.length ? 'Image chat' : 'New chat');
    return titleSource.substring(0, 30) + (titleSource.length > 30 ? '...' : '');
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  const handleDeleteChat = async (id: string) => {
    if (!confirm('Delete this chat? This cannot be undone.')) return;
    if (isStreaming && currentSessionId === id) {
      alert('Stop the current generation before deleting this chat.');
      return;
    }
    await fetch('/api/chats', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    setSessions(prev => prev.filter(s => s.id !== id));
    if (currentSessionId === id) switchSession(null, []);
    setChatMenuOpen(null);
  };

  const handlePinChat = async (id: string, pinned: boolean) => {
    await fetch('/api/chats', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, pinned: !pinned }) });
    setSessions(prev => {
      const updated = prev.map(s => s.id === id ? { ...s, pinned: !pinned } : s);
      return [...updated.filter(s => s.pinned), ...updated.filter(s => !s.pinned)];
    });
    setChatMenuOpen(null);
  };

  const handleRenameChat = async (id: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    await fetch('/api/chats', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, title: trimmed }) });
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title: trimmed } : s));
    setRenamingId(null);
    setRenameValue('');
    setChatMenuOpen(null);
  };

  const handleShareChat = (session: ChatSession) => {
    const text = session.messages
      .filter(m => m.role !== 'system')
      .map(m => {
        const attachments = m.attachments?.length
          ? `\nFiles: ${m.attachments.map((attachment: { name: string }) => attachment.name).join(', ')}`
          : '';
        const images = m.images?.length ? `\nImages: ${m.images.length}` : '';
        return `${m.role === 'user' ? 'You' : 'AI'}: ${m.content}${attachments}${images}`;
      })
      .join('\n\n');
    navigator.clipboard.writeText(text)
      .then(() => alert('Chat copied to clipboard!'))
      .catch(() => alert('Could not copy to clipboard'));
    setChatMenuOpen(null);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newFolderName, color: newFolderColor }),
      });
      if (res.ok) {
        setNewFolderName('');
        setShowNewFolderModal(false);
        await loadFolders();
      }
    } catch (error) {
      console.error('Failed to create folder:', error);
    }
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    try {
      const res = await fetch('/api/chat-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTagName, color: newTagColor }),
      });
      if (res.ok) {
        setNewTagName('');
        setShowNewTagModal(false);
        await loadChatTags();
      }
    } catch (error) {
      console.error('Failed to create tag:', error);
    }
  };

  const handleAddToFolder = async (sessionId: string, folderId: string | null) => {
    try {
      const res = await fetch('/api/chats', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, folderId }),
      });
      if (res.ok) {
        await Promise.all([loadChatSessions(), loadFolders()]);
      }
    } catch (error) {
      console.error('Failed to add to folder:', error);
    }
  };

  const handleAddTagToSession = async (sessionId: string, tagId: string) => {
    try {
      await fetch(`/api/sessions/${sessionId}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagId }),
      });
      await Promise.all([loadChatSessions(), loadChatTags()]);
    } catch (error) {
      console.error('Failed to add tag:', error);
    }
  };

  const handleRemoveTagFromSession = async (sessionId: string, tagId: string) => {
    try {
      await fetch(`/api/sessions/${sessionId}/tags?tagId=${tagId}`, {
        method: 'DELETE',
      });
      await Promise.all([loadChatSessions(), loadChatTags()]);
    } catch (error) {
      console.error('Failed to remove tag:', error);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&surface=chat`);
      const data = await res.json();
      setSearchResults(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (!searchQuery.trim()) return;

    const timer = window.setTimeout(() => {
      void handleSearch();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const switchSession = (id: string | null, messages: ChatMessage[]) => {
    closeMobileChrome();
    requestScrollReset();
    setCurrentSessionId(id);
    setChatHistory(messages);
    setLastSubmittedDraft(null);
    if (id) {
      loadCanvasArtifacts(id);
    } else {
      setCanvasArtifacts([]);
    }
  };

  const selectModel = (model: Model) => {
    setSelectedModel(model.id);
    setModelMenuOpen(false);
    setModelControlNote(null);
    setUserSettings(prev => prev ? {
      ...prev,
      chatModel: model.name,
      chatModelProvider: model.provider,
    } : prev);
    if (userSettings?.chatModel === model.name && userSettings?.chatModelProvider === model.provider) return;
    void fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatModel: model.name,
        chatModelProvider: model.provider,
      }),
    }).then(async response => {
      if (!response.ok) return;
      const data = await response.json().catch(() => null);
      if (data && !data.error) {
        setUserSettings(data);
        applyTheme(data.theme);
      }
    }).catch(error => {
      console.error('Failed to persist chat model selection:', error);
    });
  };

  async function refreshOllamaHealth(modelName = selectedModelName, host = userSettings?.ollamaHost || 'http://127.0.0.1:11434') {
    setOllamaHealthLoading(true);
    try {
      const params = new URLSearchParams();
      if (modelName) params.set('model', modelName);
      if (host) params.set('host', host);
      const response = await fetch(`/api/ollama/health?${params.toString()}`);
      const data = await response.json().catch(() => ({})) as OllamaHealthSummary & { error?: string };
      if (!response.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to inspect Ollama health');
      }
      setOllamaHealth(data);
    } catch (error) {
      setOllamaHealth({
        ok: false,
        status: 'offline',
        host,
        online: false,
        version: '',
        installedModelCount: 0,
        loadedModelCount: 0,
        loadedModels: [],
        selectedModel: modelName,
        selectedModelLoaded: false,
        error: error instanceof Error ? error.message : 'Failed to inspect Ollama health',
        checkedAt: Date.now(),
      });
    } finally {
      setOllamaHealthLoading(false);
    }
  }

  const stopSelectedModel = async () => {
    if (!selectedModelName || stoppingModel || !selectedModelIsOllama) return;

    if (isStreaming) {
      handleStop();
    }

    setStoppingModel(true);
    setModelControlNote(`Stopping ${selectedModelName}...`);

    try {
      const response = await fetch('/api/ollama/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModelName,
          host: userSettings?.ollamaHost,
        }),
      });
      const data = await response.json().catch(() => ({})) as {
        error?: unknown;
        model?: unknown;
        stopped?: unknown;
      };

      if (!response.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : `Failed to stop ${selectedModelName}`);
      }

      if (data.stopped === false) {
        setModelControlNote(`${selectedModelName} was not currently loaded.`);
      } else {
        const stoppedModel = typeof data.model === 'string' && data.model.trim() ? data.model : selectedModelName;
        setModelControlNote(`${stoppedModel} stopped. The next request will reload it.`);
      }
      void refreshOllamaHealth(selectedModelName, userSettings?.ollamaHost || 'http://127.0.0.1:11434');
    } catch (error) {
      setModelControlNote(error instanceof Error ? error.message : 'Failed to stop selected model');
    } finally {
      setStoppingModel(false);
    }
  };

  const toggleInternetAccess = () => {
    setInternetEnabled(prev => {
      const nextValue = !prev;
      try {
        window.sessionStorage.setItem(CHAT_INTERNET_STORAGE, String(nextValue));
      } catch {
        // Ignore browser storage failures.
      }
      return nextValue;
    });
  };

  const setInternetAccess = (nextValue: boolean) => {
    try {
      window.sessionStorage.setItem(CHAT_INTERNET_STORAGE, String(nextValue));
    } catch {
      // Ignore browser storage failures.
    }
    setInternetEnabled(nextValue);
  };

  const retryLastDraft = async (options?: { disableInternet?: boolean; stopModelFirst?: boolean }) => {
    if (!lastSubmittedDraft || isStreaming) return;
    const nextInternetEnabled = options?.disableInternet ? false : lastSubmittedDraft.internetEnabled;

    if (options?.stopModelFirst && selectedModelIsOllama && selectedModelName) {
      await stopSelectedModel();
    }

    setInternetAccess(nextInternetEnabled);
    pinToBottom();
    await handleSendMessage({
      ...lastSubmittedDraft,
      internetEnabled: nextInternetEnabled,
    });
  };

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed(current => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE, String(next));
      } catch {
        // Ignore browser storage failures.
      }
      return next;
    });
  };

  const visibleSessions = sessions.filter(session => {
    if (selectedFolderId && session.folderId !== selectedFolderId) {
      return false;
    }
    if (selectedTagId && !session.tags?.some(tag => tag.id === selectedTagId)) {
      return false;
    }
    return true;
  });

  const handleSendMessage = async (draft?: RetryableChatDraft) => {
    const messageText = draft?.content ?? message;
    const messageImages = draft ? [...draft.images] : [...pendingImages];
    const messageAttachments = draft ? [...draft.attachments] : [...pendingAttachments];
    const draftInternetEnabled = draft?.internetEnabled ?? internetEnabled;

    // Smooth character-drip streaming: tokens queue up and release
    // in small chunks at a steady rate for a ChatGPT-like typing feel.
    const DRIP_CHUNK_SIZE = 3;
    const DRIP_INTERVAL_MS = 16;
    let contentQueue = '';
    let thinkingQueue = '';
    let sourcesQueue: MessageSource[] | null = null;
    let dripTimer: ReturnType<typeof setInterval> | null = null;
    let streamingDone = false;

    const flushAll = () => {
      const hasContent = contentQueue.length > 0;
      const hasThinking = thinkingQueue.length > 0;
      const hasSources = sourcesQueue !== null;
      if (!hasContent && !hasThinking && !hasSources) return;

      setChatHistory(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role !== 'assistant') return prev;
        updated[lastIdx] = {
          ...updated[lastIdx],
          ...(hasContent ? { content: updated[lastIdx].content + contentQueue } : {}),
          ...(hasThinking ? { thinking: (updated[lastIdx].thinking || '') + thinkingQueue } : {}),
          ...(hasSources ? { sources: sourcesQueue! } : {}),
        };
        return updated;
      });

      contentQueue = '';
      thinkingQueue = '';
      sourcesQueue = null;
    };

    const startDrip = () => {
      if (dripTimer) return;
      dripTimer = setInterval(() => {
        const hasContent = contentQueue.length > 0;
        const hasThinking = thinkingQueue.length > 0;
        const hasSources = sourcesQueue !== null;
        if (!hasContent && !hasThinking && !hasSources) {
          if (streamingDone) {
            clearInterval(dripTimer!);
            dripTimer = null;
          }
          return;
        }

        const contentChunk = hasContent ? contentQueue.slice(0, DRIP_CHUNK_SIZE) : '';
        const thinkingChunk = hasThinking ? thinkingQueue.slice(0, DRIP_CHUNK_SIZE) : '';
        if (hasContent) contentQueue = contentQueue.slice(contentChunk.length);
        if (hasThinking) thinkingQueue = thinkingQueue.slice(thinkingChunk.length);

        setChatHistory(prev => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (updated[lastIdx]?.role !== 'assistant') return prev;
          updated[lastIdx] = {
            ...updated[lastIdx],
            ...(contentChunk ? { content: updated[lastIdx].content + contentChunk } : {}),
            ...(thinkingChunk ? { thinking: (updated[lastIdx].thinking || '') + thinkingChunk } : {}),
            ...(hasSources ? { sources: sourcesQueue! } : {}),
          };
          // Clear sources after first delivery so we don't re-set them every tick
          if (hasSources) sourcesQueue = null;
          return updated;
        });
      }, DRIP_INTERVAL_MS);
    };

    const scheduleUpdate = (update: { content?: string; thinking?: string; sources?: MessageSource[] }) => {
      if (update.content) contentQueue += update.content;
      if (update.thinking) thinkingQueue += update.thinking;
      if (update.sources) sourcesQueue = update.sources;
      startDrip();
    };
    const draftRagContext = draft?.ragContext ?? ragContext;
    const draftRagContextSources = draft?.ragContextSources ?? ragContextSources;
    const hasText = messageText.trim();
    const hasMedia = messageImages.length > 0 || messageAttachments.length > 0;
    if ((!hasText && !hasMedia) || !selectedModelName || isStreaming || processingAttachments) return;

    if (selectedModelProvider === 'huggingface' && isHuggingFaceRouterUrl(selectedHuggingFaceBaseUrl) && !huggingFaceApiKey.trim()) {
      setAttachmentError('Add a Hugging Face token in Settings before using the default Hugging Face router.');
      return;
    }

    const userMessage = messageText.trim();
    const ragSearchText = userMessage || messageAttachments.map(getAttachmentContent).join('\n').slice(0, 2000);
    const responsePresentation = inferResponsePresentation([{
      role: 'user',
      content: userMessage || messageAttachments.map(attachment => attachment.name).join(', ') || ragSearchText,
    }]);
    const isNewSession = !currentSessionId;
    const chatId = currentSessionId ?? randomUUID();
    const userMessageId = randomUUID();
    const assistantMessageId = randomUUID();
    if (!clientSessionIdRef.current) {
      clientSessionIdRef.current = randomUUID();
      try {
        window.localStorage.setItem('view-llama-client-session-id', clientSessionIdRef.current);
      } catch {
        // Ignore storage errors and keep the in-memory session id.
      }
    }
    const userMsg: ChatMessage = {
      id: userMessageId,
      role: 'user',
      content: userMessage,
      ...(messageImages.length > 0 ? { images: messageImages } : {}),
      ...(messageAttachments.length > 0 ? { attachments: messageAttachments } : {}),
    };
    const baseHistory = [...chatHistory, userMsg];
    const existingSession = currentSessionId ? sessions.find(session => session.id === currentSessionId) : null;
    const existingTitle = existingSession?.title?.trim();
    const sessionTitle = existingTitle && existingTitle !== 'New Chat' ? existingTitle : getChatTitle(baseHistory);

    pinToBottom();
    setMessage('');
    setPendingImages([]);
    setPendingAttachments([]);
    setAttachmentError(null);
    setModelControlNote(null);
    setLastSubmittedDraft({
      content: userMessage,
      images: messageImages,
      attachments: messageAttachments,
      internetEnabled: draftInternetEnabled,
      ragContext: draftRagContext,
      ragContextSources: draftRagContextSources,
    });
    setCurrentSessionId(chatId);
    setChatHistory([
      ...baseHistory,
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
      },
    ]);
    setIsStreaming(true);
    // Scroll to bottom after adding messages so the user sees the response
    requestAnimationFrame(() => scrollToBottom('auto'));

    const controller = new AbortController();
    abortControllerRef.current = controller;
    
    startTimeRef.current = Date.now();
    tokenCountRef.current = 0;
    setLiveStats({ tps: 0, tokens: 0 });
    setStreamPhase(ragEnabled && Boolean(ragSearchText.trim()) ? 'preparing-context' : 'connecting');

    const intervalId = setInterval(() => {
      const elapsedSec = (Date.now() - startTimeRef.current) / 1000;
      if (elapsedSec > 0.1) {
        setLiveStats({ 
          tps: tokenCountRef.current / elapsedSec, 
          tokens: tokenCountRef.current 
        });
      }
    }, 500);

    const previewSession: ChatSession = {
      id: chatId,
      title: sessionTitle,
      updatedAt: Date.now(),
      pinned: existingSession?.pinned ?? false,
      messages: baseHistory,
    };

    upsertSessionInState(previewSession);

    try {
      const sessionSavePromise = saveSession(
        chatId,
        sessionTitle,
        baseHistory,
        isNewSession,
        isNewSession || !existingTitle || existingTitle === 'New Chat',
      )
        .then(savedSession => {
          upsertSessionInState(savedSession);
          return savedSession;
        })
        .catch(saveError => {
          console.error('Failed to persist chat session before streaming:', saveError);
          return null;
        });

      if (controller.signal.aborted) {
        return;
      }

      // If RAG is enabled, inject KB context as prefixed system messages. Internet
      // mode now runs server-side so the model can search/fetch more than once.
      let augmentedMessages = [...baseHistory];
      const contextMessages: Array<{ role: 'system'; content: string }> = [];
      let activeSources: MessageSource[] = [];
      if (ragEnabled && ragSearchText.trim()) {
        try {
          const ragRes = await fetch('/api/rag/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({ query: ragSearchText, topK: 4 })
          });
          if (ragRes.ok) {
            const ragData = await ragRes.json() as MessageSource[];
            if (Array.isArray(ragData) && ragData.length > 0) {
              activeSources = [...activeSources, ...ragData];
              const context = ragData
                .map((r, idx) => {
                  const label = r.sourcePath && r.sourcePath !== r.filename
                    ? `${r.filename} (${r.sourcePath})`
                    : r.filename;
                  const meta = [
                    r.fileKind || null,
                    r.extension ? `.${r.extension}` : null,
                    typeof r.chunkIndex === 'number' ? `chunk ${r.chunkIndex + 1}` : null,
                    typeof r.documentSize === 'number' ? formatBytes(r.documentSize) : null,
                    `${Math.round(r.score * 100)}% match`,
                    r.mode || 'semantic',
                  ].filter(Boolean).join(' · ');
                  return `[Source ${idx + 1}: ${label} | ${meta}]\n${r.content}`;
                })
                .join('\n\n---\n\n');
              contextMessages.push({
                role: 'system' as const,
                content: `Use the following knowledge base context when it is relevant. Most entries are retrieved excerpts from indexed files, but small files may be included as full-document context when safe. If the context is not enough, ask for a broader lookup or direct file inspection by naming the file, folder, or chunk you need. Cite the source and chunk when you can.\n\n${context}`
              });
            }
          }
        } catch (e) {
          if (e instanceof Error && e.name === 'AbortError') {
            throw e;
          }
          console.error('RAG search failed:', e);
        }
      } else if (draftRagContext) {
        // One-shot context injected from KB "Send to Chat" button
        activeSources = [...activeSources, ...draftRagContextSources];
        contextMessages.push({ role: 'system' as const, content: `Use the following knowledge base context when it is relevant. Most entries are retrieved excerpts from indexed files, but small files may be included as full-document context when safe. If the context is not enough, ask for a broader lookup or direct file inspection by naming the file, folder, or chunk you need. Cite the source and chunk when you can.\n\n${draftRagContext}` });
        if (!draft) {
          setRagContext(null); // consume it
          setRagContextSources([]);
        }
      }

      if (contextMessages.length > 0) {
        augmentedMessages = [...contextMessages, ...baseHistory];
      }

      if (controller.signal.aborted) {
        return;
      }

      if (activeSources.length > 0) {
        setChatHistory(prev => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (updated[lastIdx]?.role === 'assistant') {
            updated[lastIdx] = {
              ...updated[lastIdx],
              sources: activeSources,
            };
          }
          return updated;
        });
      }

      setStreamPhase('connecting');

      // Tool loop: stream model response, check for web tool requests,
      // execute them, and re-stream with results (max 2 rounds).
      const MAX_TOOL_ROUNDS = 2;
      let toolRoundMessages = [...augmentedMessages];
      let toolRoundSources = [...activeSources];
      let assistantContent = '';
      let assistantThinking = '';
      let finalMeta: ChatMessage['meta'] | undefined;

      type StreamFrame = {
        task_id?: unknown;
        chat_id?: unknown;
        session_id?: unknown;
        id?: unknown;
        error?: unknown;
        status?: unknown;
        sources?: unknown;
        knowledge_sources?: unknown;
        message?: {
          thinking?: unknown;
          content?: unknown;
        };
        done?: unknown;
        eval_count?: number;
        eval_duration?: number;
      };


      for (let toolRound = 0; toolRound < MAX_TOOL_ROUNDS; toolRound += 1) {
        if (toolRound > 0) {
          // Reset content for the new round — the model will produce a fresh response
          // that incorporates the web research results.
          assistantContent = '';
          assistantThinking = '';
          finalMeta = undefined;
          setStreamPhase('connecting');
          // Reset the assistant message content in chat history for the new response
          setChatHistory(prev => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (updated[lastIdx]?.role === 'assistant') {
              updated[lastIdx] = { ...updated[lastIdx], content: '', thinking: '' };
            }
            return updated;
          });
        }

        const roundAssistantId = toolRound === 0 ? assistantMessageId : randomUUID();
        const response = await fetch('/api/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            model: selectedModelName,
            provider: selectedModelProvider,
            ...(selectedModelProvider === 'huggingface'
              ? {
                  base_url: selectedHuggingFaceBaseUrl,
                  api_key: huggingFaceApiKey,
                }
              : {}),
            chat_id: chatId,
            session_id: clientSessionIdRef.current,
            id: roundAssistantId,
            response_presentation: responsePresentation,
            internet_enabled: false, // No pre-search — model drives web research via tool tags
            internet_tool_enabled: draftInternetEnabled,
            ...(toolRound === 0 ? { rag_enabled: ragEnabled, rag_query: ragSearchText } : { rag_enabled: false }),
            messages: toolRoundMessages.map(m => ({
              role: m.role,
              content: buildAttachmentContext(m.attachments, m.images, m.content),
              ...(m.images && m.images.length > 0 ? { images: m.images.map(getImageData) } : {}),
            })),
          })
        });

        if (!response.ok) {
          let errMessage = selectedModelProvider === 'huggingface'
            ? 'Error connecting to the Hugging Face model.'
            : 'Error connecting to the local model.';
          try {
            const errData = await response.json();
            if (errData.error) errMessage = errData.error;
          } catch {}
          throw new Error(errMessage);
        }

        if (!response.body) throw new Error('No response body');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let streamBuffer = '';

        const processStreamLine = (line: string) => {
        let data: StreamFrame | null = null;

        try {
          data = JSON.parse(line) as StreamFrame;
        } catch (error) {
          console.error('Error parsing chunk:', error);
          return;
        }

        if (!data) return;

        if (typeof data?.task_id === 'string' && data.task_id.trim()) {
          activeTaskIdRef.current = data.task_id.trim();
        }

        if (typeof data?.error === 'string' && data.error.trim()) {
          throw new Error(data.error);
        }

        if (isServerStreamStatus(data?.status)) {
          setStreamPhase(data.status);
        }

        if (Array.isArray(data.sources)) {
          activeSources = mergeMessageSources(activeSources, data.sources as MessageSource[]);
          scheduleUpdate({ sources: activeSources });
        }

        // Handle knowledge base sources from server-side RAG
        if (Array.isArray(data.knowledge_sources)) {
          const kbSources = data.knowledge_sources as MessageSource[];
          activeSources = mergeMessageSources(activeSources, kbSources);
          scheduleUpdate({ sources: activeSources });
        }

        const messageFrame = data.message;
        if (messageFrame) {
          // Accumulate thinking content (Gemma4 / Ollama native thinking field)
          if (typeof messageFrame.thinking === 'string' && messageFrame.thinking) {
            assistantThinking += messageFrame.thinking;
            tokenCountRef.current += 1;
            scheduleUpdate({ thinking: messageFrame.thinking });
          }
          // Accumulate response content
          if (typeof messageFrame.content === 'string' && messageFrame.content) {
            assistantContent += messageFrame.content;
            tokenCountRef.current += 1;
            scheduleUpdate({ content: messageFrame.content });
          }
        }

        if (data.done && data.eval_count && data.eval_duration) {
          const tokens = data.eval_count;
          const durationSec = data.eval_duration / 1e9;
          const tps = tokens / durationSec;

          setChatHistory(prev => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            finalMeta = {
              tokens,
              duration: durationSec,
              tps,
            };
            updated[lastIdx] = {
              ...updated[lastIdx],
              meta: finalMeta
            };
            return updated;
          });
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        streamBuffer += decoder.decode(value, { stream: true });

        let newlineIndex = streamBuffer.indexOf('\n');
        while (newlineIndex !== -1) {
          const line = streamBuffer.slice(0, newlineIndex).trim();
          streamBuffer = streamBuffer.slice(newlineIndex + 1);

          if (line) processStreamLine(line);

          newlineIndex = streamBuffer.indexOf('\n');
        }
      }

      streamBuffer += decoder.decode();
      const finalLine = streamBuffer.trim();
      if (finalLine) {
        processStreamLine(finalLine);
      }
      // Flush any remaining buffered updates before checking for tool requests
      streamingDone = true;
      flushAll();

        // Check for web tool request after streaming
        const { cleanedContent, request } = extractOpenClawToolRequest(assistantContent);

        if (request?.name === 'web' && draftInternetEnabled) {
          // Strip tool tag from displayed content
          const webRequest = request.request as OpenClawWebToolRequest;
          const query = webRequest.query?.trim() || '';

          if (query) {
            // Clean the tool tag from the assistant message in chat history
            setChatHistory(prev => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (updated[lastIdx]?.role === 'assistant') {
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  content: cleanedContent,
                };
              }
              return updated;
            });
            assistantContent = cleanedContent;

            // Execute the web search
            setStreamPhase('web-search');
            try {
              const webRes = await fetch('/api/web/context', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({ query }),
              });
              const webData = await webRes.json();
              if (webRes.ok && webData.context) {
                const webSources = Array.isArray(webData.sources) ? webData.sources as MessageSource[] : [];
                if (webSources.length > 0) {
                  toolRoundSources = mergeMessageSources(toolRoundSources, webSources);
                  activeSources = toolRoundSources;
                  setChatHistory(prev => {
                    const updated = [...prev];
                    const lastIdx = updated.length - 1;
                    if (updated[lastIdx]?.role === 'assistant') {
                      updated[lastIdx] = {
                        ...updated[lastIdx],
                        sources: activeSources,
                      };
                    }
                    return updated;
                  });
                }
                // Inject web context as a system message and continue
                toolRoundMessages = [
                  ...toolRoundMessages,
                  { role: 'assistant' as const, content: assistantContent },
                  { role: 'user' as const, content: `Web research results for "${query}":\n\n${webData.context}\n\nUse the above web research results to answer the original question. Cite specific claims with [^N] markers using the provided sources.` },
                ];
              }
            } catch (webError) {
              if (controller.signal.aborted) throw webError;
              console.error('Web research failed:', webError);
              // Continue without web context
              break;
            }
            setStreamPhase(null);
            // Continue to next tool round
            continue;
          }
        }

        // No tool request found — finish
        break;
      } // end tool loop

      // Flush any remaining buffered updates
      streamingDone = true;
      flushAll();
      if (dripTimer) { clearInterval(dripTimer); dripTimer = null; }

      // Strip any remaining tool tags from final content
      const { cleanedContent: finalContent } = extractOpenClawToolRequest(assistantContent);
      if (finalContent !== assistantContent) {
        assistantContent = finalContent;
        setChatHistory(prev => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (updated[lastIdx]?.role === 'assistant') {
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: finalContent,
            };
          }
          return updated;
        });
      }

      await sessionSavePromise;

      const completedMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: assistantContent,
        ...(assistantThinking ? { thinking: assistantThinking } : {}),
        ...(activeSources.length > 0 ? { sources: activeSources } : {}),
        ...(finalMeta ? { meta: finalMeta } : {}),
        presentation: responsePresentation,
      };

      try {
        const completionResponse = await fetch('/api/chat/completed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            id: assistantMessageId,
            session_id: clientSessionIdRef.current,
            title: sessionTitle,
            model: selectedModelName,
            message: completedMessage,
            messages: baseHistory,
          }),
        });

        const completionData = await completionResponse.json().catch(() => ({}));
        if (!completionResponse.ok) {
          throw new Error(completionData.error || 'Failed to finalize chat session');
        }

        if (completionData.session) {
          upsertSessionInState(completionData.session as ChatSession);
        } else {
          upsertSessionInState({
            ...previewSession,
            messages: [...baseHistory, completedMessage],
            updatedAt: Date.now(),
          });
        }
      } catch (finalizeError) {
        console.error('Failed to finalize chat session:', finalizeError);
        upsertSessionInState({
          ...previewSession,
          messages: [...baseHistory, completedMessage],
          updatedAt: Date.now(),
        });
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Stream aborted by user');
        return;
      }
      console.error('Chat error:', error);
      const message = error instanceof Error ? error.message : 'Unknown chat error';
      setChatHistory(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant' && !last.content.trim() && !last.thinking?.trim()) {
          updated.pop();
        }
        updated.push({ role: 'assistant', content: `**Error:** ${message}` });
        return updated;
      });
    } finally {
      streamingDone = true;
      if (dripTimer) { clearInterval(dripTimer); dripTimer = null; }
      flushAll();
      clearInterval(intervalId);
      setLiveStats(null);
      setStreamPhase(null);
      setIsStreaming(false);
      abortControllerRef.current = null;
      activeTaskIdRef.current = null;
    }
  };

  const chatHealthStatusLabel = ollamaHealthLoading
    ? 'Checking Ollama'
    : ollamaHealth?.status === 'online'
      ? ollamaHealth.selectedModelLoaded
        ? 'Selected model loaded'
        : ollamaHealth.loadedModelCount > 0
          ? `${ollamaHealth.loadedModelCount} other model${ollamaHealth.loadedModelCount === 1 ? '' : 's'} loaded`
          : 'Ollama online'
      : ollamaHealth?.status === 'degraded'
        ? 'Runner status limited'
        : 'Ollama offline';
  const chatHealthTone = ollamaHealth?.status === 'online'
    ? 'var(--success)'
    : ollamaHealth?.status === 'degraded'
      ? 'var(--warning)'
      : 'var(--danger)';

  const openMainChat = () => {
    closeMobileChrome();
    setOpenClawView('workspace');
    setActiveTab('chat');
  };

  const openMainKnowledgeBase = () => {
    closeMobileChrome();
    setOpenClawView('workspace');
    setActiveTab('docs');
  };

  const openOpenClawWorkspace = () => {
    closeMobileChrome();
    setOpenClawView('workspace');
    setActiveTab('openclaw');
  };

  const openOpenClawKnowledgeBase = () => {
    closeMobileChrome();
    setOpenClawView('knowledge-base');
    setActiveTab('openclaw');
  };

  const openSettings = () => {
    closeMobileChrome();
    setOpenClawView('workspace');
    setActiveTab('settings');
  };

  return (
    <div className="app-container">
      {isMobileViewport && !isOpenClaw && mobileSidebarOpen && (
        <button
          type="button"
          className="mobile-surface-overlay"
          aria-label="Close navigation drawer"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {!isOpenClaw && (
      <aside className={`sidebar${sidebarIsCompact ? ' is-collapsed' : ''}${isMobileViewport ? ' is-mobile-drawer' : ''}${isMobileViewport && mobileSidebarOpen ? ' is-mobile-open' : ''}`}>
        <div style={{ padding: sidebarIsCompact ? '18px 12px' : '24px', display: 'flex', alignItems: 'center', gap: '12px', justifyContent: sidebarIsCompact ? 'center' : 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
            <div style={{ background: 'var(--accent-gradient)', padding: '8px', borderRadius: '12px' }}>
              <Cpu size={24} color="white" />
            </div>
            {!sidebarIsCompact && (
              <div>
                <h2 style={{ fontSize: '1.2rem', margin: 0 }}>ViewLlama</h2>
                <div style={{ fontSize: '0.8rem', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                  <div className="status-indicator"></div> Engine Online
                </div>
              </div>
            )}
          </div>
          {!sidebarIsCompact && !isMobileViewport && (
            <button
              type="button"
              className="btn-icon"
              onClick={toggleSidebarCollapsed}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <ChevronLeft size={18} />
            </button>
          )}
        </div>

        <div style={{ padding: sidebarIsCompact ? '8px 12px 6px' : '20px 24px 10px' }}>
          <button 
            className="btn btn-primary" 
            style={{ width: '100%', justifyContent: 'center', padding: sidebarIsCompact ? '10px' : undefined }}
            onClick={handleNewChat}
            title="New Chat"
          >
            <Plus size={18} /> {!sidebarIsCompact && 'New Chat'}
          </button>
        </div>

        {/* KB + OpenClaw nav buttons — always visible at top of sidebar */}
        <div style={{ padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div className={`nav-item ${isDocs ? 'active' : ''}${sidebarIsCompact ? ' compact' : ''}`} onClick={openMainKnowledgeBase} title="Knowledge Base">
            <Database size={18} /> {!sidebarIsCompact && <span className="sidebar-label">Knowledge Base (RAG)</span>}
          </div>
          <div className={`nav-item ${isOpenClaw ? 'active' : ''}${sidebarIsCompact ? ' compact' : ''}`} onClick={openOpenClawWorkspace} title="Open Claw">
            <Wand2 size={18} /> {!sidebarIsCompact && <span className="sidebar-label">Open Claw</span>}
          </div>
        </div>

        <div className="sidebar-scroll-region" style={{ flex: 1, paddingTop: sidebarIsCompact ? '4px' : '10px' }}
          onClick={() => chatMenuOpen && setChatMenuOpen(null)}
        >
          {/* Search */}
          {!sidebarIsCompact && (
            <div style={{ padding: '0 12px 10px' }}>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
                  <input
                    type="text"
                    placeholder="Search chats..."
                    value={searchQuery}
                    onChange={e => {
                      const nextValue = e.target.value;
                      setSearchQuery(nextValue);
                      if (!nextValue.trim()) {
                        setSearchResults([]);
                      }
                    }}
                    className="input-field"
                    style={{ paddingLeft: '32px', height: '34px', fontSize: '0.82rem' }}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => { setSearchQuery(''); setShowSearch(false); }}
                      style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
              {searchQuery && searchResults.length > 0 && (
                <div style={{ marginTop: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                  <div className="section-title" style={{ fontSize: '0.72rem' }}>Search Results ({searchResults.length})</div>
                  {searchResults.map(s => (
                    <div
                      key={s.id}
                      className={`nav-item ${currentSessionId === s.id ? 'active' : ''}`}
                      style={{ padding: '6px 8px', fontSize: '0.8rem' }}
                      onClick={() => {
                        const fullSession = sessions.find(session => session.id === s.id);
                        if (fullSession) {
                          switchSession(fullSession.id, fullSession.messages);
                        }
                        setSearchQuery('');
                        setShowSearch(false);
                      }}
                    >
                      <MessageCircle size={12} style={{ opacity: 0.6, flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                    </div>
                  ))}
                </div>
              )}
              {searchQuery && !searching && searchResults.length === 0 && (
                <div className="section-title" style={{ fontSize: '0.72rem', paddingTop: '8px' }}>
                  No matching chats
                </div>
              )}
            </div>
          )}

          {/* Folders section */}
          {!sidebarIsCompact && (
            <div style={{ padding: '0 12px 8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span className="section-title" style={{ fontSize: '0.72rem', opacity: 0.7 }}>Folders</span>
                <button
                  onClick={() => setShowNewFolderModal(true)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '2px' }}
                  title="New folder"
                >
                  <Plus size={14} />
                </button>
              </div>
              <div
                className={`nav-item ${selectedFolderId === null && !selectedTagId ? 'active' : ''}`}
                style={{ padding: '6px 8px', fontSize: '0.8rem' }}
                onClick={() => { setSelectedFolderId(null); setSelectedTagId(null); }}
              >
                <Folder size={14} style={{ opacity: 0.6 }} />
                <span>All Chats</span>
                <span style={{ marginLeft: 'auto', fontSize: '0.7rem', opacity: 0.6 }}>{sessions.length}</span>
              </div>
              {folders.map(f => (
                <div
                  key={f.id}
                  className={`nav-item ${selectedFolderId === f.id ? 'active' : ''}`}
                  style={{ padding: '6px 8px', fontSize: '0.8rem' }}
                  onClick={() => { setSelectedFolderId(f.id); setSelectedTagId(null); }}
                >
                  <Folder size={14} style={{ color: f.color, opacity: 0.8 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{f.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '0.7rem', opacity: 0.6 }}>{f._count?.sessions || 0}</span>
                </div>
              ))}
            </div>
          )}

          {/* Tags section */}
          {!sidebarIsCompact && (
            <div style={{ padding: '0 12px 8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span className="section-title" style={{ fontSize: '0.72rem', opacity: 0.7 }}>Tags</span>
                <button
                  onClick={() => setShowNewTagModal(true)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '2px' }}
                  title="New tag"
                >
                  <Plus size={14} />
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {tags.length > 0 ? tags.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTagId(selectedTagId === t.id ? null : t.id)}
                    style={{
                      padding: '3px 8px', borderRadius: '12px', border: 'none',
                      background: `${t.color}20`,
                      color: t.color,
                      fontSize: '0.72rem',
                      cursor: 'pointer',
                      opacity: selectedTagId === t.id ? 1 : 0.7,
                    }}
                  >
                    {t.name} {t._count?.sessions || 0}
                  </button>
                )) : (
                  <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>No tags yet</span>
                )}
              </div>
            </div>
          )}

          {/* Sessions list */}
          {!sidebarIsCompact && visibleSessions.length > 0 && (
            <>
              <div className="section-title" style={{ padding: '8px 12px 4px' }}>
                {selectedFolderId ? folders.find(f => f.id === selectedFolderId)?.name || 'Folder' : selectedTagId ? tags.find(t => t.id === selectedTagId)?.name || 'Tag' : 'Chats'} ({visibleSessions.length})
              </div>
              {visibleSessions.map(s => (
                <div
                  key={s.id}
                  className={`nav-item ${currentSessionId === s.id ? 'active' : ''}`}
                  style={{ position: 'relative', padding: '8px 12px', gap: '8px', alignItems: 'center' }}
                >
                  {/* Rename inline input */}
                  {renamingId === s.id ? (
                    <form
                      style={{ display: 'flex', gap: '4px', flex: 1 }}
                      onSubmit={e => { e.preventDefault(); handleRenameChat(s.id); }}
                    >
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={() => { setRenamingId(null); setRenameValue(''); }}
                        onKeyDown={e => e.key === 'Escape' && setRenamingId(null)}
                        className="input-field"
                        style={{ flex: 1, padding: '2px 6px', fontSize: '0.82rem', height: '26px' }}
                      />
                    </form>
                  ) : (
                    <>
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0, cursor: isStreaming ? 'not-allowed' : 'pointer', opacity: isStreaming ? 0.75 : 1 }}
                        onClick={() => {
                          if (isStreaming) return;
                          switchSession(s.id, s.messages);
                        }}
                      >
                        {s.pinned
                          ? <span style={{ fontSize: '0.7rem', flexShrink: 0 }}>📌</span>
                          : <MessageCircle size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
                        }
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                          {s.title}
                        </span>
                      </div>

                      {/* Tags display */}
                      {s.tags && s.tags.length > 0 && (
                        <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
                          {s.tags.slice(0, 2).map(tag => (
                            <span
                              key={tag.id}
                              style={{
                                width: '8px', height: '8px', borderRadius: '50%',
                                background: tag.color,
                              }}
                              title={tag.name}
                            />
                          ))}
                        </div>
                      )}
                      {/* 3-dot menu trigger */}
                      <button
                        onClick={e => { e.stopPropagation(); setChatMenuOpen(chatMenuOpen === s.id ? null : s.id); }}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                          color: 'var(--text-secondary)', opacity: 0.6, flexShrink: 0,
                          borderRadius: '4px', lineHeight: 1
                        }}
                        title="Chat options"
                      >
                        <MoreHorizontal size={14} />
                      </button>

                      {/* Dropdown */}
                      {chatMenuOpen === s.id && (
                        <div
                          onClick={e => e.stopPropagation()}
                          style={{
                            position: 'absolute', right: '8px', top: '34px', zIndex: 100,
                            background: 'var(--sidebar-bg)', border: '1px solid var(--border-color)',
                            borderRadius: '10px', padding: '4px', minWidth: '150px',
                            boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
                          }}
                        >
                          {([
                            { icon: '📌 Pin', action: () => handlePinChat(s.id, s.pinned) },
                            { icon: '✏️ Rename', action: () => { setRenamingId(s.id); setRenameValue(s.title); setChatMenuOpen(null); } },
                            { icon: '📋 Copy to clipboard', action: () => handleShareChat(s) },
                            { icon: '🗑️ Delete', action: () => handleDeleteChat(s.id), danger: true },
                          ] as Array<{ icon: string; action: () => void; danger?: boolean }>).map((item, i) => (
                            <div
                              key={i}
                              onClick={item.action}
                              style={{
                                padding: '7px 12px', borderRadius: '7px', cursor: 'pointer',
                                fontSize: '0.82rem', color: item.danger ? 'var(--danger)' : 'var(--text-primary)',
                                whiteSpace: 'nowrap'
                              }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                              {item.icon}
                            </div>
                          ))}
                          <div className="section-title" style={{ padding: '8px 12px 4px', fontSize: '0.7rem' }}>Folder</div>
                          <div
                            onClick={() => { void handleAddToFolder(s.id, null); setChatMenuOpen(null); }}
                            style={{ padding: '7px 12px', borderRadius: '7px', cursor: 'pointer', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            {s.folderId ? 'Remove from folder' : 'No folder'}
                          </div>
                          {folders.length > 0 ? folders.map(folder => (
                            <div
                              key={folder.id}
                              onClick={() => { void handleAddToFolder(s.id, folder.id); setChatMenuOpen(null); }}
                              style={{ padding: '7px 12px', borderRadius: '7px', cursor: 'pointer', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                              {s.folderId === folder.id ? '✓ ' : ''}{folder.name}
                            </div>
                          )) : (
                            <div
                              onClick={() => { setShowNewFolderModal(true); setChatMenuOpen(null); }}
                              style={{ padding: '7px 12px', borderRadius: '7px', cursor: 'pointer', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                              Create first folder
                            </div>
                          )}
                          <div className="section-title" style={{ padding: '8px 12px 4px', fontSize: '0.7rem' }}>Tags</div>
                          {tags.length > 0 ? tags.map(tag => {
                            const hasTag = Boolean(s.tags?.some(sessionTag => sessionTag.id === tag.id));
                            return (
                              <div
                                key={tag.id}
                                onClick={() => {
                                  if (hasTag) {
                                    void handleRemoveTagFromSession(s.id, tag.id);
                                  } else {
                                    void handleAddTagToSession(s.id, tag.id);
                                  }
                                  setChatMenuOpen(null);
                                }}
                                style={{ padding: '7px 12px', borderRadius: '7px', cursor: 'pointer', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                              >
                                {hasTag ? '✓ ' : ''}{tag.name}
                              </div>
                            );
                          }) : (
                            <div
                              onClick={() => { setShowNewTagModal(true); setChatMenuOpen(null); }}
                              style={{ padding: '7px 12px', borderRadius: '7px', cursor: 'pointer', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                              Create first tag
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </>
          )}



          {activeTab === 'chat' && (
            <div className="section-title">Development</div>
          )}
          <div className={`nav-item ${isCode ? 'active' : ''}${sidebarIsCompact ? ' compact' : ''}`} onClick={() => { closeMobileChrome(); setActiveTab('code'); }} title="Code Interpreter">
            <Code2 size={18} /> <span className="sidebar-label">Code Interpreter</span>
          </div>
          <div className={`nav-item ${isVm ? 'active' : ''}${sidebarIsCompact ? ' compact' : ''}`} onClick={() => { closeMobileChrome(); setActiveTab('vm'); }} title="Virtual Machines">
            <Terminal size={18} /> <span className="sidebar-label">Virtual Machines</span>
          </div>
          <div className={`nav-item ${isDocker ? 'active' : ''}${sidebarIsCompact ? ' compact' : ''}`} onClick={() => { closeMobileChrome(); setActiveTab('docker'); }} title="Docker Containers">
            <Box size={18} /> <span className="sidebar-label">Docker Containers</span>
          </div>
          {activeTab === 'chat' && (
            <div className="section-title">Account</div>
          )}
          <div className={`nav-item ${isSettings ? 'active' : ''}${sidebarIsCompact ? ' compact' : ''}`} onClick={() => { closeMobileChrome(); setActiveTab('settings'); }} title="Settings">
            <Settings size={18} /> <span className="sidebar-label">Settings</span>
          </div>

          <div style={{ marginTop: 'auto', paddingTop: '20px', borderTop: '1px solid var(--border-color)', margin: sidebarIsCompact ? '20px 10px 10px' : '20px 12px 12px 12px' }}>
            <div className={`nav-item${sidebarIsCompact ? ' compact' : ''}`} style={{ color: 'var(--danger)', margin: 0 }} onClick={handleLogout} title="Logout">
              <LogOut size={18} /> <span className="sidebar-label">Logout</span>
            </div>
          </div>
        </div>
      </aside>
      )}
      {/* New Folder Modal */}
      {showNewFolderModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}
          onClick={() => setShowNewFolderModal(false)}
        >
          <div style={{
            background: 'var(--sidebar-bg)', border: '1px solid var(--border-color)',
            borderRadius: '16px', padding: '24px', width: '320px', maxWidth: '90vw'
          }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: '1rem' }}>New Folder</h3>
            <input
              type="text"
              placeholder="Folder name"
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              className="input-field"
              style={{ width: '100%', marginBottom: '12px' }}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleCreateFolder()}
            />
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              {['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'].map(color => (
                <button
                  key={color}
                  onClick={() => setNewFolderColor(color)}
                  style={{
                    width: '28px', height: '28px', borderRadius: '50%', border: newFolderColor === color ? '2px solid white' : '2px solid transparent',
                    background: color, cursor: 'pointer'
                  }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowNewFolderModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreateFolder}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* New Tag Modal */}
      {showNewTagModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}
          onClick={() => setShowNewTagModal(false)}
        >
          <div style={{
            background: 'var(--sidebar-bg)', border: '1px solid var(--border-color)',
            borderRadius: '16px', padding: '24px', width: '320px', maxWidth: '90vw'
          }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: '1rem' }}>New Tag</h3>
            <input
              type="text"
              placeholder="Tag name"
              value={newTagName}
              onChange={e => setNewTagName(e.target.value)}
              className="input-field"
              style={{ width: '100%', marginBottom: '12px' }}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleCreateTag()}
            />
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              {['#10b981', '#6366f1', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'].map(color => (
                <button
                  key={color}
                  onClick={() => setNewTagColor(color)}
                  style={{
                    width: '28px', height: '28px', borderRadius: '50%', border: newTagColor === color ? '2px solid white' : '2px solid transparent',
                    background: color, cursor: 'pointer'
                  }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowNewTagModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreateTag}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="main-content">
        {activeTab !== 'openclaw' && isMobileViewport && (
        <header className="mobile-topbar">
          <button
            type="button"
            className="mobile-topbar-button"
            onClick={() => {
              setMobileSidebarOpen(open => !open);
              setModelMenuOpen(false);
              setMobileHeaderMenuOpen(false);
            }}
            aria-label="Open navigation drawer"
            title="Open navigation"
          >
            <Menu size={18} />
          </button>

          <div className="mobile-topbar-center">
            <button
              type="button"
              className="mobile-topbar-pill"
              onClick={() => {
                setModelMenuOpen(open => !open);
                setMobileHeaderMenuOpen(false);
              }}
              disabled={modelsLoading || models.length === 0}
              style={{ opacity: modelsLoading || models.length === 0 ? 0.7 : 1 }}
            >
              <span className="mobile-topbar-pill-label">{selectedModelButtonLabel}</span>
              <ChevronDown
                size={15}
                style={{ transform: modelMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.18s ease' }}
              />
            </button>

            {modelMenuOpen && (
              <div className="mobile-topbar-dropdown">
                {models.length === 0 ? (
                  <div className="mobile-topbar-dropdown-empty">
                    {modelsLoading
                      ? 'Loading models...'
                      : needsHuggingFaceTokenForDiscovery
                        ? 'Add a Hugging Face token in Settings to list router models.'
                        : 'No chat models available for the selected platform.'}
                  </div>
                ) : (
                  <>
                    {ollamaChatModels.length > 0 && (
                      <div className="mobile-topbar-dropdown-section">Installed Ollama Models</div>
                    )}
                    {ollamaChatModels.map(model => {
                      const active = model.id === selectedModel;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          className={`mobile-topbar-menu-item${active ? ' is-active' : ''}`}
                          onClick={() => selectModel(model)}
                        >
                          <span>{model.name}</span>
                          <span>{active ? 'Selected' : 'Local'}</span>
                        </button>
                      );
                    })}
                    {huggingFaceChatModels.length > 0 && (
                      <div className="mobile-topbar-dropdown-section">Hugging Face Models</div>
                    )}
                    {huggingFaceChatModels.map(model => {
                      const active = model.id === selectedModel;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          className={`mobile-topbar-menu-item${active ? ' is-active' : ''}`}
                          onClick={() => selectModel(model)}
                        >
                          <span>{model.name}</span>
                          <span>{active ? 'Selected' : 'Cloud'}</span>
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="mobile-topbar-side">
            <button
              type="button"
              className="mobile-topbar-button"
              onClick={() => {
                setMobileHeaderMenuOpen(open => !open);
                setModelMenuOpen(false);
              }}
              aria-label="Open chat tools"
              title="Chat tools"
            >
              <MoreHorizontal size={18} />
            </button>

            {mobileHeaderMenuOpen && (
              <div className="mobile-topbar-dropdown mobile-topbar-dropdown-right">
                <button
                  type="button"
                  className={`mobile-topbar-menu-item${internetEnabled ? ' is-active' : ''}`}
                  onClick={() => {
                    toggleInternetAccess();
                    setMobileHeaderMenuOpen(false);
                  }}
                >
                  <span>Internet</span>
                  <span>{internetEnabled ? 'On' : 'Off'}</span>
                </button>
                <button
                  type="button"
                  className={`mobile-topbar-menu-item${ragEnabled ? ' is-active' : ''}`}
                  onClick={() => {
                    setRagEnabled(value => !value);
                    setMobileHeaderMenuOpen(false);
                  }}
                >
                  <span>Knowledge Base</span>
                  <span>{ragEnabled ? 'On' : 'Off'}</span>
                </button>
                {selectedModelIsOllama && (
                  <button
                    type="button"
                    className="mobile-topbar-menu-item"
                    onClick={() => {
                      void stopSelectedModel();
                      setMobileHeaderMenuOpen(false);
                    }}
                    disabled={!selectedModelName || stoppingModel}
                  >
                    <span>{stoppingModel ? 'Stopping model...' : 'Stop model'}</span>
                    <Square size={13} />
                  </button>
                )}
              </div>
            )}
          </div>
        </header>
        )}

        {activeTab !== 'openclaw' && !isMobileViewport && (
        <header className="header">
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {sidebarIsCompact && (
              <button
                type="button"
                className="btn-icon"
                onClick={toggleSidebarCollapsed}
                aria-label="Expand sidebar"
                title="Expand sidebar"
              >
                <ChevronRight size={18} />
              </button>
            )}
            <button
              type="button"
              className="glass-panel"
              onClick={() => setModelMenuOpen(open => !open)}
              disabled={modelsLoading || models.length === 0}
              style={{
                padding: '8px 12px',
                minWidth: '230px',
                maxWidth: '360px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                cursor: modelsLoading ? 'wait' : models.length === 0 ? 'not-allowed' : 'pointer',
                color: 'var(--text-primary)',
                opacity: modelsLoading || models.length === 0 ? 0.7 : 1,
                border: modelMenuOpen ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                boxShadow: modelMenuOpen ? '0 0 0 2px var(--focus-ring)' : undefined,
                transition: 'all 0.18s ease'
              }}
            >
              <div style={{
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent-border)',
                flexShrink: 0
              }}>
                <Bot size={16} color="var(--accent-primary)" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.6px', lineHeight: 1.2 }}>
                  {selectedModelOption ? `${selectedModelOption.sourceLabel} model` : 'Model'}
                </span>
                <span style={{ fontSize: '0.9rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                  {selectedModelName || (modelsLoading ? 'Loading models...' : models.length === 0 ? 'No models found' : 'Select a model')}
                </span>
              </div>
              <ChevronDown
                size={16}
                color="var(--text-secondary)"
                style={{ flexShrink: 0, transform: modelMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.18s ease' }}
              />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {selectedModelIsOllama && (
                <>
                  <button
                    type="button"
                    className="glass-panel"
                    onClick={() => void stopSelectedModel()}
                    disabled={!selectedModelName || stoppingModel}
                    title={selectedModelName
                      ? `Stop ${selectedModelName} in Ollama so the next request reloads it cleanly.`
                      : 'Select a model first.'}
                    style={{
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: !selectedModelName || stoppingModel ? 'not-allowed' : 'pointer',
                      color: 'var(--text-primary)',
                      opacity: !selectedModelName || stoppingModel ? 0.7 : 1,
                      border: '1px solid var(--border-color)',
                      background: 'rgba(255,255,255,0.03)',
                      transition: 'all 0.18s ease'
                    }}
                  >
                    {stoppingModel
                      ? <Loader2 size={16} color="var(--text-secondary)" style={{ animation: 'spin 1s linear infinite' }} />
                      : <Square size={16} color="var(--text-secondary)" />}
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {stoppingModel ? 'Stopping model...' : 'Stop model'}
                    </span>
                  </button>
                  <HelpHint text="Stops the selected Ollama model so the next request starts from a fresh load. Use this if a local model gets stuck while loading or after a failed run." />
                </>
              )}
              {modelControlNote && (
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', maxWidth: '280px' }}>
                  {modelControlNote}
                </span>
              )}
            </div>

            {modelMenuOpen && (
              <div
                className="glass-panel"
                style={{
                  position: 'absolute',
                  top: '48px',
                  left: 0,
                  zIndex: 120,
                  width: 'min(360px, calc(100vw - 48px))',
                  minWidth: '280px',
                  maxHeight: '340px',
                  overflowY: 'auto',
                  padding: '6px',
                  borderRadius: '14px',
                  background: 'var(--bg-surface)',
                  boxShadow: '0 18px 48px rgba(0,0,0,0.45)'
                }}
              >
                {models.length === 0 ? (
                  <div style={{ padding: '14px 12px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    {modelsLoading
                      ? 'Loading models...'
                      : needsHuggingFaceTokenForDiscovery
                        ? 'Add a Hugging Face token in Settings to list router models.'
                        : 'No chat models available for the selected platform.'}
                  </div>
                ) : (
                  <>
                  {ollamaChatModels.length > 0 && (
                    <div style={{
                      padding: '8px 10px',
                      fontSize: '0.72rem',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.8px',
                      borderBottom: '1px solid var(--border-color)',
                      marginBottom: '4px'
                    }}>
                      Installed Ollama Models
                    </div>
                  )}
                  {ollamaChatModels.map(model => {
                    const active = model.id === selectedModel;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => selectModel(model)}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '10px',
                          border: 'none',
                          borderRadius: '10px',
                          background: active ? 'var(--accent-soft)' : 'transparent',
                          color: active ? 'var(--accent-primary)' : 'var(--text-primary)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          fontFamily: 'inherit'
                        }}
                        onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--surface-hover)'; }}
                        onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <div style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '8px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                          border: active ? '1px solid var(--accent-border)' : '1px solid var(--border-color)',
                          flexShrink: 0
                        }}>
                          {active ? <Check size={14} /> : <Bot size={14} color="var(--text-secondary)" />}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: '0.88rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {model.name}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            Local Ollama model
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {huggingFaceChatModels.length > 0 && (
                    <div style={{
                      padding: '8px 10px',
                      fontSize: '0.72rem',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.8px',
                      borderTop: ollamaChatModels.length > 0 ? '1px solid var(--border-color)' : 'none',
                      borderBottom: '1px solid var(--border-color)',
                      marginTop: ollamaChatModels.length > 0 ? '4px' : 0,
                      marginBottom: '4px'
                    }}>
                      Hugging Face Models
                    </div>
                  )}
                  {huggingFaceChatModels.map(model => {
                    const active = model.id === selectedModel;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => selectModel(model)}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '10px',
                          border: 'none',
                          borderRadius: '10px',
                          background: active ? 'var(--accent-soft)' : 'transparent',
                          color: active ? 'var(--accent-primary)' : 'var(--text-primary)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          fontFamily: 'inherit'
                        }}
                        onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--surface-hover)'; }}
                        onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <div style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '8px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: active ? 'var(--accent-soft)' : 'var(--bg-glass)',
                          border: active ? '1px solid var(--accent-border)' : '1px solid var(--border-color)',
                          flexShrink: 0
                        }}>
                          {active ? <Check size={14} /> : <Bot size={14} color="var(--text-secondary)" />}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: '0.88rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {model.name}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            {isHuggingFaceRouterUrl(selectedHuggingFaceBaseUrl) ? 'Hugging Face Inference Providers' : model.sourceLabel}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  </>
                )}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                className="glass-panel"
                style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', border: internetEnabled ? '1px solid var(--accent-primary)' : undefined, background: internetEnabled ? 'var(--accent-soft)' : undefined }}
                onClick={() => toggleInternetAccess()}
              >
                <Globe size={16} color={internetEnabled ? 'var(--accent-primary)' : 'var(--text-secondary)'} />
                <span style={{ fontSize: '0.85rem', color: internetEnabled ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>Internet</span>
              </button>
              <HelpHint text="When enabled, ViewLlama can run read-only public web searches and fetch cited pages before answering, while still blocking private or local network targets." />
            </div>
            <button
              className={`glass-panel`}
              style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', border: ragEnabled ? '1px solid var(--accent-primary)' : undefined, background: ragEnabled ? 'var(--accent-soft)' : undefined }}
              onClick={() => setRagEnabled(!ragEnabled)}
            >
              <BookOpen size={16} color={ragEnabled ? 'var(--accent-primary)' : 'var(--text-secondary)'} />
              <span style={{ fontSize: '0.85rem', color: ragEnabled ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>RAG</span>
            </button>
            <HelpHint text="When enabled, each new chat prompt searches the Knowledge Base first and injects matching document context into the request." />
          </div>
        </header>
        )}

        {activeTab !== 'openclaw' && selectedModelIsOllama && !isMobileViewport && (
        <div className="ollama-health-strip" style={{ borderTop: 'none', padding: '6px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
            <div className="ollama-health-badge" style={{ color: chatHealthTone, padding: '4px 8px', fontSize: '0.72rem' }}>
              {ollamaHealthLoading
                ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                : ollamaHealth?.status === 'online'
                  ? <Wifi size={12} />
                  : ollamaHealth?.status === 'degraded'
                    ? <AlertCircle size={12} />
                    : <WifiOff size={12} />}
              <span>{chatHealthStatusLabel}</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
              title={ollamaHealth?.online && ollamaHealth.loadedModels.length > 0 ? 'Loaded: ' + ollamaHealth.loadedModels.join(', ') : undefined}>
              {ollamaHealth?.online
                ? (ollamaHealth.version || 'Ollama') + ' ' + String.fromCharCode(183) + ' ' + ollamaHealth.installedModelCount + ' installed ' + String.fromCharCode(183) + ' ' + ollamaHealth.loadedModelCount + ' loaded'
                : ollamaHealth?.error || 'Waiting for Ollama health...'}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            <button
              type="button"
              className="btn-icon"
              onClick={() => void refreshOllamaHealth(selectedModelName, userSettings?.ollamaHost || 'http://127.0.0.1:11434')}
              disabled={ollamaHealthLoading}
              title="Refresh Ollama health"
            >
              {ollamaHealthLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
            </button>

            {lastSubmittedDraft && (
              <>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => void retryLastDraft()}
                  disabled={isStreaming}
                  title="Retry last message"
                >
                  <Redo2 size={13} />
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => void retryLastDraft({ disableInternet: true })}
                  disabled={isStreaming}
                  title="Retry without web"
                >
                  <Globe size={13} />
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => void retryLastDraft({ stopModelFirst: true })}
                  disabled={isStreaming || stoppingModel}
                  title="Stop model and retry"
                >
                  <Square size={12} />
                </button>
              </>
            )}
          </div>
        </div>
        )}

        {activeTab === 'docs' ? (
          <KnowledgeBase onUseInChat={(ctx, sources) => {
            setRagContext(ctx);
            setRagContextSources(sources || []);
            openMainChat();
          }} />
        ) : activeTab === 'openclaw' ? (
          <OpenClawWorkspace 
            view={openClawView}
            knowledgeBaseContent={(
              <KnowledgeBase onUseInChat={(ctx, sources) => {
                setRagContext(ctx);
                setRagContextSources(sources || []);
                openMainChat();
              }} />
            )}
            onNavigateToChat={openMainChat}
            onNavigateToKnowledgeBase={openOpenClawKnowledgeBase}
            onNavigateToWorkspace={openOpenClawWorkspace}
            onNavigateToSettings={openSettings}
          />
        ) : activeTab === 'settings' ? (
          <SettingsPanel onSettingsChange={(s) => {
            setUserSettings(s);
            void fetchChatModels(s);
            if (s.chatModel) {
              const nextModelId = buildChatModelOptionId(s.chatModelProvider || 'ollama', s.chatModel);
              setSelectedModel(nextModelId);
            }
          }} />
        ) : (
        <>
        <div className="chat-scroll-shell">
        <div ref={chatAreaRef} className="chat-area" onScroll={handleChatScroll}>
          {chatHistory.length === 0 ? (
            <div style={{ textAlign: 'center', margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ 
                width: '80px', height: '80px', 
                background: 'var(--accent-gradient)', 
                borderRadius: '24px', 
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 24px',
                boxShadow: '0 12px 32px var(--accent-glow)'
              }}>
                <Cpu size={40} color="white" />
              </div>
              <h1 style={{ fontSize: '2.5rem', marginBottom: '16px' }}>What can I build for you?</h1>
              <p style={{ color: 'var(--text-secondary)', maxWidth: '500px', margin: '0 auto', lineHeight: '1.6' }}>
                {internetEnabled
                  ? 'Internet mode is ready. Each prompt can trigger read-only public web searches and page fetches with citations while still blocking private and local network targets.'
                  : selectedModelProvider === 'huggingface'
                    ? 'Select a Hugging Face model from the top dropdown and start chatting. The default router needs your HF token from Settings, while custom HF-compatible endpoints can be used with their own base URL.'
                    : 'I&apos;m connected to your local Ollama instance. Select a model from the top dropdown and start chatting. None of your data leaves this machine.'}
              </p>
            </div>
          ) : (
            chatHistory.map((msg, i) => (
              <div key={i} className={`message ${msg.role} animate-fade-in`} style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{ display: 'flex', gap: '16px', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row', maxWidth: '100%' }}>
                  <div className="avatar">
                    {msg.role === 'user' ? <User size={20} color="var(--text-secondary)" /> : <Bot size={24} color="white" />}
                  </div>
                  <div suppressHydrationWarning className={`message-content${isStreaming && msg.role === 'assistant' && i === chatHistory.length - 1 && msg.content ? ' streaming-cursor' : ''}`}>
                    {/* Images in this message */}
                    {msg.images && msg.images.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                        {msg.images.map((image, idx) => (
                          <img
                            key={idx}
                            src={getImageSrc(image)}
                            alt={getImageName(image, idx)}
                            title={getImageName(image, idx)}
                            style={{ maxWidth: '280px', maxHeight: '220px', borderRadius: '10px', objectFit: 'cover', border: '1px solid rgba(255,255,255,0.1)' }}
                          />
                        ))}
                      </div>
                    )}
                    {/* File attachment pills */}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                        {msg.attachments.map((a, idx) => (
                          <div key={idx} style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            padding: '4px 10px', borderRadius: '20px',
                            background: 'var(--accent-faint)', border: '1px solid var(--accent-border)',
                            fontSize: '0.75rem', color: 'var(--accent-primary)'
                          }}
                          title={`${a.statusMessage || 'Attached file'} (${formatBytes(getAttachmentSize(a))})`}
                          >
                            <Paperclip size={11} /> {a.name}
                            {a.truncated && <span style={{ color: 'var(--text-secondary)' }}>truncated</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Native thinking field — Gemma4, future Ollama models */}
                    {msg.thinking && (
                      <ThinkingBlock
                        content={msg.thinking}
                        isStreaming={isStreaming && i === chatHistory.length - 1 && !msg.content}
                      />
                    )}
                    {/*<think> tag based thinking — DeepSeek-R1, QwQ, etc. */}
                    {renderMessageContent(msg.content, isStreaming, i === chatHistory.length - 1, msg.presentation, msg.sources)}
                    {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                      <SourceChips sources={msg.sources} />
                    )}
                    {msg.role === 'assistant' && msg.content.trim() && (
                      <AssistantDownloads content={msg.content} index={i} presentation={msg.presentation} sessionId={currentSessionId} messageId={String(i)} onSaveArtifact={() => { if (currentSessionId) loadCanvasArtifacts(currentSessionId); }} />
                    )}
                  </div>
                </div>
                {msg.meta && (
                  <div style={{ 
                    fontSize: '0.75rem', 
                    color: 'var(--text-secondary)', 
                    marginLeft: msg.role === 'assistant' ? '56px' : '0',
                    marginRight: msg.role === 'user' ? '56px' : '0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    marginTop: '4px'
                  }}>
                    <span><Activity size={12} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }}/>{msg.meta.tps.toFixed(1)} tok/s</span>
                    <span>{msg.meta.tokens} tokens</span>
                    <span>{msg.meta.duration.toFixed(2)}s</span>
                  </div>
                )}
                {isStreaming && i === chatHistory.length - 1 && liveStats && !msg.meta && (
                  <div style={{ 
                    fontSize: '0.75rem', 
                    color: 'var(--accent-primary)', 
                    marginLeft: msg.role === 'assistant' ? '56px' : '0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    marginTop: '4px',
                    opacity: 0.8
                  }}>
                    {liveStats.tokens > 0 ? (
                      <>
                        <span><Activity size={12} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }}/>{liveStats.tps.toFixed(1)} tok/s</span>
                        <span>{liveStats.tokens} tokens</span>
                        <span className="animate-pulse">Generating...</span>
                      </>
                    ) : (
                      <span className="animate-pulse">{getStreamPhaseLabel(streamPhase)}</span>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
        {showScrollToBottom && (
          <button
            type="button"
            className="scroll-to-bottom-button"
            onClick={() => scrollToBottom('smooth')}
            aria-label="Scroll to latest message"
            title="Jump to latest message"
          >
            <ChevronDown size={19} />
          </button>
        )}
        </div>

        <div className="input-area">
          {/* Pending attachment previews */}
          {(pendingImages.length > 0 || pendingAttachments.length > 0 || processingAttachments || attachmentError) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '8px 12px 0', marginBottom: '4px' }}>
              {pendingImages.map((image, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={image.dataUrl} alt={image.name} title={`${image.name} (${formatBytes(image.size)})`} style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.15)' }} />
                  <button onClick={() => {
                    setPendingImages(p => p.filter((_, j) => j !== i));
                  }} style={{ position: 'absolute', top: '-6px', right: '-6px', background: 'var(--danger)', border: 'none', borderRadius: '50%', width: '18px', height: '18px', cursor: 'pointer', color: 'white', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>
              ))}
              {pendingAttachments.map((a, i) => (
                <div key={i} title={`${a.statusMessage || 'Attached file'} (${formatBytes(getAttachmentSize(a))})`} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '20px', background: 'var(--accent-faint)', border: '1px solid var(--accent-border)', fontSize: '0.78rem', color: 'var(--accent-primary)', position: 'relative' }}>
                  <Paperclip size={12} /> {a.name}
                  <span style={{ color: 'var(--text-secondary)' }}>{a.modelInput === 'metadata-only' ? 'metadata' : `${Math.min(a.textCharCount ?? getAttachmentContent(a).length, CHAT_ATTACHMENT_TEXT_LIMIT).toLocaleString()} chars`}</span>
                  <button onClick={() => setPendingAttachments(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', marginLeft: '2px', padding: 0, fontSize: '11px' }}>✕</button>
                </div>
              ))}
              {processingAttachments && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '20px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Processing file
                </div>
              )}
              {attachmentError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '20px', background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger)', fontSize: '0.78rem', color: '#fca5a5' }}>
                  {attachmentError}
                  <button onClick={() => setAttachmentError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', marginLeft: '2px', padding: 0, fontSize: '11px' }}>✕</button>
                </div>
              )}
            </div>
          )}
          <div className="glass-panel" style={{ display: 'flex', padding: '8px', alignItems: 'center', gap: '8px', background: 'var(--input-shell-bg)' }}>
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="*/*"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            {/* Paperclip button */}
            <button
              className="btn btn-secondary"
              style={{ padding: '10px', borderRadius: '10px', flexShrink: 0 }}
              onClick={() => fileInputRef.current?.click()}
              title="Attach files or images"
              disabled={isStreaming || processingAttachments}
            >
              {processingAttachments ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Paperclip size={16} />}
            </button>
            <input 
              type="text" 
              className="input-field" 
              placeholder={models.length > 0 ? (internetEnabled ? '🌐 Internet mode — the model will search when needed...' : ragEnabled ? '🔍 RAG mode — asking with knowledge base context...' : ragContext ? '📎 KB context attached — type your question...' : 'Message local model...') : 'Waiting for Ollama to connect...'}
              style={{ background: 'transparent', border: 'none', padding: '8px', boxShadow: 'none' }}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              disabled={isStreaming}
            />
            {ragContext && !ragEnabled && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '8px', background: 'var(--accent-soft)', fontSize: '0.75rem', color: 'var(--accent-primary)', whiteSpace: 'nowrap', cursor: 'pointer' }}
                title="Clear attached KB context" onClick={() => setRagContext(null)}>
                <BookOpen size={14} /> Context attached ✕
              </div>
            )}
            {isStreaming ? (
              <button 
                className="btn btn-secondary" 
                style={{ padding: '12px', borderRadius: '12px', color: 'var(--danger)', borderColor: 'var(--danger)' }}
                onClick={handleStop}
              >
                <Square size={18} fill="currentColor" />
              </button>
            ) : (
              <button 
                className="btn btn-primary" 
                style={{ padding: '12px', borderRadius: '12px', opacity: (!message.trim() && pendingImages.length === 0 && pendingAttachments.length === 0) || processingAttachments ? 0.5 : 1 }}
                onClick={() => void handleSendMessage()}
                disabled={processingAttachments || (!message.trim() && pendingImages.length === 0 && pendingAttachments.length === 0)}
              >
                <Send size={18} />
              </button>
            )}
          </div>
          {(internetEnabled || ragEnabled || ragContext) && (
            <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {internetEnabled && (
                <span>Internet mode lets the model run read-only public web searches and page fetches, shows citations, and blocks private or local addresses.</span>
              )}
              {ragEnabled && (
                <span>RAG mode adds matching Knowledge Base passages before generation.</span>
              )}
              {ragContext && (
                <span>Knowledge Base context is attached to the next message.</span>
              )}
            </div>
          )}
        </div>
        </>
        )}

        {/* Canvas rail for chat */}
        {activeTab === 'chat' && canvasArtifacts.length > 0 && !isMobileViewport && (
          <aside style={{
            width: canvasRailCollapsed ? '0' : '320px',
            minWidth: canvasRailCollapsed ? '0' : '320px',
            borderLeft: canvasRailCollapsed ? 'none' : '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            transition: 'width 0.2s ease, min-width 0.2s ease'
          }}>
            <div style={{
              padding: '12px 16px',
              borderBottom: canvasRailCollapsed ? 'none' : '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--accent-primary)' }}>Canvas</span>
              <button type="button" onClick={() => setCanvasRailCollapsed(true)} style={{
                background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px'
              }} title="Close canvas"><X size={14} /></button>
            </div>
            {!canvasRailCollapsed && (
              <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
                <CanvasPanel
                  artifacts={canvasArtifacts}
                  onUpdate={async (id, content, name) => {
                    const res = await fetch(`/api/canvas/artifacts/${id}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ content, name })
                    });
                    if (res.ok) {
                      const data = await res.json();
                      setCanvasArtifacts(prev => prev.map(a => a.id === id ? { ...a, content, name, version: data.artifact.version } : a));
                    }
                  }}
                  onDelete={async (id) => { await deleteArtifactById(id); }}
                  onDownload={(artifact) => {
                    const blob = new Blob([artifact.content || ''], { type: artifact.mimeType });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = artifact.name;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  onFetchContent={async (id) => {
                    const res = await fetch(`/api/canvas/artifacts/${id}`);
                    if (res.ok) {
                      const data = await res.json();
                      return data.artifact;
                    }
                    return null;
                  }}
                />
              </div>
            )}
          </aside>
        )}

        {/* Canvas rail toggle button */}
      </main>

      <style suppressHydrationWarning dangerouslySetInnerHTML={{__html: `
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-pulse {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
      `}} />
    </div>
  );
}
