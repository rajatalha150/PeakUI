"use client";

import React, { useEffect, useMemo, useRef, useState, useDeferredValue, useCallback, memo } from 'react';
import { randomUUID } from '@/lib/uuid';
import Image from 'next/image';
import { Activity, AlertCircle, BookOpen, Bot, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Database, Download, FileText, Folder, Globe, ListTodo, Loader2, Menu, MessageSquare, MoreHorizontal, Paperclip, Pin, Plus, Redo2, RefreshCw, Send, Server, Shield, Square, Star, Tag, Trash2, Wand2, Wifi, WifiOff, X } from 'lucide-react';
import { ChatMessageContent, AssistantDownloads, ThinkingBlock } from './ChatMessageContent';
import HelpHint from './HelpHint';
import SourceChips from './SourceChips';
import MessageRenderBoundary from './MessageRenderBoundary';
import KnowledgeBaseTreePopover from './KnowledgeBaseTreePopover';
import Popover from './Popover';
import { mergeMessageSources, normalizeMessageSources, type MessageSource } from '@/lib/message-sources';
import { type ResponsePresentation } from '@/lib/response-format';
import {
  buildOpenClawTaskStateBrief,
  buildOpenClawWorkspaceBrief,
  DEFAULT_OPENCLAW_AGENT_PREFERENCES,
  DEFAULT_OPENCLAW_TASK_STATE,
  OPENCLAW_AGENT_MODE_OPTIONS,
  OPENCLAW_RESPONSE_STYLE_OPTIONS,
  createOpenClawChecklistItems,
  extractOpenClawChecklistSuggestions,
  type OpenClawAgentMode,
  type OpenClawAgentPreferences,
  type OpenClawTaskState,
  type OpenClawResponseStyle,
} from '@/lib/openclaw-agent';
import {
  hasPendingContinuation,
  isLowSignalWorkspacePrompt,
  type SessionAnalytics,
  type SessionAutoContinueMode,
} from '@/lib/session-intelligence';
import {
  applyPersonaTemplate,
  DEFAULT_OPENCLAW_PERSONA,
  DEFAULT_OPENCLAW_USER_PROFILE,
  type OpenClawPersona,
  type OpenClawPersonaTemplateId,
  type OpenClawUserProfile,
} from '@/lib/openclaw-persona';
import type { OllamaHealthSummary } from '@/lib/ollama-health';
import ShellCommandModal from './ShellCommandModal';
import ShellOutput from './ShellOutput';
import CanvasPanel from './CanvasPanel';
import ShellSettingsPanel from './ShellSettingsPanel';
import ObjectUrlImage from './ObjectUrlImage';
import { Settings } from 'lucide-react';
import { getStreamPhaseLabel, isServerStreamStatus, type UiStreamPhase } from '@/lib/stream-status';
import { applyTheme } from '@/lib/theme-options';
import { useStickyScroll } from '@/lib/use-sticky-scroll';
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  formatBytes,
  isImageFile,
  normalizeImageMimeType,
  type ExtractedFilePayload,
} from '@/lib/file-shared';
import {
  buildEffectiveOpenClawToolAccess,
  type EffectiveOpenClawToolAccess,
} from '@/lib/openclaw-tool-access';
import {
  extractOpenClawToolRequest,
  stripAllToolTags,
  type OpenClawBrowserToolRequest,
  type OpenClawCodeToolRequest,
  type OpenClawCsvDocumentToolRequest,
  type OpenClawEmailDocumentToolRequest,
  type OpenClawFetchSummarizeToolRequest,
  type OpenClawFilesystemToolRequest,
  type OpenClawMarkdownDocumentToolRequest,
  type OpenClawPdfDocumentToolRequest,
  type OpenClawSlidesDocumentToolRequest,
  type OpenClawArchiveDocumentToolRequest,
  type OpenClawCalendarDocumentToolRequest,
  type OpenClawMermaidDocumentToolRequest,
  type OpenClawTaxReturnToolRequest,
  type OpenClawToolRequest,
  type OpenClawUwafBrowserToolRequest,
  type OpenClawWorkbookDocumentToolRequest,
  type OpenClawWordDocumentToolRequest,
} from '@/lib/openclaw-tools';
import UwafNetworkPanel from './UwafNetworkPanel';
import LiveBrowserView from './LiveBrowserView';
import BrowserModal from './BrowserModal';
import { reportClientError } from '@/lib/client-error-reporting';
import type { CanvasArtifactRecord, CanvasArtifactRevisionRecord } from '@/lib/canvas-artifacts';
import { isBinaryArtifact } from '@/lib/canvas-rendering';

type OpenClawProvider = 'ollama' | 'openai-compatible';
type ImageAttachmentMode = 'vision-only' | 'vision+ocr' | 'ocr-only';
const MOBILE_BREAKPOINT = 960;
const HUMAN_BROWSER_ASSIST_TIMEOUT_MS = 10 * 60 * 1000;
const SESSION_PAGE_SIZE = 15;
const OPENCLAW_CANVAS_MINIMIZED_STORAGE = 'peakui-openclaw-canvas-minimized';
const OPENCLAW_MODEL_FAVORITES_STORAGE = 'peakui-openclaw-model-favorites';
const IMAGE_ATTACHMENT_MODE_OPTIONS: Array<{ value: ImageAttachmentMode; label: string }> = [
  { value: 'vision-only', label: 'Vision only' },
  { value: 'vision+ocr', label: 'Vision + OCR' },
  { value: 'ocr-only', label: 'OCR only' },
];

interface OpenClawSession {
  id: string;
  title: string;
  updatedAt: number;
  pinned: boolean;
  surface: 'openclaw';
  messages: OpenClawMessage[];
  folderId?: string | null;
  tags?: Array<{ id: string; name: string; color: string }>;
  summary?: string | null;
  contextSummary?: string | null;
  contextSummaryUpdatedAt?: number | null;
  analytics?: SessionAnalytics | null;
  autoContinueMode: SessionAutoContinueMode;
  autoContinueMaxSteps: number;
  lastAutoContinueAt?: number | null;
  parentSessionId?: string | null;
  branchFromMessageId?: string | null;
  branchLabel?: string | null;
  branchChildrenCount: number;
  branchDepth: number;
  ragEnabled?: boolean;
  ragQuery?: string | null;
  ragSources?: MessageSource[];
}

interface OpenClawWorkspaceRecord {
  id: string;
  slug: string;
  name: string;
  description: string;
  autoGitBackup: boolean;
  createdAt: string;
  updatedAt: string;
  relativePath: string;
  containerPath: string;
  hostPath: string;
  bootPath: string;
  toolsPath: string;
  skillsPath: string;
  skillCount: number;
  skillFiles: string[];
  lastGitBackupAt?: string;
  lastGitBackupCommit?: string;
  lastGitBackupError?: string;
}

interface AutomationWorkerState {
  running: boolean;
  startedAt: string | null;
  lastTickAt: string | null;
  loopCount: number;
  lastError: string | null;
}

interface AutomationHeartbeatState {
  id: string;
  enabled: boolean;
  intervalMinutes: number;
  staleAfterMinutes: number;
  promptTemplate: string;
  deliveryMode: 'nudge' | 'background-run';
  targetSessionId: string | null;
  targetWorkspaceId: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string;
  lastError: string | null;
}

interface AutomationScheduleState {
  id: string;
  name: string;
  prompt: string;
  deliveryMode: 'nudge' | 'background-run';
  targetSessionId: string | null;
  targetWorkspaceId: string | null;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastStatus: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AutomationMonitorState {
  id: string;
  name: string;
  kind: 'url' | 'file';
  deliveryMode: 'nudge' | 'background-run';
  targetSessionId: string | null;
  targetWorkspaceId: string | null;
  target: string;
  enabled: boolean;
  checkIntervalSeconds: number;
  triggerMode: 'changed' | 'contains' | 'missing';
  expectedPattern: string | null;
  nextCheckAt: string | null;
  lastCheckedAt: string | null;
  lastStatus: string;
  lastError: string | null;
  lastSummary: string | null;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AutomationNotificationState {
  id: string;
  kind: string;
  sourceKind: string | null;
  sourceId: string | null;
  sessionId: string | null;
  title: string;
  message: string;
  createdAt: string;
  seenAt: string | null;
  dismissedAt: string | null;
}

interface AutomationExecutionRunState {
  id: string;
  sourceKind: string;
  sourceId: string | null;
  deliveryMode: string;
  sessionId: string | null;
  workspaceId: string | null;
  title: string;
  prompt: string;
  provider: string;
  model: string;
  status: string;
  resultPreview: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

const DEFAULT_AUTOMATION_WORKER_STATE: AutomationWorkerState = {
  running: false,
  startedAt: null,
  lastTickAt: null,
  loopCount: 0,
  lastError: null,
};

const DEFAULT_AUTOMATION_HEARTBEAT_STATE: AutomationHeartbeatState = {
  id: '',
  enabled: false,
  intervalMinutes: 240,
  staleAfterMinutes: 180,
  promptTemplate: 'Review stale WorkSpaces tasks and suggest the single best next action.',
  deliveryMode: 'nudge',
  targetSessionId: null,
  targetWorkspaceId: null,
  nextRunAt: null,
  lastRunAt: null,
  lastStatus: 'idle',
  lastError: null,
};

interface OpenClawFolder {
  id: string;
  name: string;
  color: string;
  _count?: { sessions: number };
}

interface OpenClawTag {
  id: string;
  name: string;
  color: string;
  _count?: { sessions: number };
}

interface OpenClawModel {
  name: string;
  model: string;
}

interface OpenClawMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  hidden?: boolean;
  toolRequest?: 'shell' | 'filesystem' | 'web' | 'code' | 'browser' | 'unified_browser' | 'tax_return' | 'pdf_document' | 'workbook_document' | 'word_document' | 'csv_document' | 'email_document' | 'markdown_document' | 'slides_document' | 'archive_document' | 'calendar_document' | 'mermaid_document' | 'fetch_summarize';
  thinking?: string;
  presentation?: ResponsePresentation;
  sources?: MessageSource[];
  images?: OpenClawImageAttachment[];
  attachments?: OpenClawFileAttachment[];
  meta?: {
    tokens: number;
    duration: number;
    tps: number;
    timings?: OpenClawLatencyTimings;
  };
  createdAt?: string;
}

type OpenClawLatencyTimings = Record<string, string | number | boolean | null>;

interface OpenClawImageAttachment {
  name: string;
  type: string;
  size: number;
  data: string;
  previewUrl: string;
  attachmentMode: ImageAttachmentMode;
  ocrText?: string;
  ocrTextCharCount?: number;
  statusMessage?: string;
}

interface OpenClawFileAttachment {
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
  ocrText?: string;
  ocrTextCharCount?: number;
  nativeImageData?: string;
  nativeImageType?: string;
  nativeImageName?: string;
  pageImages?: ExtractedFilePayload['pageImages'];
  pageImageCount?: number;
  pageImagesTruncated?: boolean;
  statusMessage?: string;
}

function getOpenClawImageSrc(image: OpenClawImageAttachment) {
  if (image.previewUrl) return image.previewUrl;
  const mimeType = image.type || 'image/jpeg';
  return `data:${mimeType};base64,${image.data}`;
}

function OpenClawAttachedImagePreview({ image }: { image: OpenClawImageAttachment }) {
  const [failed, setFailed] = useState(false);
  const imageSrc = getOpenClawImageSrc(image);

  useEffect(() => {
    setFailed(false);
  }, [imageSrc]);

  if (failed) {
    return (
      <div
        title={`${image.name} (${formatBytes(image.size)})`}
        style={{
          width: '220px',
          minHeight: '72px',
          borderRadius: '10px',
          border: '1px solid var(--border-color)',
          background: 'var(--accent-faint)',
          color: 'var(--text-secondary)',
          padding: '10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {image.name}
        </span>
        <span style={{ fontSize: '0.72rem' }}>
          {image.type || 'image'} · {formatBytes(image.size)}
        </span>
      </div>
    );
  }

  return (
    <ObjectUrlImage
      src={image.previewUrl || undefined}
      base64Data={image.previewUrl ? undefined : image.data}
      mimeType={image.type}
      alt={image.name}
      title={`${image.name} (${formatBytes(image.size)})`}
      maxPreviewWidth={360}
      maxPreviewHeight={260}
      onError={() => setFailed(true)}
      style={{
        maxWidth: '320px',
        maxHeight: '240px',
        borderRadius: '10px',
        objectFit: 'cover',
        border: '1px solid var(--border-color)',
      }}
    />
  );
}

function getImageAttachmentSummary(mode: ImageAttachmentMode, hasOcrText: boolean) {
  if (mode === 'ocr-only') {
    return hasOcrText ? 'OCR text only' : 'OCR only selected, but no OCR text was extracted';
  }
  if (mode === 'vision+ocr') {
    return hasOcrText ? 'Image bytes + OCR text' : 'Image bytes only (no OCR text found)';
  }
  return 'Image bytes only';
}

interface OpenClawSettings {
  openClawProvider: OpenClawProvider;
  openClawModel: string;
  openClawBaseUrl: string;
  ollamaHost: string;
  modelKeepAlive: boolean;
  ollamaKeepAlive: string;
  theme: string;
  shellExecutionTarget: 'container' | 'host';
  shellExecutionMode: string;
  shellAllowedCommands: string;
  shellHostAllowedRoots: string;
  shellHostAllowedEnvVars: string;
  shellHostMaxTimeoutMs: number;
  shellHostMaxOutputBytes: number;
  openClawFileAccessMode: 'deny' | 'read-only';
  openClawAllowedPaths: string;
  openClawFileWriteMode: 'deny' | 'ask-first' | 'auto-approve';
  openClawWritablePaths: string;
  openClawCodeExecutionMode: 'deny' | 'ask-first' | 'auto-approve';
  openClawBrowserMode: 'deny' | 'read-only' | 'ask-first';
  openClawUwafBrowserMode: 'deny' | 'direct' | 'stealth';
  openClawUwafDefaultMode: 'direct' | 'stealth';
  openClawUwafLiveBrowser: boolean;
  openClawAutomationExecutionEnabled: boolean;
  openClawAutomationExecutionModel: string;
  openClawAutomationExecutionMaxRunsPerHour: number;
  openClawAutomationExecutionAttachWorkspace: boolean;
  openClawAutomationExecutionAttachMemory: boolean;
  openClawSessionAutoContinueDefault: SessionAutoContinueMode;
  openClawSessionAutoContinueMaxSteps: number;
  openClawSessionSummariesEnabled: boolean;
  openClawSessionSummaryTargetTokens: number;
  openClawSessionPreserveTurns: number;
  openClawSessionAnalyticsEnabled: boolean;
  openClawSessionBranchingEnabled: boolean;
  ragEnabled: boolean;
  ragTopK: number;
  openClawPersonaTemplate: string;
  openClawPersonaName: string;
  openClawPersonaTone: string;
  openClawPersonaExpertise: string;
  openClawPersonaBoundaries: string;
  openClawPersonaOperatingInstructions: string;
  openClawUserProfileName: string;
  openClawUserProfileRole: string;
  openClawUserProfilePreferences: string;
  openClawUserProfileContext: string;
}

interface ParsedOpenClawSettingsResponse {
  settings: OpenClawSettings;
  effectiveToolAccess: EffectiveOpenClawToolAccess;
}

interface ParsedAutomationStateResponse {
  worker: AutomationWorkerState;
  heartbeat: AutomationHeartbeatState;
  schedules: AutomationScheduleState[];
  monitors: AutomationMonitorState[];
  nudges: AutomationNotificationState[];
  runs: AutomationExecutionRunState[];
}

function parseAutomationWorkerState(value: unknown): AutomationWorkerState {
  if (!value || typeof value !== 'object') return DEFAULT_AUTOMATION_WORKER_STATE;
  const candidate = value as Record<string, unknown>;
  return {
    running: candidate.running === true,
    startedAt: typeof candidate.startedAt === 'string' ? candidate.startedAt : null,
    lastTickAt: typeof candidate.lastTickAt === 'string' ? candidate.lastTickAt : null,
    loopCount: typeof candidate.loopCount === 'number' ? candidate.loopCount : 0,
    lastError: typeof candidate.lastError === 'string' ? candidate.lastError : null,
  };
}

function parseAutomationHeartbeatState(value: unknown): AutomationHeartbeatState {
  if (!value || typeof value !== 'object') return DEFAULT_AUTOMATION_HEARTBEAT_STATE;
  const candidate = value as Record<string, unknown>;
  return {
    id: typeof candidate.id === 'string' ? candidate.id : '',
    enabled: candidate.enabled === true,
    intervalMinutes: typeof candidate.intervalMinutes === 'number' ? candidate.intervalMinutes : 240,
    staleAfterMinutes: typeof candidate.staleAfterMinutes === 'number' ? candidate.staleAfterMinutes : 180,
    promptTemplate: typeof candidate.promptTemplate === 'string'
      ? candidate.promptTemplate
      : DEFAULT_AUTOMATION_HEARTBEAT_STATE.promptTemplate,
    deliveryMode: candidate.deliveryMode === 'background-run' ? 'background-run' : 'nudge',
    targetSessionId: typeof candidate.targetSessionId === 'string' ? candidate.targetSessionId : null,
    targetWorkspaceId: typeof candidate.targetWorkspaceId === 'string' ? candidate.targetWorkspaceId : null,
    nextRunAt: typeof candidate.nextRunAt === 'string' ? candidate.nextRunAt : null,
    lastRunAt: typeof candidate.lastRunAt === 'string' ? candidate.lastRunAt : null,
    lastStatus: typeof candidate.lastStatus === 'string' ? candidate.lastStatus : 'idle',
    lastError: typeof candidate.lastError === 'string' ? candidate.lastError : null,
  };
}

function parseAutomationSchedules(value: unknown): AutomationScheduleState[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate.id !== 'string'
      || typeof candidate.name !== 'string'
      || typeof candidate.prompt !== 'string'
      || typeof candidate.cronExpression !== 'string'
      || typeof candidate.timezone !== 'string'
      || typeof candidate.nextRunAt !== 'string'
      || typeof candidate.createdAt !== 'string'
      || typeof candidate.updatedAt !== 'string'
    ) {
      return [];
    }
    return [{
      id: candidate.id,
      name: candidate.name,
      prompt: candidate.prompt,
      deliveryMode: candidate.deliveryMode === 'background-run' ? 'background-run' : 'nudge',
      targetSessionId: typeof candidate.targetSessionId === 'string' ? candidate.targetSessionId : null,
      targetWorkspaceId: typeof candidate.targetWorkspaceId === 'string' ? candidate.targetWorkspaceId : null,
      cronExpression: candidate.cronExpression,
      timezone: candidate.timezone,
      enabled: candidate.enabled === true,
      nextRunAt: candidate.nextRunAt,
      lastRunAt: typeof candidate.lastRunAt === 'string' ? candidate.lastRunAt : null,
      lastStatus: typeof candidate.lastStatus === 'string' ? candidate.lastStatus : 'scheduled',
      lastError: typeof candidate.lastError === 'string' ? candidate.lastError : null,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
    }];
  });
}

function parseAutomationMonitors(value: unknown): AutomationMonitorState[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate.id !== 'string'
      || typeof candidate.name !== 'string'
      || typeof candidate.target !== 'string'
      || typeof candidate.checkIntervalSeconds !== 'number'
      || typeof candidate.createdAt !== 'string'
      || typeof candidate.updatedAt !== 'string'
    ) {
      return [];
    }
    const kind = candidate.kind === 'file' ? 'file' : 'url';
    const triggerMode = candidate.triggerMode === 'contains' || candidate.triggerMode === 'missing'
      ? candidate.triggerMode
      : 'changed';
    return [{
      id: candidate.id,
      name: candidate.name,
      kind,
      deliveryMode: candidate.deliveryMode === 'background-run' ? 'background-run' : 'nudge',
      targetSessionId: typeof candidate.targetSessionId === 'string' ? candidate.targetSessionId : null,
      targetWorkspaceId: typeof candidate.targetWorkspaceId === 'string' ? candidate.targetWorkspaceId : null,
      target: candidate.target,
      enabled: candidate.enabled === true,
      checkIntervalSeconds: candidate.checkIntervalSeconds,
      triggerMode,
      expectedPattern: typeof candidate.expectedPattern === 'string' ? candidate.expectedPattern : null,
      nextCheckAt: typeof candidate.nextCheckAt === 'string' ? candidate.nextCheckAt : null,
      lastCheckedAt: typeof candidate.lastCheckedAt === 'string' ? candidate.lastCheckedAt : null,
      lastStatus: typeof candidate.lastStatus === 'string' ? candidate.lastStatus : 'scheduled',
      lastError: typeof candidate.lastError === 'string' ? candidate.lastError : null,
      lastSummary: typeof candidate.lastSummary === 'string' ? candidate.lastSummary : null,
      lastTriggeredAt: typeof candidate.lastTriggeredAt === 'string' ? candidate.lastTriggeredAt : null,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
    }];
  });
}

function parseAutomationNotifications(value: unknown): AutomationNotificationState[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate.id !== 'string'
      || typeof candidate.kind !== 'string'
      || typeof candidate.title !== 'string'
      || typeof candidate.message !== 'string'
      || typeof candidate.createdAt !== 'string'
    ) {
      return [];
    }
    return [{
      id: candidate.id,
      kind: candidate.kind,
      sourceKind: typeof candidate.sourceKind === 'string' ? candidate.sourceKind : null,
      sourceId: typeof candidate.sourceId === 'string' ? candidate.sourceId : null,
      sessionId: typeof candidate.sessionId === 'string' ? candidate.sessionId : null,
      title: candidate.title,
      message: candidate.message,
      createdAt: candidate.createdAt,
      seenAt: typeof candidate.seenAt === 'string' ? candidate.seenAt : null,
      dismissedAt: typeof candidate.dismissedAt === 'string' ? candidate.dismissedAt : null,
    }];
  });
}

function parseAutomationRuns(value: unknown): AutomationExecutionRunState[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate.id !== 'string'
      || typeof candidate.sourceKind !== 'string'
      || typeof candidate.title !== 'string'
      || typeof candidate.prompt !== 'string'
      || typeof candidate.provider !== 'string'
      || typeof candidate.model !== 'string'
      || typeof candidate.status !== 'string'
      || typeof candidate.createdAt !== 'string'
    ) {
      return [];
    }
    return [{
      id: candidate.id,
      sourceKind: candidate.sourceKind,
      sourceId: typeof candidate.sourceId === 'string' ? candidate.sourceId : null,
      deliveryMode: typeof candidate.deliveryMode === 'string' ? candidate.deliveryMode : 'background-run',
      sessionId: typeof candidate.sessionId === 'string' ? candidate.sessionId : null,
      workspaceId: typeof candidate.workspaceId === 'string' ? candidate.workspaceId : null,
      title: candidate.title,
      prompt: candidate.prompt,
      provider: candidate.provider,
      model: candidate.model,
      status: candidate.status,
      resultPreview: typeof candidate.resultPreview === 'string' ? candidate.resultPreview : null,
      error: typeof candidate.error === 'string' ? candidate.error : null,
      createdAt: candidate.createdAt,
      startedAt: typeof candidate.startedAt === 'string' ? candidate.startedAt : null,
      completedAt: typeof candidate.completedAt === 'string' ? candidate.completedAt : null,
    }];
  });
}

function parseAutomationStateResponse(data: Record<string, unknown>): ParsedAutomationStateResponse {
  return {
    worker: parseAutomationWorkerState(data.worker),
    heartbeat: parseAutomationHeartbeatState(data.heartbeat),
    schedules: parseAutomationSchedules(data.schedules),
    monitors: parseAutomationMonitors(data.monitors),
    nudges: parseAutomationNotifications(data.nudges),
    runs: parseAutomationRuns(data.runs),
  };
}

function formatAutomationTimestamp(value: string | null) {
  if (!value) return 'not run yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function parseOpenClawPermissions(value: unknown): EffectiveOpenClawToolAccess['permissions'] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is EffectiveOpenClawToolAccess['permissions'][number] => typeof entry === 'string'
  );
}

function parseOpenClawToolAccess(
  value: unknown,
  fallback: EffectiveOpenClawToolAccess
): EffectiveOpenClawToolAccess {
  if (!value || typeof value !== 'object') return fallback;

  const candidate = value as Partial<EffectiveOpenClawToolAccess>;
  return {
    permissions: fallback.permissions,
    shellGranted: candidate.shellGranted === true,
    shellEnabled: candidate.shellEnabled === true,
    filesystemGranted: candidate.filesystemGranted === true,
    filesystemEnabled: candidate.filesystemEnabled === true,
    filesystemWriteEnabled: candidate.filesystemWriteEnabled === true,
    codeGranted: candidate.codeGranted === true,
    codeExecutionEnabled: candidate.codeExecutionEnabled === true,
    browserGranted: candidate.browserGranted === true,
    browserMode: candidate.browserMode === 'read-only' || candidate.browserMode === 'ask-first'
      ? candidate.browserMode
      : 'deny',
    uwafGranted: candidate.uwafGranted === true,
    uwafBrowserMode: candidate.uwafBrowserMode === 'direct' || candidate.uwafBrowserMode === 'stealth'
      ? candidate.uwafBrowserMode
      : 'deny',
  };
}

function parseOpenClawSettingsResponse(data: Record<string, unknown>): ParsedOpenClawSettingsResponse {
  const settings: OpenClawSettings = {
    openClawProvider: data.openClawProvider === 'openai-compatible' ? 'openai-compatible' : 'ollama',
    openClawModel: typeof data.openClawModel === 'string' ? data.openClawModel : '',
    openClawBaseUrl: typeof data.openClawBaseUrl === 'string' ? data.openClawBaseUrl : '',
    ollamaHost: typeof data.ollamaHost === 'string' ? data.ollamaHost : 'http://127.0.0.1:11434',
    modelKeepAlive: data.modelKeepAlive === true,
    ollamaKeepAlive: typeof data.ollamaKeepAlive === 'string' && data.ollamaKeepAlive.trim() ? data.ollamaKeepAlive : '0',
    theme: typeof data.theme === 'string' ? data.theme : 'aurora',
    shellExecutionTarget: data.shellExecutionTarget === 'host' ? 'host' : 'container',
    shellExecutionMode: typeof data.shellExecutionMode === 'string' ? data.shellExecutionMode : 'ask-first',
    shellAllowedCommands: typeof data.shellAllowedCommands === 'string' ? data.shellAllowedCommands : '',
    shellHostAllowedRoots: typeof data.shellHostAllowedRoots === 'string' ? data.shellHostAllowedRoots : '/tmp/peakui-openclaw-workspace',
    shellHostAllowedEnvVars: typeof data.shellHostAllowedEnvVars === 'string' ? data.shellHostAllowedEnvVars : 'PATH\nHOME\nUSER\nSHELL\nLANG\nTERM',
    shellHostMaxTimeoutMs: typeof data.shellHostMaxTimeoutMs === 'number' ? data.shellHostMaxTimeoutMs : 60000,
    shellHostMaxOutputBytes: typeof data.shellHostMaxOutputBytes === 'number' ? data.shellHostMaxOutputBytes : 262144,
    openClawFileAccessMode: data.openClawFileAccessMode === 'read-only' ? 'read-only' : 'deny',
    openClawAllowedPaths: typeof data.openClawAllowedPaths === 'string' ? data.openClawAllowedPaths : '',
    openClawFileWriteMode: data.openClawFileWriteMode === 'auto-approve' || data.openClawFileWriteMode === 'ask-first'
      ? data.openClawFileWriteMode
      : 'deny',
    openClawWritablePaths: typeof data.openClawWritablePaths === 'string' ? data.openClawWritablePaths : '',
    openClawCodeExecutionMode: data.openClawCodeExecutionMode === 'auto-approve' || data.openClawCodeExecutionMode === 'ask-first'
      ? data.openClawCodeExecutionMode
      : 'deny',
    openClawBrowserMode: data.openClawBrowserMode === 'read-only' || data.openClawBrowserMode === 'ask-first'
      ? data.openClawBrowserMode
      : 'deny',
    openClawUwafBrowserMode: data.openClawUwafBrowserMode === 'direct' || data.openClawUwafBrowserMode === 'stealth'
      ? data.openClawUwafBrowserMode
      : 'deny',
    openClawUwafDefaultMode: data.openClawUwafDefaultMode === 'stealth' ? 'stealth' : 'direct',
    openClawUwafLiveBrowser: data.openClawUwafLiveBrowser !== false,
    openClawAutomationExecutionEnabled: data.openClawAutomationExecutionEnabled === true,
    openClawAutomationExecutionModel: typeof data.openClawAutomationExecutionModel === 'string' ? data.openClawAutomationExecutionModel : '',
    openClawAutomationExecutionMaxRunsPerHour: typeof data.openClawAutomationExecutionMaxRunsPerHour === 'number'
      ? data.openClawAutomationExecutionMaxRunsPerHour
      : 6,
    openClawAutomationExecutionAttachWorkspace: data.openClawAutomationExecutionAttachWorkspace !== false,
    openClawAutomationExecutionAttachMemory: data.openClawAutomationExecutionAttachMemory !== false,
    openClawSessionAutoContinueDefault: data.openClawSessionAutoContinueDefault === 'safe'
      ? 'safe'
      : data.openClawSessionAutoContinueDefault === 'ask'
        ? 'ask'
        : 'manual',
    openClawSessionAutoContinueMaxSteps: typeof data.openClawSessionAutoContinueMaxSteps === 'number'
      ? data.openClawSessionAutoContinueMaxSteps
      : 3,
    openClawSessionSummariesEnabled: data.openClawSessionSummariesEnabled !== false,
    openClawSessionSummaryTargetTokens: typeof data.openClawSessionSummaryTargetTokens === 'number'
      ? data.openClawSessionSummaryTargetTokens
      : 6000,
    openClawSessionPreserveTurns: typeof data.openClawSessionPreserveTurns === 'number'
      ? data.openClawSessionPreserveTurns
      : 6,
    openClawSessionAnalyticsEnabled: data.openClawSessionAnalyticsEnabled !== false,
    openClawSessionBranchingEnabled: data.openClawSessionBranchingEnabled !== false,
    ragEnabled: data.ragEnabled === true,
    ragTopK: typeof data.ragTopK === 'number' ? data.ragTopK : 8,
    openClawPersonaTemplate: typeof data.openClawPersonaTemplate === 'string' ? data.openClawPersonaTemplate : 'custom',
    openClawPersonaName: typeof data.openClawPersonaName === 'string' ? data.openClawPersonaName : '',
    openClawPersonaTone: typeof data.openClawPersonaTone === 'string' ? data.openClawPersonaTone : '',
    openClawPersonaExpertise: typeof data.openClawPersonaExpertise === 'string' ? data.openClawPersonaExpertise : '',
    openClawPersonaBoundaries: typeof data.openClawPersonaBoundaries === 'string' ? data.openClawPersonaBoundaries : '',
    openClawPersonaOperatingInstructions: typeof data.openClawPersonaOperatingInstructions === 'string' ? data.openClawPersonaOperatingInstructions : '',
    openClawUserProfileName: typeof data.openClawUserProfileName === 'string' ? data.openClawUserProfileName : '',
    openClawUserProfileRole: typeof data.openClawUserProfileRole === 'string' ? data.openClawUserProfileRole : '',
    openClawUserProfilePreferences: typeof data.openClawUserProfilePreferences === 'string' ? data.openClawUserProfilePreferences : '',
    openClawUserProfileContext: typeof data.openClawUserProfileContext === 'string' ? data.openClawUserProfileContext : '',
  };

  const permissions = parseOpenClawPermissions(data.permissions);
  const fallbackToolAccess = buildEffectiveOpenClawToolAccess(settings, permissions);

  return {
    settings,
    effectiveToolAccess: parseOpenClawToolAccess(data.effectiveToolAccess, fallbackToolAccess),
  };
}

interface ShellOutputEntry {
  id: string;
  messageId: string;
  command: string;
  target?: 'container' | 'host';
  auditId?: string;
  description?: string;
  stdout?: string;
  stderr?: string;
  exitCode: number | null;
  duration: number;
  success: boolean;
  blocked?: boolean;
  rejected?: boolean;
}

interface ShellExecutionRequest {
  command: string;
  description?: string;
  approvalToken?: string;
  messageId: string;
  auditId?: string;
}

interface FilesystemToolResultEntry {
  action: 'list' | 'read' | 'stat' | 'write' | 'append' | 'mkdir';
  path: string;
  kind?: 'file' | 'directory';
  content?: string;
  truncated?: boolean;
  size?: number;
  modifiedAt?: string;
  created?: boolean;
  bytesWritten?: number;
  entries?: Array<{
    name: string;
    path: string;
    kind: 'file' | 'directory';
    size?: number;
  }>;
  success: boolean;
  error?: string;
  code?: string;
  actionRequired?: string;
}

interface PendingToolApprovalBase {
  title: string;
  description?: string;
  previewLabel: string;
  previewContent: string;
  approvalToken?: string;
  messageId: string;
}

type PendingToolApproval =
  | (PendingToolApprovalBase & {
      kind: 'shell';
      request: {
        command: string;
        description?: string;
        auditId?: string;
      };
    })
  | (PendingToolApprovalBase & {
      kind: 'filesystem';
      request: OpenClawFilesystemToolRequest;
    })
  | (PendingToolApprovalBase & {
      kind: 'code';
      request: OpenClawCodeToolRequest & { sessionId: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'browser';
      request: OpenClawBrowserToolRequest & { sessionId: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'unified_browser';
      request: OpenClawUwafBrowserToolRequest & { sessionId: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'tax_return';
      request: OpenClawTaxReturnToolRequest & { sessionId: string; messageId?: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'pdf_document';
      request: OpenClawPdfDocumentToolRequest & { sessionId: string; messageId?: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'workbook_document';
      request: OpenClawWorkbookDocumentToolRequest & { sessionId: string; messageId?: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'word_document';
      request: OpenClawWordDocumentToolRequest & { sessionId: string; messageId?: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'csv_document';
      request: OpenClawCsvDocumentToolRequest & { sessionId: string; messageId?: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'email_document';
      request: OpenClawEmailDocumentToolRequest & { sessionId: string; messageId?: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'markdown_document';
      request: OpenClawMarkdownDocumentToolRequest & { sessionId: string; messageId?: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'slides_document';
      request: OpenClawSlidesDocumentToolRequest & { sessionId: string; messageId?: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'archive_document';
      request: OpenClawArchiveDocumentToolRequest & { sessionId: string; messageId?: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'calendar_document';
      request: OpenClawCalendarDocumentToolRequest & { sessionId: string; messageId?: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'mermaid_document';
      request: OpenClawMermaidDocumentToolRequest & { sessionId: string; messageId?: string };
    });

type ToolApprovalResolution =
  | ShellOutputEntry
  | FilesystemToolResultEntry
  | CodeToolResultEntry
  | BrowserToolResultEntry
  | UwafBrowserToolResultEntry
  | TaxReturnToolResultEntry
  | PdfDocumentToolResultEntry
  | WorkbookDocumentToolResultEntry
  | WordDocumentToolResultEntry
  | CsvDocumentToolResultEntry
  | EmailDocumentToolResultEntry
  | MarkdownDocumentToolResultEntry
  | SlidesDocumentToolResultEntry
  | ArchiveDocumentToolResultEntry
  | CalendarDocumentToolResultEntry
  | MermaidDocumentToolResultEntry;

interface WebToolResultEntry {
  query: string;
  description?: string;
  context?: string;
  sources: MessageSource[];
  success: boolean;
  error?: string;
}

interface TaxReturnToolResultEntry {
  action: 'generate_review_pdf' | 'fill_pdf_form';
  success: boolean;
  artifact?: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    downloadUrl: string;
  };
  filledFields?: string[];
  warnings?: string[];
  missingFields?: string[];
  error?: string;
}

interface PdfDocumentToolResultEntry {
  success: boolean;
  title: string;
  artifact?: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    downloadUrl: string;
  };
  error?: string;
}

interface WorkbookDocumentToolResultEntry {
  success: boolean;
  title: string;
  artifact?: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    downloadUrl: string;
  };
  error?: string;
}

interface WordDocumentToolResultEntry {
  success: boolean;
  title: string;
  artifact?: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    downloadUrl: string;
  };
  error?: string;
}

interface CsvDocumentToolResultEntry {
  success: boolean;
  title: string;
  artifact?: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    downloadUrl: string;
  };
  error?: string;
}

interface EmailDocumentToolResultEntry {
  success: boolean;
  title: string;
  artifact?: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    downloadUrl: string;
  };
  error?: string;
}

interface MarkdownDocumentToolResultEntry {
  success: boolean;
  title: string;
  artifact?: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    downloadUrl: string;
  };
  error?: string;
}

interface SlidesDocumentToolResultEntry {
  success: boolean;
  title: string;
  artifact?: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    downloadUrl: string;
  };
  error?: string;
}

interface ArchiveDocumentToolResultEntry {
  success: boolean;
  title: string;
  artifact?: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    downloadUrl: string;
  };
  error?: string;
}

interface CalendarDocumentToolResultEntry {
  success: boolean;
  title: string;
  artifact?: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    downloadUrl: string;
  };
  error?: string;
}

interface MermaidDocumentToolResultEntry {
  success: boolean;
  title: string;
  artifact?: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    downloadUrl: string;
  };
  error?: string;
}

interface FetchSummarizeToolResultEntry {
  success: boolean;
  url: string;
  title?: string;
  summary?: string[];
  quote?: string;
  error?: string;
}

interface CodeToolResultEntry {
  runtime: 'python' | 'node';
  workingDirectory: string;
  scriptPath: string;
  command: string;
  stdout?: string;
  stderr?: string;
  exitCode: number | null;
  duration: number;
  success: boolean;
  outputTruncated?: boolean;
  files: Array<{
    path: string;
    relativePath: string;
    kind: 'file' | 'directory';
    size?: number;
    modifiedAt?: string;
  }>;
  error?: string;
}

interface BrowserToolResultEntry {
  action: 'open' | 'click' | 'fill' | 'submit' | 'extract';
  currentUrl: string;
  title: string;
  text?: string;
  html?: string;
  links: Array<{
    index: number;
    text: string;
    url: string;
  }>;
  forms: Array<{
    index: number;
    action: string;
    method: 'GET' | 'POST';
    fields: Array<{
      name: string;
      type: string;
      value?: string;
    }>;
  }>;
  pendingFormValues?: Record<string, string>;
  submitted?: {
    url: string;
    method: 'GET' | 'POST';
    fieldCount: number;
  };
  success: boolean;
  error?: string;
}

interface UwafBrowserToolResultEntry {
  action: string;
  currentUrl: string;
  title: string;
  text?: string;
  html?: string;
  markdown?: string;
  links: Array<{
    index: number;
    text: string;
    url: string;
  }>;
  forms: Array<{
    index: number;
    action: string;
    method: string;
    fields: Array<{
      name: string;
      type: string;
      value?: string;
    }>;
  }>;
  tables?: Array<{
    headers: string[];
    rows: string[][];
    markdown: string;
    csv: string;
  }>;
  screenshot?: string;
  mode: 'direct' | 'stealth';
  stealthProfile?: 'normal' | 'high';
  source: 'clear_web' | 'dark_web';
  success: boolean;
  error?: string;
  requestedUrl?: string;
  requestedQuery?: string;
  finalUrl?: string;
  redirected?: boolean;
  httpStatus?: number;
  queryMatched?: boolean;
  resultCount?: number;
  antiBotDetected?: boolean;
  loginDetected?: boolean;
  jsErrors?: string[];
  networkErrors?: string[];
  failureCode?: string;
  failureDetail?: string;
  pageChanged?: boolean;
  navigationChanged?: boolean;
  selectorMatched?: boolean;
  waitTimedOut?: boolean;
  searchEngine?: string;
  searchProviderId?: string;
  searchAttempts?: Array<{
    providerId: string;
    providerLabel: string;
    success: boolean;
    resultCount: number;
    queryMatched?: boolean;
    failureCode?: string;
    failureDetail?: string;
  }>;
  tabs?: Array<{
    index: number;
    url: string;
    title: string;
    active: boolean;
  }>;
  activeTabIndex?: number;
  observations?: string[];
  batchResults?: Array<{
    url: string;
    title: string;
    markdown: string;
    links: Array<{ index: number; text: string; url: string }>;
    depth: number;
  }>;
}

type OpenClawStreamFrame = {
  task_id?: unknown;
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
  timings?: unknown;
};

const OPENCLAW_API_KEY_STORAGE = 'peakui-openclaw-api-key';
const OPENCLAW_INTERNET_STORAGE = 'peakui-openclaw-internet-enabled';
const OPENCLAW_RAG_STORAGE = 'peakui-openclaw-rag-enabled';
const OPENCLAW_UNRESTRICTED_STORAGE = 'peakui-openclaw-unrestricted';
const OPENCLAW_UNCENSORED_STORAGE = 'peakui-openclaw-uncensored';
const OPENCLAW_AGENT_STORAGE = 'peakui-openclaw-agent-preferences';
const OPENCLAW_RAIL_STORAGE = 'peakui-openclaw-rail-collapsed';
const OPENCLAW_TASK_STATE_STORAGE = 'peakui-openclaw-task-states';
const OPENCLAW_DRAFT_TASK_ID = '__draft__';
const OPENCLAW_PERSONA_STORAGE = 'peakui-openclaw-persona';
const OPENCLAW_USER_PROFILE_STORAGE = 'peakui-openclaw-user-profile';
const OPENCLAW_CURRENT_SESSION_STORAGE = 'peakui-openclaw-current-session';
const OPENCLAW_CURRENT_WORKSPACE_STORAGE = 'peakui-openclaw-current-workspace';

function getChatTitle(messages: OpenClawMessage[]) {
  const firstMessage = messages.find(message => message?.role === 'user' && message.content.trim());
  const base = firstMessage?.content.trim() || 'WorkSpaces';
  return base.substring(0, 36) + (base.length > 36 ? '...' : '');
}

function formatTimestamp(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function isVisibleMessage(message: OpenClawMessage) {
  return Boolean(message) && !message.hidden;
}

function describeShellRequest(command: string, description?: string) {
  const summary = description?.trim();
  return summary ? `Running shell command: ${summary}` : `Running shell command: \`${command}\``
}

function describeFilesystemRequest(action: OpenClawFilesystemToolRequest['action'], requestedPath: string) {
  if (action === 'list') return `Listing directory: \`${requestedPath}\``;
  if (action === 'stat') return `Inspecting path metadata: \`${requestedPath}\``;
  if (action === 'mkdir') return `Creating directory: \`${requestedPath}\``;
  if (action === 'append') return `Appending to file: \`${requestedPath}\``;
  if (action === 'write') return `Writing file: \`${requestedPath}\``;
  return `Reading file: \`${requestedPath}\``;
}

function describeWebResearchRequest(query: string, description?: string) {
  const summary = description?.trim();
  return summary ? `Researching the web: ${summary}` : `Researching the web for: \`${query}\``;
}

function describeCodeExecutionRequest(request: OpenClawCodeToolRequest) {
  const summary = request.description?.trim();
  const target = request.workspacePath?.trim() ? ` in \`${request.workspacePath.trim()}\`` : '';
  return summary
    ? `Running sandboxed ${request.runtime} code: ${summary}`
    : `Running sandboxed ${request.runtime} code${target}`;
}

function describeBrowserRequest(request: OpenClawBrowserToolRequest) {
  if (request.action === 'open') {
    return request.description?.trim()
      ? `Browser navigation: ${request.description.trim()}`
      : `Opening page: \`${request.url}\``;
  }

  if (request.action === 'click') {
    return request.description?.trim()
      ? `Browser navigation: ${request.description.trim()}`
      : request.linkIndex !== undefined
        ? `Clicking link ${request.linkIndex}`
        : `Clicking link matching: \`${request.linkText}\``;
  }

  if (request.action === 'fill') {
    return request.description?.trim()
      ? `Preparing browser form: ${request.description.trim()}`
      : `Filling browser form ${request.formIndex}`;
  }

  if (request.action === 'submit') {
    return request.description?.trim()
      ? `Submitting browser form: ${request.description.trim()}`
      : `Submitting browser form ${request.formIndex ?? '?'}`;
  }

  return request.description?.trim()
    ? `Extracting page content: ${request.description.trim()}`
    : `Extracting page ${request.mode || 'summary'}`;
}

function describeUwafBrowserRequest(request: OpenClawUwafBrowserToolRequest) {
  const modeLabel = request.browserMode === 'stealth'
    ? `Stealth${request.stealthProfile === 'high' ? ' High' : ''}`
    : 'Direct';
  if (request.action === 'search') {
    const providerLabel = request.providerId?.trim() ? ` via ${request.providerId.trim()}` : '';
    return request.description?.trim()
      ? `UWAF ${modeLabel} Search${providerLabel}: ${request.description.trim()}`
      : `UWAF ${modeLabel} Search${providerLabel}: \`${request.query}\``;
  }
  if (request.action === 'open') {
    return request.description?.trim()
      ? `UWAF ${modeLabel}: ${request.description.trim()}`
      : `UWAF ${modeLabel}: Opening \`${request.url}\``;
  }
  if (request.action === 'research_batch') {
    return request.description?.trim()
      ? `UWAF ${modeLabel} Research: ${request.description.trim()}`
      : `UWAF ${modeLabel} Research: Crawling \`${request.url}\` (depth ${request.depth || 1})`;
  }
  if (request.action === 'extract_table') {
    return `UWAF ${modeLabel}: Extracting tables`;
  }
  if (request.action === 'type') {
    return `UWAF ${modeLabel}: Typing into \`${request.selector}\``;
  }
  if (request.action === 'press') {
    return `UWAF ${modeLabel}: Pressing \`${request.key}\`${request.selector ? ` on \`${request.selector}\`` : ''}`;
  }
  if (request.action === 'wait_for_selector') {
    return `UWAF ${modeLabel}: Waiting for \`${request.selector}\``;
  }
  if (request.action === 'scroll') {
    return `UWAF ${modeLabel}: Scrolling page`;
  }
  if (request.action === 'back' || request.action === 'forward') {
    return `UWAF ${modeLabel}: Navigating ${request.action}`;
  }
  if (request.action === 'new_tab') {
    return request.url
      ? `UWAF ${modeLabel}: Opening new tab for \`${request.url}\``
      : `UWAF ${modeLabel}: Opening a new tab`;
  }
  if (request.action === 'list_tabs') {
    return `UWAF ${modeLabel}: Listing tabs`;
  }
  if (request.action === 'switch_tab' || request.action === 'close_tab') {
    return `UWAF ${modeLabel}: ${request.action} ${request.tabIndex ?? '?'}`;
  }
  if (request.action === 'select') {
    return `UWAF ${modeLabel}: Selecting in \`${request.selector}\``;
  }
  if (request.action === 'hover') {
    return `UWAF ${modeLabel}: Hovering \`${request.selector}\``;
  }
  if (request.action === 'click') {
    return request.linkIndex !== undefined
      ? `UWAF ${modeLabel}: Clicking link ${request.linkIndex}`
      : `UWAF ${modeLabel}: Clicking link matching \`${request.linkText}\``;
  }
  if (request.action === 'submit') {
    return `UWAF ${modeLabel}: Submitting form ${request.formIndex ?? '?'}`;
  }
  if (request.action === 'wait_for_user') {
    return request.description?.trim()
      ? `UWAF ${modeLabel}: Waiting for human help - ${request.description.trim()}`
      : `UWAF ${modeLabel}: Waiting for human help`;
  }
  return request.description?.trim()
    ? `UWAF ${modeLabel}: ${request.description.trim()}`
    : `UWAF ${modeLabel}: ${request.action}`;
}

function describeTaxReturnRequest(request: OpenClawTaxReturnToolRequest) {
  if (request.description?.trim()) return `Tax PDF generation: ${request.description.trim()}`;
  const folder = request.folder?.trim() ? ` from Knowledge Base folder \`${request.folder.trim()}\`` : '';
  return request.action === 'fill_pdf_form'
    ? `Filling a tax PDF form${folder}`
    : `Generating a tax review PDF${folder}`;
}

function describePdfDocumentRequest(request: OpenClawPdfDocumentToolRequest) {
  return request.description?.trim()
    ? `PDF generation: ${request.description.trim()}`
    : `Generating downloadable PDF: \`${request.filename || request.title}.pdf\``;
}

function describeWorkbookDocumentRequest(request: OpenClawWorkbookDocumentToolRequest) {
  return request.description?.trim()
    ? `Excel workbook generation: ${request.description.trim()}`
    : `Generating downloadable Excel workbook: \`${request.filename || request.title}.xlsx\``;
}

function describeWordDocumentRequest(request: OpenClawWordDocumentToolRequest) {
  return request.description?.trim()
    ? `Word document generation: ${request.description.trim()}`
    : `Generating downloadable Word document: \`${request.filename || request.title}.docx\``;
}

function describeCsvDocumentRequest(request: OpenClawCsvDocumentToolRequest) {
  return request.description?.trim()
    ? `CSV export: ${request.description.trim()}`
    : `Generating downloadable CSV: \`${request.filename || request.title}.csv\``;
}

function describeEmailDocumentRequest(request: OpenClawEmailDocumentToolRequest) {
  return request.description?.trim()
    ? `Email draft: ${request.description.trim()}`
    : `Generating downloadable email draft: \`${request.filename || request.title || request.subject}.eml\``;
}

function describeFetchSummarizeRequest(request: OpenClawFetchSummarizeToolRequest) {
  return request.description?.trim()
    ? `Fetch and summarize: ${request.description.trim()} (${request.url})`
    : `Fetch and summarize web page: ${request.url}`;
}

function describeMarkdownDocumentRequest(request: OpenClawMarkdownDocumentToolRequest) {
  return request.description?.trim()
    ? `Markdown document: ${request.description.trim()}`
    : `Generating downloadable Markdown document: \`${request.filename || request.title}.md\``;
}

function describeSlidesDocumentRequest(request: OpenClawSlidesDocumentToolRequest) {
  return request.description?.trim()
    ? `Slide deck: ${request.description.trim()}`
    : `Generating slide deck with ${request.slides.length} slides: \`${request.filename || request.title}.pptx\``;
}

function describeArchiveDocumentRequest(request: OpenClawArchiveDocumentToolRequest) {
  return request.description?.trim()
    ? `Archive: ${request.description.trim()}`
    : `Bundling ${request.entries.length} files into \`${request.filename || request.title}.zip\``;
}

function describeCalendarDocumentRequest(request: OpenClawCalendarDocumentToolRequest) {
  return request.description?.trim()
    ? `Calendar event: ${request.description.trim()}`
    : `Creating calendar event(s): \`${request.filename || request.title}.ics\``;
}

function describeMermaidDocumentRequest(request: OpenClawMermaidDocumentToolRequest) {
  return request.description?.trim()
    ? `Mermaid diagram: ${request.description.trim()}`
    : `Rendering Mermaid diagram as ${request.format || 'svg'}: \`${request.filename || request.title}.${request.format || 'svg'}\``;
}

function normalizeToolSources(value: unknown): MessageSource[] {
  return normalizeMessageSources(value);
}

function normalizeLatencyTimings(value: unknown): OpenClawLatencyTimings | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const normalized: OpenClawLatencyTimings = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' || raw === null) {
      normalized[key] = raw;
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function formatTimingSeconds(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)}s` : '';
}

function formatLatencySummary(timings?: OpenClawLatencyTimings) {
  if (!timings) return '';
  const parts = [
    ['Prep', timings.server_prepare_ms],
    ['Headers', timings.upstream_headers_ms],
    ['First text', timings.first_content_ms],
    ['Load', timings.load_duration_ms],
    ['Prompt eval', timings.prompt_eval_duration_ms],
  ]
    .map(([label, value]) => {
      const formatted = formatTimingSeconds(value);
      return formatted ? `${label} ${formatted}` : '';
    })
    .filter(Boolean);

  return parts.join(' · ');
}

function formatLoadedUntil(value?: string) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const VisibleChatMessageRow = memo(function VisibleChatMessageRow({
  msg,
  index,
  isStreaming,
  isLast,
  currentSessionId,
  liveStats,
  streamPhase,
  outputsForMessage,
  messageSources,
  branchingEnabled,
  onBranchFromMessage,
  onCopyMessage,
}: {
  msg: OpenClawMessage;
  index: number;
  isStreaming: boolean;
  isLast: boolean;
  currentSessionId?: string | null;
  liveStats: { tokens: number; tps: number } | null;
  streamPhase: UiStreamPhase | null;
  outputsForMessage: ShellOutputEntry[];
  messageSources: MessageSource[];
  branchingEnabled: boolean;
  onBranchFromMessage?: (messageId?: string, branchLabel?: string) => void;
  onCopyMessage?: (message: OpenClawMessage) => void;
}) {
  const messageContent = typeof msg.content === 'string' ? msg.content : '';
  const messageThinking = typeof msg.thinking === 'string' ? msg.thinking : '';
  const isToolBridgeMessage = msg.role === 'assistant' && (Boolean(msg.toolRequest) || outputsForMessage.length > 0);
  const latencySummary = formatLatencySummary(msg.meta?.timings);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
        paddingBottom: '18px',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: '14px',
          flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
          maxWidth: '100%',
        }}
      >
        <div className="avatar">
          {msg.role === 'user' ? <MessageSquare size={18} color="var(--text-secondary)" /> : <Bot size={22} color="white" />}
        </div>
        <div suppressHydrationWarning className={`message-content${isStreaming && msg.role === 'assistant' && isLast && messageContent ? ' streaming-cursor' : ''}`} style={{ maxWidth: '100%' }}>
          {messageThinking && (
            <ThinkingBlock content={messageThinking} isStreaming={isStreaming && isLast && !messageContent} />
          )}
          {msg.role === 'assistant' ? (
            <MessageRenderBoundary fallbackText={messageContent}>
              <ChatMessageContent
                content={messageContent}
                isStreaming={isStreaming}
                isLast={isLast}
                presentation={msg.presentation}
                sources={messageSources}
              />
              {!isToolBridgeMessage && messageSources.length > 0 && (
                <SourceChips sources={messageSources} />
              )}
              {!isToolBridgeMessage && messageContent.trim() && (
                <AssistantDownloads content={messageContent} index={index} presentation={msg.presentation} sessionId={currentSessionId ?? undefined} messageId={msg.id} />
              )}
            </MessageRenderBoundary>
          ) : (
            <>
              {msg.images && msg.images.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: messageContent.trim() ? '10px' : 0 }}>
                  {msg.images.map((image, imageIndex) => (
                    <OpenClawAttachedImagePreview key={`${image.name}-${imageIndex}`} image={image} />
                  ))}
                </div>
              )}
              <ChatMessageContent
                content={messageContent}
                isStreaming={isStreaming}
                isLast={isLast}
                presentation={msg.presentation}
                sources={messageSources}
              />
            </>
          )}
        </div>
      </div>
      {msg.role === 'assistant' && outputsForMessage.length > 0 && (
        <div style={{ marginLeft: '52px', marginTop: '8px', width: 'calc(100% - 52px)' }}>
          {outputsForMessage.map(output => (
            <ShellOutput
              key={output.id}
              command={output.command}
              target={output.target}
              stdout={output.stdout}
              stderr={output.stderr}
              exitCode={output.exitCode}
              duration={output.duration}
              success={output.success}
            />
          ))}
        </div>
      )}
      {msg.meta && (
        <div
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
            marginLeft: msg.role === 'assistant' ? '52px' : '0',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <span><Activity size={12} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />{msg.meta.tps.toFixed(1)} tok/s</span>
          <span>{msg.meta.tokens} tokens</span>
          <span>{msg.meta.duration.toFixed(2)}s</span>
          {latencySummary && <span>{latencySummary}</span>}
        </div>
      )}
      {msg.role !== 'system' && !msg.hidden && msg.id && !isStreaming && (
        <div
          style={{
            fontSize: '0.74rem',
            color: 'var(--text-secondary)',
            marginLeft: msg.role === 'assistant' ? '52px' : '0',
            display: 'flex',
            gap: '8px',
          }}
        >
          <button
            type="button"
            className="openclaw-inline-button"
            onClick={() => void onCopyMessage?.(msg)}
          >
            <Copy size={12} />
            Copy message
          </button>
          {branchingEnabled && (
            <button
              type="button"
              className="openclaw-inline-button"
              onClick={() => onBranchFromMessage?.(msg.id, `${msg.role === 'user' ? 'User' : 'Assistant'} turn ${index + 1}`)}
            >
              <Copy size={12} />
              Branch from here
            </button>
          )}
        </div>
      )}
      {isStreaming && isLast && liveStats && !msg.meta && (
        <div
          style={{
            fontSize: '0.75rem',
            color: 'var(--accent-primary)',
            marginLeft: msg.role === 'assistant' ? '52px' : '0',
            display: 'flex',
            gap: '12px',
          }}
        >
          {liveStats.tokens > 0 ? (
            <>
              <span><Activity size={12} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />{liveStats.tps.toFixed(1)} tok/s</span>
              <span>{liveStats.tokens} tokens</span>
              <span className="animate-pulse">Generating...</span>
            </>
          ) : (
            <span className="animate-pulse">{getStreamPhaseLabel(streamPhase)}</span>
          )}
        </div>
      )}
    </div>
  );
}, (prev, next) => (
  prev.msg === next.msg
  && prev.index === next.index
  && prev.isStreaming === next.isStreaming
  && prev.isLast === next.isLast
  && prev.currentSessionId === next.currentSessionId
  && prev.liveStats === next.liveStats
  && prev.streamPhase === next.streamPhase
  && prev.outputsForMessage === next.outputsForMessage
  && prev.messageSources === next.messageSources
  && prev.branchingEnabled === next.branchingEnabled
  && prev.onCopyMessage === next.onCopyMessage
));

function normalizeExtractedToolRequestName(value: unknown): OpenClawMessage['toolRequest'] {
  // Whitelist must match OpenClawToolName in @/lib/openclaw-tools so all 18 tool
  // names propagate to message.toolRequest. The original list omitted
  // slides_document / archive_document / calendar_document / mermaid_document,
  // which broke `message.toolRequest` for those tools even though dispatch and
  // approval worked correctly.
  const validToolNames = new Set<string>([
    'shell', 'filesystem', 'web', 'code', 'browser', 'unified_browser',
    'tax_return', 'pdf_document', 'workbook_document', 'word_document',
    'csv_document', 'email_document', 'markdown_document',
    'slides_document', 'archive_document', 'calendar_document',
    'mermaid_document', 'fetch_summarize',
  ])
  return typeof value === 'string' && validToolNames.has(value)
    ? value as OpenClawMessage['toolRequest']
    : undefined
}

// Detects when an assistant message narrates an imminent tool action (e.g.
// "Step 2 — Extract:", "Fetching the page now:") but ends without emitting a
// tool block. These messages stall the agent loop because there is nothing to
// execute, so the harness nudges the model to emit the block it promised.
function detectMissingToolIntent(content: string): boolean {
  const text = content.trim();
  if (!text) return false;

  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const lastLine = lines[lines.length - 1] || '';
  // A trailing question means the model is handing control back to the user.
  if (lastLine.endsWith('?')) return false;

  const plain = text.replace(/[*_`#>]/g, '').trim();
  // Phrases that explicitly hand control back to the user — never nudge on these.
  if (/\b(let me know|would you like|want me to|do you want|should i\b|which (one|would)|up to you)\b/i.test(plain)) {
    return false;
  }

  const actionCue = /\b(let me|i'?ll|i will|let's|lets|fetch(?:ing)?|open(?:ing)?|search(?:ing)?|run(?:ning)?|extract(?:ing)?|pull(?:ing)?|load(?:ing)?|navigat(?:e|ing)|grab(?:bing)?|visit(?:ing)?|get(?:ting)?|next step|next,|step \d|proceed(?:ing)?|now i|starting with)\b/i;
  const toolVerbTarget = /\b(open(?:ing)?|fetch(?:ing)?|search(?:ing)?|pull(?:ing)?|visit(?:ing)?|navigat(?:e|ing)|load(?:ing)?|extract(?:ing)?|run(?:ning)?|get(?:ting)?|check(?:ing)?)\b/i;

  // Strong signal: the message ends as if a tool block should immediately follow.
  const endsImminent = /[:：]$/.test(lastLine)
    || /(\.\.\.|…)$/.test(lastLine)
    || /[⬜▢]/.test(text);
  if (endsImminent && actionCue.test(text.slice(-500))) return true;

  // Softer signal: a short message that is purely an action announcement with no
  // delivered answer, e.g. "Next step: Open WhaleStream and MarketBeat in parallel."
  const isShortAnnouncement = plain.length <= 400;
  if (isShortAnnouncement && actionCue.test(plain) && toolVerbTarget.test(plain)) {
    return true;
  }

  return false;
}

function normalizeOpenClawMessage(value: unknown): OpenClawMessage | null {
  if (!value || typeof value !== 'object') return null;

  const raw = value as Partial<OpenClawMessage>;
  if (raw.role !== 'user' && raw.role !== 'assistant' && raw.role !== 'system') {
    return null;
  }

  const rawContent = typeof raw.content === 'string' ? raw.content : '';
  const extractedToolRequest = raw.role === 'assistant' && rawContent.includes('<openclaw_tool')
    ? extractOpenClawToolRequest(rawContent)
    : undefined;
  const content = extractedToolRequest
    ? extractedToolRequest.cleanedContent
    : rawContent;
  const thinking = typeof raw.thinking === 'string' ? raw.thinking : undefined;
  const sources = normalizeToolSources(raw.sources);
  const images = Array.isArray(raw.images) ? raw.images : undefined;
  const attachments = Array.isArray(raw.attachments) ? raw.attachments : undefined;
  const toolRequest = extractedToolRequest?.request
    ? normalizeExtractedToolRequestName(extractedToolRequest.request.name)
    : raw.toolRequest;
  const hidden = raw.hidden === true || Boolean(extractedToolRequest?.request) || rawContent.includes('<openclaw_tool');
  const hasPayload = Boolean(
    content.trim()
    || thinking?.trim()
    || sources.length
    || images?.length
    || attachments?.length
  );

  if (!hasPayload && !(typeof raw.id === 'string' && raw.id.trim())) {
    return null;
  }

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : undefined,
    role: raw.role,
    content,
    hidden,
    toolRequest,
    thinking,
    presentation: raw.presentation,
    sources: sources.length ? sources : undefined,
    images,
    attachments,
    meta: raw.meta,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
  };
}

function parseTimestampValue(value: unknown, fallback: number | null = null) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (value && typeof value === 'object' && value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? fallback : parsed;
  }

  return fallback;
}

function normalizeOpenClawSession(value: unknown): OpenClawSession | null {
  if (!value || typeof value !== 'object') return null;

  const raw = value as Partial<OpenClawSession>;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
  if (!id) return null;

  const messages = Array.isArray(raw.messages)
    ? raw.messages
        .map(normalizeOpenClawMessage)
        .filter((message): message is OpenClawMessage => Boolean(message))
    : [];

  return {
    id,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'WorkSpaces',
    updatedAt: parseTimestampValue(raw.updatedAt, Date.now()) ?? Date.now(),
    pinned: raw.pinned === true,
    surface: 'openclaw',
    messages,
    folderId: typeof raw.folderId === 'string' ? raw.folderId : raw.folderId === null ? null : undefined,
    tags: Array.isArray(raw.tags)
      ? raw.tags.flatMap(tag => {
          if (!tag || typeof tag !== 'object') return [];
          const normalizedTag = tag as { id?: unknown; name?: unknown; color?: unknown };
          if (typeof normalizedTag.id !== 'string' || typeof normalizedTag.name !== 'string' || typeof normalizedTag.color !== 'string') {
            return [];
          }
          return [{
            id: normalizedTag.id,
            name: normalizedTag.name,
            color: normalizedTag.color,
          }];
        })
      : undefined,
    summary: typeof raw.summary === 'string' ? raw.summary : raw.summary === null ? null : undefined,
    contextSummary: typeof raw.contextSummary === 'string' ? raw.contextSummary : raw.contextSummary === null ? null : undefined,
    contextSummaryUpdatedAt: parseTimestampValue(raw.contextSummaryUpdatedAt, null),
    analytics: raw.analytics && typeof raw.analytics === 'object' ? raw.analytics as SessionAnalytics : null,
    autoContinueMode: raw.autoContinueMode === 'safe' ? 'safe' : raw.autoContinueMode === 'ask' ? 'ask' : 'manual',
    autoContinueMaxSteps: typeof raw.autoContinueMaxSteps === 'number' ? raw.autoContinueMaxSteps : 3,
    lastAutoContinueAt: parseTimestampValue(raw.lastAutoContinueAt, null),
    parentSessionId: typeof raw.parentSessionId === 'string' ? raw.parentSessionId : raw.parentSessionId === null ? null : undefined,
    branchFromMessageId: typeof raw.branchFromMessageId === 'string' ? raw.branchFromMessageId : raw.branchFromMessageId === null ? null : undefined,
    branchLabel: typeof raw.branchLabel === 'string' ? raw.branchLabel : raw.branchLabel === null ? null : undefined,
    branchChildrenCount: typeof raw.branchChildrenCount === 'number' ? raw.branchChildrenCount : 0,
    branchDepth: typeof raw.branchDepth === 'number' ? raw.branchDepth : 0,
    ragEnabled: raw.ragEnabled === true,
    ragQuery: typeof raw.ragQuery === 'string' ? raw.ragQuery : raw.ragQuery === null ? null : undefined,
    ragSources: Array.isArray(raw.ragSources) ? normalizeMessageSources(raw.ragSources) : undefined,
  };
}

function sanitizeOpenClawMessages(messages: unknown): OpenClawMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .map(normalizeOpenClawMessage)
    .filter((message): message is OpenClawMessage => Boolean(message));
}

// Rendered document page images can be several MB of base64. Keep them in the
// live in-memory history (so the active vision turn can resend them) but drop
// them before persisting to the database to avoid bloating session storage and
// reload payloads. Reloaded threads fall back to the extracted text.
function stripAttachmentVisionData(messages: OpenClawMessage[]): OpenClawMessage[] {
  return messages.map(message => {
    if (!message.attachments?.length) return message;
    let changed = false;
    const attachments = message.attachments.map(attachment => {
      if (!attachment.pageImages?.length) return attachment;
      changed = true;
      const { pageImages: _pageImages, ...rest } = attachment;
      void _pageImages;
      return {
        ...rest,
        pageImageCount: attachment.pageImageCount ?? attachment.pageImages.length,
      };
    });
    return changed ? { ...message, attachments } : message;
  });
}

function sanitizeOpenClawSessions(sessions: unknown): OpenClawSession[] {
  if (!Array.isArray(sessions)) return [];
  return sessions
    .map(normalizeOpenClawSession)
    .filter((session): session is OpenClawSession => Boolean(session));
}

function getLatestVisibleAssistantMessage(messages: OpenClawMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant' && !message.hidden) {
      return message;
    }
  }
  return null;
}

function isAbsoluteUnixPath(value: string) {
  return value.startsWith('/');
}

function pathLooksLikeHostFilesystemTarget(requestedPath: string, allowedPaths: string[]) {
  if (requestedPath.startsWith('/home') || requestedPath.startsWith('/tmp')) {
    return true;
  }

  return allowedPaths.some(root =>
    requestedPath === root
    || requestedPath.startsWith(`${root}/`)
    || root.startsWith(`${requestedPath}/`)
  );
}

function inferFilesystemRequestFromShellCommand(
  command: string,
  allowedPaths: string[],
): { action: 'list' | 'read' | 'stat'; path: string } | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  // Only translate simple single-command filesystem inspection, not general shell usage.
  if (/[|;&<>`$()\\'"]/.test(trimmed)) {
    return null;
  }

  const tokens = trimmed.split(/\s+/);
  const program = tokens[0];
  const args = tokens.slice(1);
  const pathArgs = args.filter(arg => !arg.startsWith('-'));

  if (pathArgs.length !== 1 || !isAbsoluteUnixPath(pathArgs[0]) || !pathLooksLikeHostFilesystemTarget(pathArgs[0], allowedPaths)) {
    return null;
  }

  if (program === 'ls') {
    return { action: 'list', path: pathArgs[0] };
  }

  if (program === 'cat') {
    return { action: 'read', path: pathArgs[0] };
  }

  if (program === 'stat') {
    return { action: 'stat', path: pathArgs[0] };
  }

  return null;
}

function getOpenClawToolRequestSignature(request: OpenClawToolRequest) {
  if (request.name === 'web') {
    return `web:${request.request.query.trim()}`;
  }

  if (request.name === 'shell') {
    return `shell:${request.request.command.trim()}`;
  }

  if (request.name === 'code') {
    return `code:${request.request.runtime}:${request.request.workspacePath?.trim() || ''}:${request.request.filename?.trim() || ''}:${request.request.code.trim()}`;
  }

  if (request.name === 'browser') {
    return `browser:${request.request.action}:${request.request.url?.trim() || ''}:${request.request.linkIndex ?? ''}:${request.request.linkText?.trim() || ''}:${request.request.formIndex ?? ''}:${JSON.stringify(request.request.values || {})}:${request.request.mode || ''}`;
  }

  if (request.name === 'unified_browser') {
    const uwaf = request.request as OpenClawUwafBrowserToolRequest
    return `unified_browser:${uwaf.action}:${uwaf.query?.trim() || ''}:${uwaf.providerId?.trim() || ''}:${uwaf.url?.trim() || ''}:${uwaf.browserMode || ''}:${uwaf.stealthProfile || ''}:${uwaf.linkIndex ?? ''}:${uwaf.linkText?.trim() || ''}:${uwaf.formIndex ?? ''}:${JSON.stringify(uwaf.values || {})}:${uwaf.mode || ''}:${uwaf.depth ?? ''}:${uwaf.selector?.trim() || ''}:${uwaf.text || ''}:${uwaf.key?.trim() || ''}:${uwaf.tabIndex ?? ''}:${uwaf.timeoutMs ?? ''}:${uwaf.deltaY ?? ''}:${uwaf.optionValue?.trim() || ''}:${uwaf.optionLabel?.trim() || ''}`;
  }

  if (request.name === 'tax_return') {
    const tax = request.request as OpenClawTaxReturnToolRequest
    return `tax_return:${tax.action}:${tax.folder?.trim() || ''}:${tax.taxYear?.trim() || ''}:${tax.templateDocumentId?.trim() || ''}:${tax.flatten === true ? 'flatten' : ''}`;
  }

  if (request.name === 'pdf_document') {
    const pdf = request.request as OpenClawPdfDocumentToolRequest
    return `pdf_document:${pdf.title.trim()}:${pdf.filename?.trim() || ''}:${pdf.template || ''}:${(pdf.content || '').trim().slice(0, 2000)}:${JSON.stringify({
      sections: pdf.sections,
      fields: pdf.fields,
      tables: pdf.tables,
      callouts: pdf.callouts,
    }).slice(0, 2000)}`;
  }

  if (request.name === 'workbook_document') {
    const workbook = request.request as OpenClawWorkbookDocumentToolRequest
    return `workbook_document:${workbook.title.trim()}:${workbook.filename?.trim() || ''}:${workbook.template || ''}:${JSON.stringify({
      sheets: workbook.sheets,
      metadata: workbook.metadata,
    }).slice(0, 6000)}`;
  }

  if (request.name === 'word_document') {
    const word = request.request as OpenClawWordDocumentToolRequest
    return `word_document:${word.title.trim()}:${word.filename?.trim() || ''}:${word.template || ''}:${(word.content || '').trim().slice(0, 2000)}:${JSON.stringify({
      sections: word.sections,
      fields: word.fields,
      tables: word.tables,
      callouts: word.callouts,
      metadata: word.metadata,
    }).slice(0, 6000)}`;
  }

  if (request.name === 'csv_document') {
    const csv = request.request as OpenClawCsvDocumentToolRequest
    return `csv_document:${csv.title.trim()}:${csv.filename?.trim() || ''}:${(csv.content || '').trim().slice(0, 2000)}:${JSON.stringify({
      headers: csv.headers,
      rows: csv.rows?.slice(0, 20),
    }).slice(0, 4000)}`;
  }

  if (request.name === 'email_document') {
    const email = request.request as OpenClawEmailDocumentToolRequest
    return `email_document:${email.title?.trim() || email.subject.trim()}:${email.filename?.trim() || ''}:${email.to?.trim() || ''}:${email.subject.trim()}:${(email.body || '').trim().slice(0, 2000)}`;
  }

  if (request.name === 'fetch_summarize') {
    const fetchSummarize = request.request as OpenClawFetchSummarizeToolRequest
    return `fetch_summarize:${fetchSummarize.url.trim()}`;
  }

  if (request.name === 'markdown_document') {
    const markdown = request.request as OpenClawMarkdownDocumentToolRequest
    return `markdown_document:${markdown.title.trim()}:${markdown.filename?.trim() || ''}:${(markdown.content || '').trim().slice(0, 2000)}`;
  }

  if (request.name === 'slides_document') {
    const slides = request.request as OpenClawSlidesDocumentToolRequest
    return `slides_document:${slides.title.trim()}:${slides.filename?.trim() || ''}:${slides.slides.length}`;
  }

  if (request.name === 'archive_document') {
    const archive = request.request as OpenClawArchiveDocumentToolRequest
    return `archive_document:${archive.title.trim()}:${archive.filename?.trim() || ''}:${archive.entries.length}`;
  }

  if (request.name === 'calendar_document') {
    const calendar = request.request as OpenClawCalendarDocumentToolRequest
    return `calendar_document:${(calendar.title ?? '').trim()}:${calendar.filename?.trim() || ''}:${calendar.events.length}`;
  }

  if (request.name === 'mermaid_document') {
    const mermaid = request.request as OpenClawMermaidDocumentToolRequest
    return `mermaid_document:${mermaid.title.trim()}:${mermaid.filename?.trim() || ''}:${mermaid.format || 'svg'}`;
  }

  if (request.name === 'filesystem') {
    return `filesystem:${request.request.action}:${request.request.path.trim()}`;
  }

  const fallback = request as any;
  return `${fallback.name}:${JSON.stringify(fallback.request).slice(0, 200)}`;
}

function formatShellToolResult(entry: ShellOutputEntry): string {
  const lines = [
    'Shell command result:',
    `Target: ${entry.target === 'host' ? 'host machine' : 'container'}`,
    `Command: ${entry.command}`,
    `Status: ${entry.success ? 'completed' : entry.rejected ? 'rejected' : entry.blocked ? 'blocked' : 'failed'}`,
    `Exit code: ${entry.exitCode ?? 'none'}`,
    `Duration: ${entry.duration}ms`,
  ];

  if (entry.stdout?.trim()) {
    lines.push('', 'STDOUT:', entry.stdout.trim());
  }

  if (entry.stderr?.trim()) {
    lines.push('', 'STDERR:', entry.stderr.trim());
  }

  lines.push('', 'Use this result to continue the task. Do not claim anything beyond what the command output shows.');
  return lines.join('\n');
}

function formatFilesystemToolResult(entry: FilesystemToolResultEntry): string {
  const lines = [
    'Filesystem tool result:',
    `Action: ${entry.action}`,
    `Path: ${entry.path}`,
    `Status: ${entry.success ? 'completed' : 'failed'}`,
  ];

  if (!entry.success) {
    if (entry.code?.trim()) {
      lines.push(`Code: ${entry.code.trim()}`);
    }
    if (entry.error?.trim()) {
      lines.push(`Error: ${entry.error.trim()}`);
    }
    if (entry.actionRequired?.trim()) {
      lines.push(`Action required: ${entry.actionRequired.trim()}`);
    }
    lines.push('', 'Use this result to continue the task. Do not claim file access that did not happen.');
    return lines.join('\n');
  }

  lines.push(`Kind: ${entry.kind || 'unknown'}`);

  if (typeof entry.size === 'number') {
    lines.push(`Size: ${entry.size} bytes`);
  }

  if (entry.modifiedAt) {
    lines.push(`Modified: ${entry.modifiedAt}`);
  }

  if (entry.action === 'list') {
    const entries = entry.entries || [];
    lines.push('', 'Directory entries:');
    if (entries.length === 0) {
      lines.push('(empty)');
    } else {
      entries.forEach(item => {
        lines.push(`- [${item.kind}] ${item.path}${typeof item.size === 'number' ? ` (${item.size} bytes)` : ''}`);
      });
    }
  }

  if (entry.action === 'read') {
    if (entry.truncated) {
      lines.push('Content: truncated to fit read limit.');
    }
    lines.push('', 'File content:', entry.content !== undefined ? entry.content : '(empty file)');
  }

  if (entry.action === 'write' || entry.action === 'append') {
    if (typeof entry.bytesWritten === 'number') {
      lines.push(`Bytes written: ${entry.bytesWritten}`);
    }
    if (entry.created) {
      lines.push('Created: yes');
    }
    if (entry.content !== undefined) {
      if (entry.truncated) {
        lines.push('Written content preview: truncated.');
      }
      lines.push('', 'Written content preview:', entry.content);
    }
  }

  if (entry.action === 'mkdir' && entry.created) {
    lines.push('Created: yes');
  }

  lines.push('', 'Use this result to continue the task. Do not claim anything beyond the actual file contents or metadata.');
  return lines.join('\n');
}

function formatCodeToolResult(entry: CodeToolResultEntry): string {
  const lines = [
    'Code execution result:',
    `Runtime: ${entry.runtime}`,
    `Working directory: ${entry.workingDirectory}`,
    `Script path: ${entry.scriptPath}`,
    `Command: ${entry.command}`,
    `Status: ${entry.success ? 'completed' : 'failed'}`,
    `Exit code: ${entry.exitCode ?? 'none'}`,
    `Duration: ${entry.duration}ms`,
  ];

  if (!entry.success && entry.error?.trim()) {
    lines.push(`Error: ${entry.error.trim()}`);
  }

  if (entry.stdout?.trim()) {
    lines.push('', 'STDOUT:', entry.stdout.trim());
  }

  if (entry.stderr?.trim()) {
    lines.push('', 'STDERR:', entry.stderr.trim());
  }

  if (entry.outputTruncated) {
    lines.push('', 'Output was truncated to stay within sandbox limits.');
  }

  lines.push('', `Workspace entries returned: ${entry.files.length}`);
  entry.files.forEach(file => {
    lines.push(`- [${file.kind}] ${file.path}${typeof file.size === 'number' ? ` (${file.size} bytes)` : ''}`);
  });

  lines.push('', 'Use this result to continue the task. Do not claim runtime behavior or artifacts that were not returned here.');
  return lines.join('\n');
}

function pruneInterruptedMessages(messages: OpenClawMessage[]) {
  const next = [...messages];

  while (next.length > 0) {
    const last = next[next.length - 1];
    if (last?.hidden) {
      next.pop();
      continue;
    }
    if (last?.role === 'assistant' && !last.content.trim() && !last.thinking?.trim()) {
      next.pop();
      continue;
    }
    break;
  }

  return next;
}

function formatWebToolResult(entry: WebToolResultEntry): string {
  const lines = [
    'Web research tool result:',
    `Query: ${entry.query}`,
    `Status: ${entry.success ? 'completed' : 'failed'}`,
  ];

  if (entry.description?.trim()) {
    lines.push(`Description: ${entry.description.trim()}`);
  }

  if (!entry.success) {
    if (entry.error?.trim()) {
      lines.push(`Error: ${entry.error.trim()}`);
    }
    lines.push('', 'Use this result to continue the task. Do not claim web access or evidence that did not happen.');
    return lines.join('\n');
  }

  lines.push(`Sources returned: ${entry.sources.length}`);

  if (entry.context?.trim()) {
    lines.push('', 'Public web context:', entry.context.trim());
  }

  lines.push('', 'Use this result to continue the task. Base factual claims on these sources and cite them with inline markers like [^1].');
  return lines.join('\n');
}

function formatBrowserToolResult(entry: BrowserToolResultEntry): string {
  const lines = [
    'Browser tool result:',
    `Action: ${entry.action}`,
    `Status: ${entry.success ? 'completed' : 'failed'}`,
  ];

  if (!entry.success) {
    if (entry.error?.trim()) {
      lines.push(`Error: ${entry.error.trim()}`);
    }
    lines.push('', 'Use this result to continue the task. Do not claim browser actions or page state that did not happen.');
    return lines.join('\n');
  }

  lines.push(`URL: ${entry.currentUrl}`);
  lines.push(`Title: ${entry.title}`);

  if (entry.submitted) {
    lines.push(`Submitted: ${entry.submitted.method} ${entry.submitted.url} (${entry.submitted.fieldCount} fields)`);
  }

  if (entry.pendingFormValues && Object.keys(entry.pendingFormValues).length > 0) {
    lines.push('', 'Pending form values:');
    Object.entries(entry.pendingFormValues).forEach(([key, value]) => {
      lines.push(`- ${key}: ${value}`);
    });
  }

  if (entry.text?.trim()) {
    lines.push('', 'Page text:', entry.text.trim());
  }

  if (entry.links.length > 0) {
    lines.push('', 'Links:');
    entry.links.forEach(link => {
      lines.push(`- [${link.index}] ${link.text} -> ${link.url}`);
    });
  }

  if (entry.forms.length > 0) {
    lines.push('', 'Forms:');
    entry.forms.forEach(form => {
      lines.push(`- [${form.index}] ${form.method} ${form.action}`);
      form.fields.forEach(field => {
        lines.push(`  - ${field.name} (${field.type})${field.value ? ` = ${field.value}` : ''}`);
      });
    });
  }

  if (entry.html?.trim()) {
    lines.push('', 'HTML excerpt:', entry.html.trim());
  }

  lines.push('', 'Use this result to continue the task. Do not claim page content, forms, or navigation state beyond what this browser result contains.');
  return lines.join('\n');
}

function formatUwafBrowserToolResult(entry: UwafBrowserToolResultEntry): string {
  const profileLabel = entry.mode === 'stealth' && entry.stealthProfile ? ` · ${entry.stealthProfile}` : '';
  const modeLabel = entry.mode === 'stealth' ? `Stealth (Tor${profileLabel})` : 'Direct (Clear Web)';
  const lines = [
    `Unified browser result [${modeLabel}]:`,
    `Action: ${entry.action}`,
    `Status: ${entry.success ? 'completed' : 'failed'}`,
    `Source: ${entry.source === 'dark_web' ? 'Dark Web' : 'Clear Web'}`,
  ];

  if (!entry.success) {
    if (entry.searchEngine?.trim()) {
      lines.push(`Search engine: ${entry.searchEngine.trim()}`);
    }
    if (entry.searchProviderId?.trim()) {
      lines.push(`Search provider id: ${entry.searchProviderId.trim()}`);
    }
    if (entry.failureCode) {
      lines.push(`Failure code: ${entry.failureCode}`);
    }
    if (entry.error?.trim()) {
      lines.push(`Error: ${entry.error.trim()}`);
    }
    if (entry.failureDetail?.trim() && entry.failureDetail.trim() !== entry.error?.trim()) {
      lines.push(`Detail: ${entry.failureDetail.trim()}`);
    }
    if (entry.searchAttempts && entry.searchAttempts.length > 0) {
      lines.push('', 'Provider attempts:');
      entry.searchAttempts.forEach(attempt => {
        const status = attempt.success
          ? `success (${attempt.resultCount} result blocks)`
          : `failed${attempt.failureCode ? `: ${attempt.failureCode}` : ''}${attempt.resultCount > 0 ? ` (${attempt.resultCount} result blocks)` : ''}`;
        lines.push(`- ${attempt.providerLabel} [${attempt.providerId}]: ${status}`);
      });
    }
    if (entry.observations && entry.observations.length > 0) {
      lines.push('', 'Observed issues:');
      entry.observations.forEach(note => {
        lines.push(`- ${note}`);
      });
    }
    lines.push('', 'Use this result to continue the task. Do not claim browser actions or page state that did not happen.');
    return lines.join('\n');
  }

  lines.push(`URL: ${entry.currentUrl}`);
  lines.push(`Title: ${entry.title}`);
  if (entry.requestedQuery?.trim()) {
    lines.push(`Query: ${entry.requestedQuery.trim()}`);
  }
  if (entry.searchEngine?.trim()) {
    lines.push(`Search engine: ${entry.searchEngine.trim()}`);
  }
  if (entry.searchProviderId?.trim()) {
    lines.push(`Search provider id: ${entry.searchProviderId.trim()}`);
  }
  if (typeof entry.queryMatched === 'boolean') {
    lines.push(`Query matched page: ${entry.queryMatched ? 'yes' : 'no'}`);
  }
  if (typeof entry.resultCount === 'number') {
    lines.push(`Detected result blocks: ${entry.resultCount}`);
  }
  if (typeof entry.httpStatus === 'number') {
    lines.push(`HTTP status: ${entry.httpStatus}`);
  }
  if (entry.redirected) {
    lines.push('Redirected: yes');
  }
  if (typeof entry.navigationChanged === 'boolean') {
    lines.push(`Navigation changed: ${entry.navigationChanged ? 'yes' : 'no'}`);
  }
  if (typeof entry.pageChanged === 'boolean') {
    lines.push(`Page changed: ${entry.pageChanged ? 'yes' : 'no'}`);
  }
  if (typeof entry.selectorMatched === 'boolean') {
    lines.push(`Selector matched: ${entry.selectorMatched ? 'yes' : 'no'}`);
  }
  if (entry.waitTimedOut) {
    lines.push('Wait timed out: yes');
  }
  if (entry.antiBotDetected) {
    lines.push('Anti-bot detected: yes');
  }
  if (entry.loginDetected) {
    lines.push('Login/auth detected: yes');
  }
  if (entry.searchAttempts && entry.searchAttempts.length > 0) {
    lines.push('', 'Provider attempts:');
    entry.searchAttempts.forEach(attempt => {
      const status = attempt.success
        ? `success (${attempt.resultCount} result blocks)`
        : `failed${attempt.failureCode ? `: ${attempt.failureCode}` : ''}${attempt.resultCount > 0 ? ` (${attempt.resultCount} result blocks)` : ''}`;
      lines.push(`- ${attempt.providerLabel} [${attempt.providerId}]: ${status}`);
    });
  }

  if (entry.text?.trim()) {
    lines.push('', 'Page content:', entry.text.trim());
  } else if (entry.markdown?.trim()) {
    lines.push('', 'Page content (Markdown):', entry.markdown.trim());
  }

  if (entry.links.length > 0) {
    lines.push('', 'Links:');
    entry.links.forEach(link => {
      lines.push(`- [${link.index}] ${link.text} -> ${link.url}`);
    });
  }

  if (entry.forms.length > 0) {
    lines.push('', 'Forms:');
    entry.forms.forEach(form => {
      lines.push(`- [${form.index}] ${form.method} ${form.action}`);
      form.fields.forEach(field => {
        lines.push(`  - ${field.name} (${field.type})${field.value ? ` = ${field.value}` : ''}`);
      });
    });
  }

  if (entry.tables && entry.tables.length > 0) {
    lines.push('', 'Tables:');
    entry.tables.forEach((table, i) => {
      lines.push(`  Table ${i + 1}: ${table.headers.length} columns, ${table.rows.length} rows`);
      lines.push(table.markdown);
    });
  }

  if (entry.batchResults && entry.batchResults.length > 0) {
    lines.push('', `Research batch: ${entry.batchResults.length} pages crawled`);
    entry.batchResults.forEach((result, i) => {
      lines.push(`  [Depth ${result.depth}] ${result.title} - ${result.url}`);
      if (result.markdown.trim()) {
        lines.push(`  Content preview: ${result.markdown.slice(0, 500)}...`);
      }
    });
  }

  if (entry.tabs && entry.tabs.length > 0) {
    lines.push('', 'Tabs:');
    entry.tabs.forEach(tab => {
      lines.push(`- [${tab.index}] ${tab.active ? '*' : ' '} ${tab.title || '(untitled)'} -> ${tab.url}`);
    });
  }

  if (entry.observations && entry.observations.length > 0) {
    lines.push('', 'Observations:');
    entry.observations.forEach(note => {
      lines.push(`- ${note}`);
    });
  }

  if (entry.jsErrors && entry.jsErrors.length > 0) {
    lines.push('', 'JavaScript/runtime issues:');
    entry.jsErrors.forEach(issue => {
      lines.push(`- ${issue}`);
    });
  }

  if (entry.networkErrors && entry.networkErrors.length > 0) {
    lines.push('', 'Network issues:');
    entry.networkErrors.forEach(issue => {
      lines.push(`- ${issue}`);
    });
  }

  lines.push('', 'Use this result to continue the task. Separate observed evidence from inference, and do not claim a search or interaction succeeded unless these browser fields show that it did.');
  return lines.join('\n');
}

function formatTaxReturnToolResult(entry: TaxReturnToolResultEntry): string {
  const lines = [
    'Tax return PDF tool result:',
    `Action: ${entry.action}`,
    `Status: ${entry.success ? 'completed' : 'failed'}`,
  ];

  if (!entry.success) {
    if (entry.error?.trim()) lines.push(`Error: ${entry.error.trim()}`);
    lines.push('', 'Use this result to continue the task. Do not claim a PDF was generated if this result failed.');
    return lines.join('\n');
  }

  if (entry.artifact) {
    lines.push(
      `Artifact: ${entry.artifact.name}`,
      `Artifact id: ${entry.artifact.id}`,
      `Download URL: ${entry.artifact.downloadUrl}`,
      `Mime type: ${entry.artifact.mimeType}`,
      `Size: ${entry.artifact.size} bytes`,
    );
  }

  if (entry.filledFields && entry.filledFields.length > 0) {
    lines.push('', `Filled form fields: ${entry.filledFields.length}`);
    entry.filledFields.slice(0, 30).forEach(field => lines.push(`- ${field}`));
  }

  if (entry.missingFields && entry.missingFields.length > 0) {
    lines.push('', 'Missing or uncertain fields:');
    entry.missingFields.forEach(field => lines.push(`- ${field}`));
  }

  if (entry.warnings && entry.warnings.length > 0) {
    lines.push('', 'Warnings:');
    entry.warnings.forEach(warning => lines.push(`- ${warning}`));
  }

  lines.push('', artifactDownloadInstruction(entry.artifact?.name ?? 'tax-review.pdf'));
  lines.push('Use this result to clearly state any missing fields or review warnings.');
  return lines.join('\n');
}

function artifactDownloadInstruction(artifactName: string): string {
  return `When presenting the download link, output a markdown link using the artifact name as the link text and the EXACT relative Download URL below (for example: [${artifactName}](<URL>)). Do not add any domain or protocol prefix such as https://peakui.com; the URL must stay a relative path starting with /api/canvas/artifacts/.`;
}

function formatPdfDocumentToolResult(entry: PdfDocumentToolResultEntry): string {
  const lines = [
    'PDF document tool result:',
    `Title: ${entry.title}`,
    `Status: ${entry.success ? 'completed' : 'failed'}`,
  ];

  if (!entry.success) {
    if (entry.error?.trim()) lines.push(`Error: ${entry.error.trim()}`);
    lines.push('', 'Use this result to continue the task. Do not claim a PDF was generated if this result failed.');
    return lines.join('\n');
  }

  if (entry.artifact) {
    lines.push(
      `Artifact: ${entry.artifact.name}`,
      `Artifact id: ${entry.artifact.id}`,
      `Download URL: ${entry.artifact.downloadUrl}`,
      `Mime type: ${entry.artifact.mimeType}`,
      `Size: ${entry.artifact.size} bytes`,
    );
  }

  lines.push('', artifactDownloadInstruction(entry.artifact?.name ?? 'document.pdf'));
  lines.push('Keep the user-facing response concise and do not restate the full PDF contents in markdown unless the user explicitly asks for an inline summary.');
  return lines.join('\n');
}

function formatWorkbookDocumentToolResult(entry: WorkbookDocumentToolResultEntry): string {
  const lines = [
    'Excel workbook tool result:',
    `Title: ${entry.title}`,
    `Status: ${entry.success ? 'completed' : 'failed'}`,
  ];

  if (!entry.success) {
    if (entry.error?.trim()) lines.push(`Error: ${entry.error.trim()}`);
    lines.push('', 'Use this result to continue the task. Do not claim a workbook was generated if this result failed.');
    return lines.join('\n');
  }

  if (entry.artifact) {
    lines.push(
      `Artifact: ${entry.artifact.name}`,
      `Artifact id: ${entry.artifact.id}`,
      `Download URL: ${entry.artifact.downloadUrl}`,
      `Mime type: ${entry.artifact.mimeType}`,
      `Size: ${entry.artifact.size} bytes`,
    );
  }

  lines.push('', artifactDownloadInstruction(entry.artifact?.name ?? 'document.xlsx'));
  lines.push('Keep the user-facing response concise and do not restate spreadsheet rows as markdown unless the user explicitly asks for an inline summary.');
  return lines.join('\n');
}

function formatWordDocumentToolResult(entry: WordDocumentToolResultEntry): string {
  const lines = [
    'Word document tool result:',
    `Title: ${entry.title}`,
    `Status: ${entry.success ? 'completed' : 'failed'}`,
  ];

  if (!entry.success) {
    if (entry.error?.trim()) lines.push(`Error: ${entry.error.trim()}`);
    lines.push('', 'Use this result to continue the task. Do not claim a Word document was generated if this result failed.');
    return lines.join('\n');
  }

  if (entry.artifact) {
    lines.push(
      `Artifact: ${entry.artifact.name}`,
      `Artifact id: ${entry.artifact.id}`,
      `Download URL: ${entry.artifact.downloadUrl}`,
      `Mime type: ${entry.artifact.mimeType}`,
      `Size: ${entry.artifact.size} bytes`,
    );
  }

  lines.push('', artifactDownloadInstruction(entry.artifact?.name ?? 'document.docx'));
  lines.push('Keep the user-facing response concise and do not restate the full document in markdown unless the user explicitly asks for an inline summary.');
  return lines.join('\n');
}

function formatCsvDocumentToolResult(entry: CsvDocumentToolResultEntry): string {
  const lines = [
    'CSV export tool result:',
    `Title: ${entry.title}`,
    `Status: ${entry.success ? 'completed' : 'failed'}`,
  ];

  if (!entry.success) {
    if (entry.error?.trim()) lines.push(`Error: ${entry.error.trim()}`);
    lines.push('', 'Use this result to continue the task. Do not claim a CSV was exported if this result failed.');
    return lines.join('\n');
  }

  if (entry.artifact) {
    lines.push(
      `Artifact: ${entry.artifact.name}`,
      `Artifact id: ${entry.artifact.id}`,
      `Download URL: ${entry.artifact.downloadUrl}`,
      `Mime type: ${entry.artifact.mimeType}`,
      `Size: ${entry.artifact.size} bytes`,
    );
  }

  lines.push('', artifactDownloadInstruction(entry.artifact?.name ?? 'document.csv'));
  lines.push('Keep the user-facing response concise.');
  return lines.join('\n');
}

function formatEmailDocumentToolResult(entry: EmailDocumentToolResultEntry): string {
  const lines = [
    'Email writer tool result:',
    `Title: ${entry.title}`,
    `Status: ${entry.success ? 'completed' : 'failed'}`,
  ];

  if (!entry.success) {
    if (entry.error?.trim()) lines.push(`Error: ${entry.error.trim()}`);
    lines.push('', 'Use this result to continue the task. Do not claim an email was generated if this result failed.');
    return lines.join('\n');
  }

  if (entry.artifact) {
    lines.push(
      `Artifact: ${entry.artifact.name}`,
      `Artifact id: ${entry.artifact.id}`,
      `Download URL: ${entry.artifact.downloadUrl}`,
      `Mime type: ${entry.artifact.mimeType}`,
      `Size: ${entry.artifact.size} bytes`,
    );
  }

  lines.push('', artifactDownloadInstruction(entry.artifact?.name ?? 'email.eml'));
  lines.push('Present the .eml download link first, then offer to revise the draft if the user wants changes.');
  return lines.join('\n');
}

function formatMarkdownDocumentToolResult(entry: MarkdownDocumentToolResultEntry): string {
  const lines = [
    'Markdown document tool result:',
    `Title: ${entry.title}`,
    `Status: ${entry.success ? 'completed' : 'failed'}`,
  ];

  if (!entry.success) {
    if (entry.error?.trim()) lines.push(`Error: ${entry.error.trim()}`);
    lines.push('', 'Use this result to continue the task. Do not claim a Markdown file was generated if this result failed.');
    return lines.join('\n');
  }

  if (entry.artifact) {
    lines.push(
      `Artifact: ${entry.artifact.name}`,
      `Artifact id: ${entry.artifact.id}`,
      `Download URL: ${entry.artifact.downloadUrl}`,
      `Mime type: ${entry.artifact.mimeType}`,
      `Size: ${entry.artifact.size} bytes`,
    );
  }

  lines.push('', artifactDownloadInstruction(entry.artifact?.name ?? 'document.md'));
  lines.push('Present the .md download link first. Keep the user-facing response concise and do not restate the full Markdown contents unless the user explicitly asks for an inline summary.');
  return lines.join('\n');
}

function formatSlidesDocumentToolResult(entry: SlidesDocumentToolResultEntry): string {
  const lines = [
    'Slide deck tool result:',
    `Title: ${entry.title}`,
    `Status: ${entry.success ? 'completed' : 'failed'}`,
  ];
  if (!entry.success) {
    if (entry.error?.trim()) lines.push(`Error: ${entry.error.trim()}`);
    lines.push('', 'Use this result to continue the task. Do not claim a slide deck was generated if this result failed.');
    return lines.join('\n');
  }
  if (entry.artifact) {
    lines.push(
      `Artifact: ${entry.artifact.name}`,
      `Artifact id: ${entry.artifact.id}`,
      `Download URL: ${entry.artifact.downloadUrl}`,
      `Mime type: ${entry.artifact.mimeType}`,
      `Size: ${entry.artifact.size} bytes`,
    );
  }
  lines.push('', artifactDownloadInstruction(entry.artifact?.name ?? 'deck.pptx'));
  lines.push('Present the .pptx download link first.');
  return lines.join('\n');
}

function formatArchiveDocumentToolResult(entry: ArchiveDocumentToolResultEntry): string {
  const lines = [
    'Archive tool result:',
    `Title: ${entry.title}`,
    `Status: ${entry.success ? 'completed' : 'failed'}`,
  ];
  if (!entry.success) {
    if (entry.error?.trim()) lines.push(`Error: ${entry.error.trim()}`);
    lines.push('', 'Use this result to continue the task. Do not claim a ZIP archive was generated if this result failed.');
    return lines.join('\n');
  }
  if (entry.artifact) {
    lines.push(
      `Artifact: ${entry.artifact.name}`,
      `Artifact id: ${entry.artifact.id}`,
      `Download URL: ${entry.artifact.downloadUrl}`,
      `Mime type: ${entry.artifact.mimeType}`,
      `Size: ${entry.artifact.size} bytes`,
    );
  }
  lines.push('', artifactDownloadInstruction(entry.artifact?.name ?? 'bundle.zip'));
  lines.push('Present the .zip download link first.');
  return lines.join('\n');
}

function formatCalendarDocumentToolResult(entry: CalendarDocumentToolResultEntry): string {
  const lines = [
    'Calendar tool result:',
    `Title: ${entry.title}`,
    `Status: ${entry.success ? 'completed' : 'failed'}`,
  ];
  if (!entry.success) {
    if (entry.error?.trim()) lines.push(`Error: ${entry.error.trim()}`);
    lines.push('', 'Use this result to continue the task. Do not claim a calendar event was generated if this result failed.');
    return lines.join('\n');
  }
  if (entry.artifact) {
    lines.push(
      `Artifact: ${entry.artifact.name}`,
      `Artifact id: ${entry.artifact.id}`,
      `Download URL: ${entry.artifact.downloadUrl}`,
      `Mime type: ${entry.artifact.mimeType}`,
      `Size: ${entry.artifact.size} bytes`,
    );
  }
  lines.push('', artifactDownloadInstruction(entry.artifact?.name ?? 'event.ics'));
  lines.push('Present the .ics download link first.');
  return lines.join('\n');
}

function formatMermaidDocumentToolResult(entry: MermaidDocumentToolResultEntry): string {
  const lines = [
    'Mermaid diagram tool result:',
    `Title: ${entry.title}`,
    `Status: ${entry.success ? 'completed' : 'failed'}`,
  ];
  if (!entry.success) {
    if (entry.error?.trim()) lines.push(`Error: ${entry.error.trim()}`);
    lines.push('', 'Use this result to continue the task. Do not claim a diagram was generated if this result failed.');
    return lines.join('\n');
  }
  if (entry.artifact) {
    lines.push(
      `Artifact: ${entry.artifact.name}`,
      `Artifact id: ${entry.artifact.id}`,
      `Download URL: ${entry.artifact.downloadUrl}`,
      `Mime type: ${entry.artifact.mimeType}`,
      `Size: ${entry.artifact.size} bytes`,
    );
  }
  lines.push('', artifactDownloadInstruction(entry.artifact?.name ?? 'diagram.svg'));
  lines.push('Present the diagram download link first; the Canvas panel will render an inline preview.');
  return lines.join('\n');
}

function formatFetchSummarizeToolResult(entry: FetchSummarizeToolResultEntry): string {
  const lines = [
    'URL fetch and summarize tool result:',
    `URL: ${entry.url}`,
    `Status: ${entry.success ? 'completed' : 'failed'}`,
  ];

  if (!entry.success) {
    if (entry.error?.trim()) lines.push(`Error: ${entry.error.trim()}`);
    lines.push('', 'Use this result to continue the task. Do not claim the page was fetched if this result failed.');
    return lines.join('\n');
  }

  if (entry.title) lines.push(`Title: ${entry.title}`);
  if (entry.summary && entry.summary.length > 0) {
    lines.push('', 'Summary:');
    entry.summary.forEach(bullet => lines.push(`- ${bullet}`));
  }
  if (entry.quote) lines.push('', `Key quote: "${entry.quote}"`);

  lines.push('', 'Use this result to answer the user. Cite the source URL explicitly.');
  return lines.join('\n');
}

export interface OpenClawWorkspaceProps {
  onNavigateToKnowledgeBase?: () => void;
  onNavigateToWorkspace?: () => void;
  onNavigateToSettings?: () => void;
  view?: 'workspace' | 'knowledge-base' | 'settings';
  knowledgeBaseContent?: React.ReactNode;
  settingsContent?: React.ReactNode;
  settingsRevision?: number;
}

export default function OpenClawWorkspace({
  onNavigateToKnowledgeBase,
  onNavigateToWorkspace,
  onNavigateToSettings,
  view = 'workspace',
  knowledgeBaseContent,
  settingsContent,
  settingsRevision = 0,
}: OpenClawWorkspaceProps) {
  const getStoredInternetEnabled = () => {
    if (typeof window === 'undefined') return false;
    try {
      return window.sessionStorage.getItem(OPENCLAW_INTERNET_STORAGE) === 'true';
    } catch {
      return false;
    }
  };

  const getStoredRagEnabled = (): boolean | null => {
    if (typeof window === 'undefined') return null;
    try {
      const stored = window.sessionStorage.getItem(OPENCLAW_RAG_STORAGE);
      if (stored === 'true') return true;
      if (stored === 'false') return false;
      return null;
    } catch {
      return null;
    }
  };

  const getStoredAgentPreferences = () => {
    if (typeof window === 'undefined') return DEFAULT_OPENCLAW_AGENT_PREFERENCES;
    try {
      const storedPreferences = window.localStorage.getItem(OPENCLAW_AGENT_STORAGE);
      if (!storedPreferences) return DEFAULT_OPENCLAW_AGENT_PREFERENCES;

      const parsed = JSON.parse(storedPreferences) as Partial<OpenClawAgentPreferences>;
      return {
        ...DEFAULT_OPENCLAW_AGENT_PREFERENCES,
        ...parsed,
        mode: (parsed.mode as OpenClawAgentMode) || DEFAULT_OPENCLAW_AGENT_PREFERENCES.mode,
        responseStyle: (parsed.responseStyle as OpenClawResponseStyle) || DEFAULT_OPENCLAW_AGENT_PREFERENCES.responseStyle,
        workspaceNotes: typeof parsed.workspaceNotes === 'string' ? parsed.workspaceNotes : '',
        successCriteria: typeof parsed.successCriteria === 'string' ? parsed.successCriteria : '',
        askClarifyingQuestionFirst: typeof parsed.askClarifyingQuestionFirst === 'boolean'
          ? parsed.askClarifyingQuestionFirst
          : DEFAULT_OPENCLAW_AGENT_PREFERENCES.askClarifyingQuestionFirst,
      };
    } catch {
      return DEFAULT_OPENCLAW_AGENT_PREFERENCES;
    }
  };

  const getStoredRightRailCollapsed = () => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(OPENCLAW_RAIL_STORAGE) === 'true';
    } catch {
      return false;
    }
  };

  const getStoredTaskStates = () => {
    if (typeof window === 'undefined') return {};
    try {
      const storedTaskStates = window.localStorage.getItem(OPENCLAW_TASK_STATE_STORAGE);
      if (!storedTaskStates) return {};
      const parsed = JSON.parse(storedTaskStates) as Record<string, Partial<OpenClawTaskState>>;
      return Object.entries(parsed).reduce<Record<string, OpenClawTaskState>>((acc, [key, value]) => {
        acc[key] = {
          ...DEFAULT_OPENCLAW_TASK_STATE,
          ...value,
          checklist: Array.isArray(value?.checklist)
            ? value.checklist
              .filter(item => item && typeof item.text === 'string')
              .map(item => ({
                id: typeof item.id === 'string' && item.id ? item.id : randomUUID(),
                text: item.text,
                completed: Boolean(item.completed),
              }))
            : [],
        };
        return acc;
      }, {});
    } catch {
      return {};
    }
  };

  const getStoredPersona = (): OpenClawPersona & { templateId: OpenClawPersonaTemplateId } => {
    if (typeof window === 'undefined') return { ...DEFAULT_OPENCLAW_PERSONA, templateId: 'custom' };
    try {
      const stored = window.localStorage.getItem(OPENCLAW_PERSONA_STORAGE);
      if (!stored) return { ...DEFAULT_OPENCLAW_PERSONA, templateId: 'custom' };
      const parsed = JSON.parse(stored) as Partial<OpenClawPersona & { templateId: OpenClawPersonaTemplateId }>;
      const templateId = (parsed.templateId as OpenClawPersonaTemplateId) || 'custom';
      const base = templateId === 'custom' ? DEFAULT_OPENCLAW_PERSONA : applyPersonaTemplate(templateId);
      return {
        ...base,
        name: typeof parsed.name === 'string' ? parsed.name : base.name,
        tone: typeof parsed.tone === 'string' ? parsed.tone : base.tone,
        expertise: typeof parsed.expertise === 'string' ? parsed.expertise : base.expertise,
        boundaries: typeof parsed.boundaries === 'string' ? parsed.boundaries : base.boundaries,
        operatingInstructions: typeof parsed.operatingInstructions === 'string' ? parsed.operatingInstructions : base.operatingInstructions,
        templateId,
      };
    } catch {
      return { ...DEFAULT_OPENCLAW_PERSONA, templateId: 'custom' };
    }
  };

  const getStoredUserProfile = (): OpenClawUserProfile => {
    if (typeof window === 'undefined') return DEFAULT_OPENCLAW_USER_PROFILE;
    try {
      const stored = window.localStorage.getItem(OPENCLAW_USER_PROFILE_STORAGE);
      if (!stored) return DEFAULT_OPENCLAW_USER_PROFILE;
      const parsed = JSON.parse(stored) as Partial<OpenClawUserProfile>;
      return {
        name: typeof parsed.name === 'string' ? parsed.name : '',
        role: typeof parsed.role === 'string' ? parsed.role : '',
        preferences: typeof parsed.preferences === 'string' ? parsed.preferences : '',
        context: typeof parsed.context === 'string' ? parsed.context : '',
      };
    } catch {
      return DEFAULT_OPENCLAW_USER_PROFILE;
    }
  };

  const getStoredCurrentSessionSelection = () => {
    if (typeof window === 'undefined') return '';
    try {
      return window.sessionStorage.getItem(OPENCLAW_CURRENT_SESSION_STORAGE) || '';
    } catch {
      return '';
    }
  };

  const getStoredCurrentWorkspaceSelection = () => {
    if (typeof window === 'undefined') return '';
    try {
      return window.localStorage.getItem(OPENCLAW_CURRENT_WORKSPACE_STORAGE) || '';
    } catch {
      return '';
    }
  };

  const getIsMobileViewport = () => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= MOBILE_BREAKPOINT;
  };

  const [settings, setSettings] = useState<OpenClawSettings | null>(null);
  const [draftSessionAutoContinueMode, setDraftSessionAutoContinueMode] = useState<SessionAutoContinueMode>('manual');
  const [draftSessionAutoContinueMaxSteps, setDraftSessionAutoContinueMaxSteps] = useState(3);
  const [effectiveToolAccess, setEffectiveToolAccess] = useState<EffectiveOpenClawToolAccess | null>(null);
  const [models, setModels] = useState<OpenClawModel[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false);
  const [workspaces, setWorkspaces] = useState<OpenClawWorkspaceRecord[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string>(() => getStoredCurrentWorkspaceSelection());
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceDescription, setNewWorkspaceDescription] = useState('');
  const [sessions, setSessions] = useState<OpenClawSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => {
    const storedSelection = getStoredCurrentSessionSelection();
    return storedSelection && storedSelection !== OPENCLAW_DRAFT_TASK_ID ? storedSelection : null;
  });
  const [chatHistory, setChatHistory] = useState<OpenClawMessage[]>([]);
  const [message, setMessage] = useState('');
  const deferredChatHistory = useDeferredValue(chatHistory);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamPhase, setStreamPhase] = useState<UiStreamPhase | null>(null);
  const [liveStats, setLiveStats] = useState<{ tps: number; tokens: number } | null>(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [favoriteModels, setFavoriteModels] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(OPENCLAW_MODEL_FAVORITES_STORAGE) || '[]');
      return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
    } catch {
      return [];
    }
  });
  const [provider, setProvider] = useState<OpenClawProvider>('ollama');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelSupportsVision, setModelSupportsVision] = useState(false);
  const visionCapabilityCacheRef = useRef<Map<string, boolean>>(new Map());
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
  const [connectionSummary, setConnectionSummary] = useState('');
  const [sessionMenuOpen, setSessionMenuOpen] = useState<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [folders, setFolders] = useState<OpenClawFolder[]>([]);
  const [tags, setTags] = useState<OpenClawTag[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [showNewTagModal, setShowNewTagModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState('#6366f1');
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#10b981');
  const [sessionSelectionMode, setSessionSelectionMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [sessionListPage, setSessionListPage] = useState(0);
  const [selectedSessionInfo, setSelectedSessionInfo] = useState<string>('');
  const [ragEnabled, setRagEnabled] = useState(() => getStoredRagEnabled() ?? false);
  const [ragFolderPath, setRagFolderPath] = useState<string | null>(null);
  const [ragFolderPopoverOpen, setRagFolderPopoverOpen] = useState(false);
  const ragFolderButtonRef = useRef<HTMLButtonElement>(null);
  const ragFolderPopoverRef = useRef<HTMLDivElement>(null);
  const [internetEnabled, setInternetEnabled] = useState(getStoredInternetEnabled);
  const [uwafBrowserMode, setUwafBrowserMode] = useState<'direct' | 'stealth'>('direct');
  const [unrestrictedEnabled, setUnrestrictedEnabled] = useState(() => {
    try { return window.sessionStorage.getItem(OPENCLAW_UNRESTRICTED_STORAGE) === 'true'; } catch { return false; }
  });
  const [uncensoredEnabled, setUncensoredEnabled] = useState(() => {
    try { return window.sessionStorage.getItem(OPENCLAW_UNCENSORED_STORAGE) === 'true'; } catch { return false; }
  });
  const [uwafCurrentUrl, setUwafCurrentUrl] = useState<string>('');
  const [uwafCurrentTitle, setUwafCurrentTitle] = useState<string>('');
  const [browserModalOpen, setBrowserModalOpen] = useState(false);
  const [browserInterrupted, setBrowserInterrupted] = useState(false);
  const [browserLiveStatus, setBrowserLiveStatus] = useState<'connecting' | 'live' | 'disconnected' | 'failed'>('connecting');
  const [browserTakeoverRequestId, setBrowserTakeoverRequestId] = useState(0);
  const browserInterruptedRef = useRef(false);
  const switchUwafBrowserMode = useCallback((nextMode: 'direct' | 'stealth') => {
    setUwafBrowserMode((currentMode) => {
      if (currentMode === nextMode) return currentMode;

      setBrowserModalOpen(false);
      setBrowserInterrupted(false);
      browserInterruptedRef.current = false;
      setBrowserLiveStatus('connecting');
      setUwafCurrentUrl('');
      setUwafCurrentTitle('');
      setBrowserTakeoverRequestId((previous) => previous + 1);

      return nextMode;
    });
  }, []);
  const [stoppingModel, setStoppingModel] = useState(false);
  const [modelControlNote, setModelControlNote] = useState('');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [headerModeMenuOpen, setHeaderModeMenuOpen] = useState<string | null>(null);
  const [workspaceCapabilitiesOpen, setWorkspaceCapabilitiesOpen] = useState(false);
  const [automationPanelOpen, setAutomationPanelOpen] = useState(false);
  const [branchCompareOpen, setBranchCompareOpen] = useState(false);
  const [branchCompareLeftId, setBranchCompareLeftId] = useState('');
  const [branchCompareRightId, setBranchCompareRightId] = useState('');
  const [rightRailCollapsed, setRightRailCollapsed] = useState(getStoredRightRailCollapsed);
  const [isMobileViewport, setIsMobileViewport] = useState(getIsMobileViewport);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [mobileHeaderMenuOpen, setMobileHeaderMenuOpen] = useState(false);
  const [mobileModelMenuOpen, setMobileModelMenuOpen] = useState(false);
  const [agentPreferences, setAgentPreferences] = useState<OpenClawAgentPreferences>(getStoredAgentPreferences);
  const [autoContinuePending, setAutoContinuePending] = useState(false);
  const autoContinueCountRef = useRef(0);
  const [taskStates, setTaskStates] = useState<Record<string, OpenClawTaskState>>(getStoredTaskStates);
  const [lastSubmission, setLastSubmission] = useState<{ prompt: string; internetEnabled: boolean } | null>(null);
  const [ollamaHealth, setOllamaHealth] = useState<OllamaHealthSummary | null>(null);
  const [ollamaHealthLoading, setOllamaHealthLoading] = useState(false);
  const [persona, setPersona] = useState<OpenClawPersona & { templateId: OpenClawPersonaTemplateId }>(getStoredPersona);
  const [userProfile, setUserProfile] = useState<OpenClawUserProfile>(getStoredUserProfile);
  const [agentModePanelOpen, setAgentModePanelOpen] = useState(false);
  const [responseStylePanelOpen, setResponseStylePanelOpen] = useState(false);
  const [taskStatePanelOpen, setTaskStatePanelOpen] = useState(false);
  const [workspaceBriefPanelOpen, setWorkspaceBriefPanelOpen] = useState(false);
  const [personaPanelOpen, setPersonaPanelOpen] = useState(false);
  const [userProfilePanelOpen, setUserProfilePanelOpen] = useState(false);
  const [workspaceControlsModalOpen, setWorkspaceControlsModalOpen] = useState(false);
  const [memoryContext, setMemoryContext] = useState<string>('');
  const [hasMemory, setHasMemory] = useState(false);
  const [automationPermissionGranted, setAutomationPermissionGranted] = useState(true);
  const [automationActionRequired, setAutomationActionRequired] = useState('');
  const [automationLoading, setAutomationLoading] = useState(false);
  const [automationSaving, setAutomationSaving] = useState(false);
  const [automationError, setAutomationError] = useState('');
  const [automationWorker, setAutomationWorker] = useState<AutomationWorkerState>(DEFAULT_AUTOMATION_WORKER_STATE);
  const [automationHeartbeat, setAutomationHeartbeat] = useState<AutomationHeartbeatState>(DEFAULT_AUTOMATION_HEARTBEAT_STATE);
  const [automationSchedules, setAutomationSchedules] = useState<AutomationScheduleState[]>([]);
  const [automationMonitors, setAutomationMonitors] = useState<AutomationMonitorState[]>([]);
  const [automationNudges, setAutomationNudges] = useState<AutomationNotificationState[]>([]);
  const [automationRuns, setAutomationRuns] = useState<AutomationExecutionRunState[]>([]);
  const [newScheduleName, setNewScheduleName] = useState('');
  const [newSchedulePrompt, setNewSchedulePrompt] = useState('');
  const [newScheduleCron, setNewScheduleCron] = useState('0 9 * * 1-5');
  const [newScheduleDeliveryMode, setNewScheduleDeliveryMode] = useState<'nudge' | 'background-run'>('nudge');
  const [newScheduleTimezone, setNewScheduleTimezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
    } catch {
      return 'America/New_York';
    }
  });
  const [newMonitorName, setNewMonitorName] = useState('');
  const [newMonitorKind, setNewMonitorKind] = useState<'url' | 'file'>('url');
  const [newMonitorTarget, setNewMonitorTarget] = useState('');
  const [newMonitorIntervalSeconds, setNewMonitorIntervalSeconds] = useState(300);
  const [newMonitorTriggerMode, setNewMonitorTriggerMode] = useState<'changed' | 'contains' | 'missing'>('changed');
  const [newMonitorExpectedPattern, setNewMonitorExpectedPattern] = useState('');
  const [newMonitorDeliveryMode, setNewMonitorDeliveryMode] = useState<'nudge' | 'background-run'>('nudge');
  const [wakeEventTitle, setWakeEventTitle] = useState('');
  const [wakeEventMessage, setWakeEventMessage] = useState('');
  const [wakeEventDeliveryMode, setWakeEventDeliveryMode] = useState<'nudge' | 'background-run'>('nudge');
  const [shellSettingsOpen, setShellSettingsOpen] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingToolApproval | null>(null);
  const [, setExecutingCommand] = useState(false);
  const [shellOutput, setShellOutput] = useState<ShellOutputEntry[]>([]);
  // Canvas artifacts state
  const [canvasArtifacts, setCanvasArtifacts] = useState<CanvasArtifactRecord[]>([]);
  const [canvasNextCursor, setCanvasNextCursor] = useState<string | null>(null);
  const [canvasHasMore, setCanvasHasMore] = useState(false);
  const [canvasTotalCount, setCanvasTotalCount] = useState<number | null>(null);
  const [canvasSearchQuery, setCanvasSearchQuery] = useState('');
  const [canvasLoading, setCanvasLoading] = useState(false);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [canvasMinimized, setCanvasMinimized] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(OPENCLAW_CANVAS_MINIMIZED_STORAGE) === 'true';
    } catch {
      return false;
    }
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingApprovalResolverRef = useRef<((result: ToolApprovalResolution) => void) | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const startTimeRef = useRef<number>(0);
  const tokenCountRef = useRef<number>(0);
  const [pendingImages, setPendingImages] = useState<OpenClawImageAttachment[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<OpenClawFileAttachment[]>([]);
  const [processingAttachments, setProcessingAttachments] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelMenuButtonRef = useRef<HTMLButtonElement>(null);
  const modesMenuButtonRef = useRef<HTMLButtonElement>(null);
  const createMenuButtonRef = useRef<HTMLButtonElement>(null);
  const sessionMenuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const railCollapsed = rightRailCollapsed && !isMobileViewport;
  const pendingPreviewUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    browserInterruptedRef.current = browserInterrupted;
  }, [browserInterrupted]);

  useEffect(() => {
    try {
      window.localStorage.setItem(OPENCLAW_CANVAS_MINIMIZED_STORAGE, canvasMinimized ? 'true' : 'false');
    } catch {
      // Ignore storage errors; minimizing is only a UI preference.
    }
  }, [canvasMinimized]);

  useEffect(() => {
    try {
      window.localStorage.setItem(OPENCLAW_MODEL_FAVORITES_STORAGE, JSON.stringify(favoriteModels));
    } catch {
      // Ignore storage errors; favorites are a local UI preference.
    }
  }, [favoriteModels]);

  const {
    handleScroll: handleChatScroll,
    messagesEndRef,
    pinToBottom,
    requestScrollReset,
    scrollAreaRef: chatAreaRef,
    scrollToBottom,
    showScrollToBottom,
  } = useStickyScroll({
    contentKey: deferredChatHistory,
    isStreaming,
  });

  useEffect(() => {
    const nextPreviewUrls = pendingImages
      .map(image => image.previewUrl)
      .filter((url): url is string => typeof url === 'string' && url.startsWith('blob:'));

    for (const previousUrl of pendingPreviewUrlsRef.current) {
      if (!nextPreviewUrls.includes(previousUrl)) {
        URL.revokeObjectURL(previousUrl);
      }
    }

    pendingPreviewUrlsRef.current = nextPreviewUrls;
  }, [pendingImages]);

  // Resolve whether the selected model can accept image input so document page
  // images are only attached to vision-capable models (text-only models get the
  // extracted text instead).
  useEffect(() => {
    const model = selectedModel.trim();
    if (!model) {
      setModelSupportsVision(false);
      return;
    }

    const cacheKey = `${provider}::${model}`;
    const cached = visionCapabilityCacheRef.current.get(cacheKey);
    if (cached !== undefined) {
      setModelSupportsVision(cached);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/openclaw/model-vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            provider,
            base_url: provider === 'openai-compatible' ? baseUrl : settings?.ollamaHost,
          }),
        });
        const data = await res.json().catch(() => ({}));
        const vision = Boolean(data?.vision);
        visionCapabilityCacheRef.current.set(cacheKey, vision);
        if (!cancelled) setModelSupportsVision(vision);
      } catch {
        if (!cancelled) setModelSupportsVision(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedModel, provider, baseUrl, settings?.ollamaHost]);

  useEffect(() => {
    return () => {
      for (const previewUrl of pendingPreviewUrlsRef.current) {
        URL.revokeObjectURL(previewUrl);
      }
      pendingPreviewUrlsRef.current = [];
    };
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(OPENCLAW_API_KEY_STORAGE);
      if (stored) setApiKey(stored);
    } finally {
      setApiKeyLoaded(true);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(OPENCLAW_AGENT_STORAGE, JSON.stringify(agentPreferences));
      window.localStorage.setItem(OPENCLAW_RAIL_STORAGE, String(rightRailCollapsed));
      window.localStorage.setItem(OPENCLAW_TASK_STATE_STORAGE, JSON.stringify(taskStates));
      window.localStorage.setItem(OPENCLAW_PERSONA_STORAGE, JSON.stringify(persona));
      window.localStorage.setItem(OPENCLAW_USER_PROFILE_STORAGE, JSON.stringify(userProfile));
    } catch {
      // Ignore browser storage failures.
    }
  }, [agentPreferences, rightRailCollapsed, taskStates, persona, userProfile]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        OPENCLAW_CURRENT_SESSION_STORAGE,
        currentSessionId || OPENCLAW_DRAFT_TASK_ID,
      );
    } catch {
      // Ignore browser storage failures.
    }
  }, [currentSessionId]);

  useEffect(() => {
    try {
      if (currentWorkspaceId) {
        window.localStorage.setItem(OPENCLAW_CURRENT_WORKSPACE_STORAGE, currentWorkspaceId);
      } else {
        window.localStorage.removeItem(OPENCLAW_CURRENT_WORKSPACE_STORAGE);
      }
    } catch {
      // Ignore browser storage failures.
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    const syncViewport = () => {
      const nextIsMobile = window.innerWidth <= MOBILE_BREAKPOINT;
      setIsMobileViewport(nextIsMobile);
      if (!nextIsMobile) {
        setMobileRailOpen(false);
        setMobileHeaderMenuOpen(false);
        setMobileModelMenuOpen(false);
      }
      if (nextIsMobile) {
        setHeaderModeMenuOpen(null);
      }
    };

    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  // Click-outside and Esc handling for the Workspace modes menu is owned by
  // the <Popover> primitive (it portals the menu to <body>, so a listener on
  // the original DOM tree can never contain clicks inside the portaled menu).
  // The stale handler that used to live here closed the menu on every click
  // inside it, which made the menu feel unresponsive.

  const closeMobileChrome = () => {
    setMobileRailOpen(false);
    setMobileHeaderMenuOpen(false);
    setMobileModelMenuOpen(false);
    setModelMenuOpen(false);
    setHeaderModeMenuOpen(null);
  };

  const shellGranted = effectiveToolAccess?.shellGranted ?? false;
  const shellEnabled = effectiveToolAccess?.shellEnabled ?? false;
  const filesystemGranted = effectiveToolAccess?.filesystemGranted ?? false;
  const filesystemEnabled = effectiveToolAccess?.filesystemEnabled ?? false;
  const filesystemWriteEnabled = effectiveToolAccess?.filesystemWriteEnabled ?? false;
  const codeGranted = effectiveToolAccess?.codeGranted ?? false;
  const codeExecutionEnabled = effectiveToolAccess?.codeExecutionEnabled ?? false;
  const browserGranted = effectiveToolAccess?.browserGranted ?? false;
  const browserMode = effectiveToolAccess?.browserMode ?? 'deny';
  const browserEnabled = browserMode !== 'deny';
  const uwafBrowserSettingMode = effectiveToolAccess?.uwafBrowserMode ?? 'deny';
  const uwafBrowserEnabled = uwafBrowserSettingMode !== 'deny';
  const allowedFilesystemPaths = useMemo(() => {
    if (!settings?.openClawAllowedPaths) return [];
    return settings.openClawAllowedPaths
      .split(/\r?\n/)
      .map(entry => entry.trim())
      .filter(Boolean);
  }, [settings?.openClawAllowedPaths]);
  const allowedWritablePaths = useMemo(() => {
    if (!settings?.openClawWritablePaths) return [];
    return settings.openClawWritablePaths
      .split(/\r?\n/)
      .map(entry => entry.trim())
      .filter(Boolean);
  }, [settings?.openClawWritablePaths]);
  const filesystemAccessSummary = !filesystemGranted
    ? 'Blocked by account permission'
    : filesystemEnabled
      ? allowedFilesystemPaths.length > 0
        ? `${allowedFilesystemPaths.length} approved path${allowedFilesystemPaths.length === 1 ? '' : 's'}`
        : 'Read-only mode, no approved paths'
      : 'Disabled';
  const filesystemAccessBadge = !filesystemGranted
    ? 'Blocked'
    : filesystemEnabled
      ? allowedFilesystemPaths.length > 0
        ? `${allowedFilesystemPaths.length} path${allowedFilesystemPaths.length === 1 ? '' : 's'}`
        : 'Read-only'
      : 'Off';
  const filesystemWriteSummary = !filesystemGranted
    ? 'Blocked by account permission'
    : filesystemWriteEnabled
      ? settings?.openClawFileWriteMode === 'auto-approve'
        ? 'Auto-approve'
        : settings?.openClawFileWriteMode === 'ask-first'
          ? 'Ask-first'
          : 'Disabled'
      : 'Disabled';
  const filesystemWriteBadge = !filesystemGranted
    ? 'Blocked'
    : filesystemWriteEnabled
      ? settings?.openClawFileWriteMode === 'auto-approve'
        ? 'Auto'
        : settings?.openClawFileWriteMode === 'ask-first'
          ? 'Ask-first'
          : 'Off'
      : 'Off';
  const codeSandboxSummary = !codeGranted
    ? 'Blocked by account permission'
    : codeExecutionEnabled
      ? settings?.openClawCodeExecutionMode === 'auto-approve'
        ? 'Auto-approve'
        : 'Ask-first'
      : 'Disabled';
  const codeSandboxBadge = !codeGranted
    ? 'Blocked'
    : codeExecutionEnabled
      ? settings?.openClawCodeExecutionMode === 'auto-approve'
        ? 'Auto'
        : 'Ask-first'
      : 'Off';
  const browserControlSummary = !browserGranted ? 'Blocked by account permission' : browserEnabled ? browserMode : 'Disabled';
  const browserControlBadge = !browserGranted ? 'Blocked' : browserEnabled ? browserMode : 'Off';
  const currentWorkspace = useMemo(() => {
    if (currentWorkspaceId) {
      const selected = workspaces.find(workspace => workspace.id === currentWorkspaceId);
      if (selected) return selected;
    }
    return workspaces[0] ?? null;
  }, [currentWorkspaceId, workspaces]);
  const currentSession = useMemo(() => {
    if (!currentSessionId) return null;
    return sanitizeOpenClawSessions(sessions).find(session => session.id === currentSessionId) ?? null;
  }, [currentSessionId, sessions]);
  const effectiveSessionAutoContinueMode = currentSession?.autoContinueMode ?? draftSessionAutoContinueMode;
  const effectiveSessionAutoContinueMaxSteps = currentSession?.autoContinueMaxSteps ?? draftSessionAutoContinueMaxSteps;
  const continuationPending = useMemo(() => hasPendingContinuation(chatHistory), [chatHistory]);
  const workspaceSummary = currentWorkspace
    ? `${currentWorkspace.name} · ${currentWorkspace.skillCount} skill${currentWorkspace.skillCount === 1 ? '' : 's'} · ${currentWorkspace.autoGitBackup ? 'Git backup on' : 'Git backup off'}`
    : 'No workspace loaded';
  const activeAgentMode = OPENCLAW_AGENT_MODE_OPTIONS.find(option => option.id === agentPreferences.mode);

  const persistApiKey = (value: string) => {
    setApiKey(value);
    try {
      window.localStorage.setItem(OPENCLAW_API_KEY_STORAGE, value);
    } catch {
      // Ignore browser storage failures.
    }
  };

  const setRagAccess = (nextValue: boolean) => {
    try {
      window.sessionStorage.setItem(OPENCLAW_RAG_STORAGE, String(nextValue));
    } catch {
      // Ignore browser storage failures.
    }
    setRagEnabled(nextValue);
  };

  const loadSettings = async () => {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const parsed = parseOpenClawSettingsResponse(data as Record<string, unknown>);
    const nextSettings = parsed.settings;

    setSettings(nextSettings);
    setEffectiveToolAccess(parsed.effectiveToolAccess);
    setProvider(nextSettings.openClawProvider);
    setBaseUrl(nextSettings.openClawBaseUrl);
    setSelectedModel(nextSettings.openClawModel);
    applyTheme(nextSettings.theme);
    setDraftSessionAutoContinueMode(nextSettings.openClawSessionAutoContinueDefault);
    setDraftSessionAutoContinueMaxSteps(nextSettings.openClawSessionAutoContinueMaxSteps);
    if (getStoredRagEnabled() === null) {
      setRagEnabled(nextSettings.ragEnabled);
    }

    const templateId = (nextSettings.openClawPersonaTemplate as OpenClawPersonaTemplateId) || 'custom';
    const serverPersona = applyPersonaTemplate(templateId, {
      name: nextSettings.openClawPersonaName,
      tone: nextSettings.openClawPersonaTone,
      expertise: nextSettings.openClawPersonaExpertise,
      boundaries: nextSettings.openClawPersonaBoundaries,
      operatingInstructions: nextSettings.openClawPersonaOperatingInstructions,
    });
    setPersona({ ...serverPersona, templateId });

    setUserProfile({
      name: nextSettings.openClawUserProfileName,
      role: nextSettings.openClawUserProfileRole,
      preferences: nextSettings.openClawUserProfilePreferences,
      context: nextSettings.openClawUserProfileContext,
    });
  };

  const loadWorkspaces = async () => {
    setWorkspaceLoading(true);
    setWorkspaceError('');
    try {
      const res = await fetch('/api/openclaw/workspaces');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load workspaces');
      }

      const nextWorkspaces: OpenClawWorkspaceRecord[] = Array.isArray(data.workspaces)
        ? data.workspaces.filter((workspace: unknown): workspace is OpenClawWorkspaceRecord => {
            if (!workspace || typeof workspace !== 'object') return false;
            const candidate = workspace as Record<string, unknown>;
            return typeof candidate.id === 'string'
              && typeof candidate.name === 'string'
              && typeof candidate.relativePath === 'string'
              && typeof candidate.hostPath === 'string';
          })
        : [];

      setWorkspaces(nextWorkspaces);
      setCurrentWorkspaceId(current => {
        if (current && nextWorkspaces.some(workspace => workspace.id === current)) {
          return current;
        }
        return nextWorkspaces[0]?.id || '';
      });
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Failed to load workspaces');
      setWorkspaces([]);
      setCurrentWorkspaceId('');
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const loadSessions = async () => {
    const res = await fetch('/api/chats?surface=openclaw');
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Failed to load WorkSpaces sessions');

    const nextSessions = sanitizeOpenClawSessions(data);
    setSessions(nextSessions);
    setSelectedSessionIds(current => current.filter(id => nextSessions.some(session => session?.id === id)));
    const storedSelection = getStoredCurrentSessionSelection();

    if (storedSelection === OPENCLAW_DRAFT_TASK_ID) {
      setCurrentSessionId(null);
      setChatHistory([]);
      setCanvasArtifacts([]);
      setCanvasNextCursor(null);
      setCanvasHasMore(false);
      setCanvasTotalCount(null);
      setCanvasSearchQuery('');
      setSelectedSessionInfo('New WorkSpaces task thread');
      return;
    }

    const preferredSession = storedSelection
      ? nextSessions.find(session => session?.id === storedSelection)
      : null;
    const nextSession = preferredSession || nextSessions[0];

    if (nextSession) {
      setCurrentSessionId(nextSession.id);
      setChatHistory(sanitizeOpenClawMessages(nextSession.messages || []));
      // Restore the RAG draft so reopened WorkSpaces threads re-hydrate the
      // composer with the last search text. The user's current ragEnabled toggle
      // is preserved; toggling it on and sending re-runs the search.
      setMessage(nextSession.ragQuery ?? '');
      setCanvasSearchQuery('');
      loadCanvasArtifacts(nextSession.id, { query: '' });
      setSelectedSessionInfo(`${nextSession.title} · updated ${formatTimestamp(nextSession.updatedAt)}`);
    } else {
      setCurrentSessionId(null);
      setChatHistory([]);
      setCanvasArtifacts([]);
      setCanvasNextCursor(null);
      setCanvasHasMore(false);
      setCanvasTotalCount(null);
      setCanvasSearchQuery('');
      setSelectedSessionInfo('No saved sessions yet');
    }
  };

  const loadFolders = async () => {
    const res = await fetch('/api/folders');
    const data = await res.json();
    setFolders(Array.isArray(data) ? data : []);
  };

  const loadChatTags = async () => {
    const res = await fetch('/api/chat-tags');
    const data = await res.json();
    setTags(Array.isArray(data) ? data : []);
  };

  const loadMemory = async () => {
    try {
      const res = await fetch('/api/openclaw/memory');
      const data = await res.json();
      if (data.memoryContext || data.longTermMemory) {
        const combined = [data.memoryContext, data.longTermMemory].filter(Boolean).join('\n\n---\n\n');
        setMemoryContext(combined);
        setHasMemory(true);
      }
    } catch (error) {
      console.error('Failed to load memory context:', error);
    }
  };

  const loadAutomationState = async (options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setAutomationLoading(true);
    }
    if (!options.silent) {
      setAutomationError('');
    }

    try {
      const res = await fetch('/api/openclaw/automation');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const missingPermissions = Array.isArray(data.missingPermissions)
          ? data.missingPermissions.filter((entry: unknown): entry is string => typeof entry === 'string')
          : [];
        if (res.status === 403 && missingPermissions.includes('openclaw.automation')) {
          setAutomationPermissionGranted(false);
          setAutomationActionRequired(typeof data.actionRequired === 'string' ? data.actionRequired : '');
          setAutomationWorker(DEFAULT_AUTOMATION_WORKER_STATE);
          setAutomationHeartbeat(DEFAULT_AUTOMATION_HEARTBEAT_STATE);
          setAutomationSchedules([]);
          setAutomationMonitors([]);
          setAutomationNudges([]);
          setAutomationRuns([]);
          return;
        }

        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load automation state');
      }

      const parsed = parseAutomationStateResponse(data as Record<string, unknown>);
      setAutomationPermissionGranted(true);
      setAutomationActionRequired('');
      setAutomationWorker(parsed.worker);
      setAutomationHeartbeat(parsed.heartbeat);
      setAutomationSchedules(parsed.schedules);
      setAutomationMonitors(parsed.monitors);
      setAutomationNudges(parsed.nudges);
      setAutomationRuns(parsed.runs);
    } catch (error) {
      setAutomationError(error instanceof Error ? error.message : 'Failed to load automation state');
    } finally {
      if (!options.silent) {
        setAutomationLoading(false);
      }
    }
  };

  const postAutomationAction = async (payload: Record<string, unknown>) => {
    setAutomationSaving(true);
    setAutomationError('');
    try {
      const res = await fetch('/api/openclaw/automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Automation request failed');
      }
      await loadAutomationState({ silent: true });
      return data as Record<string, unknown>;
    } catch (error) {
      setAutomationError(error instanceof Error ? error.message : 'Automation request failed');
      throw error;
    } finally {
      setAutomationSaving(false);
    }
  };

  const getAutomationTargetIds = () => ({
    targetSessionId: currentSessionId || null,
    targetWorkspaceId: currentWorkspaceId || null,
  });

  const saveHeartbeatConfig = async (patch: Partial<AutomationHeartbeatState>) => {
    const targets = getAutomationTargetIds();
    await postAutomationAction({
      action: 'update_heartbeat',
      ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
      ...(typeof patch.intervalMinutes === 'number' ? { intervalMinutes: patch.intervalMinutes } : {}),
      ...(typeof patch.staleAfterMinutes === 'number' ? { staleAfterMinutes: patch.staleAfterMinutes } : {}),
      ...(typeof patch.promptTemplate === 'string' ? { promptTemplate: patch.promptTemplate } : {}),
      ...(typeof patch.deliveryMode === 'string' ? { deliveryMode: patch.deliveryMode } : {}),
      ...((patch.deliveryMode ?? automationHeartbeat.deliveryMode) === 'background-run'
        ? targets
        : { targetSessionId: null, targetWorkspaceId: null }),
    });
  };

  const createAutomationScheduleRecord = async () => {
    const targets = getAutomationTargetIds();
    await postAutomationAction({
      action: 'create_schedule',
      name: newScheduleName,
      prompt: newSchedulePrompt,
      cronExpression: newScheduleCron,
      timezone: newScheduleTimezone,
      deliveryMode: newScheduleDeliveryMode,
      ...(newScheduleDeliveryMode === 'background-run' ? targets : {}),
    });
    setNewScheduleName('');
    setNewSchedulePrompt('');
    setNewScheduleCron('0 9 * * 1-5');
    setNewScheduleDeliveryMode('nudge');
  };

  const toggleAutomationSchedule = async (schedule: AutomationScheduleState) => {
    await postAutomationAction({
      action: 'update_schedule',
      id: schedule.id,
      enabled: !schedule.enabled,
    });
  };

  const deleteAutomationScheduleRecord = async (id: string) => {
    await postAutomationAction({ action: 'delete_schedule', id });
  };

  const createAutomationMonitorRecord = async () => {
    const targets = getAutomationTargetIds();
    await postAutomationAction({
      action: 'create_monitor',
      name: newMonitorName,
      kind: newMonitorKind,
      target: newMonitorTarget,
      checkIntervalSeconds: newMonitorIntervalSeconds,
      triggerMode: newMonitorTriggerMode,
      expectedPattern: newMonitorExpectedPattern,
      deliveryMode: newMonitorDeliveryMode,
      ...(newMonitorDeliveryMode === 'background-run' ? targets : {}),
    });
    setNewMonitorName('');
    setNewMonitorTarget('');
    setNewMonitorIntervalSeconds(300);
    setNewMonitorTriggerMode('changed');
    setNewMonitorExpectedPattern('');
    setNewMonitorDeliveryMode('nudge');
  };

  const toggleAutomationMonitor = async (monitor: AutomationMonitorState) => {
    await postAutomationAction({
      action: 'update_monitor',
      id: monitor.id,
      enabled: !monitor.enabled,
    });
  };

  const deleteAutomationMonitorRecord = async (id: string) => {
    await postAutomationAction({ action: 'delete_monitor', id });
  };

  const dismissAutomationNudge = async (id: string) => {
    await postAutomationAction({ action: 'dismiss_nudge', id });
  };

  const markAutomationNudgesSeen = async (ids: string[]) => {
    if (ids.length === 0) return;
    await postAutomationAction({ action: 'mark_seen', ids });
  };

  const createAutomationWakeEventRecord = async () => {
    const targets = getAutomationTargetIds();
    await postAutomationAction({
      action: 'create_wake_event',
      title: wakeEventTitle,
      message: wakeEventMessage,
      ...(wakeEventDeliveryMode === 'background-run'
        ? {
            sessionId: targets.targetSessionId,
            workspaceId: targets.targetWorkspaceId,
            deliveryMode: 'background-run',
          }
        : (currentSessionId ? { sessionId: currentSessionId } : {})),
    });
    setWakeEventTitle('');
    setWakeEventMessage('');
    setWakeEventDeliveryMode('nudge');
  };

  const loadCanvasArtifacts = async (
    sessionId: string,
    options: { append?: boolean; cursor?: string | null; query?: string } = {},
  ) => {
    setCanvasLoading(true);
    setCanvasError(null);
    try {
      const params = new URLSearchParams({
        sessionId,
        limit: '50',
      });
      const query = options.query ?? canvasSearchQuery;
      if (query) params.set('q', query);
      if (options.cursor) params.set('cursor', options.cursor);

      const res = await fetch(`/api/canvas/artifacts?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load Canvas artifacts');
      }
      const nextArtifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
      setCanvasArtifacts(prev => options.append ? [...prev, ...nextArtifacts] : nextArtifacts);
      setCanvasNextCursor(typeof data.pageInfo?.nextCursor === 'string' ? data.pageInfo.nextCursor : null);
      setCanvasHasMore(Boolean(data.pageInfo?.hasMore));
      setCanvasTotalCount(typeof data.pageInfo?.total === 'number' ? data.pageInfo.total : null);
    } catch (error) {
      console.error("Failed to load canvas artifacts:", error);
      setCanvasError(error instanceof Error ? error.message : 'Failed to load Canvas artifacts');
    } finally {
      setCanvasLoading(false);
    }
  };

  const downloadArtifactById = async (id: string, fallbackName?: string) => {
    try {
      const res = await fetch(`/api/canvas/artifacts/${id}`);
      if (res.ok) {
        const data = await res.json();
        const blob = new Blob([data.artifact.content], { type: data.artifact.mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = data.artifact.name || fallbackName || 'artifact';
        a.click();
        URL.revokeObjectURL(url);
        return data.artifact;
      }
    } catch (error) {
      console.error("Failed to download artifact:", error);
    }
    return null;
  };
  const deleteArtifactById = async (id: string) => {
    try {
      const res = await fetch(`/api/canvas/artifacts/${id}`, { method: "DELETE" });
      if (res.ok) {
        setCanvasArtifacts(prev => prev.filter(a => a?.id !== id));
      }
    } catch (error) {
      console.error("Failed to delete artifact:", error);
    }
  };

  const loadModels = async (nextProvider = provider, nextBaseUrl = baseUrl, ollamaHost = settings?.ollamaHost || 'http://127.0.0.1:11434') => {
    setModelsLoading(true);
    try {
      const res = await fetch('/api/openclaw/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: nextProvider,
          baseUrl: nextProvider === 'openai-compatible' ? nextBaseUrl : ollamaHost,
          apiKey,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load models');
      }

      const nextModels = Array.isArray(data.models) ? data.models : [];
      setModels(nextModels);
      setConnectionStatus('ok');
      setConnectionSummary(nextProvider === 'ollama'
        ? `${nextModels.length} local models available`
        : `${nextModels.length} provider models available`);

      const savedModel = nextSettingsModel(nextModels, settings?.openClawModel || '', selectedModel);
      if (savedModel !== selectedModel) {
        setSelectedModel(savedModel);
      }

      if (savedModel && savedModel !== (settings?.openClawModel || '')) {
        void saveSettingsPatch({ openClawModel: savedModel });
      }
    } catch (error) {
      console.error('WorkSpaces model lookup failed:', error);
      setModels([]);
      setConnectionStatus('error');
      setConnectionSummary(error instanceof Error ? error.message : 'Connection failed');
    } finally {
      setModelsLoading(false);
    }
  };

  const verifyConnection = async (
    nextProvider = provider,
    nextBaseUrl = baseUrl,
    nextApiKey = apiKey,
    ollamaHost = settings?.ollamaHost || 'http://127.0.0.1:11434',
  ) => {
    setConnectionStatus('checking');
    setConnectionSummary('Checking connection...');

    try {
      const res = await fetch('/api/openclaw/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: nextProvider,
          baseUrl: nextProvider === 'openai-compatible' ? nextBaseUrl : ollamaHost,
          apiKey: nextApiKey,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Verification failed');
      }

      setConnectionStatus('ok');
      if (nextProvider === 'ollama') {
        const version = typeof data.version === 'string' && data.version ? data.version : 'version unknown';
        const modelCount = typeof data.modelCount === 'number' ? data.modelCount : 0;
        const loadedModelCount = typeof data.loadedModelCount === 'number' ? data.loadedModelCount : 0;
        setConnectionSummary(`${version} · ${modelCount} installed · ${loadedModelCount} loaded`);
      } else {
        const modelCount = typeof data.modelCount === 'number' ? data.modelCount : 0;
        setConnectionSummary(`${modelCount} models reachable at ${data.baseUrl || nextBaseUrl}`);
      }
    } catch (error) {
      setConnectionStatus('error');
      setConnectionSummary(error instanceof Error ? error.message : 'Verification failed');
    }
  };

  const refreshOllamaHealth = async (modelName = selectedModel, host = settings?.ollamaHost || 'http://127.0.0.1:11434') => {
    setOllamaHealthLoading(true);
    try {
      const params = new URLSearchParams();
      if (modelName) params.set('model', modelName);
      if (host) params.set('host', host);
      const res = await fetch(`/api/ollama/health?${params.toString()}`);
      const data = await res.json().catch(() => ({})) as OllamaHealthSummary & { error?: string };
      if (!res.ok) {
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
        loadedModelDetails: [],
        selectedModel: modelName,
        selectedModelLoaded: false,
        selectedModelExpiresAt: '',
        modelKeepAlive: settings?.modelKeepAlive,
        ollamaKeepAlive: settings?.ollamaKeepAlive,
        error: error instanceof Error ? error.message : 'Failed to inspect Ollama health',
        checkedAt: Date.now(),
      });
    } finally {
      setOllamaHealthLoading(false);
    }
  };

  function nextSettingsModel(nextModels: OpenClawModel[], saved: string, fallback: string) {
    if (saved) return saved;
    if (fallback && nextModels.some(model => model.name === fallback)) return fallback;
    return nextModels[0]?.name || fallback || '';
  }

  const saveSettingsPatch = async (patch: Partial<OpenClawSettings>) => {
    setConfigSaving(true);
    setConfigError('');
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save WorkSpaces settings');
      }
      const parsed = parseOpenClawSettingsResponse(data as Record<string, unknown>);
      const nextSettings = parsed.settings;

      setSettings(nextSettings);
      setEffectiveToolAccess(parsed.effectiveToolAccess);
      setProvider(nextSettings.openClawProvider);
      setBaseUrl(nextSettings.openClawBaseUrl);
      setSelectedModel(nextSettings.openClawModel);
      applyTheme(nextSettings.theme);
      setDraftSessionAutoContinueMode(current => currentSessionId ? current : nextSettings.openClawSessionAutoContinueDefault);
      setDraftSessionAutoContinueMaxSteps(current => currentSessionId ? current : nextSettings.openClawSessionAutoContinueMaxSteps);
      if (getStoredRagEnabled() === null) {
        setRagEnabled(nextSettings.ragEnabled);
      }
      return nextSettings;
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : 'Failed to save WorkSpaces settings');
      throw error;
    } finally {
      setConfigSaving(false);
    }
  };

  const createWorkspace = async () => {
    const name = newWorkspaceName.trim();
    if (!name) {
      setWorkspaceError('Workspace name is required.');
      return;
    }

    setCreatingWorkspace(true);
    setWorkspaceError('');
    try {
      const res = await fetch('/api/openclaw/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: newWorkspaceDescription,
          autoGitBackup: false,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to create workspace');
      }

      const nextWorkspace = data.workspace as OpenClawWorkspaceRecord | undefined;
      await loadWorkspaces();
      if (nextWorkspace?.id) {
        setCurrentWorkspaceId(nextWorkspace.id);
      }
      setNewWorkspaceName('');
      setNewWorkspaceDescription('');
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Failed to create workspace');
    } finally {
      setCreatingWorkspace(false);
    }
  };

  const updateCurrentWorkspace = async (patch: Partial<Pick<OpenClawWorkspaceRecord, 'name' | 'description' | 'autoGitBackup'>>) => {
    if (!currentWorkspace) return;
    setWorkspaceError('');
    try {
      const res = await fetch(`/api/openclaw/workspaces/${currentWorkspace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to update workspace');
      }
      const nextWorkspace = data.workspace as OpenClawWorkspaceRecord | undefined;
      if (!nextWorkspace) {
        await loadWorkspaces();
        return;
      }
      setWorkspaces(current => current.map(workspace => workspace.id === nextWorkspace.id ? nextWorkspace : workspace));
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Failed to update workspace');
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        await Promise.all([loadSettings(), loadSessions(), loadFolders(), loadChatTags(), loadMemory(), loadShellSettings(), loadWorkspaces(), loadAutomationState()]);
      } catch (error) {
        console.error('Failed to initialize WorkSpaces workspace:', error);
      }
    })();
    // load only once on mount
  }, []);

  useEffect(() => {
    if (settingsRevision <= 0) return;
    void loadSettings();
  }, [settingsRevision]);

  useEffect(() => {
    if (!automationPermissionGranted || workspaceControlsModalOpen) return;
    const intervalId = window.setInterval(() => {
      void loadAutomationState({ silent: true });
    }, 45000);
    return () => window.clearInterval(intervalId);
  }, [automationPermissionGranted, workspaceControlsModalOpen]);

  useEffect(() => {
    if (settings?.openClawUwafLiveBrowser !== false) return;
    setBrowserModalOpen(false);
    setBrowserInterrupted(false);
    browserInterruptedRef.current = false;
  }, [settings?.openClawUwafLiveBrowser]);

  useEffect(() => {
    if (settings?.openClawUwafLiveBrowser !== true) return;
    setBrowserLiveStatus('connecting');
  }, [settings?.openClawUwafLiveBrowser, currentSessionId, uwafBrowserMode]);

  useEffect(() => {
    if (!workspaceControlsModalOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setWorkspaceControlsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [workspaceControlsModalOpen]);

  useEffect(() => {
    if (!workspaceControlsModalOpen || !automationPermissionGranted) return;
    const unseenIds = automationNudges
      .filter(nudge => !nudge.seenAt && !nudge.dismissedAt)
      .map(nudge => nudge.id);
    if (unseenIds.length === 0) return;
    void markAutomationNudgesSeen(unseenIds);
  }, [workspaceControlsModalOpen, automationNudges, automationPermissionGranted]);

  useEffect(() => {
    setSessionListPage(0);
  }, [selectedFolderId, selectedTagId]);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!settings || !apiKeyLoaded) return;
    const timer = window.setTimeout(() => {
      void loadModels(provider, baseUrl);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [settings?.openClawProvider, settings?.openClawBaseUrl, apiKeyLoaded, apiKey]);
  /* eslint-enable react-hooks/exhaustive-deps */

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!settings || !apiKeyLoaded) return;
    if (provider === 'ollama') return;
    const timer = window.setTimeout(() => {
      void verifyConnection(provider, baseUrl, apiKey, settings.ollamaHost);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [provider, baseUrl, settings?.openClawProvider, settings?.openClawBaseUrl, settings?.ollamaHost, apiKeyLoaded, apiKey]);
  /* eslint-enable react-hooks/exhaustive-deps */

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!settings || provider !== 'ollama') {
        setOllamaHealth(null);
        return;
      }
      void refreshOllamaHealth(selectedModel, settings.ollamaHost);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [provider, selectedModel, settings?.ollamaHost]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const resetComposerDraftState = () => {
    setMessage('');
    setPendingImages([]);
    setPendingAttachments([]);
    setAttachmentError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleStopStreaming = () => {
    if (!abortControllerRef.current) return;
    abortControllerRef.current.abort();
    abortControllerRef.current = null;
    setChatHistory(prev => pruneInterruptedMessages(prev));
    setLiveStats(null);
    setStreamPhase(null);
    setIsStreaming(false);
  };

  const updateAgentPreferences = (patch: Partial<OpenClawAgentPreferences>) => {
    setAgentPreferences(current => ({
      ...current,
      ...patch,
    }));
  };

  const activeTaskStateId = currentSessionId ?? OPENCLAW_DRAFT_TASK_ID;
  const taskState = taskStates[activeTaskStateId] ?? DEFAULT_OPENCLAW_TASK_STATE;

  const updateTaskState = (patch: Partial<OpenClawTaskState> | ((current: OpenClawTaskState) => OpenClawTaskState)) => {
    setTaskStates(current => {
      const existing = current[activeTaskStateId] ?? DEFAULT_OPENCLAW_TASK_STATE;
      const nextState = typeof patch === 'function'
        ? patch(existing)
        : {
          ...existing,
          ...patch,
        };

      return {
        ...current,
        [activeTaskStateId]: nextState,
      };
    });
  };

  const latestAssistantChecklistSuggestion = useMemo(() => {
    const latestAssistantMessage = [...chatHistory]
      .reverse()
      .find(entry => entry.role === 'assistant' && entry.content.trim());
    return latestAssistantMessage ? extractOpenClawChecklistSuggestions(latestAssistantMessage.content) : [];
  }, [chatHistory]);

  const replaceChecklistFromLatestAssistant = () => {
    if (latestAssistantChecklistSuggestion.length === 0) return;
    updateTaskState(current => ({
      ...current,
      checklist: createOpenClawChecklistItems(latestAssistantChecklistSuggestion),
    }));
  };

  const addChecklistItem = () => {
    updateTaskState(current => ({
      ...current,
      checklist: [
        ...current.checklist,
        {
          id: randomUUID(),
          text: '',
          completed: false,
        },
      ],
    }));
  };

  const updateChecklistItem = (id: string, text: string) => {
    updateTaskState(current => ({
      ...current,
      checklist: current.checklist.flatMap(item => {
        if (!item) return [];
        return [item.id === id ? { ...item, text } : item];
      }),
    }));
  };

  const toggleChecklistItem = (id: string) => {
    updateTaskState(current => ({
      ...current,
      checklist: current.checklist.flatMap(item => {
        if (!item) return [];
        return [item.id === id ? { ...item, completed: !item.completed } : item];
      }),
    }));
  };

  const removeChecklistItem = (id: string) => {
    updateTaskState(current => ({
      ...current,
      checklist: current.checklist.filter(item => item?.id !== id),
    }));
  };

  const toggleRightRail = () => {
    if (isMobileViewport) {
      setMobileRailOpen(current => !current);
      return;
    }
    setRightRailCollapsed(current => !current);
  };

  const selectOpenClawModel = async (modelName: string) => {
    setSelectedModel(modelName);
    setModelControlNote('');
    setModelMenuOpen(false);
    setMobileModelMenuOpen(false);
    try {
      await saveSettingsPatch({ openClawModel: modelName });
    } catch {
      // Ignore inline selection persistence errors; footer surfaces failures.
    }
  };

  const getModelFavoriteKey = (modelName: string, modelProvider = provider) => `${modelProvider}:${modelName}`;

  const toggleFavoriteModel = (event: React.MouseEvent, modelName: string) => {
    event.preventDefault();
    event.stopPropagation();
    const key = getModelFavoriteKey(modelName);
    setFavoriteModels(current => current.includes(key)
      ? current.filter(entry => entry !== key)
      : [...current, key]);
  };

  const refreshModels = async () => {
    if (!settings) return;
    await Promise.all([
      loadModels(provider, baseUrl),
      provider === 'ollama'
        ? Promise.resolve()
        : verifyConnection(provider, baseUrl, apiKey, settings.ollamaHost),
      provider === 'ollama' ? refreshOllamaHealth(selectedModel, settings.ollamaHost) : Promise.resolve(),
    ]);
  };

  const switchSession = (session: OpenClawSession) => {
    if (isStreaming) {
      setSelectedSessionInfo('Stop the current WorkSpaces run before switching task threads.');
      return;
    }
    closeMobileChrome();
    requestScrollReset();
    setCurrentSessionId(session.id);
    setChatHistory(sanitizeOpenClawMessages(session.messages || []));
    setCanvasSearchQuery('');
    loadCanvasArtifacts(session.id, { query: '' });
    resetComposerDraftState();
    // Restore the RAG draft after resetComposerDraftState so the saved query
    // is what the user sees, not a freshly cleared composer.
    setMessage(session.ragQuery ?? '');
    setLastSubmission(null);
    setSelectedSessionInfo(`${session.title} · updated ${formatTimestamp(session.updatedAt)}`);
    setSessionMenuOpen(null);
    setCreateMenuOpen(false);
    setRenamingSessionId(null);
    setRenameValue('');
  };

  const openAutomationNudgeSession = (nudge: AutomationNotificationState) => {
    if (!nudge.sessionId) {
      setSelectedSessionInfo('This automation nudge is not tied to a specific WorkSpaces thread.');
      return;
    }
    const session = sessions.find(candidate => candidate.id === nudge.sessionId);
    if (!session) {
      setSelectedSessionInfo('The WorkSpaces thread linked to this automation nudge no longer exists.');
      return;
    }
    switchSession(session);
  };

  const createSession = async (
    baseMessages: OpenClawMessage[],
    sessionId: string,
    rag?: { ragEnabled?: boolean; ragQuery?: string | null; ragSources?: MessageSource[] },
  ) => {
    const title = getChatTitle(baseMessages);

    const res = await fetch('/api/chats/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: sessionId,
        title,
        messages: stripAttachmentVisionData(baseMessages),
        surface: 'openclaw',
        autoContinueMode: effectiveSessionAutoContinueMode,
        autoContinueMaxSteps: effectiveSessionAutoContinueMaxSteps,
        ...(rag ?? {}),
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to create WorkSpaces session');
    }

    const session = normalizeOpenClawSession(data.session);
    if (!session) {
      throw new Error('Failed to normalize created WorkSpaces session');
    }
    setSessions(prev => {
      const safePrev = sanitizeOpenClawSessions(prev);
      const existingIndex = safePrev.findIndex(item => item?.id === session.id);
      if (existingIndex === -1) return [session, ...safePrev];
      const next = [...safePrev];
      next[existingIndex] = session;
      return next;
    });
    return session;
  };

  const updateSessionRecord = (nextSession: OpenClawSession) => {
    setSessions(prev => {
      const safePrev = sanitizeOpenClawSessions(prev);
      const index = safePrev.findIndex(session => session.id === nextSession.id);
      if (index === -1) return [nextSession, ...safePrev];
      const next = [...safePrev];
      next[index] = nextSession;
      return next;
    });
  };

  const persistSessionIntelligence = async (patch: {
    autoContinueMode?: SessionAutoContinueMode;
    autoContinueMaxSteps?: number;
    branchLabel?: string;
    lastAutoContinueAt?: string;
  }) => {
    if (!currentSessionId) {
      if (patch.autoContinueMode) setDraftSessionAutoContinueMode(patch.autoContinueMode);
      if (typeof patch.autoContinueMaxSteps === 'number') setDraftSessionAutoContinueMaxSteps(patch.autoContinueMaxSteps);
      return;
    }

    const res = await fetch('/api/chats', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: currentSessionId,
        surface: 'openclaw',
        ...patch,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : 'Failed to update session intelligence');
    }

    const normalized = normalizeOpenClawSession(data.session);
    if (normalized) {
      updateSessionRecord(normalized);
    }
  };

  const persistSessionIntelligenceSafe = (patch: Parameters<typeof persistSessionIntelligence>[0]) => {
    void persistSessionIntelligence(patch).catch(error => {
      console.error('Failed to persist session intelligence:', error);
      setSelectedSessionInfo(error instanceof Error ? error.message : 'Failed to update session intelligence.');
    });
  };

  const updateCurrentThreadMemory = async (action: 'clear' | 'refresh') => {
    if (!currentSession) return;

    const res = await fetch('/api/chats', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: currentSession.id,
        surface: 'openclaw',
        messages: stripAttachmentVisionData(currentSession.messages),
        clearContextSummary: action === 'clear',
        refreshContextSummary: action === 'refresh',
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : `Failed to ${action} memory`);
    }

    const normalized = normalizeOpenClawSession(data.session);
    if (normalized) {
      updateSessionRecord(normalized);
      setSelectedSessionInfo(action === 'clear' ? 'Thread memory cleared.' : 'Thread memory refreshed.');
    }
  };

  const updateCurrentThreadMemorySafe = (action: 'clear' | 'refresh') => {
    void updateCurrentThreadMemory(action).catch(error => {
      console.error(`Failed to ${action} thread memory:`, error);
      setSelectedSessionInfo(error instanceof Error ? error.message : `Failed to ${action} memory.`);
    });
  };

  const handleNewSession = () => {
    if (isStreaming) {
      setSelectedSessionInfo('Stop the current WorkSpaces run before starting a new task thread.');
      return;
    }
    closeMobileChrome();
    resetComposerDraftState();
    setChatHistory([]);
    setCurrentSessionId(null);
    setCanvasArtifacts([]);
    setCanvasNextCursor(null);
    setCanvasHasMore(false);
    setCanvasTotalCount(null);
    setCanvasSearchQuery('');
    setCanvasError(null);
    setStreamPhase(null);
    setLiveStats(null);
    setSessionMenuOpen(null);
    setCreateMenuOpen(false);
    setRenamingSessionId(null);
    setRenameValue('');
    setSessionSelectionMode(false);
    setSelectedSessionIds([]);
    setModelControlNote('');
    setSelectedSessionInfo('New WorkSpaces task thread');
    setLastSubmission(null);
    setBranchCompareOpen(false);
    setDraftSessionAutoContinueMode(settings?.openClawSessionAutoContinueDefault || 'manual');
    setDraftSessionAutoContinueMaxSteps(settings?.openClawSessionAutoContinueMaxSteps || 3);
    setTaskStates(current => ({
      ...current,
      [OPENCLAW_DRAFT_TASK_ID]: DEFAULT_OPENCLAW_TASK_STATE,
    }));
    requestScrollReset();
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  const stopSelectedModel = async () => {
    if (provider !== 'ollama' || !selectedModel || stoppingModel) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    setStoppingModel(true);
    setModelControlNote(`Stopping ${selectedModel}...`);

    try {
      const res = await fetch('/api/ollama/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          host: settings?.ollamaHost,
        }),
      });
      const data = await res.json().catch(() => ({})) as {
        error?: unknown;
        model?: unknown;
        stopped?: unknown;
      };

      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : `Failed to stop ${selectedModel}`);
      }

      if (data.stopped === false) {
        setModelControlNote(`${selectedModel} was not currently loaded.`);
      } else {
        const stoppedModel = typeof data.model === 'string' && data.model.trim() ? data.model : selectedModel;
        setModelControlNote(`${stoppedModel} stopped. The next request will reload it.`);
      }

      if (provider !== 'ollama') {
        void verifyConnection(provider, baseUrl, apiKey, settings?.ollamaHost || 'http://127.0.0.1:11434');
      }
      void refreshOllamaHealth(selectedModel, settings?.ollamaHost || 'http://127.0.0.1:11434');
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
        window.sessionStorage.setItem(OPENCLAW_INTERNET_STORAGE, String(nextValue));
      } catch {
        // Ignore browser storage failures.
      }
      return nextValue;
    });
  };

  const toggleUnrestricted = () => {
    setUnrestrictedEnabled(prev => {
      const nextValue = !prev;
      try {
        window.sessionStorage.setItem(OPENCLAW_UNRESTRICTED_STORAGE, String(nextValue));
      } catch {
        // Ignore browser storage failures.
      }
      return nextValue;
    });
  };

  const toggleUncensored = () => {
    setUncensoredEnabled(prev => {
      const nextValue = !prev;
      try {
        window.sessionStorage.setItem(OPENCLAW_UNCENSORED_STORAGE, String(nextValue));
      } catch {
        // Ignore browser storage failures.
      }
      return nextValue;
    });
  };

  const setInternetAccess = (nextValue: boolean) => {
    try {
      window.sessionStorage.setItem(OPENCLAW_INTERNET_STORAGE, String(nextValue));
    } catch {
      // Ignore browser storage failures.
    }
    setInternetEnabled(nextValue);
  };

  const retryLastSubmission = async (options?: { disableInternet?: boolean; stopModelFirst?: boolean }) => {
    if (!lastSubmission || isStreaming) return;
    const nextInternetEnabled = options?.disableInternet ? false : lastSubmission.internetEnabled;

    if (options?.stopModelFirst && provider === 'ollama' && selectedModel) {
      await stopSelectedModel();
    }

    setInternetAccess(nextInternetEnabled);
    pinToBottom();
    await handleSendMessage(lastSubmission.prompt, nextInternetEnabled);
  };

  const generateSessionSummary = async (sessionId: string, title: string, messages: OpenClawMessage[], objective?: string) => {
    try {
      await fetch('/api/openclaw/session-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          title,
          messages: stripAttachmentVisionData(messages),
          objective,
          apiKey: provider === 'openai-compatible' ? apiKey : undefined,
        }),
      });
    } catch (error) {
      console.error('Failed to generate session summary:', error);
    }
  };

  // Shell execution handlers
  async function loadShellSettings() {
    try {
      const res = await fetch('/api/openclaw/shell/settings');
      const data = await res.json();
      if (res.ok) {
        setSettings(current => current ? {
          ...current,
          shellExecutionTarget: data.shellExecutionTarget === 'host' ? 'host' : current.shellExecutionTarget,
          shellExecutionMode: typeof data.shellExecutionMode === 'string' ? data.shellExecutionMode : current.shellExecutionMode,
          shellAllowedCommands: typeof data.shellAllowedCommands === 'string' ? data.shellAllowedCommands : current.shellAllowedCommands,
          shellHostAllowedRoots: typeof data.shellHostAllowedRoots === 'string' ? data.shellHostAllowedRoots : current.shellHostAllowedRoots,
          shellHostAllowedEnvVars: typeof data.shellHostAllowedEnvVars === 'string' ? data.shellHostAllowedEnvVars : current.shellHostAllowedEnvVars,
          shellHostMaxTimeoutMs: typeof data.shellHostMaxTimeoutMs === 'number' ? data.shellHostMaxTimeoutMs : current.shellHostMaxTimeoutMs,
          shellHostMaxOutputBytes: typeof data.shellHostMaxOutputBytes === 'number' ? data.shellHostMaxOutputBytes : current.shellHostMaxOutputBytes,
        } : current);
      }
    } catch (error) {
      console.error('Failed to load shell settings:', error);
    }
  }

  const appendShellOutput = (entry: ShellOutputEntry) => {
    setShellOutput(prev => [...prev, entry]);
    return entry;
  };

  const truncateApprovalPreview = (value: string, maxChars = 2400) => {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars - 1).trimEnd()}…`;
  };

  const executeShellCommand = async (
    shellRequest: ShellExecutionRequest
  ): Promise<ShellOutputEntry> => {
    setExecutingCommand(true);
    try {
      const execRes = await fetch('/api/openclaw/shell/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: shellRequest.command,
          approvalToken: shellRequest.approvalToken,
          auditId: shellRequest.auditId,
          sessionId: currentSessionId,
          messageId: shellRequest.messageId,
          description: shellRequest.description,
        }),
      });
      const execData = await execRes.json();
      const entry: ShellOutputEntry = {
        id: randomUUID(),
        messageId: shellRequest.messageId,
        target: execData.target === 'host' ? 'host' : 'container',
        auditId: typeof execData.auditId === 'string' ? execData.auditId : shellRequest.auditId,
        command: shellRequest.command,
        description: shellRequest.description,
        stdout: execData.stdout,
        stderr: execRes.ok ? execData.stderr : execData.error || 'Execution failed',
        exitCode: execRes.ok ? execData.exitCode : -1,
        duration: execRes.ok ? execData.duration : 0,
        success: execRes.ok ? Boolean(execData.success) : false,
      };
      return appendShellOutput(entry);
    } catch (error) {
      const entry: ShellOutputEntry = {
        id: randomUUID(),
        messageId: shellRequest.messageId,
        auditId: shellRequest.auditId,
        command: shellRequest.command,
        description: shellRequest.description,
        stderr: error instanceof Error ? error.message : 'Execution failed',
        exitCode: -1,
        duration: 0,
        success: false,
        target: settings?.shellExecutionTarget === 'host' ? 'host' : 'container',
      };
      return appendShellOutput(entry);
    } finally {
      setExecutingCommand(false);
    }
  };

  const requestShellCommand = async (
    command: string,
    options: { description?: string; messageId: string }
  ): Promise<ShellOutputEntry> => {
    try {
      const res = await fetch('/api/openclaw/shell/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command,
          description: options.description,
          sessionId: currentSessionId,
          messageId: options.messageId,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Shell command request failed');
      }

      if (data.autoApproved) {
        const fallbackDescription = typeof data.fallbackReason === 'string' && data.fallbackReason.trim()
          ? `${data.description || options.description || `Run: ${command}`}\n\n${data.fallbackReason}`
          : data.description || options.description;
        return await executeShellCommand({
          command,
          description: fallbackDescription,
          approvalToken: typeof data.approvalToken === 'string' ? data.approvalToken : undefined,
          messageId: options.messageId,
          auditId: typeof data.auditId === 'string' ? data.auditId : undefined,
        });
      }

      if (data.requiresApproval) {
        const fallbackDescription = typeof data.fallbackReason === 'string' && data.fallbackReason.trim()
          ? `${data.description || options.description || `Run: ${command}`}\n\n${data.fallbackReason}`
          : data.description || options.description;
        return await new Promise<ShellOutputEntry>(resolve => {
          pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
          setPendingApproval({
            kind: 'shell',
            title: data.target === 'host' ? 'Host Shell Command Approval' : 'Shell Command Approval',
            description: data.reason
              ? `${fallbackDescription || `Run: ${command}`}\n\nReason: ${data.reason}`
              : fallbackDescription,
            previewLabel: 'Command',
            previewContent: `$ ${command}`,
            approvalToken: typeof data.approvalToken === 'string' ? data.approvalToken : undefined,
            messageId: options.messageId,
            request: {
              command,
              description: fallbackDescription,
              auditId: typeof data.auditId === 'string' ? data.auditId : undefined,
            },
          });
        });
      }

      const entry: ShellOutputEntry = {
        id: randomUUID(),
        messageId: options.messageId,
        target: data.target === 'host' ? 'host' : 'container',
        auditId: typeof data.auditId === 'string' ? data.auditId : undefined,
        command,
        description: options.description,
        stderr: `Blocked: ${data.reason || 'Command was rejected'}${typeof data.fallbackReason === 'string' ? `\n${data.fallbackReason}` : ''}`,
        exitCode: -1,
        duration: 0,
        success: false,
        blocked: true,
      };
      return appendShellOutput(entry);
    } catch (error) {
      console.error('Shell command request failed:', error);
      const entry: ShellOutputEntry = {
        id: randomUUID(),
        messageId: options.messageId,
        command,
        description: options.description,
        stderr: error instanceof Error ? error.message : 'Shell command request failed',
        exitCode: -1,
        duration: 0,
        success: false,
        target: settings?.shellExecutionTarget === 'host' ? 'host' : 'container',
      };
      return appendShellOutput(entry);
    }
  };

  const executeFilesystemAction = async (
    request: OpenClawFilesystemToolRequest & { approvalToken?: string },
  ): Promise<FilesystemToolResultEntry> => {
    try {
      const res = await fetch('/api/openclaw/filesystem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json();
      if (!res.ok) {
        const requestDiagnostic = data && typeof data === 'object'
          ? (data as { diagnostics?: { request?: { actionRequired?: unknown } } }).diagnostics?.request
          : undefined;
        return {
          action: request.action,
          path: request.path,
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Filesystem request failed',
          code: typeof data.code === 'string' ? data.code : undefined,
          actionRequired: typeof data.actionRequired === 'string'
            ? data.actionRequired
            : typeof requestDiagnostic?.actionRequired === 'string'
              ? requestDiagnostic.actionRequired
              : undefined,
        };
      }

      return {
        action: request.action,
        path: typeof data.path === 'string' ? data.path : request.path,
        kind: data.kind === 'directory' ? 'directory' : data.kind === 'file' ? 'file' : undefined,
        content: typeof data.content === 'string' ? data.content : undefined,
        truncated: Boolean(data.truncated),
        size: typeof data.size === 'number' ? data.size : undefined,
        modifiedAt: typeof data.modifiedAt === 'string' ? data.modifiedAt : undefined,
        created: Boolean(data.created),
        bytesWritten: typeof data.bytesWritten === 'number' ? data.bytesWritten : undefined,
        entries: Array.isArray(data.entries)
          ? data.entries
            .filter((entry: unknown): entry is { name: string; path: string; kind: 'file' | 'directory'; size?: number } => {
              if (!entry || typeof entry !== 'object') return false;
              const candidate = entry as Record<string, unknown>;
              return typeof candidate.name === 'string'
                && typeof candidate.path === 'string'
                && (candidate.kind === 'file' || candidate.kind === 'directory');
            })
            .map((entry: { name: string; path: string; kind: 'file' | 'directory'; size?: number }) => ({
              name: entry.name,
              path: entry.path,
              kind: entry.kind,
              size: typeof entry.size === 'number' ? entry.size : undefined,
            }))
          : undefined,
        success: true,
      };
    } catch (error) {
      return {
        action: request.action,
        path: request.path,
        success: false,
        error: error instanceof Error ? error.message : 'Filesystem request failed',
      };
    }
  };

  const requestFilesystemAction = async (
    request: OpenClawFilesystemToolRequest,
    options: { messageId: string }
  ): Promise<FilesystemToolResultEntry> => {
    if (request.action === 'list' || request.action === 'read' || request.action === 'stat') {
      return await executeFilesystemAction(request);
    }

    try {
      const res = await fetch('/api/openclaw/filesystem/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json();

      if (!res.ok) {
        const requestDiagnostic = data && typeof data === 'object'
          ? (data as { diagnostics?: { request?: { actionRequired?: unknown } } }).diagnostics?.request
          : undefined;
        return {
          action: request.action,
          path: request.path,
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Filesystem write request failed',
          code: typeof data.code === 'string' ? data.code : undefined,
          actionRequired: typeof data.actionRequired === 'string'
            ? data.actionRequired
            : typeof requestDiagnostic?.actionRequired === 'string'
              ? requestDiagnostic.actionRequired
              : undefined,
        };
      }

      if (data.autoApproved) {
        return await executeFilesystemAction({
          ...request,
          approvalToken: typeof data.approvalToken === 'string' ? data.approvalToken : undefined,
        });
      }

      if (data.requiresApproval) {
        return await new Promise<FilesystemToolResultEntry>(resolve => {
          pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
          setPendingApproval({
            kind: 'filesystem',
            title: 'Filesystem Write Approval',
            description: data.description || describeFilesystemRequest(request.action, request.path),
            previewLabel: 'Requested change',
            previewContent: truncateApprovalPreview(
              request.action === 'mkdir'
                ? request.path
                : `${request.path}\n\n${request.content || ''}`
            ),
            approvalToken: typeof data.approvalToken === 'string' ? data.approvalToken : undefined,
            messageId: options.messageId,
            request,
          });
        });
      }

      return {
        action: request.action,
        path: request.path,
        success: false,
        error: data.reason || 'Filesystem write was rejected',
        code: typeof data.code === 'string' ? data.code : undefined,
        actionRequired: typeof data.actionRequired === 'string' ? data.actionRequired : undefined,
      };
    } catch (error) {
      return {
        action: request.action,
        path: request.path,
        success: false,
        error: error instanceof Error ? error.message : 'Filesystem write request failed',
      };
    }
  };

  const executeCodeAction = async (
    request: OpenClawCodeToolRequest & { sessionId: string; approvalToken?: string },
  ): Promise<CodeToolResultEntry> => {
    try {
      const res = await fetch('/api/openclaw/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          runtime: request.runtime,
          workingDirectory: '',
          scriptPath: '',
          command: '',
          stdout: '',
          stderr: typeof data.error === 'string' ? data.error : 'Code execution failed',
          exitCode: -1,
          duration: 0,
          success: false,
          files: [],
          error: typeof data.error === 'string' ? data.error : 'Code execution failed',
        };
      }

      return {
        runtime: request.runtime,
        workingDirectory: typeof data.workingDirectory === 'string' ? data.workingDirectory : '',
        scriptPath: typeof data.scriptPath === 'string' ? data.scriptPath : '',
        command: typeof data.command === 'string' ? data.command : '',
        stdout: typeof data.stdout === 'string' ? data.stdout : '',
        stderr: typeof data.stderr === 'string' ? data.stderr : '',
        exitCode: typeof data.exitCode === 'number' ? data.exitCode : data.exitCode === null ? null : -1,
        duration: typeof data.duration === 'number' ? data.duration : 0,
        success: Boolean(data.success),
        outputTruncated: Boolean(data.outputTruncated),
        files: Array.isArray(data.files)
          ? data.files
            .filter((entry: unknown): entry is CodeToolResultEntry['files'][number] => {
              if (!entry || typeof entry !== 'object') return false;
              const candidate = entry as Record<string, unknown>;
              return typeof candidate.path === 'string'
                && typeof candidate.relativePath === 'string'
                && (candidate.kind === 'file' || candidate.kind === 'directory');
            })
            .map((entry: CodeToolResultEntry['files'][number]) => ({
              path: entry.path,
              relativePath: entry.relativePath,
              kind: entry.kind,
              size: typeof entry.size === 'number' ? entry.size : undefined,
              modifiedAt: typeof entry.modifiedAt === 'string' ? entry.modifiedAt : undefined,
            }))
          : [],
      };
    } catch (error) {
      return {
        runtime: request.runtime,
        workingDirectory: '',
        scriptPath: '',
        command: '',
        stdout: '',
        stderr: error instanceof Error ? error.message : 'Code execution failed',
        exitCode: -1,
        duration: 0,
        success: false,
        files: [],
        error: error instanceof Error ? error.message : 'Code execution failed',
      };
    }
  };

  const requestCodeExecution = async (
    request: OpenClawCodeToolRequest,
    options: { messageId: string; sessionId: string }
  ): Promise<CodeToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      workspacePath: request.workspacePath?.trim() || currentWorkspace?.relativePath || undefined,
    };

    try {
      const res = await fetch('/api/openclaw/code/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Code execution request failed');
      }

      if (data.autoApproved) {
        return await executeCodeAction(payload);
      }

      if (data.requiresApproval) {
        return await new Promise<CodeToolResultEntry>(resolve => {
          pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
          setPendingApproval({
            kind: 'code',
            title: 'Code Sandbox Approval',
            description: data.description || describeCodeExecutionRequest(request),
            previewLabel: 'Code preview',
            previewContent: truncateApprovalPreview(request.code),
            approvalToken: typeof data.approvalToken === 'string' ? data.approvalToken : undefined,
            messageId: options.messageId,
            request: payload,
          });
        });
      }

      return {
        runtime: request.runtime,
        workingDirectory: '',
        scriptPath: '',
        command: '',
        stdout: '',
        stderr: data.reason || 'Code execution was rejected',
        exitCode: -1,
        duration: 0,
        success: false,
        files: [],
        error: data.reason || 'Code execution was rejected',
      };
    } catch (error) {
      return {
        runtime: request.runtime,
        workingDirectory: '',
        scriptPath: '',
        command: '',
        stdout: '',
        stderr: error instanceof Error ? error.message : 'Code execution request failed',
        exitCode: -1,
        duration: 0,
        success: false,
        files: [],
        error: error instanceof Error ? error.message : 'Code execution request failed',
      };
    }
  };

  const executeBrowserAction = async (
    request: OpenClawBrowserToolRequest & { sessionId: string; approvalToken?: string },
  ): Promise<BrowserToolResultEntry> => {
    try {
      const res = await fetch('/api/openclaw/browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          action: request.action,
          currentUrl: '',
          title: '',
          text: '',
          links: [],
          forms: [],
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Browser action failed',
        };
      }

      return {
        action: request.action,
        currentUrl: typeof data.currentUrl === 'string' ? data.currentUrl : '',
        title: typeof data.title === 'string' ? data.title : '',
        text: typeof data.text === 'string' ? data.text : '',
        html: typeof data.html === 'string' ? data.html : undefined,
        links: Array.isArray(data.links)
          ? data.links
            .filter((entry: unknown): entry is BrowserToolResultEntry['links'][number] => {
              if (!entry || typeof entry !== 'object') return false;
              const candidate = entry as Record<string, unknown>;
              return typeof candidate.index === 'number'
                && typeof candidate.text === 'string'
                && typeof candidate.url === 'string';
            })
            .map((entry: BrowserToolResultEntry['links'][number]) => ({
              index: entry.index,
              text: entry.text,
              url: entry.url,
            }))
          : [],
        forms: Array.isArray(data.forms)
          ? data.forms
            .filter((entry: unknown): entry is BrowserToolResultEntry['forms'][number] => {
              if (!entry || typeof entry !== 'object') return false;
              const candidate = entry as Record<string, unknown>;
              return typeof candidate.index === 'number'
                && typeof candidate.action === 'string'
                && (candidate.method === 'GET' || candidate.method === 'POST')
                && Array.isArray(candidate.fields);
            })
            .map((entry: BrowserToolResultEntry['forms'][number]) => ({
              index: entry.index,
              action: entry.action,
              method: entry.method,
              fields: Array.isArray(entry.fields)
                ? entry.fields
                  .filter((field: unknown): field is BrowserToolResultEntry['forms'][number]['fields'][number] => {
                    if (!field || typeof field !== 'object') return false;
                    const candidate = field as Record<string, unknown>;
                    return typeof candidate.name === 'string' && typeof candidate.type === 'string';
                  })
                  .map((field: BrowserToolResultEntry['forms'][number]['fields'][number]) => ({
                    name: field.name,
                    type: field.type,
                    value: typeof field.value === 'string' ? field.value : undefined,
                  }))
                : [],
            }))
          : [],
        pendingFormValues: data.pendingFormValues && typeof data.pendingFormValues === 'object' && !Array.isArray(data.pendingFormValues)
          ? Object.fromEntries(Object.entries(data.pendingFormValues).filter(([, value]) => typeof value === 'string')) as Record<string, string>
          : undefined,
        submitted: data.submitted && typeof data.submitted === 'object'
          ? {
              url: typeof data.submitted.url === 'string' ? data.submitted.url : '',
              method: data.submitted.method === 'POST' ? 'POST' : 'GET',
              fieldCount: typeof data.submitted.fieldCount === 'number' ? data.submitted.fieldCount : 0,
            }
          : undefined,
        success: true,
      };
    } catch (error) {
      return {
        action: request.action,
        currentUrl: '',
        title: '',
        text: '',
        links: [],
        forms: [],
        success: false,
        error: error instanceof Error ? error.message : 'Browser action failed',
      };
    }
  };

  const requestBrowserAction = async (
    request: OpenClawBrowserToolRequest,
    options: { messageId: string; sessionId: string }
  ): Promise<BrowserToolResultEntry> => {
    const payload = { ...request, sessionId: options.sessionId };

    if (request.action !== 'submit') {
      return await executeBrowserAction(payload);
    }

    try {
      const res = await fetch('/api/openclaw/browser/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Browser request failed');
      }

      if (data.requiresApproval) {
        return await new Promise<BrowserToolResultEntry>(resolve => {
          pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
          setPendingApproval({
            kind: 'browser',
            title: 'Browser Form Approval',
            description: data.description || describeBrowserRequest(request),
            previewLabel: 'Submit target',
            previewContent: truncateApprovalPreview(
              `${data.method || 'GET'} ${data.submitUrl || ''}\nFields: ${typeof data.fieldCount === 'number' ? data.fieldCount : 0}`
            ),
            approvalToken: typeof data.approvalToken === 'string' ? data.approvalToken : undefined,
            messageId: options.messageId,
            request: payload,
          });
        });
      }

      if (data.allowed === false) {
        return {
          action: request.action,
          currentUrl: '',
          title: '',
          text: '',
          links: [],
          forms: [],
          success: false,
          error: data.reason || 'Browser submit was rejected',
        };
      }

      return await executeBrowserAction(payload);
    } catch (error) {
      return {
        action: request.action,
        currentUrl: '',
        title: '',
        text: '',
        links: [],
        forms: [],
        success: false,
        error: error instanceof Error ? error.message : 'Browser request failed',
      };
    }
  };

  const requestUwafBrowserAction = async (
    request: OpenClawUwafBrowserToolRequest,
    options: { messageId: string; sessionId: string }
  ): Promise<UwafBrowserToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      browserMode: request.browserMode || uwafBrowserMode,
    };

    if (request.action === 'wait_for_user') {
      return await waitForHumanBrowserAssistance(
        payload as OpenClawUwafBrowserToolRequest & { sessionId: string; browserMode: 'direct' | 'stealth' }
      );
    }

    if (request.action !== 'submit' && request.action !== 'research_batch') {
      return await executeUwafBrowserAction(payload);
    }

    try {
      const res = await fetch('/api/openclaw/uwaf-browser/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'UWAF browser request failed');
      }

      if (data.requiresApproval) {
        return await new Promise<UwafBrowserToolResultEntry>(resolve => {
          pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
          setPendingApproval({
            kind: 'unified_browser',
            title: 'UWAF Browser Approval',
            description: data.description || `${request.action} request requires approval`,
            previewLabel: 'Action details',
            previewContent: truncateApprovalPreview(
              `Action: ${request.action}\nURL: ${request.url || 'current page'}\nMode: ${payload.browserMode}`
            ),
            approvalToken: typeof data.approvalToken === 'string' ? data.approvalToken : undefined,
            messageId: options.messageId,
            request: payload as OpenClawUwafBrowserToolRequest & { sessionId: string },
          });
        });
      }

      if (data.allowed === false) {
        return {
          action: request.action,
          currentUrl: '',
          title: '',
          text: '',
          links: [],
          forms: [],
          mode: payload.browserMode,
          source: payload.browserMode === 'stealth' ? 'dark_web' as const : 'clear_web' as const,
          success: false,
          error: data.reason || 'UWAF browser action was rejected',
        };
      }

      return await executeUwafBrowserAction(payload);
    } catch (error) {
      return {
        action: request.action,
        currentUrl: '',
        title: '',
        text: '',
        links: [],
        forms: [],
        mode: payload.browserMode,
        source: payload.browserMode === 'stealth' ? 'dark_web' as const : 'clear_web' as const,
        success: false,
        error: error instanceof Error ? error.message : 'UWAF browser request failed',
      };
    }
  };

  const waitForHumanBrowserAssistance = async (
    request: OpenClawUwafBrowserToolRequest & { sessionId: string; browserMode: 'direct' | 'stealth' }
  ): Promise<UwafBrowserToolResultEntry> => {
    if (settings?.openClawUwafLiveBrowser === false) {
      return {
        action: request.action,
        currentUrl: '',
        title: '',
        text: '',
        links: [],
        forms: [],
        mode: request.browserMode,
        source: request.browserMode === 'stealth' ? 'dark_web' : 'clear_web',
        success: false,
        error: 'Live Browser is disabled in Settings, so human browser assistance is unavailable.',
      };
    }

    setBrowserModalOpen(true);
    setBrowserTakeoverRequestId(previous => previous + 1);

    const startedAt = Date.now();
    while (!browserInterruptedRef.current && Date.now() - startedAt < 15000) {
      await new Promise(resolve => window.setTimeout(resolve, 250));
    }

    if (!browserInterruptedRef.current) {
      return {
        action: request.action,
        currentUrl: '',
        title: '',
        text: '',
        links: [],
        forms: [],
        mode: request.browserMode,
        source: request.browserMode === 'stealth' ? 'dark_web' : 'clear_web',
        success: false,
        error: 'The live browser did not enter human-control mode.',
      };
    }

    while (browserInterruptedRef.current && Date.now() - startedAt < HUMAN_BROWSER_ASSIST_TIMEOUT_MS) {
      await new Promise(resolve => window.setTimeout(resolve, 500));
    }

    if (browserInterruptedRef.current) {
      return {
        action: request.action,
        currentUrl: '',
        title: '',
        text: '',
        links: [],
        forms: [],
        mode: request.browserMode,
        source: request.browserMode === 'stealth' ? 'dark_web' : 'clear_web',
        success: false,
        error: 'Timed out waiting for human browser assistance.',
      };
    }

    const observed = await executeUwafBrowserAction({
      action: 'extract',
      sessionId: request.sessionId,
      browserMode: request.browserMode,
      mode: request.mode || 'summary',
    });

    return {
      ...observed,
      action: request.action,
      text: [
        request.description?.trim()
          ? `Human assistance completed: ${request.description.trim()}`
          : 'Human assistance completed.',
        observed.text || observed.markdown || '',
      ].filter(Boolean).join('\n\n'),
    };
  };

  const executeUwafBrowserAction = async (payload: Record<string, unknown>): Promise<UwafBrowserToolResultEntry> => {
    try {
      const res = await fetch('/api/openclaw/uwaf-browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        return {
          action: payload.action as string,
          currentUrl: typeof data.currentUrl === 'string' ? data.currentUrl : '',
          title: typeof data.title === 'string' ? data.title : '',
          text: typeof data.text === 'string' ? data.text : '',
          links: Array.isArray(data.links) ? data.links : [],
          forms: Array.isArray(data.forms) ? data.forms : [],
          mode: (payload.browserMode as 'direct' | 'stealth') || 'direct',
          source: payload.browserMode === 'stealth' ? 'dark_web' as const : 'clear_web' as const,
          success: false,
        error: typeof data.error === 'string' ? data.error : `UWAF browser action failed: ${res.status}`,
        failureCode: typeof data.failureCode === 'string' ? data.failureCode : undefined,
        failureDetail: typeof data.failureDetail === 'string' ? data.failureDetail : undefined,
        observations: Array.isArray(data.observations)
            ? data.observations.filter((item: unknown): item is string => typeof item === 'string')
            : [],
        };
      }

      return {
        action: data.action,
        currentUrl: data.currentUrl || '',
        title: data.title || '',
        text: data.text || data.markdown || '',
        links: data.links || [],
        forms: data.forms || [],
        tables: data.tables || [],
        markdown: data.markdown || '',
        mode: data.mode || 'direct',
        stealthProfile: data.stealthProfile === 'high' ? 'high' : data.stealthProfile === 'normal' ? 'normal' : undefined,
        source: data.source || 'clear_web',
        success: data.success !== false,
        error: typeof data.error === 'string' ? data.error : undefined,
        requestedUrl: typeof data.requestedUrl === 'string' ? data.requestedUrl : undefined,
        requestedQuery: typeof data.requestedQuery === 'string' ? data.requestedQuery : undefined,
        finalUrl: typeof data.finalUrl === 'string' ? data.finalUrl : undefined,
        redirected: typeof data.redirected === 'boolean' ? data.redirected : undefined,
        httpStatus: typeof data.httpStatus === 'number' ? data.httpStatus : undefined,
        queryMatched: typeof data.queryMatched === 'boolean' ? data.queryMatched : undefined,
        resultCount: typeof data.resultCount === 'number' ? data.resultCount : undefined,
        antiBotDetected: typeof data.antiBotDetected === 'boolean' ? data.antiBotDetected : undefined,
        loginDetected: typeof data.loginDetected === 'boolean' ? data.loginDetected : undefined,
        jsErrors: Array.isArray(data.jsErrors) ? data.jsErrors.filter((item: unknown): item is string => typeof item === 'string') : [],
        networkErrors: Array.isArray(data.networkErrors) ? data.networkErrors.filter((item: unknown): item is string => typeof item === 'string') : [],
        failureCode: typeof data.failureCode === 'string' ? data.failureCode : undefined,
        failureDetail: typeof data.failureDetail === 'string' ? data.failureDetail : undefined,
        pageChanged: typeof data.pageChanged === 'boolean' ? data.pageChanged : undefined,
        navigationChanged: typeof data.navigationChanged === 'boolean' ? data.navigationChanged : undefined,
        selectorMatched: typeof data.selectorMatched === 'boolean' ? data.selectorMatched : undefined,
        waitTimedOut: typeof data.waitTimedOut === 'boolean' ? data.waitTimedOut : undefined,
        searchEngine: typeof data.searchEngine === 'string' ? data.searchEngine : undefined,
        searchProviderId: typeof data.searchProviderId === 'string' ? data.searchProviderId : undefined,
        searchAttempts: Array.isArray(data.searchAttempts)
          ? data.searchAttempts.filter((item: unknown): item is NonNullable<UwafBrowserToolResultEntry['searchAttempts']>[number] => {
              if (!item || typeof item !== 'object') return false;
              const attempt = item as Record<string, unknown>;
              return typeof attempt.providerId === 'string'
                && typeof attempt.providerLabel === 'string'
                && typeof attempt.success === 'boolean'
                && typeof attempt.resultCount === 'number';
            })
          : [],
        tabs: Array.isArray(data.tabs) ? data.tabs : [],
        activeTabIndex: typeof data.activeTabIndex === 'number' ? data.activeTabIndex : undefined,
        observations: Array.isArray(data.observations)
          ? data.observations.filter((item: unknown): item is string => typeof item === 'string')
          : [],
        batchResults: data.batchResults,
      };
    } catch (error) {
      return {
        action: payload.action as string,
        currentUrl: '',
        title: '',
        text: '',
        links: [],
        forms: [],
        mode: (payload.browserMode as 'direct' | 'stealth') || 'direct',
        source: payload.browserMode === 'stealth' ? 'dark_web' as const : 'clear_web' as const,
        success: false,
        error: error instanceof Error ? error.message : 'UWAF browser action failed',
      };
    }
  };

  const requestWebContext = async (
    query: string,
    options: { description?: string } = {},
  ): Promise<WebToolResultEntry> => {
    try {
      const res = await fetch('/api/web/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();

      if (!res.ok) {
        return {
          query,
          description: options.description,
          context: '',
          sources: [],
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Web research request failed',
        };
      }

      return {
        query,
        description: options.description,
        context: typeof data.context === 'string' ? data.context : '',
        sources: normalizeToolSources(data.sources),
        success: true,
      };
    } catch (error) {
      return {
        query,
        description: options.description,
        context: '',
        sources: [],
        success: false,
        error: error instanceof Error ? error.message : 'Web research request failed',
      };
    }
  };

  const executeTaxReturnAction = async (
    request: OpenClawTaxReturnToolRequest & { sessionId: string; messageId?: string },
  ): Promise<TaxReturnToolResultEntry> => {
    try {
      const res = await fetch('/api/openclaw/tax', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          action: request.action,
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Tax PDF generation failed',
        };
      }

      const artifact = data.artifact && typeof data.artifact === 'object'
        ? data.artifact as Record<string, unknown>
        : null;
      const draft = data.draft && typeof data.draft === 'object'
        ? data.draft as Record<string, unknown>
        : {};

      return {
        action: request.action,
        success: data.success !== false,
        artifact: artifact
          && typeof artifact.id === 'string'
          && typeof artifact.name === 'string'
          && typeof artifact.mimeType === 'string'
          && typeof artifact.size === 'number'
          && typeof artifact.downloadUrl === 'string'
          ? {
              id: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              size: artifact.size,
              downloadUrl: artifact.downloadUrl,
            }
          : undefined,
        filledFields: Array.isArray(data.filledFields) ? data.filledFields.filter((field: unknown): field is string => typeof field === 'string') : [],
        warnings: Array.isArray(data.warnings) ? data.warnings.filter((warning: unknown): warning is string => typeof warning === 'string') : [],
        missingFields: Array.isArray(draft.missingFields) ? draft.missingFields.filter((field: unknown): field is string => typeof field === 'string') : [],
      };
    } catch (error) {
      return {
        action: request.action,
        success: false,
        error: error instanceof Error ? error.message : 'Tax PDF generation failed',
      };
    }
  };

  const requestTaxReturnAction = async (
    request: OpenClawTaxReturnToolRequest,
    options: { messageId: string; sessionId: string },
  ): Promise<TaxReturnToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      messageId: options.messageId,
      folder: request.folder?.trim() || ragFolderPath || undefined,
    };

    return await new Promise<TaxReturnToolResultEntry>(resolve => {
      pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
      setPendingApproval({
        kind: 'tax_return',
        title: 'Tax PDF Generation Approval',
        description: describeTaxReturnRequest(payload),
        previewLabel: 'Tax PDF request',
        previewContent: truncateApprovalPreview(
          [
            `Action: ${payload.action}`,
            `Folder: ${payload.folder || 'enabled Knowledge Base context'}`,
            `Tax year: ${payload.taxYear || 'auto-detect'}`,
            payload.templateDocumentId ? `Template document: ${payload.templateDocumentId}` : null,
            payload.flatten ? 'Flatten output form: yes' : null,
            '',
            'This will read ready Knowledge Base tax documents and create a downloadable PDF artifact.',
          ].filter(Boolean).join('\n')
        ),
        messageId: options.messageId,
        request: payload,
      });
    });
  };

  const executePdfDocumentAction = async (
    request: OpenClawPdfDocumentToolRequest & { sessionId: string; messageId?: string },
  ): Promise<PdfDocumentToolResultEntry> => {
    try {
      const res = await fetch('/api/openclaw/pdf-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          title: request.title,
          success: false,
          error: typeof data.error === 'string' ? data.error : 'PDF generation failed',
        };
      }
      const artifact = data.artifact && typeof data.artifact === 'object'
        ? data.artifact as Record<string, unknown>
        : null;
      return {
        title: request.title,
        success: data.success !== false,
        artifact: artifact
          && typeof artifact.id === 'string'
          && typeof artifact.name === 'string'
          && typeof artifact.mimeType === 'string'
          && typeof artifact.size === 'number'
          && typeof artifact.downloadUrl === 'string'
          ? {
              id: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              size: artifact.size,
              downloadUrl: artifact.downloadUrl,
            }
          : undefined,
      };
    } catch (error) {
      return {
        title: request.title,
        success: false,
        error: error instanceof Error ? error.message : 'PDF generation failed',
      };
    }
  };

  const requestPdfDocumentAction = async (
    request: OpenClawPdfDocumentToolRequest,
    options: { messageId: string; sessionId: string },
  ): Promise<PdfDocumentToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      messageId: options.messageId,
    };

    return await new Promise<PdfDocumentToolResultEntry>(resolve => {
      pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
      setPendingApproval({
        kind: 'pdf_document',
        title: 'PDF Generation Approval',
        description: describePdfDocumentRequest(request),
        previewLabel: 'PDF content preview',
        previewContent: truncateApprovalPreview(
          [
            `Title: ${request.title}`,
            `Filename: ${request.filename || `${request.title}.pdf`}`,
            request.template ? `Template: ${request.template}` : null,
            request.subtitle ? `Subtitle: ${request.subtitle}` : null,
            request.sections?.length ? `Sections: ${request.sections.length}` : null,
            request.tables?.length ? `Tables: ${request.tables.length}` : null,
            request.fields?.length ? `Fields: ${request.fields.length}` : null,
            request.callouts?.length ? `Callouts: ${request.callouts.length}` : null,
            '',
            request.content || JSON.stringify({
              sections: request.sections,
              tables: request.tables,
              fields: request.fields,
              callouts: request.callouts,
            }, null, 2),
          ].filter(Boolean).join('\n')
        ),
        messageId: options.messageId,
        request: payload,
      });
    });
  };

  const executeWorkbookDocumentAction = async (
    request: OpenClawWorkbookDocumentToolRequest & { sessionId: string; messageId?: string },
  ): Promise<WorkbookDocumentToolResultEntry> => {
    try {
      const res = await fetch('/api/openclaw/workbook-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          title: request.title,
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Excel workbook generation failed',
        };
      }
      const artifact = data.artifact && typeof data.artifact === 'object'
        ? data.artifact as Record<string, unknown>
        : null;
      return {
        title: request.title,
        success: data.success !== false,
        artifact: artifact
          && typeof artifact.id === 'string'
          && typeof artifact.name === 'string'
          && typeof artifact.mimeType === 'string'
          && typeof artifact.size === 'number'
          && typeof artifact.downloadUrl === 'string'
          ? {
              id: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              size: artifact.size,
              downloadUrl: artifact.downloadUrl,
            }
          : undefined,
      };
    } catch (error) {
      return {
        title: request.title,
        success: false,
        error: error instanceof Error ? error.message : 'Excel workbook generation failed',
      };
    }
  };

  const requestWorkbookDocumentAction = async (
    request: OpenClawWorkbookDocumentToolRequest,
    options: { messageId: string; sessionId: string },
  ): Promise<WorkbookDocumentToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      messageId: options.messageId,
    };

    return await new Promise<WorkbookDocumentToolResultEntry>(resolve => {
      pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
      setPendingApproval({
        kind: 'workbook_document',
        title: 'Excel Workbook Generation Approval',
        description: describeWorkbookDocumentRequest(request),
        previewLabel: 'Workbook structure preview',
        previewContent: truncateApprovalPreview(
          [
            `Title: ${request.title}`,
            `Filename: ${request.filename || `${request.title}.xlsx`}`,
            request.template ? `Template: ${request.template}` : null,
            request.sheets?.length ? `Sheets: ${request.sheets.length}` : null,
            '',
            JSON.stringify({
              sheets: request.sheets,
              metadata: request.metadata,
            }, null, 2),
          ].filter(Boolean).join('\n')
        ),
        messageId: options.messageId,
        request: payload,
      });
    });
  };

  const executeWordDocumentAction = async (
    request: OpenClawWordDocumentToolRequest & { sessionId: string; messageId?: string },
  ): Promise<WordDocumentToolResultEntry> => {
    try {
      const res = await fetch('/api/openclaw/word-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          title: request.title,
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Word document generation failed',
        };
      }
      const artifact = data.artifact && typeof data.artifact === 'object'
        ? data.artifact as Record<string, unknown>
        : null;
      return {
        title: request.title,
        success: data.success !== false,
        artifact: artifact
          && typeof artifact.id === 'string'
          && typeof artifact.name === 'string'
          && typeof artifact.mimeType === 'string'
          && typeof artifact.size === 'number'
          && typeof artifact.downloadUrl === 'string'
          ? {
              id: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              size: artifact.size,
              downloadUrl: artifact.downloadUrl,
            }
          : undefined,
      };
    } catch (error) {
      return {
        title: request.title,
        success: false,
        error: error instanceof Error ? error.message : 'Word document generation failed',
      };
    }
  };

  const requestWordDocumentAction = async (
    request: OpenClawWordDocumentToolRequest,
    options: { messageId: string; sessionId: string },
  ): Promise<WordDocumentToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      messageId: options.messageId,
    };

    return await new Promise<WordDocumentToolResultEntry>(resolve => {
      pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
      setPendingApproval({
        kind: 'word_document',
        title: 'Word Document Generation Approval',
        description: describeWordDocumentRequest(request),
        previewLabel: 'Word document structure preview',
        previewContent: truncateApprovalPreview(
          [
            `Title: ${request.title}`,
            `Filename: ${request.filename || `${request.title}.docx`}`,
            request.template ? `Template: ${request.template}` : null,
            request.subtitle ? `Subtitle: ${request.subtitle}` : null,
            request.sections?.length ? `Sections: ${request.sections.length}` : null,
            request.tables?.length ? `Tables: ${request.tables.length}` : null,
            request.fields?.length ? `Fields: ${request.fields.length}` : null,
            request.callouts?.length ? `Callouts: ${request.callouts.length}` : null,
            '',
            request.content || JSON.stringify({
              sections: request.sections,
              tables: request.tables,
              fields: request.fields,
              callouts: request.callouts,
              metadata: request.metadata,
            }, null, 2),
          ].filter(Boolean).join('\n')
        ),
        messageId: options.messageId,
        request: payload,
      });
    });
  };

  const executeCsvDocumentAction = async (
    request: OpenClawCsvDocumentToolRequest & { sessionId: string; messageId?: string },
  ): Promise<CsvDocumentToolResultEntry> => {
    try {
      const res = await fetch('/api/openclaw/csv-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          title: request.title,
          success: false,
          error: typeof data.error === 'string' ? data.error : 'CSV export failed',
        };
      }
      const artifact = data.artifact && typeof data.artifact === 'object'
        ? data.artifact as Record<string, unknown>
        : null;
      return {
        title: request.title,
        success: data.success !== false,
        artifact: artifact
          && typeof artifact.id === 'string'
          && typeof artifact.name === 'string'
          && typeof artifact.mimeType === 'string'
          && typeof artifact.size === 'number'
          && typeof artifact.downloadUrl === 'string'
          ? {
              id: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              size: artifact.size,
              downloadUrl: artifact.downloadUrl,
            }
          : undefined,
      };
    } catch (error) {
      return {
        title: request.title,
        success: false,
        error: error instanceof Error ? error.message : 'CSV export failed',
      };
    }
  };

  const requestCsvDocumentAction = async (
    request: OpenClawCsvDocumentToolRequest,
    options: { messageId: string; sessionId: string },
  ): Promise<CsvDocumentToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      messageId: options.messageId,
    };

    return await new Promise<CsvDocumentToolResultEntry>(resolve => {
      pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
      setPendingApproval({
        kind: 'csv_document',
        title: 'CSV Export Approval',
        description: describeCsvDocumentRequest(request),
        previewLabel: 'CSV preview',
        previewContent: truncateApprovalPreview(
          [
            `Title: ${request.title}`,
            `Filename: ${request.filename || `${request.title}.csv`}`,
            request.headers?.length ? `Columns: ${request.headers.length}` : null,
            request.rows?.length ? `Rows: ${request.rows.length}` : null,
            '',
            request.content || JSON.stringify({
              headers: request.headers,
              rows: request.rows?.slice(0, 10),
            }, null, 2),
          ].filter(Boolean).join('\n')
        ),
        messageId: options.messageId,
        request: payload,
      });
    });
  };

  const executeEmailDocumentAction = async (
    request: OpenClawEmailDocumentToolRequest & { sessionId: string; messageId?: string },
  ): Promise<EmailDocumentToolResultEntry> => {
    try {
      const res = await fetch('/api/openclaw/email-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const title = request.title || request.subject || 'Generated Email';
        return {
          title,
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Email generation failed',
        };
      }
      const artifact = data.artifact && typeof data.artifact === 'object'
        ? data.artifact as Record<string, unknown>
        : null;
      const title = request.title || request.subject || 'Generated Email';
      return {
        title,
        success: data.success !== false,
        artifact: artifact
          && typeof artifact.id === 'string'
          && typeof artifact.name === 'string'
          && typeof artifact.mimeType === 'string'
          && typeof artifact.size === 'number'
          && typeof artifact.downloadUrl === 'string'
          ? {
              id: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              size: artifact.size,
              downloadUrl: artifact.downloadUrl,
            }
          : undefined,
      };
    } catch (error) {
      const title = request.title || request.subject || 'Generated Email';
      return {
        title,
        success: false,
        error: error instanceof Error ? error.message : 'Email generation failed',
      };
    }
  };

  const requestEmailDocumentAction = async (
    request: OpenClawEmailDocumentToolRequest,
    options: { messageId: string; sessionId: string },
  ): Promise<EmailDocumentToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      messageId: options.messageId,
    };
    const title = request.title || request.subject || 'Generated Email';

    return await new Promise<EmailDocumentToolResultEntry>(resolve => {
      pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
      setPendingApproval({
        kind: 'email_document',
        title: 'Email Draft Approval',
        description: describeEmailDocumentRequest(request),
        previewLabel: 'Email preview',
        previewContent: truncateApprovalPreview(
          [
            `Title: ${title}`,
            `Filename: ${request.filename || `${title}.eml`}`,
            request.to ? `To: ${request.to}` : null,
            request.from ? `From: ${request.from}` : null,
            `Subject: ${request.subject}`,
            '',
            request.body,
          ].filter(Boolean).join('\n')
        ),
        messageId: options.messageId,
        request: payload,
      });
    });
  };

  const executeMarkdownDocumentAction = async (
    request: OpenClawMarkdownDocumentToolRequest & { sessionId: string; messageId?: string },
  ): Promise<MarkdownDocumentToolResultEntry> => {
    try {
      const res = await fetch('/api/openclaw/markdown-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          title: request.title || 'Generated Markdown Document',
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Markdown document generation failed',
        };
      }
      const artifact = data.artifact && typeof data.artifact === 'object'
        ? data.artifact as Record<string, unknown>
        : null;
      return {
        title: request.title || 'Generated Markdown Document',
        success: data.success !== false,
        artifact: artifact
          && typeof artifact.id === 'string'
          && typeof artifact.name === 'string'
          && typeof artifact.mimeType === 'string'
          && typeof artifact.size === 'number'
          && typeof artifact.downloadUrl === 'string'
          ? {
              id: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              size: artifact.size,
              downloadUrl: artifact.downloadUrl,
            }
          : undefined,
      };
    } catch (error) {
      return {
        title: request.title || 'Generated Markdown Document',
        success: false,
        error: error instanceof Error ? error.message : 'Markdown document generation failed',
      };
    }
  };

  const requestMarkdownDocumentAction = async (
    request: OpenClawMarkdownDocumentToolRequest,
    options: { messageId: string; sessionId: string },
  ): Promise<MarkdownDocumentToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      messageId: options.messageId,
    };
    const title = request.title || 'Generated Markdown Document';

    return await new Promise<MarkdownDocumentToolResultEntry>(resolve => {
      pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
      setPendingApproval({
        kind: 'markdown_document',
        title: 'Markdown Document Approval',
        description: describeMarkdownDocumentRequest(request),
        previewLabel: 'Markdown preview',
        previewContent: truncateApprovalPreview(
          [
            `Title: ${title}`,
            `Filename: ${request.filename || `${title}.md`}`,
            '',
            request.content.slice(0, 4000),
          ].filter(Boolean).join('\n')
        ),
        messageId: options.messageId,
        request: payload,
      });
    });
  };

  const executeSlidesDocumentAction = async (
    request: OpenClawSlidesDocumentToolRequest & { sessionId: string; messageId?: string },
  ): Promise<SlidesDocumentToolResultEntry> => {
    try {
      const res = await fetch('/api/openclaw/slides-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          title: request.title || 'Generated Slides',
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Slide deck generation failed',
        };
      }
      const artifact = data.artifact && typeof data.artifact === 'object'
        ? data.artifact as Record<string, unknown>
        : null;
      return {
        title: request.title || 'Generated Slides',
        success: data.success !== false,
        artifact: artifact
          && typeof artifact.id === 'string'
          && typeof artifact.name === 'string'
          && typeof artifact.mimeType === 'string'
          && typeof artifact.size === 'number'
          && typeof artifact.downloadUrl === 'string'
          ? {
              id: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              size: artifact.size,
              downloadUrl: artifact.downloadUrl,
            }
          : undefined,
      };
    } catch (error) {
      return {
        title: request.title || 'Generated Slides',
        success: false,
        error: error instanceof Error ? error.message : 'Slide deck generation failed',
      };
    }
  };

  const requestSlidesDocumentAction = async (
    request: OpenClawSlidesDocumentToolRequest,
    options: { messageId: string; sessionId: string },
  ): Promise<SlidesDocumentToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      messageId: options.messageId,
    };
    const title = request.title || 'Generated Slides';

    return await new Promise<SlidesDocumentToolResultEntry>(resolve => {
      pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
      setPendingApproval({
        kind: 'slides_document',
        title: 'Slide Deck Approval',
        description: `Generate a slide deck titled "${title}" with ${request.slides.length} slides.`,
        previewLabel: 'Slide structure preview',
        previewContent: truncateApprovalPreview(
          [
            `Title: ${title}`,
            `Filename: ${request.filename || `${title}.pptx`}`,
            request.subtitle ? `Subtitle: ${request.subtitle}` : null,
            `Slides: ${request.slides.length}`,
            '',
            JSON.stringify({ slides: request.slides }, null, 2).slice(0, 4000),
          ].filter(Boolean).join('\n')
        ),
        messageId: options.messageId,
        request: payload,
      });
    });
  };

  const executeArchiveDocumentAction = async (
    request: OpenClawArchiveDocumentToolRequest & { sessionId: string; messageId?: string },
  ): Promise<ArchiveDocumentToolResultEntry> => {
    try {
      const res = await fetch('/api/openclaw/archive-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          title: request.title || 'Generated Archive',
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Archive generation failed',
        };
      }
      const artifact = data.artifact && typeof data.artifact === 'object'
        ? data.artifact as Record<string, unknown>
        : null;
      return {
        title: request.title || 'Generated Archive',
        success: data.success !== false,
        artifact: artifact
          && typeof artifact.id === 'string'
          && typeof artifact.name === 'string'
          && typeof artifact.mimeType === 'string'
          && typeof artifact.size === 'number'
          && typeof artifact.downloadUrl === 'string'
          ? {
              id: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              size: artifact.size,
              downloadUrl: artifact.downloadUrl,
            }
          : undefined,
      };
    } catch (error) {
      return {
        title: request.title || 'Generated Archive',
        success: false,
        error: error instanceof Error ? error.message : 'Archive generation failed',
      };
    }
  };

  const requestArchiveDocumentAction = async (
    request: OpenClawArchiveDocumentToolRequest,
    options: { messageId: string; sessionId: string },
  ): Promise<ArchiveDocumentToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      messageId: options.messageId,
    };
    const title = request.title || 'Generated Archive';

    return await new Promise<ArchiveDocumentToolResultEntry>(resolve => {
      pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
      setPendingApproval({
        kind: 'archive_document',
        title: 'Archive Approval',
        description: `Bundle ${request.entries.length} entries into "${title}".`,
        previewLabel: 'Archive preview',
        previewContent: truncateApprovalPreview(
          [
            `Title: ${title}`,
            `Filename: ${request.filename || `${title}.zip`}`,
            `Entries: ${request.entries.length}`,
            '',
            JSON.stringify({ entries: request.entries.map(e => ({ name: e.name, mimeType: e.mimeType, bytes: typeof e.content === 'string' ? e.content.length : 0 })) }, null, 2),
          ].filter(Boolean).join('\n')
        ),
        messageId: options.messageId,
        request: payload,
      });
    });
  };

  const executeCalendarDocumentAction = async (
    request: OpenClawCalendarDocumentToolRequest & { sessionId: string; messageId?: string },
  ): Promise<CalendarDocumentToolResultEntry> => {
    try {
      const res = await fetch('/api/openclaw/calendar-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          title: request.title || 'Generated Calendar Event',
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Calendar event generation failed',
        };
      }
      const artifact = data.artifact && typeof data.artifact === 'object'
        ? data.artifact as Record<string, unknown>
        : null;
      return {
        title: request.title || 'Generated Calendar Event',
        success: data.success !== false,
        artifact: artifact
          && typeof artifact.id === 'string'
          && typeof artifact.name === 'string'
          && typeof artifact.mimeType === 'string'
          && typeof artifact.size === 'number'
          && typeof artifact.downloadUrl === 'string'
          ? {
              id: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              size: artifact.size,
              downloadUrl: artifact.downloadUrl,
            }
          : undefined,
      };
    } catch (error) {
      return {
        title: request.title || 'Generated Calendar Event',
        success: false,
        error: error instanceof Error ? error.message : 'Calendar event generation failed',
      };
    }
  };

  const requestCalendarDocumentAction = async (
    request: OpenClawCalendarDocumentToolRequest,
    options: { messageId: string; sessionId: string },
  ): Promise<CalendarDocumentToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      messageId: options.messageId,
    };
    const title = request.title || 'Generated Calendar Event';

    return await new Promise<CalendarDocumentToolResultEntry>(resolve => {
      pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
      setPendingApproval({
        kind: 'calendar_document',
        title: 'Calendar Event Approval',
        description: `Generate calendar with ${request.events.length} event${request.events.length === 1 ? '' : 's'} titled "${title}".`,
        previewLabel: 'Calendar preview',
        previewContent: truncateApprovalPreview(
          [
            `Title: ${title}`,
            `Filename: ${request.filename || `${title}.ics`}`,
            `Events: ${request.events.length}`,
            '',
            JSON.stringify({ events: request.events }, null, 2).slice(0, 4000),
          ].filter(Boolean).join('\n')
        ),
        messageId: options.messageId,
        request: payload,
      });
    });
  };

  const executeMermaidDocumentAction = async (
    request: OpenClawMermaidDocumentToolRequest & { sessionId: string; messageId?: string },
  ): Promise<MermaidDocumentToolResultEntry> => {
    try {
      const res = await fetch('/api/openclaw/mermaid-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          title: request.title || 'Generated Diagram',
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Diagram generation failed',
        };
      }
      const artifact = data.artifact && typeof data.artifact === 'object'
        ? data.artifact as Record<string, unknown>
        : null;
      return {
        title: request.title || 'Generated Diagram',
        success: data.success !== false,
        artifact: artifact
          && typeof artifact.id === 'string'
          && typeof artifact.name === 'string'
          && typeof artifact.mimeType === 'string'
          && typeof artifact.size === 'number'
          && typeof artifact.downloadUrl === 'string'
          ? {
              id: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              size: artifact.size,
              downloadUrl: artifact.downloadUrl,
            }
          : undefined,
      };
    } catch (error) {
      return {
        title: request.title || 'Generated Diagram',
        success: false,
        error: error instanceof Error ? error.message : 'Diagram generation failed',
      };
    }
  };

  const requestMermaidDocumentAction = async (
    request: OpenClawMermaidDocumentToolRequest,
    options: { messageId: string; sessionId: string },
  ): Promise<MermaidDocumentToolResultEntry> => {
    const payload = {
      ...request,
      sessionId: options.sessionId,
      messageId: options.messageId,
    };
    const title = request.title || 'Generated Diagram';

    return await new Promise<MermaidDocumentToolResultEntry>(resolve => {
      pendingApprovalResolverRef.current = resolve as (result: ToolApprovalResolution) => void;
      setPendingApproval({
        kind: 'mermaid_document',
        title: 'Mermaid Diagram Approval',
        description: `Render a Mermaid diagram titled "${title}" as ${request.format || 'svg'}.`,
        previewLabel: 'Diagram source preview',
        previewContent: truncateApprovalPreview(
          [
            `Title: ${title}`,
            `Filename: ${request.filename || `${title}.${request.format || 'svg'}`}`,
            `Format: ${request.format || 'svg'}`,
            '',
            request.diagram.slice(0, 4000),
          ].filter(Boolean).join('\n')
        ),
        messageId: options.messageId,
        request: payload,
      });
    });
  };

  const executeFetchSummarizeAction = async (
    request: OpenClawFetchSummarizeToolRequest,
  ): Promise<FetchSummarizeToolResultEntry> => {
    try {
      const res = await fetch('/api/openclaw/fetch-summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          url: request.url,
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Fetch and summarize failed',
        };
      }
      return {
        url: request.url,
        success: data.success !== false,
        title: typeof data.title === 'string' ? data.title : undefined,
        summary: Array.isArray(data.summary) ? data.summary.filter((s: unknown): s is string => typeof s === 'string') : undefined,
        quote: typeof data.quote === 'string' ? data.quote : undefined,
      };
    } catch (error) {
      return {
        url: request.url,
        success: false,
        error: error instanceof Error ? error.message : 'Fetch and summarize failed',
      };
    }
  };

  const handleToolApprove = async () => {
    if (!pendingApproval || !pendingApprovalResolverRef.current) return;
    const approval = pendingApproval;
    const resolve = pendingApprovalResolverRef.current;
    pendingApprovalResolverRef.current = null;
    setPendingApproval(null);

    try {
      if (approval.kind === 'shell') {
        resolve(await executeShellCommand({
          ...approval.request,
          approvalToken: approval.approvalToken,
          messageId: approval.messageId,
        }));
        return;
      }

      if (approval.kind === 'filesystem') {
        resolve(await executeFilesystemAction({
          ...approval.request,
          approvalToken: approval.approvalToken,
        }));
        return;
      }

      if (approval.kind === 'code') {
        resolve(await executeCodeAction({
          ...approval.request,
          approvalToken: approval.approvalToken,
        }));
        return;
      }

      if (approval.kind === 'unified_browser') {
        resolve(await executeUwafBrowserAction({
          ...approval.request,
          approvalToken: approval.approvalToken,
        }));
        return;
      }

      if (approval.kind === 'tax_return') {
        resolve(await executeTaxReturnAction(approval.request));
        return;
      }

      if (approval.kind === 'pdf_document') {
        resolve(await executePdfDocumentAction(approval.request));
        return;
      }

      if (approval.kind === 'workbook_document') {
        resolve(await executeWorkbookDocumentAction(approval.request));
        return;
      }

      if (approval.kind === 'word_document') {
        resolve(await executeWordDocumentAction(approval.request));
        return;
      }

      if (approval.kind === 'csv_document') {
        resolve(await executeCsvDocumentAction(approval.request));
        return;
      }

      if (approval.kind === 'email_document') {
        resolve(await executeEmailDocumentAction(approval.request));
        return;
      }

      if (approval.kind === 'markdown_document') {
        resolve(await executeMarkdownDocumentAction(approval.request));
        return;
      }

      if (approval.kind === 'slides_document') {
        resolve(await executeSlidesDocumentAction(approval.request));
        return;
      }

      if (approval.kind === 'archive_document') {
        resolve(await executeArchiveDocumentAction(approval.request));
        return;
      }

      if (approval.kind === 'calendar_document') {
        resolve(await executeCalendarDocumentAction(approval.request));
        return;
      }

      if (approval.kind === 'mermaid_document') {
        resolve(await executeMermaidDocumentAction(approval.request));
        return;
      }

      resolve(await executeBrowserAction({
        ...approval.request,
        approvalToken: approval.approvalToken,
      }));
    } catch (error) {
      console.error('Approved tool execution failed:', error);
      const message = error instanceof Error ? error.message : 'Approved tool execution failed';

      if (approval.kind === 'shell') {
        resolve(appendShellOutput({
          id: randomUUID(),
          messageId: approval.messageId,
          auditId: approval.request.auditId,
          target: settings?.shellExecutionTarget === 'host' ? 'host' : 'container',
          command: approval.request.command,
          description: approval.request.description,
          stderr: message,
          exitCode: -1,
          duration: 0,
          success: false,
        }));
        return;
      }

      if (approval.kind === 'filesystem') {
        resolve({
          action: approval.request.action,
          path: approval.request.path,
          success: false,
          error: message,
        });
        return;
      }

      if (approval.kind === 'code') {
        resolve({
          runtime: approval.request.runtime,
          workingDirectory: '',
          scriptPath: '',
          command: '',
          stdout: '',
          stderr: message,
          exitCode: -1,
          duration: 0,
          success: false,
          files: [],
          error: message,
        });
        return;
      }

      if (approval.kind === 'unified_browser') {
        resolve({
          action: approval.request.action,
          currentUrl: '',
          title: '',
          text: '',
          links: [],
          forms: [],
          mode: approval.request.browserMode || 'direct',
          source: (approval.request.browserMode || 'direct') === 'stealth' ? 'dark_web' as const : 'clear_web' as const,
          success: false,
          error: message,
        } satisfies UwafBrowserToolResultEntry);
        return;
      }

      if (approval.kind === 'tax_return') {
        resolve({
          action: approval.request.action,
          success: false,
          error: message,
        } satisfies TaxReturnToolResultEntry);
        return;
      }

      if (approval.kind === 'pdf_document') {
        resolve({
          title: approval.request.title,
          success: false,
          error: message,
        } satisfies PdfDocumentToolResultEntry);
        return;
      }

      if (approval.kind === 'workbook_document') {
        resolve({
          title: approval.request.title,
          success: false,
          error: message,
        } satisfies WorkbookDocumentToolResultEntry);
        return;
      }

      if (approval.kind === 'word_document') {
        resolve({
          title: approval.request.title,
          success: false,
          error: message,
        } satisfies WordDocumentToolResultEntry);
        return;
      }

      if (approval.kind === 'csv_document') {
        resolve({
          title: approval.request.title,
          success: false,
          error: message,
        } satisfies CsvDocumentToolResultEntry);
        return;
      }

      if (approval.kind === 'email_document') {
        resolve({
          title: approval.request.title || approval.request.subject || 'Generated Email',
          success: false,
          error: message,
        } satisfies EmailDocumentToolResultEntry);
        return;
      }

      if (approval.kind === 'markdown_document') {
        resolve({
          title: approval.request.title || 'Generated Markdown Document',
          success: false,
          error: message,
        } satisfies MarkdownDocumentToolResultEntry);
        return;
      }

      if (approval.kind === 'slides_document') {
        resolve({
          title: approval.request.title || 'Generated Slides',
          success: false,
          error: message,
        } satisfies SlidesDocumentToolResultEntry);
        return;
      }

      if (approval.kind === 'archive_document') {
        resolve({
          title: approval.request.title || 'Generated Archive',
          success: false,
          error: message,
        } satisfies ArchiveDocumentToolResultEntry);
        return;
      }

      if (approval.kind === 'calendar_document') {
        resolve({
          title: approval.request.title || 'Generated Calendar Event',
          success: false,
          error: message,
        } satisfies CalendarDocumentToolResultEntry);
        return;
      }

      if (approval.kind === 'mermaid_document') {
        resolve({
          title: approval.request.title || 'Generated Diagram',
          success: false,
          error: message,
        } satisfies MermaidDocumentToolResultEntry);
        return;
      }

      resolve({
        action: approval.request.action,
        currentUrl: '',
        title: '',
        text: '',
        links: [],
        forms: [],
        success: false,
        error: message,
      });
    }
  };

  const handleToolReject = () => {
    if (!pendingApproval || !pendingApprovalResolverRef.current) return;
    const approval = pendingApproval;
    const resolve = pendingApprovalResolverRef.current;
    pendingApprovalResolverRef.current = null;
    setPendingApproval(null);

    if (approval.kind === 'shell') {
      resolve(appendShellOutput({
        id: randomUUID(),
        messageId: approval.messageId,
        command: approval.request.command,
        description: approval.request.description,
        stderr: 'Command rejected by user',
        exitCode: -1,
        duration: 0,
        success: false,
        rejected: true,
      }));
      return;
    }

    if (approval.kind === 'filesystem') {
      resolve({
        action: approval.request.action,
        path: approval.request.path,
        success: false,
        error: 'Filesystem write rejected by user',
      } satisfies FilesystemToolResultEntry);
      return;
    }

    if (approval.kind === 'code') {
      resolve({
        runtime: approval.request.runtime,
        workingDirectory: '',
        scriptPath: '',
        command: '',
        stdout: '',
        stderr: 'Code execution rejected by user',
        exitCode: -1,
        duration: 0,
        success: false,
        files: [],
        error: 'Code execution rejected by user',
      } satisfies CodeToolResultEntry);
      return;
    }

    if (approval.kind === 'unified_browser') {
      resolve({
        action: approval.request.action,
        currentUrl: '',
        title: '',
        text: '',
        links: [],
        forms: [],
        mode: approval.request.browserMode || 'direct',
        source: (approval.request.browserMode || 'direct') === 'stealth' ? 'dark_web' as const : 'clear_web' as const,
        success: false,
        error: 'UWAF browser action rejected by user',
      } satisfies UwafBrowserToolResultEntry);
      return;
    }

    if (approval.kind === 'tax_return') {
      resolve({
        action: approval.request.action,
        success: false,
        error: 'Tax PDF generation rejected by user',
      } satisfies TaxReturnToolResultEntry);
      return;
    }

    if (approval.kind === 'pdf_document') {
      resolve({
        title: approval.request.title,
        success: false,
        error: 'PDF generation rejected by user',
      } satisfies PdfDocumentToolResultEntry);
      return;
    }

    if (approval.kind === 'workbook_document') {
      resolve({
        title: approval.request.title,
        success: false,
        error: 'Excel workbook generation rejected by user',
      } satisfies WorkbookDocumentToolResultEntry);
      return;
    }

    if (approval.kind === 'word_document') {
      resolve({
        title: approval.request.title,
        success: false,
        error: 'Word document generation rejected by user',
      } satisfies WordDocumentToolResultEntry);
      return;
    }

    if (approval.kind === 'csv_document') {
      resolve({
        title: approval.request.title,
        success: false,
        error: 'CSV export rejected by user',
      } satisfies CsvDocumentToolResultEntry);
      return;
    }

    if (approval.kind === 'email_document') {
      resolve({
        title: approval.request.title || approval.request.subject || 'Generated Email',
        success: false,
        error: 'Email draft rejected by user',
      } satisfies EmailDocumentToolResultEntry);
      return;
    }

    if (approval.kind === 'markdown_document') {
      resolve({
        title: approval.request.title || 'Generated Markdown Document',
        success: false,
        error: 'Markdown document generation rejected by user',
      } satisfies MarkdownDocumentToolResultEntry);
      return;
    }

    if (approval.kind === 'slides_document') {
      resolve({
        title: approval.request.title || 'Generated Slides',
        success: false,
        error: 'Slide deck generation rejected by user',
      } satisfies SlidesDocumentToolResultEntry);
      return;
    }

    if (approval.kind === 'archive_document') {
      resolve({
        title: approval.request.title || 'Generated Archive',
        success: false,
        error: 'Archive generation rejected by user',
      } satisfies ArchiveDocumentToolResultEntry);
      return;
    }

    if (approval.kind === 'calendar_document') {
      resolve({
        title: approval.request.title || 'Generated Calendar Event',
        success: false,
        error: 'Calendar event generation rejected by user',
      } satisfies CalendarDocumentToolResultEntry);
      return;
    }

    if (approval.kind === 'mermaid_document') {
      resolve({
        title: approval.request.title || 'Generated Diagram',
        success: false,
        error: 'Diagram generation rejected by user',
      } satisfies MermaidDocumentToolResultEntry);
      return;
    }

    resolve({
      action: approval.request.action,
      currentUrl: '',
      title: '',
      text: '',
      links: [],
      forms: [],
      success: false,
      error: 'Browser action rejected by user',
    } satisfies BrowserToolResultEntry);
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (isStreaming && currentSessionId === sessionId) {
      setSelectedSessionInfo('Stop the current WorkSpaces run before deleting this task thread.');
      setSessionMenuOpen(null);
      return;
    }
    if (!confirm('Delete this WorkSpaces session?')) return;
    await fetch('/api/chats', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sessionId }),
    });
    setSessions(prev => sanitizeOpenClawSessions(prev).filter(session => session?.id !== sessionId));
    setSelectedSessionIds(prev => prev.filter(id => id !== sessionId));
    setTaskStates(current => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    if (currentSessionId === sessionId) handleNewSession();
    setSessionMenuOpen(null);
  };

  const handlePinSession = async (sessionId: string, pinned: boolean) => {
    await fetch('/api/chats', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sessionId, pinned: !pinned, surface: 'openclaw' }),
    });
    setSessions(prev => {
      const updated = sanitizeOpenClawSessions(prev).map(session => session?.id === sessionId ? { ...session, pinned: !pinned } : session);
      return [...updated.filter(session => session?.pinned), ...updated.filter(session => !session?.pinned)];
    });
    setSessionMenuOpen(null);
  };

  const handleRenameSession = async (sessionId: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    await fetch('/api/chats', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sessionId, title: trimmed, surface: 'openclaw' }),
    });
    setSessions(prev => sanitizeOpenClawSessions(prev).map(session => session?.id === sessionId ? { ...session, title: trimmed } : session));
    if (currentSessionId === sessionId) {
      setSelectedSessionInfo(`${trimmed} · updated ${formatTimestamp(Date.now())}`);
    }
    setRenamingSessionId(null);
    setRenameValue('');
    setSessionMenuOpen(null);
  };

  const handleCopySession = async (session: OpenClawSession) => {
    const text = sanitizeOpenClawMessages(session.messages)
      .filter(messageItem => messageItem?.role !== 'system')
      .map(messageItem => {
        const attachments = messageItem.attachments?.length
          ? `\nFiles: ${messageItem.attachments.map(attachment => attachment.name).join(', ')}`
          : '';
        const images = messageItem.images?.length ? `\nImages: ${messageItem.images.length}` : '';
        return `${messageItem.role === 'user' ? 'You' : 'AI'}: ${messageItem.content}${attachments}${images}`;
      })
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setSelectedSessionInfo(`Copied "${session.title}" to clipboard.`);
    } catch {
      setSelectedSessionInfo(`Could not copy "${session.title}" to clipboard.`);
    }
    setSessionMenuOpen(null);
  };

  const handleCopyMessage = async (message: OpenClawMessage) => {
    const text = message.content || '';
    try {
      await navigator.clipboard.writeText(text);
      setSelectedSessionInfo('Copied message to clipboard.');
    } catch {
      setSelectedSessionInfo('Could not copy message to clipboard.');
    }
  };

  const handleBranchFromMessage = async (messageId?: string, branchLabel?: string, sessionIdOverride?: string) => {
    if (!settings?.openClawSessionBranchingEnabled) {
      setSelectedSessionInfo('Session branching is disabled in Settings.');
      return;
    }
    const targetSessionId = sessionIdOverride || currentSessionId;
    if (!targetSessionId) {
      setSelectedSessionInfo('Save this WorkSpaces thread first before branching it.');
      return;
    }
    if (isStreaming) {
      setSelectedSessionInfo('Stop the current WorkSpaces run before creating a branch.');
      return;
    }

    try {
      const res = await fetch(`/api/chats/${targetSessionId}/branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId,
          branchLabel,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to create session branch');
      }

      const branchedSession = normalizeOpenClawSession(data.session);
      if (!branchedSession) {
        throw new Error('Failed to normalize branched session');
      }

      updateSessionRecord(branchedSession);
      switchSession(branchedSession);
      setSelectedSessionInfo(`Created branch "${branchedSession.title}".`);
      setBranchCompareLeftId(branchedSession.id);
      setBranchCompareRightId(targetSessionId);
    } catch (error) {
      console.error('Failed to branch WorkSpaces session:', error);
      setSelectedSessionInfo(error instanceof Error ? error.message : 'Failed to create WorkSpaces branch.');
    }
  };

  const openBranchCompare = (leftId?: string, rightId?: string) => {
    if (!settings?.openClawSessionBranchingEnabled) {
      setSelectedSessionInfo('Branch comparison is disabled in Settings.');
      return;
    }
    const nextLeftId = leftId || currentSessionId || '';
    const nextRightId = rightId || '';
    setBranchCompareLeftId(nextLeftId);
    setBranchCompareRightId(nextRightId && nextRightId !== nextLeftId ? nextRightId : '');
    setBranchCompareOpen(true);
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
        body: JSON.stringify({ id: sessionId, folderId, surface: 'openclaw' }),
      });
      if (res.ok) {
        await Promise.all([loadSessions(), loadFolders()]);
      }
    } catch (error) {
      console.error('Failed to update WorkSpaces folder:', error);
    }
  };

  const handleAddTagToSession = async (sessionId: string, tagId: string) => {
    try {
      await fetch(`/api/sessions/${sessionId}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagId }),
      });
      await Promise.all([loadSessions(), loadChatTags()]);
    } catch (error) {
      console.error('Failed to add WorkSpaces tag:', error);
    }
  };

  const handleRemoveTagFromSession = async (sessionId: string, tagId: string) => {
    try {
      await fetch(`/api/sessions/${sessionId}/tags?tagId=${tagId}`, {
        method: 'DELETE',
      });
      await Promise.all([loadSessions(), loadChatTags()]);
    } catch (error) {
      console.error('Failed to remove WorkSpaces tag:', error);
    }
  };

  const toggleSessionSelection = (sessionId: string) => {
    setSelectedSessionIds(current =>
      current.includes(sessionId)
        ? current.filter(id => id !== sessionId)
        : [...current, sessionId],
    );
  };

  const handleClearSelectedSessions = async () => {
    const safeSessions = sanitizeOpenClawSessions(sessions);
    const ids = selectedSessionIds.filter(id => safeSessions.some(session => session?.id === id));
    if (ids.length === 0) return;
    if (isStreaming && currentSessionId && ids.includes(currentSessionId)) {
      setSelectedSessionInfo('Stop the current WorkSpaces run before deleting the active task thread.');
      return;
    }
    if (!confirm(`Delete ${ids.length} selected WorkSpaces ${ids.length === 1 ? 'session' : 'sessions'}?`)) return;
    await fetch('/api/chats', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    setSessions(prev => sanitizeOpenClawSessions(prev).filter(session => !ids.includes(session.id)));
    setTaskStates(current => {
      const next = { ...current };
      for (const id of ids) {
        delete next[id];
      }
      return next;
    });
    setSelectedSessionIds([]);
    setSessionSelectionMode(false);
    if (currentSessionId && ids.includes(currentSessionId)) {
      handleNewSession();
    }
  };

  const handleClearAllSessions = async () => {
    if (isStreaming) {
      setSelectedSessionInfo('Stop the current WorkSpaces run before clearing all task threads.');
      return;
    }
    if (!sessions.length) return;
    if (!confirm(`Delete all ${sessions.length} WorkSpaces task threads? This cannot be undone.`)) return;
    await fetch('/api/chats', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surface: 'openclaw' }),
    });
    setSessions([]);
    setSelectedSessionIds([]);
    setSessionSelectionMode(false);
    setTaskStates(current => {
      const next = { ...current };
      for (const session of sessions) {
        delete next[session.id];
      }
      return next;
    });
    handleNewSession();
  };


  // Attachment helpers
  const readAsBase64Fn = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1] || '';
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const getAttachmentContent = (attachment: OpenClawFileAttachment) =>
    attachment.text ?? attachment.content ?? '';
  const getAttachmentSize = (attachment: OpenClawFileAttachment) =>
    typeof attachment.size === 'number' ? attachment.size : 0;

  const extractAttachment = async (file: File): Promise<OpenClawFileAttachment> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/files/extract', { method: 'POST', body: formData });
    const data = await res.json() as (ExtractedFilePayload & { error?: string });
    if (!res.ok || data.error) {
      throw new Error(data.error || `Extraction failed (${res.status})`);
    }
    return {
      name: data.name,
      type: data.type,
      size: data.size,
      extension: data.extension,
      kind: data.kind,
      text: data.text,
      content: data.text,
      textCharCount: data.textCharCount,
      truncated: data.truncated,
      extractionStatus: data.extractionStatus,
      modelInput: data.modelInput,
      statusMessage: data.statusMessage,
      ...(data.ocrText ? { ocrText: data.ocrText, ocrTextCharCount: data.ocrTextCharCount } : {}),
      ...(data.nativeImageData
        ? {
            nativeImageData: data.nativeImageData,
            nativeImageType: data.nativeImageType,
            nativeImageName: data.nativeImageName,
          }
        : {}),
      ...(data.pageImages && data.pageImages.length > 0
        ? {
            pageImages: data.pageImages,
            pageImageCount: data.pageImageCount ?? data.pageImages.length,
            ...(data.pageImagesTruncated ? { pageImagesTruncated: true } : {}),
          }
        : {}),
    };
  };

  const buildAttachmentContext = (attachments: OpenClawFileAttachment[] = [], images: OpenClawImageAttachment[] = [], userText = '') => {
    const imageContext = images.map((image, idx) => {
      const lines = [
        `[Attached image ${idx + 1}: ${image.name}]`,
        `MIME: ${image.type || 'image/*'}`,
        `Size: ${formatBytes(image.size)}`,
        `Attachment mode: ${getImageAttachmentSummary(image.attachmentMode, Boolean(image.ocrText?.trim()))}`,
      ];

      if (image.attachmentMode !== 'ocr-only') {
        lines.push(`Model input: image bytes (${image.type || 'image/*'})`);
      }

      if (image.attachmentMode !== 'vision-only') {
        if (image.ocrText?.trim()) {
          lines.push('', 'OCR extract:', image.ocrText.trim());
        } else {
          lines.push('', 'OCR extract: No OCR text was found for this image.');
        }
      }

      return lines.join('\n');
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
      const pageCount = attachment.pageImageCount ?? attachment.pageImages?.length ?? 0;
      if (pageCount > 0) {
        lines.push(modelSupportsVision
          ? `Vision input: ${pageCount} rendered page image${pageCount === 1 ? '' : 's'} attached so you can read this document visually${attachment.pageImagesTruncated ? ' (remaining pages are provided as text only)' : ''}.`
          : `Vision input: ${pageCount} page image${pageCount === 1 ? '' : 's'} available, but the selected model is text-only — only the extracted text below is sent.`);
      }
      const attachmentText = getAttachmentContent(attachment);
      if (attachmentText.trim()) lines.push('', attachmentText);
      return lines.join('\n');
    });

    return [...imageContext, ...fileContext, userText.trim()].filter(Boolean).join('\n\n');
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setAttachmentError(null);
    setProcessingAttachments(true);
    try {
      const nextImages: OpenClawImageAttachment[] = [];
      const nextAttachments: OpenClawFileAttachment[] = [];

      for (const file of files) {
        if (file.size > MAX_UPLOAD_BYTES) {
          setAttachmentError(`"${file.name}" is too large. Files are limited to ${MAX_UPLOAD_LABEL}.`);
          break;
        }
        if (isImageFile(file.name, file.type)) {
          const mimeType = normalizeImageMimeType(file.name, file.type || 'application/octet-stream');
          const [b64, imageExtraction] = await Promise.all([
            readAsBase64Fn(file),
            extractAttachment(file),
          ]);
          const imageData = imageExtraction.nativeImageData || b64;
          const imageType = imageExtraction.nativeImageType || mimeType;
          const previewUrl = imageExtraction.nativeImageData
            ? `data:${imageType};base64,${imageData}`
            : URL.createObjectURL(file);
          nextImages.push({
            name: imageExtraction.nativeImageName || file.name,
            type: imageType,
            size: file.size,
            data: imageData,
            previewUrl,
            attachmentMode: imageExtraction.ocrText?.trim() ? 'vision+ocr' : 'vision-only',
            ocrText: imageExtraction.ocrText,
            ocrTextCharCount: imageExtraction.ocrTextCharCount,
            statusMessage: imageExtraction.statusMessage,
          });
        } else {
          const attachment = await extractAttachment(file);
          nextAttachments.push(attachment);
        }
      }

      setPendingImages(current => [...current, ...nextImages]);
      setPendingAttachments(current => [...current, ...nextAttachments]);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'Could not process attachment');
    } finally {
      setProcessingAttachments(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removePendingImage = (index: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index));
  };

  const updatePendingImageMode = (index: number, attachmentMode: ImageAttachmentMode) => {
    setPendingImages(prev => prev.map((image, currentIndex) => (
      currentIndex === index ? { ...image, attachmentMode } : image
    )));
  };

  const removePendingAttachment = (index: number) => {
    setPendingAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const updateChatMessage = (messageId: string, updater: (message: OpenClawMessage) => OpenClawMessage) => {
    setChatHistory(prev => sanitizeOpenClawMessages(prev).map(message => (
      message?.id === messageId ? updater(message) : message
    )));
  };


  // Smooth character-drip streaming for ChatGPT-like typing feel
  const DRIP_CHUNK_SIZE = 3;
  const DRIP_INTERVAL_MS = 16;
  const contentQueues = new Map<string, { content: string; thinking: string }>();
  let sourcesQueue: { id: string; sources: MessageSource[] } | null = null;
  let dripTimer: ReturnType<typeof setInterval> | null = null;
  let ocStreamingDone = false;

  const flushAll = () => {
    for (const [id, queue] of contentQueues) {
      if (queue.content || queue.thinking) {
        const contentSnapshot = queue.content;
        const thinkingSnapshot = queue.thinking;
        queue.content = '';
        queue.thinking = '';
        setChatHistory(prev => {
          const next = sanitizeOpenClawMessages(prev);
          const idx = next.findIndex(m => m?.id === id);
          if (idx !== -1) {
            next[idx] = {
              ...next[idx],
              ...(contentSnapshot ? { content: next[idx].content + contentSnapshot } : {}),
              ...(thinkingSnapshot ? { thinking: (next[idx].thinking || '') + thinkingSnapshot } : {}),
            };
          }
          return next;
        });
      }
    }
    if (sourcesQueue) {
      const queuedSources = sourcesQueue;
      sourcesQueue = null;
      setChatHistory(prev => {
        const next = sanitizeOpenClawMessages(prev);
        const idx = next.findIndex(m => m?.id === queuedSources.id);
        if (idx !== -1) {
          next[idx] = { ...next[idx], sources: queuedSources.sources };
        }
        return next;
      });
    }
  };

  const startDrip = () => {
    if (dripTimer) return;
    dripTimer = setInterval(() => {
      try {
        let hasWork = false;
        for (const [, queue] of contentQueues) {
          if (queue.content || queue.thinking) { hasWork = true; break; }
        }
        if (!hasWork && !sourcesQueue) {
          if (ocStreamingDone) { clearInterval(dripTimer!); dripTimer = null; }
          return;
        }
        for (const [id, queue] of contentQueues) {
          const contentChunk = queue.content.slice(0, DRIP_CHUNK_SIZE);
          const thinkingChunk = queue.thinking.slice(0, DRIP_CHUNK_SIZE);
          if (contentChunk) queue.content = queue.content.slice(contentChunk.length);
          if (thinkingChunk) queue.thinking = queue.thinking.slice(thinkingChunk.length);
          if (contentChunk || thinkingChunk) {
            setChatHistory(prev => {
              const next = sanitizeOpenClawMessages(prev);
              const idx = next.findIndex(m => m?.id === id);
              if (idx !== -1) {
                next[idx] = {
                  ...next[idx],
                  ...(contentChunk ? { content: next[idx].content + contentChunk } : {}),
                  ...(thinkingChunk ? { thinking: (next[idx].thinking || '') + thinkingChunk } : {}),
                };
              }
              return next;
            });
          }
        }
        if (sourcesQueue) {
          const queuedSources = sourcesQueue;
          sourcesQueue = null;
          setChatHistory(prev => {
            const next = sanitizeOpenClawMessages(prev);
            const idx = next.findIndex(m => m?.id === queuedSources.id);
            if (idx !== -1) {
              next[idx] = { ...next[idx], sources: queuedSources.sources };
            }
            return next;
          });
        }
      } catch (error) {
        reportClientError(error, {
          source: 'openclaw.stream.drip',
          extra: {
            pendingQueues: contentQueues.size,
            hasSourcesQueue: Boolean(sourcesQueue),
            streamingDone: ocStreamingDone,
          },
        });
        if (dripTimer) {
          clearInterval(dripTimer);
          dripTimer = null;
        }
        flushAll();
      }
    }, DRIP_INTERVAL_MS);
  };

  const scheduleUpdate = (id: string, update: { thinking?: string; content?: string; sources?: MessageSource[] }) => {
    if (!contentQueues.has(id)) contentQueues.set(id, { content: '', thinking: '' });
    const queue = contentQueues.get(id)!;
    if (update.content) queue.content += update.content;
    if (update.thinking) queue.thinking += update.thinking;
    if (update.sources) sourcesQueue = { id, sources: update.sources };
    startDrip();
  };

  const streamAssistantResponse = async (options: {
    assistantMessageId: string;
    conversationMessages: OpenClawMessage[];
    chatId: string;
    prompt: string;
    ragEnabledForTurn: boolean;
    ragQuery: string;
    ragTopK: number;
    responsePresentation: ResponsePresentation;
    internetEnabledForTurn: boolean;
    internetToolEnabledForTurn: boolean;
    initialSources: MessageSource[];
  }): Promise<{ assistantMessage: OpenClawMessage; activeSources: MessageSource[] }> => {
    startTimeRef.current = Date.now();
    tokenCountRef.current = 0;
    setLiveStats({ tps: 0, tokens: 0 });
    setStreamPhase('connecting');

    let activeSources = [...options.initialSources];
    let assistantContent = '';
    let assistantThinking = '';
    let ocWasInsideToolTag = false;
    let finalMeta: OpenClawMessage['meta'] | undefined;
    let latestTimings: OpenClawLatencyTimings | undefined;

    if (activeSources.length > 0) {
      updateChatMessage(options.assistantMessageId, current => ({
        ...current,
        sources: activeSources,
      }));
    }

    const response = await fetch('/api/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abortControllerRef.current?.signal,
      body: JSON.stringify({
        model: selectedModel,
        chat_id: options.chatId,
        session_id: 'openclaw',
        id: options.assistantMessageId,
        workspace_id: currentWorkspace?.id,
        surface: 'openclaw',
        provider,
        base_url: provider === 'openai-compatible' ? baseUrl : settings?.ollamaHost,
        api_key: apiKey,
        response_presentation: options.responsePresentation,
        internet_enabled: options.internetEnabledForTurn,
        internet_tool_enabled: options.internetToolEnabledForTurn,
        rag_enabled: options.ragEnabledForTurn,
        rag_query: options.ragEnabledForTurn ? options.ragQuery : undefined,
        rag_topk: options.ragTopK,
        unrestricted: unrestrictedEnabled,
        uncensored: uncensoredEnabled,
        messages: options.conversationMessages.map(message => {
          const displayImages = (message.images ?? []).map(img => ({
            data: img.data,
            mimeType: img.type,
            name: img.name,
          }));
          // Send rendered document pages as native image input, but only to
          // vision-capable models. Text-only models already receive the
          // extracted text via the attachment context.
          const documentPageImages = modelSupportsVision
            ? (message.attachments ?? []).flatMap(attachment =>
                (attachment.pageImages ?? []).map(page => ({
                  data: page.data,
                  mimeType: page.type,
                  name: `${attachment.name} · ${page.name}`,
                })),
              )
            : [];
          const images = [...displayImages, ...documentPageImages];
          return {
            role: message.role,
            content: message.content,
            ...(images.length > 0 ? { images } : {}),
          };
        }),
      }),
    });

    if (!response.ok) {
      let errMessage = 'Error connecting to the selected model.';
      try {
        const errData = await response.json();
        if (errData.error) errMessage = errData.error;
      } catch {
        // Ignore JSON parse failures.
      }
      throw new Error(errMessage);
    }

    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let streamBuffer = '';

    const processStreamLine = (line: string) => {
      let data: OpenClawStreamFrame | null = null;

      try {
        data = JSON.parse(line) as OpenClawStreamFrame;
      } catch {
        return;
      }

      if (!data) return;

      if (typeof data.error === 'string' && data.error.trim()) {
        throw new Error(data.error);
      }

      if (isServerStreamStatus(data.status)) {
        setStreamPhase(data.status);
      }

      const frameTimings = normalizeLatencyTimings(data.timings);
      if (frameTimings) {
        latestTimings = frameTimings;
        if (finalMeta) {
          finalMeta = { ...finalMeta, timings: latestTimings };
          updateChatMessage(options.assistantMessageId, current => ({
            ...current,
            meta: finalMeta,
          }));
        }
      }

      if (Array.isArray(data.sources)) {
        activeSources = mergeMessageSources(activeSources, normalizeToolSources(data.sources));
        scheduleUpdate(options.assistantMessageId, { sources: activeSources });
      }

      if (Array.isArray(data.knowledge_sources)) {
        activeSources = mergeMessageSources(activeSources, normalizeToolSources(data.knowledge_sources));
        scheduleUpdate(options.assistantMessageId, { sources: activeSources });
      }

      const messageFrame = data.message;
      if (messageFrame) {
        if (typeof messageFrame.thinking === 'string' && messageFrame.thinking) {
          assistantThinking += messageFrame.thinking;
          tokenCountRef.current += 1;
          scheduleUpdate(options.assistantMessageId, { thinking: messageFrame.thinking });
        }

        if (typeof messageFrame.content === 'string' && messageFrame.content) {
          assistantContent += messageFrame.content;
          tokenCountRef.current += 1;
          // Suppress <openclaw_tool> tags from the display drip.
          // After streaming completes, extractOpenClawToolRequest will
          // clean the content and updateChatMessage will replace it.
          // Only drip content that is outside of tool tags.
          const toolTagOpen = assistantContent.lastIndexOf('<openclaw_tool');
          const toolTagClose = assistantContent.lastIndexOf('</openclaw_tool>');
          const insideToolTag = toolTagOpen !== -1 && (toolTagClose === -1 || toolTagOpen > toolTagClose);
          // Also skip the chunk that closes a tool tag — it may contain closing
          // tag text mixed with post-tag content. The post-stream extraction
          // will replace the entire message with cleaned content.
          const justClosedToolTag = ocWasInsideToolTag && !insideToolTag;
          if (!insideToolTag && !justClosedToolTag) {
            scheduleUpdate(options.assistantMessageId, { content: messageFrame.content });
          }
          ocWasInsideToolTag = insideToolTag;
        }
      }

      if (data.done) {
        const tokens = typeof data.eval_count === 'number' ? data.eval_count : tokenCountRef.current;
        const durationSec = typeof data.eval_duration === 'number'
          ? data.eval_duration / 1e9
          : Math.max((Date.now() - startTimeRef.current) / 1000, 0.001);
        const tps = tokens > 0 ? tokens / durationSec : 0;
        finalMeta = { tokens, duration: durationSec, tps, timings: latestTimings };
        updateChatMessage(options.assistantMessageId, current => ({
          ...current,
          meta: finalMeta,
        }));
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
    if (finalLine) processStreamLine(finalLine);

    return {
      assistantMessage: {
        id: options.assistantMessageId,
        role: 'assistant',
        content: assistantContent,
        ...(assistantThinking ? { thinking: assistantThinking } : {}),
        ...(finalMeta ? { meta: finalMeta } : {}),
        ...(activeSources.length > 0 ? { sources: activeSources } : {}),
        presentation: options.responsePresentation,
        createdAt: new Date().toISOString(),
      },
      activeSources,
    };
  };

  const handleSendMessage = async (draftPrompt = message, draftInternetEnabled = internetEnabled) => {
    const prompt = draftPrompt.trim();
    if ((!prompt && pendingImages.length === 0 && pendingAttachments.length === 0) || isStreaming || !selectedModel || !settings) return;

    // Reset auto-continue counter on new user-initiated messages (not auto-continues)
    if (prompt !== 'continue') {
      autoContinueCountRef.current = 0;
    }

    const chatId = currentSessionId ?? randomUUID();
    const existingObjective = taskState.objective.trim();
    const promptIsLowSignal = isLowSignalWorkspacePrompt(prompt);
    const objectiveIsLowSignal = isLowSignalWorkspacePrompt(existingObjective);
    const effectiveObjective = existingObjective && !objectiveIsLowSignal
      ? existingObjective
      : promptIsLowSignal
        ? ''
        : prompt;
    const effectiveTaskState = {
      ...taskState,
      objective: effectiveObjective,
      currentStatus: taskState.currentStatus.trim() || (effectiveObjective ? 'Task captured. Waiting for the next workspace update.' : ''),
      nextStep: taskState.nextStep.trim() || (effectiveObjective ? 'Review the assistant output and update the pinned checklist.' : ''),
    };
    const messageImages = pendingImages.filter(image => image.attachmentMode !== 'ocr-only');
    const contextImages = [...pendingImages];
    const messageAttachments = [...pendingAttachments];
    const attachmentContext = buildAttachmentContext(messageAttachments, contextImages, prompt);
    const rawRagQueryText = (attachmentContext || prompt).slice(0, 2000);
    const ragQueryText = ragFolderPath
      ? `folder:${ragFolderPath} ${rawRagQueryText}`.trim().slice(0, 2000)
      : rawRagQueryText;
    const userMessage: OpenClawMessage = {
      id: randomUUID(),
      role: 'user',
      content: attachmentContext || prompt,
      images: messageImages,
      attachments: messageAttachments,
      createdAt: new Date().toISOString(),
    };
    const assistantMessageId = randomUUID();
    const baseHistory = [...chatHistory, userMessage];
    // WorkSpaces is an agentic workspace — responses naturally mix text, code, tables,
    // and tool outputs. Forcing a specific presentation mode (like 'code') based on
    // keywords in the prompt breaks mixed-content rendering and tells the model to
    // "return only code" when it should explain results. Always use 'general' mode.
    const responsePresentation: ResponsePresentation = { mode: 'general' };

    pinToBottom();
    setMessage('');
    setPendingImages([]);
    setPendingAttachments([]);
    setModelControlNote('');
    setLastSubmission({
      prompt,
      internetEnabled: draftInternetEnabled,
    });
    setTaskStates(current => {
      const next = { ...current };
      next[chatId] = effectiveTaskState;
      if (!currentSessionId) delete next[OPENCLAW_DRAFT_TASK_ID];
      return next;
    });
    setChatHistory([
      ...baseHistory,
      { id: assistantMessageId, role: 'assistant', content: '', createdAt: new Date().toISOString() },
    ]);
    setCurrentSessionId(chatId);
    setIsStreaming(true);
    setStreamPhase(ragEnabled && Boolean(ragQueryText.trim()) ? 'preparing-context' : 'connecting');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    startTimeRef.current = Date.now();
    tokenCountRef.current = 0;
    setLiveStats({ tps: 0, tokens: 0 });

    const intervalId = window.setInterval(() => {
      const elapsedSec = (Date.now() - startTimeRef.current) / 1000;
      if (elapsedSec > 0.1) {
        setLiveStats({
          tps: tokenCountRef.current / elapsedSec,
          tokens: tokenCountRef.current,
        });
      }
    }, 500);

    let finalAssistantMessage: OpenClawMessage | null = null;

    // Persist the RAG draft on the pre-stream save so reopened WorkSpaces
    // threads re-hydrate the composer with the last search text. The actual
    // citation set is captured below by the /api/chat/completed finalize call
    // after streaming finishes.
    const ragSnapshot = {
      ragEnabled: ragEnabled && Boolean(ragQueryText.trim()),
      ragQuery: ragEnabled && Boolean(ragQueryText.trim()) ? ragQueryText : null,
      ragSources: [] as MessageSource[],
    };

    try {
      const sessionSavePromise = createSession(baseHistory, chatId, ragSnapshot).catch(error => {
        console.error('Failed to persist WorkSpaces session before streaming:', error);
        return null;
      });
      if (controller.signal.aborted) return;

      const contextMessages: OpenClawMessage[] = [];
      let activeSources: MessageSource[] = [];
      const workspaceBrief = buildOpenClawWorkspaceBrief(agentPreferences);
      const taskStateBrief = buildOpenClawTaskStateBrief(effectiveTaskState);
      if (workspaceBrief) {
        contextMessages.push({
          id: randomUUID(),
          role: 'system',
          content: workspaceBrief,
          hidden: true,
        });
      }
      if (taskStateBrief) {
        contextMessages.push({
          id: randomUUID(),
          role: 'system',
          content: taskStateBrief,
          hidden: true,
        });
      }
      if (memoryContext) {
        contextMessages.push({
          id: randomUUID(),
          role: 'system',
          content: `Recent memory context (auto-loaded from previous sessions):\n\n${memoryContext}`,
          hidden: true,
        });
      }

      if (activeSources.length > 0) {
        updateChatMessage(assistantMessageId, current => ({
          ...current,
          sources: activeSources,
        }));
      }

      let sessionHistory = [...baseHistory];
      let currentSources = [...activeSources];
      let nextAssistantId = assistantMessageId;
      let lastToolRequestSignature: string | null = null;
      let duplicateToolRequestCount = 0;
      let missingToolNudgeCount = 0;
      // Budget tracking. We only count rounds where a real tool actually ran
      // toward the productive limit, so recovery nudges and duplicate notices
      // no longer burn the budget and cut a task short. MAX_TOOL_LOOP_ITERATIONS
      // is just a hard safety ceiling against infinite loops.
      const MAX_TOOL_ROUNDS = 12;
      const MAX_TOOL_LOOP_ITERATIONS = 40;
      let executedToolRounds = 0;

      for (let toolRound = 0; toolRound < MAX_TOOL_LOOP_ITERATIONS; toolRound += 1) {
        if (toolRound > 0) {
          nextAssistantId = randomUUID();
          setChatHistory(prev => [
            ...prev,
            {
              id: nextAssistantId,
              role: 'assistant',
              content: '',
              createdAt: new Date().toISOString(),
              ...(currentSources.length > 0 ? { sources: currentSources } : {}),
            },
          ]);
        }

        const { assistantMessage, activeSources: roundSources } = await streamAssistantResponse({
          assistantMessageId: nextAssistantId,
          conversationMessages: [...contextMessages, ...sessionHistory],
          chatId,
          prompt,
          ragEnabledForTurn: toolRound === 0 ? ragEnabled : false,
          ragQuery: ragQueryText,
          ragTopK: settings.ragTopK,
          responsePresentation,
          internetEnabledForTurn: false,
          internetToolEnabledForTurn: draftInternetEnabled,
          initialSources: currentSources,
        });

        currentSources = roundSources;
      const rawToolTagPresent = assistantMessage.content.includes('<openclaw_tool');
      const { cleanedContent, request } = extractOpenClawToolRequest(assistantMessage.content);
      const inferredFilesystemRequest = request?.name === 'shell' && filesystemEnabled
        ? inferFilesystemRequestFromShellCommand(request.request.command, allowedFilesystemPaths)
        : null;
      if (rawToolTagPresent && !request) {
        reportClientError(new Error('WorkSpaces emitted an invalid tool block'), {
          source: 'openclaw.tool-request.parse',
          extra: {
            assistantMessageId: nextAssistantId,
            rawContent: assistantMessage.content,
            cleanedContent,
          },
        });
      }
      const normalizedAssistant: OpenClawMessage = {
        ...assistantMessage,
        hidden: Boolean(request) || rawToolTagPresent,
        sources: request ? undefined : currentSources.length > 0 ? currentSources : undefined,
        toolRequest: request
          ? inferredFilesystemRequest
              ? 'filesystem'
              : request.name
          : undefined,
        content: cleanedContent || (
            request
              ? inferredFilesystemRequest
                ? describeFilesystemRequest(inferredFilesystemRequest.action, inferredFilesystemRequest.path)
                : request.name === 'shell'
                  ? describeShellRequest(request.request.command, request.request.description)
                  : request.name === 'web'
                    ? describeWebResearchRequest(request.request.query, request.request.description)
                    : request.name === 'code'
                      ? describeCodeExecutionRequest(request.request)
                      : request.name === 'browser'
                        ? describeBrowserRequest(request.request)
                        : request.name === 'unified_browser'
                          ? describeUwafBrowserRequest(request.request)
                          : request.name === 'tax_return'
                            ? describeTaxReturnRequest(request.request)
                            : request.name === 'pdf_document'
                              ? describePdfDocumentRequest(request.request)
                              : request.name === 'workbook_document'
                                ? describeWorkbookDocumentRequest(request.request)
                                : request.name === 'word_document'
                                  ? describeWordDocumentRequest(request.request)
                                  : request.name === 'csv_document'
                                    ? describeCsvDocumentRequest(request.request)
                                    : request.name === 'email_document'
                                      ? describeEmailDocumentRequest(request.request)
                                      : request.name === 'fetch_summarize'
                                        ? describeFetchSummarizeRequest(request.request)
                                        : request.name === 'markdown_document'
                                          ? describeMarkdownDocumentRequest(request.request)
                                          : request.name === 'slides_document'
                                            ? describeSlidesDocumentRequest(request.request)
                                            : request.name === 'archive_document'
                                              ? describeArchiveDocumentRequest(request.request)
                                              : request.name === 'calendar_document'
                                                ? describeCalendarDocumentRequest(request.request)
                                                : request.name === 'mermaid_document'
                                                  ? describeMermaidDocumentRequest(request.request)
                                                  : describeFilesystemRequest(request.request.action, request.request.path)
              : rawToolTagPresent
                ? stripAllToolTags(assistantMessage.content)
                : assistantMessage.content
          ),
      };

        updateChatMessage(nextAssistantId, current => ({
          ...current,
          ...normalizedAssistant,
        }));
        // Clear the drip queue for this message to prevent stale
        // partial content from overwriting the cleaned/normalized version.
        contentQueues.delete(nextAssistantId);

        sessionHistory = [...sessionHistory, normalizedAssistant];
        finalAssistantMessage = normalizedAssistant;

        if (!request) {
          // The model either emitted a malformed/duplicate tool block, or it
          // narrated an imminent tool action and stopped without emitting the
          // block. Both cases stall the loop, so nudge it to recover instead of
          // silently ending the turn (bounded to avoid runaway loops).
          const invalidToolBlock = rawToolTagPresent;
          const promisedToolButStopped = !rawToolTagPresent
            && detectMissingToolIntent(normalizedAssistant.content);

          if (
            (invalidToolBlock || promisedToolButStopped)
            && toolRound < MAX_TOOL_LOOP_ITERATIONS - 1
            && missingToolNudgeCount < 2
            && !controller.signal.aborted
          ) {
            missingToolNudgeCount += 1;
            const recoveryNotice: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: invalidToolBlock
                ? 'Your previous message contained an invalid or duplicate tool block. Emit exactly ONE valid <openclaw_tool> block to continue, or give your final answer in plain text if no tool is needed. Never include more than one tool block in a single message.'
                : 'You described the next action (for example "UWAF Direct: ...") but did not include the tool block, so nothing ran. To actually run it, end your reply with exactly ONE tool block wrapped exactly like:\n<openclaw_tool name="TOOL_NAME">{ ...json args... }</openclaw_tool>\nFor browsing, TOOL_NAME is unified_browser. If no tool is needed, give the user the answer directly instead of only describing what you will do.',
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, recoveryNotice];
            setChatHistory(prev => [...prev, recoveryNotice]);
            setLiveStats(null);
            setStreamPhase(null);
            continue;
          }

          // Recovery nudges are exhausted but the model was clearly mid-action.
          // Surface a clear, visible pause instead of silently ending so the
          // user understands why the run stopped and can resume it.
          if ((invalidToolBlock || promisedToolButStopped) && !controller.signal.aborted) {
            const stallNotice: OpenClawMessage = {
              id: randomUUID(),
              role: 'assistant',
              content: 'I described the next step but couldn\'t emit a clean tool call after a couple of tries, so I paused here instead of looping. Reply "continue" and I\'ll resume from this point.',
              createdAt: new Date().toISOString(),
            };
            setChatHistory(prev => [...prev, stallNotice]);
            sessionHistory = [...sessionHistory, stallNotice];
            finalAssistantMessage = stallNotice;
          }

          lastToolRequestSignature = null;
          break;
        }

        missingToolNudgeCount = 0;
        executedToolRounds += 1;

        // Reached the productive tool-step budget for this turn. Pause cleanly
        // with a visible explanation rather than dropping the last requested
        // tool silently, so the user knows why it stopped and can continue.
        if (executedToolRounds > MAX_TOOL_ROUNDS) {
          const pauseNotice: OpenClawMessage = {
            id: randomUUID(),
            role: 'assistant',
            content: `I've run ${MAX_TOOL_ROUNDS} tool steps on this turn and hit the per-message step limit, so I paused to avoid an endless loop. Reply "continue" and I'll pick up exactly where I left off.`,
            createdAt: new Date().toISOString(),
          };
          setChatHistory(prev => [...prev, pauseNotice]);
          sessionHistory = [...sessionHistory, pauseNotice];
          finalAssistantMessage = pauseNotice;
          lastToolRequestSignature = null;
          break;
        }

        setLiveStats(null);
        setStreamPhase(null);

        const effectiveToolSignature = inferredFilesystemRequest
          ? `filesystem:${inferredFilesystemRequest.action}:${inferredFilesystemRequest.path}`
          : getOpenClawToolRequestSignature(request);

        if (effectiveToolSignature === lastToolRequestSignature) {
          duplicateToolRequestCount += 1;
          const duplicateNotice: OpenClawMessage = {
            id: randomUUID(),
            role: 'user',
            content: inferredFilesystemRequest
              ? 'The previous filesystem result for this exact path was already provided. Do not repeat the same request. Use that result to answer the user or request a different path/action only if new information is needed.'
              : 'The previous tool result for this exact request was already provided. Do not repeat the same request. Use that result to answer the user or choose a different next step only if new information is needed.',
            hidden: true,
            createdAt: new Date().toISOString(),
          };
          sessionHistory = [...sessionHistory, duplicateNotice];
          setChatHistory(prev => [...prev, duplicateNotice]);

          if (duplicateToolRequestCount > 1) {
            break;
          }

          continue;
        }

        if (inferredFilesystemRequest) {
          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          try {
            setStreamPhase('tool-filesystem');
            const filesystemResult = await requestFilesystemAction(
              inferredFilesystemRequest,
              { messageId: nextAssistantId }
            );
            setStreamPhase(null);
            const toolResultMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: formatFilesystemToolResult(filesystemResult),
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, toolResultMessage];
            setChatHistory(prev => [...prev, toolResultMessage]);
          } catch (toolError) {
            setStreamPhase(null);
            console.error('Filesystem tool failed:', toolError);
            const errorMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: `Filesystem operation failed: ${toolError instanceof Error ? toolError.message : String(toolError)}. Try a different approach or path.`,
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, errorMessage];
            setChatHistory(prev => [...prev, errorMessage]);
          }
          continue;
        }

        if (request.name === 'web') {
          if (!draftInternetEnabled) {
            break;
          }

          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          try {
            setStreamPhase('web-search');
            const webResult = await requestWebContext(request.request.query, {
              description: request.request.description,
            });
            setStreamPhase(null);
            if (webResult.sources.length > 0) {
              currentSources = mergeMessageSources(currentSources, webResult.sources);
            }
            const toolResultMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: formatWebToolResult(webResult),
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, toolResultMessage];
            setChatHistory(prev => [...prev, toolResultMessage]);
          } catch (toolError) {
            setStreamPhase(null);
            console.error('Web research tool failed:', toolError);
            const errorMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: `Web research failed: ${toolError instanceof Error ? toolError.message : String(toolError)}. Try rephrasing your search or proceed without web results.`,
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, errorMessage];
            setChatHistory(prev => [...prev, errorMessage]);
          }
          continue;
        }

        if (request.name === 'code') {
          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          try {
            setStreamPhase('tool-code');
            const codeResult = await requestCodeExecution(request.request, {
              messageId: nextAssistantId,
              sessionId: chatId,
            });
            setStreamPhase(null);
            const toolResultMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: formatCodeToolResult(codeResult),
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, toolResultMessage];
            setChatHistory(prev => [...prev, toolResultMessage]);
          } catch (toolError) {
            setStreamPhase(null);
            console.error('Code execution tool failed:', toolError);
            const errorMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: `Code execution failed: ${toolError instanceof Error ? toolError.message : String(toolError)}. The sandbox may have timed out or run out of resources. Try simplifying the code or breaking it into smaller steps.`,
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, errorMessage];
            setChatHistory(prev => [...prev, errorMessage]);
          }
          continue;
        }

        if (request.name === 'browser') {
          if (!draftInternetEnabled) {
            break;
          }
          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          try {
            setStreamPhase('tool-browser');
            const browserResult = await requestBrowserAction(request.request, {
              messageId: nextAssistantId,
              sessionId: chatId,
            });
            setStreamPhase(null);
            const toolResultMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: formatBrowserToolResult(browserResult),
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, toolResultMessage];
            setChatHistory(prev => [...prev, toolResultMessage]);
          } catch (toolError) {
            setStreamPhase(null);
            console.error('Browser tool failed:', toolError);
            const errorMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: `Browser operation failed: ${toolError instanceof Error ? toolError.message : String(toolError)}. The page may be unreachable or the browser session expired. Try a different URL or approach.`,
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, errorMessage];
            setChatHistory(prev => [...prev, errorMessage]);
          }
          continue;
        }

        if (request.name === 'unified_browser') {
          if (!draftInternetEnabled) {
            break;
          }
          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          try {
            setStreamPhase('tool-uwaf-browser');
            const uwafResult = await requestUwafBrowserAction(request.request as OpenClawUwafBrowserToolRequest, {
              messageId: nextAssistantId,
              sessionId: chatId,
            });
            setStreamPhase(null);
            if (uwafResult.currentUrl || uwafResult.title) {
              setUwafCurrentUrl(uwafResult.currentUrl);
              setUwafCurrentTitle(uwafResult.title);
            }
            const toolResultMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: formatUwafBrowserToolResult(uwafResult),
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, toolResultMessage];
            setChatHistory(prev => [...prev, toolResultMessage]);
          } catch (toolError) {
            setStreamPhase(null);
            console.error('UWAF browser tool failed:', toolError);
            const errorMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: `Browser operation failed: ${toolError instanceof Error ? toolError.message : String(toolError)}. The page may be unreachable, the browser session may have expired, or the Tor proxy may be down. Try a different URL, switch browser mode, or use web research instead.`,
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, errorMessage];
            setChatHistory(prev => [...prev, errorMessage]);
          }
          continue;
        }

        if (request.name === 'tax_return') {
          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          try {
            setStreamPhase('tool-code');
            const taxResult = await requestTaxReturnAction(request.request, {
              messageId: nextAssistantId,
              sessionId: chatId,
            });
            setStreamPhase(null);
            if (taxResult.success) {
              void loadCanvasArtifacts(chatId);
            }
            const toolResultMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: formatTaxReturnToolResult(taxResult),
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, toolResultMessage];
            setChatHistory(prev => [...prev, toolResultMessage]);
          } catch (toolError) {
            setStreamPhase(null);
            console.error('Tax return tool failed:', toolError);
            const errorMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: `Tax PDF generation failed: ${toolError instanceof Error ? toolError.message : String(toolError)}. Ask the user to verify the Knowledge Base folder and source documents, then retry.`,
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, errorMessage];
            setChatHistory(prev => [...prev, errorMessage]);
          }
          continue;
        }

        if (request.name === 'pdf_document') {
          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          try {
            setStreamPhase('tool-code');
            const pdfResult = await requestPdfDocumentAction(request.request, {
              messageId: nextAssistantId,
              sessionId: chatId,
            });
            setStreamPhase(null);
            if (pdfResult.success) {
              void loadCanvasArtifacts(chatId);
            }
            const toolResultMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: formatPdfDocumentToolResult(pdfResult),
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, toolResultMessage];
            setChatHistory(prev => [...prev, toolResultMessage]);
          } catch (toolError) {
            setStreamPhase(null);
            console.error('PDF document tool failed:', toolError);
            const errorMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: `PDF generation failed: ${toolError instanceof Error ? toolError.message : String(toolError)}. Try simplifying the document content and retry.`,
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, errorMessage];
            setChatHistory(prev => [...prev, errorMessage]);
          }
          continue;
        }

        if (request.name === 'workbook_document') {
          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          try {
            setStreamPhase('tool-code');
            const workbookResult = await requestWorkbookDocumentAction(request.request, {
              messageId: nextAssistantId,
              sessionId: chatId,
            });
            setStreamPhase(null);
            if (workbookResult.success) {
              void loadCanvasArtifacts(chatId);
            }
            const toolResultMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: formatWorkbookDocumentToolResult(workbookResult),
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, toolResultMessage];
            setChatHistory(prev => [...prev, toolResultMessage]);
          } catch (toolError) {
            setStreamPhase(null);
            console.error('Excel workbook tool failed:', toolError);
            const errorMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: `Excel workbook generation failed: ${toolError instanceof Error ? toolError.message : String(toolError)}. Try simplifying the workbook structure and retry.`,
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, errorMessage];
            setChatHistory(prev => [...prev, errorMessage]);
          }
          continue;
        }

        if (request.name === 'word_document') {
          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          try {
            setStreamPhase('tool-code');
            const wordResult = await requestWordDocumentAction(request.request, {
              messageId: nextAssistantId,
              sessionId: chatId,
            });
            setStreamPhase(null);
            if (wordResult.success) {
              void loadCanvasArtifacts(chatId);
            }
            const toolResultMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: formatWordDocumentToolResult(wordResult),
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, toolResultMessage];
            setChatHistory(prev => [...prev, toolResultMessage]);
          } catch (toolError) {
            setStreamPhase(null);
            console.error('Word document tool failed:', toolError);
            const errorMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: `Word document generation failed: ${toolError instanceof Error ? toolError.message : String(toolError)}. Try simplifying the document structure and retry.`,
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, errorMessage];
            setChatHistory(prev => [...prev, errorMessage]);
          }
          continue;
        }

        if (request.name === 'csv_document') {
          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          try {
            setStreamPhase('tool-code');
            const csvResult = await requestCsvDocumentAction(request.request, {
              messageId: nextAssistantId,
              sessionId: chatId,
            });
            setStreamPhase(null);
            if (csvResult.success) {
              void loadCanvasArtifacts(chatId);
            }
            const toolResultMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: formatCsvDocumentToolResult(csvResult),
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, toolResultMessage];
            setChatHistory(prev => [...prev, toolResultMessage]);
          } catch (toolError) {
            setStreamPhase(null);
            console.error('CSV export tool failed:', toolError);
            const errorMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: `CSV export failed: ${toolError instanceof Error ? toolError.message : String(toolError)}. Check the data structure and retry.`,
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, errorMessage];
            setChatHistory(prev => [...prev, errorMessage]);
          }
          continue;
        }

        if (request.name === 'email_document') {
          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          try {
            setStreamPhase('tool-code');
            const emailResult = await requestEmailDocumentAction(request.request, {
              messageId: nextAssistantId,
              sessionId: chatId,
            });
            setStreamPhase(null);
            if (emailResult.success) {
              void loadCanvasArtifacts(chatId);
            }
            const toolResultMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: formatEmailDocumentToolResult(emailResult),
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, toolResultMessage];
            setChatHistory(prev => [...prev, toolResultMessage]);
          } catch (toolError) {
            setStreamPhase(null);
            console.error('Email writer tool failed:', toolError);
            const errorMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: `Email generation failed: ${toolError instanceof Error ? toolError.message : String(toolError)}. Try again with a clear subject and body.`,
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, errorMessage];
            setChatHistory(prev => [...prev, errorMessage]);
          }
          continue;
        }

        if (request.name === 'fetch_summarize') {
          if (!draftInternetEnabled) {
            break;
          }
          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          try {
            setStreamPhase('web-search');
            const summaryResult = await executeFetchSummarizeAction(request.request);
            setStreamPhase(null);
            const toolResultMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: formatFetchSummarizeToolResult(summaryResult),
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, toolResultMessage];
            setChatHistory(prev => [...prev, toolResultMessage]);
          } catch (toolError) {
            setStreamPhase(null);
            console.error('Fetch summarize tool failed:', toolError);
            const errorMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: `Fetch and summarize failed: ${toolError instanceof Error ? toolError.message : String(toolError)}. The URL may be unreachable or the page may block fetching.`,
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, errorMessage];
            setChatHistory(prev => [...prev, errorMessage]);
          }
          continue;
        }

        if (request.name === 'markdown_document') {
          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          try {
            setStreamPhase('tool-code');
            const markdownResult = await requestMarkdownDocumentAction(request.request, {
              messageId: nextAssistantId,
              sessionId: chatId,
            });
            setStreamPhase(null);
            if (markdownResult.success) {
              void loadCanvasArtifacts(chatId);
            }
            const toolResultMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: formatMarkdownDocumentToolResult(markdownResult),
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, toolResultMessage];
            setChatHistory(prev => [...prev, toolResultMessage]);
          } catch (toolError) {
            setStreamPhase(null);
            console.error('Markdown document tool failed:', toolError);
            const errorMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: `Markdown document generation failed: ${toolError instanceof Error ? toolError.message : String(toolError)}. Try again with a clear title and markdown body.`,
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, errorMessage];
            setChatHistory(prev => [...prev, errorMessage]);
          }
          continue;
        }

        if (request.name === 'slides_document') {
          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          try {
            setStreamPhase('tool-code');
            const slidesResult = await requestSlidesDocumentAction(request.request, {
              messageId: nextAssistantId,
              sessionId: chatId,
            });
            setStreamPhase(null);
            if (slidesResult.success) {
              void loadCanvasArtifacts(chatId);
            }
            const toolResultMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: formatSlidesDocumentToolResult(slidesResult),
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, toolResultMessage];
            setChatHistory(prev => [...prev, toolResultMessage]);
          } catch (toolError) {
            setStreamPhase(null);
            console.error('Slides tool failed:', toolError);
            const errorMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: `Slide deck generation failed: ${toolError instanceof Error ? toolError.message : String(toolError)}.`,
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, errorMessage];
            setChatHistory(prev => [...prev, errorMessage]);
          }
          continue;
        }

        if (request.name === 'archive_document') {
          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          try {
            setStreamPhase('tool-code');
            const archiveResult = await requestArchiveDocumentAction(request.request, {
              messageId: nextAssistantId,
              sessionId: chatId,
            });
            setStreamPhase(null);
            if (archiveResult.success) {
              void loadCanvasArtifacts(chatId);
            }
            const toolResultMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: formatArchiveDocumentToolResult(archiveResult),
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, toolResultMessage];
            setChatHistory(prev => [...prev, toolResultMessage]);
          } catch (toolError) {
            setStreamPhase(null);
            console.error('Archive tool failed:', toolError);
            const errorMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: `Archive generation failed: ${toolError instanceof Error ? toolError.message : String(toolError)}.`,
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, errorMessage];
            setChatHistory(prev => [...prev, errorMessage]);
          }
          continue;
        }

        if (request.name === 'calendar_document') {
          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          try {
            setStreamPhase('tool-code');
            const calendarResult = await requestCalendarDocumentAction(request.request, {
              messageId: nextAssistantId,
              sessionId: chatId,
            });
            setStreamPhase(null);
            if (calendarResult.success) {
              void loadCanvasArtifacts(chatId);
            }
            const toolResultMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: formatCalendarDocumentToolResult(calendarResult),
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, toolResultMessage];
            setChatHistory(prev => [...prev, toolResultMessage]);
          } catch (toolError) {
            setStreamPhase(null);
            console.error('Calendar tool failed:', toolError);
            const errorMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: `Calendar event generation failed: ${toolError instanceof Error ? toolError.message : String(toolError)}.`,
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, errorMessage];
            setChatHistory(prev => [...prev, errorMessage]);
          }
          continue;
        }

        if (request.name === 'mermaid_document') {
          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          try {
            setStreamPhase('tool-code');
            const mermaidResult = await requestMermaidDocumentAction(request.request, {
              messageId: nextAssistantId,
              sessionId: chatId,
            });
            setStreamPhase(null);
            if (mermaidResult.success) {
              void loadCanvasArtifacts(chatId);
            }
            const toolResultMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: formatMermaidDocumentToolResult(mermaidResult),
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, toolResultMessage];
            setChatHistory(prev => [...prev, toolResultMessage]);
          } catch (toolError) {
            setStreamPhase(null);
            console.error('Mermaid tool failed:', toolError);
            const errorMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: `Mermaid diagram generation failed: ${toolError instanceof Error ? toolError.message : String(toolError)}.`,
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, errorMessage];
            setChatHistory(prev => [...prev, errorMessage]);
          }
          continue;
        }

        if (request.name === 'shell') {
          if (!shellEnabled) {
            break;
          }

          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          try {
            setStreamPhase('tool-shell');
            const shellResult = await requestShellCommand(request.request.command, {
              description: request.request.description,
              messageId: nextAssistantId,
            });
            setStreamPhase(null);
            const toolResultMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: formatShellToolResult(shellResult),
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, toolResultMessage];
            setChatHistory(prev => [...prev, toolResultMessage]);
          } catch (toolError) {
            setStreamPhase(null);
            console.error('Shell tool failed:', toolError);
            const errorMessage: OpenClawMessage = {
              id: randomUUID(),
              role: 'user',
              content: `Shell command failed: ${toolError instanceof Error ? toolError.message : String(toolError)}. The command may have timed out or the execution environment is unavailable. Try a simpler command or check connectivity.`,
              hidden: true,
              createdAt: new Date().toISOString(),
            };
            sessionHistory = [...sessionHistory, errorMessage];
            setChatHistory(prev => [...prev, errorMessage]);
          }
          continue;
        }

        lastToolRequestSignature = effectiveToolSignature;
        duplicateToolRequestCount = 0;
        try {
          setStreamPhase('tool-filesystem');
          const filesystemResult = await requestFilesystemAction(request.request, {
            messageId: nextAssistantId,
          });
          setStreamPhase(null);
          const toolResultMessage: OpenClawMessage = {
            id: randomUUID(),
            role: 'user',
            content: formatFilesystemToolResult(filesystemResult),
            hidden: true,
            createdAt: new Date().toISOString(),
          };
          sessionHistory = [...sessionHistory, toolResultMessage];
          setChatHistory(prev => [...prev, toolResultMessage]);
        } catch (toolError) {
          setStreamPhase(null);
          console.error('Filesystem tool failed:', toolError);
          const errorMessage: OpenClawMessage = {
            id: randomUUID(),
            role: 'user',
            content: `Filesystem operation failed: ${toolError instanceof Error ? toolError.message : String(toolError)}. The path may not exist or permissions may be insufficient. Try a different path or action.`,
            hidden: true,
            createdAt: new Date().toISOString(),
          };
          sessionHistory = [...sessionHistory, errorMessage];
          setChatHistory(prev => [...prev, errorMessage]);
        }
      }

      const savedSession = await sessionSavePromise;
      const sessionRecord = savedSession ?? {
        id: chatId,
        title: getChatTitle(baseHistory),
        updatedAt: Date.now(),
        pinned: false,
        surface: 'openclaw' as const,
        messages: baseHistory,
      };

      if (!finalAssistantMessage) {
        throw new Error('No assistant response was produced');
      }

      const messagesBeforeFinalAssistant = sessionHistory.slice(0, -1);

      // Final RAG snapshot: only round 0 carries RAG on the server
      // (toolRound === 0 in streamAssistantResponse), and ragQueryText is invariant
      // across rounds, so the snapshot above plus currentSources covers the
      // complete set of citations used this turn.
      const finalizeRagEnabled = ragEnabled && Boolean(ragQueryText.trim());
      const completedResponse = await fetch('/api/chat/completed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          id: finalAssistantMessage.id,
          session_id: 'openclaw',
          title: getChatTitle(baseHistory),
          message: finalAssistantMessage,
          messages: stripAttachmentVisionData(messagesBeforeFinalAssistant),
          surface: 'openclaw',
          autoContinueMode: effectiveSessionAutoContinueMode,
          autoContinueMaxSteps: effectiveSessionAutoContinueMaxSteps,
          branchLabel: currentSession?.branchLabel ?? null,
          lastAutoContinueAt: currentSession?.lastAutoContinueAt
            ? new Date(currentSession.lastAutoContinueAt).toISOString()
            : null,
          rag_enabled: finalizeRagEnabled,
          rag_query: finalizeRagEnabled ? ragQueryText : null,
          rag_sources: currentSources,
        }),
      });
      const completedData = await completedResponse.json().catch(() => ({}));
      const completedSession = normalizeOpenClawSession((completedData as { session?: unknown }).session);

      // Generate session summary in the background
      void generateSessionSummary(
        chatId,
        getChatTitle(baseHistory),
        [...messagesBeforeFinalAssistant, finalAssistantMessage],
        effectiveTaskState.objective
      );

      setSessions(prev => {
        const next = sanitizeOpenClawSessions(prev);
        const index = next.findIndex(session => session?.id === sessionRecord.id);
        const updatedSession: OpenClawSession = completedSession || {
          ...sessionRecord,
          title: getChatTitle(baseHistory),
          messages: [...messagesBeforeFinalAssistant, finalAssistantMessage!],
          updatedAt: Date.now(),
          autoContinueMode: effectiveSessionAutoContinueMode,
          autoContinueMaxSteps: effectiveSessionAutoContinueMaxSteps,
          branchChildrenCount: currentSession?.branchChildrenCount || 0,
          branchDepth: currentSession?.branchDepth || 0,
        };
        if (index === -1) return [updatedSession, ...next];
        next[index] = updatedSession;
        return next;
      });
      setSelectedSessionInfo(`${getChatTitle(baseHistory)} · updated ${formatTimestamp(Date.now())}`);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setChatHistory(prev => pruneInterruptedMessages(prev));
        return;
      }
      console.error('WorkSpaces chat error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown chat error';
      setChatHistory(prev => {
        const updated = [...prev];
        while (updated.length > 0) {
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant' && !last.content.trim() && !last.thinking?.trim()) {
            updated.pop();
            continue;
          }
          if (last?.hidden) {
            updated.pop();
            continue;
          }
          break;
        }
        updated.push({ role: 'assistant', content: `**Error:** ${errorMessage}` });
        return updated;
      });
    } finally {
      ocStreamingDone = true;
      if (dripTimer) { clearInterval(dripTimer); dripTimer = null; }
      flushAll();
      clearInterval(intervalId);
      setLiveStats(null);
      setStreamPhase(null);
      setIsStreaming(false);
      abortControllerRef.current = null;

      if (effectiveSessionAutoContinueMode === 'safe' && taskState.objective.trim()) {
        if (finalAssistantMessage?.toolRequest && autoContinueCountRef.current < effectiveSessionAutoContinueMaxSteps) {
          autoContinueCountRef.current += 1;
          setAutoContinuePending(true);
          persistSessionIntelligenceSafe({
            lastAutoContinueAt: new Date().toISOString(),
          });
          setTimeout(() => {
            setAutoContinuePending(false);
            void handleSendMessage('continue');
          }, 1500);
        } else {
          autoContinueCountRef.current = 0;
        }
      } else {
        setAutoContinuePending(false);
        autoContinueCountRef.current = 0;
      }
    }
  };

  const activeModeOption = OPENCLAW_AGENT_MODE_OPTIONS.find(option => option.id === agentPreferences.mode)
    || OPENCLAW_AGENT_MODE_OPTIONS[0];
  const activeStyleOption = OPENCLAW_RESPONSE_STYLE_OPTIONS.find(option => option.id === agentPreferences.responseStyle)
    || OPENCLAW_RESPONSE_STYLE_OPTIONS[1];
  const safeSessions = sanitizeOpenClawSessions(sessions);
  const sessionMap = new Map(safeSessions.map(session => [session.id, session]));
  const getBranchRootId = (session: OpenClawSession) => {
    let cursor: OpenClawSession | undefined = session;
    const seen = new Set<string>();
    while (cursor?.parentSessionId) {
      if (seen.has(cursor.parentSessionId)) break;
      seen.add(cursor.parentSessionId);
      const next = sessionMap.get(cursor.parentSessionId);
      if (!next) break;
      cursor = next;
    }
    return cursor?.id || session.id;
  };
  const currentBranchFamily = currentSession
    ? safeSessions.filter(session => getBranchRootId(session) === getBranchRootId(currentSession))
    : [];
  const compareLeftSession = safeSessions.find(session => session.id === (branchCompareLeftId || currentSessionId || '')) ?? null;
  const compareRightSession = safeSessions.find(session => session.id === branchCompareRightId) ?? null;
  useEffect(() => {
    if (!currentSession) return;
    setBranchCompareLeftId(current => current || currentSession.id);
    setBranchCompareRightId(current => {
      if (current && current !== currentSession.id) return current;
      const sibling = currentBranchFamily.find(session => session.id !== currentSession.id);
      return sibling?.id || '';
    });
  }, [currentSession, currentBranchFamily]);
  const filteredSessions = safeSessions.filter(session => {
    if (selectedFolderId && session.folderId !== selectedFolderId) {
      return false;
    }
    if (selectedTagId && !session.tags?.some(tagItem => tagItem?.id === selectedTagId)) {
      return false;
    }
    return true;
  });
  const sessionPageCount = Math.max(1, Math.ceil(filteredSessions.length / SESSION_PAGE_SIZE));
  const activeSessionListPage = Math.min(sessionListPage, sessionPageCount - 1);
  const sessionPageStart = activeSessionListPage * SESSION_PAGE_SIZE;
  const visibleSessions = filteredSessions.slice(sessionPageStart, sessionPageStart + SESSION_PAGE_SIZE);
  const folderSessionCounts = safeSessions.reduce<Record<string, number>>((accumulator, session) => {
    if (session.folderId) {
      accumulator[session.folderId] = (accumulator[session.folderId] || 0) + 1;
    }
    return accumulator;
  }, {});
  const tagSessionCounts = safeSessions.reduce<Record<string, number>>((accumulator, session) => {
    for (const tagItem of session.tags || []) {
      if (!tagItem?.id) continue;
      accumulator[tagItem.id] = (accumulator[tagItem.id] || 0) + 1;
    }
    return accumulator;
  }, {});
  const selectedVisibleSessionCount = selectedSessionIds.filter(id => visibleSessions.some(session => session?.id === id)).length;
  const showingAllVisibleSessions = filteredSessions.length <= SESSION_PAGE_SIZE;
  useEffect(() => {
    if (sessionListPage <= sessionPageCount - 1) return;
    setSessionListPage(Math.max(0, sessionPageCount - 1));
  }, [sessionListPage, sessionPageCount]);
  const compactModeLabel = activeModeOption.label.slice(0, 3).toUpperCase();
  const selectedModelButtonLabel = selectedModel || (modelsLoading
    ? 'Loading models...'
    : models.length > 0
      ? 'Select a model'
      : 'No models found');
  const selectedModelIsOllama = provider === 'ollama';
  const sortedModels = useMemo(() => {
    const favoriteSet = new Set(favoriteModels);
    return models
      .map((model, index) => ({
        model,
        index,
        favorite: favoriteSet.has(getModelFavoriteKey(model.name, provider)),
      }))
      .sort((left, right) => {
        if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
        return left.index - right.index;
      });
  }, [models, favoriteModels, provider]);
  const selectedModelLoadedUntil = formatLoadedUntil(ollamaHealth?.selectedModelExpiresAt);
  const keepAliveLabel = ollamaHealth?.modelKeepAlive
    ? `Keep alive ${ollamaHealth.ollamaKeepAlive || '30m'}`
    : 'Keep alive off';
  const healthStatusLabel = ollamaHealthLoading
    ? 'Checking Ollama'
    : ollamaHealth?.status === 'online'
      ? ollamaHealth.selectedModelLoaded
        ? `Selected model loaded${selectedModelLoadedUntil ? ` until ${selectedModelLoadedUntil}` : ''}`
        : ollamaHealth.loadedModelCount > 0
          ? `${ollamaHealth.loadedModelCount} other model${ollamaHealth.loadedModelCount === 1 ? '' : 's'} loaded`
          : 'Ollama online'
      : ollamaHealth?.status === 'degraded'
        ? 'Runner status limited'
        : 'Ollama offline';
  const healthStatusTone = ollamaHealth?.status === 'online'
    ? 'var(--success)'
    : ollamaHealth?.status === 'degraded'
      ? 'var(--warning)'
      : 'var(--danger)';
  const runtimeMetaLabel = ollamaHealth?.online
    ? `${ollamaHealth.version || 'Ollama'} · ${ollamaHealth.installedModelCount} installed · ${ollamaHealth.loadedModelCount} loaded · ${keepAliveLabel}`
    : ollamaHealth?.error || 'Waiting for Ollama health...';
  const collapsedRailFooterLabel = provider === 'ollama' ? 'Local' : 'Cloud';
  const collapsedRailFooterTone = provider === 'ollama'
    ? healthStatusTone
    : connectionStatus === 'error'
      ? 'var(--danger)'
      : connectionStatus === 'ok'
        ? 'var(--success)'
        : 'var(--text-secondary)';
  const composerPlaceholder = uncensoredEnabled
    ? '🔓 Uncensored mode — direct answers without refusal...'
    : unrestrictedEnabled
      ? '⚡ Unrestricted mode — no system prompts, natural responses...'
      : internetEnabled
    ? 'Internet mode - the model will search the web when needed...'
    : ragEnabled
      ? 'RAG mode - ask WorkSpaces with Knowledge Base context...'
      : agentPreferences.mode === 'research'
        ? 'Ask WorkSpaces to compare options, gather evidence, or recommend a direction...'
        : agentPreferences.mode === 'execute'
          ? 'Describe the task you want executed with concrete steps or deliverables...'
          : agentPreferences.mode === 'review'
            ? 'Paste the plan, draft, or setup you want WorkSpaces to audit...'
          : 'Describe the task, workflow, or action you want WorkSpaces to handle...';
  const hasWorkspaceNotes = agentPreferences.workspaceNotes.trim().length > 0;
  const hasSuccessCriteria = agentPreferences.successCriteria.trim().length > 0;
  const taskStateFieldCount = [
    taskState.objective,
    taskState.currentStatus,
    taskState.nextStep,
    taskState.doneCriteria,
  ].filter(entry => entry.trim().length > 0).length;
  const hasTaskState = Boolean(
    taskState.objective.trim()
    || taskState.currentStatus.trim()
    || taskState.nextStep.trim()
    || taskState.doneCriteria.trim()
    || taskState.checklist.length > 0
  );
  const autoContinueSummaryLabel = effectiveSessionAutoContinueMode === 'safe'
    ? `Auto-continue Safe · cap ${effectiveSessionAutoContinueMaxSteps}`
    : effectiveSessionAutoContinueMode === 'ask'
      ? 'Auto-continue Ask'
      : 'Auto-continue Manual';
  const responseStyleSummary = `${activeStyleOption.label} · ${agentPreferences.askClarifyingQuestionFirst ? 'Clarify first' : 'Assume and move'} · ${autoContinueSummaryLabel}`;
  const taskStateSummary = hasTaskState
    ? `${taskStateFieldCount}/4 fields set${taskState.checklist.length > 0 ? ` · ${taskState.checklist.length} checklist item${taskState.checklist.length === 1 ? '' : 's'}` : ''}`
    : 'No task state captured yet';
  const workspaceBriefSummary = `${hasWorkspaceNotes ? 'Notes set' : 'Notes empty'} · ${hasSuccessCriteria ? 'Criteria set' : 'Criteria empty'}`;
  const personaSummary = persona.templateId === 'custom'
    ? (persona.name || 'Default persona')
    : `${persona.name} · ${persona.templateId}`;
  const userProfileSummary = `${userProfile.name || 'Not set'} · ${userProfile.role || 'No role'}`;
  const currentSessionAnalyticsSummary = currentSession?.analytics
    ? `${currentSession.analytics.assistantTokens.toLocaleString()} tokens · ${currentSession.analytics.toolCalls} tool call${currentSession.analytics.toolCalls === 1 ? '' : 's'} · ${currentSession.analytics.assistantDurationSeconds.toFixed(1)}s`
    : 'Analytics pending';
  const currentContextSummaryStatus = currentSession?.contextSummary
    ? `Memory active${currentSession.contextSummaryUpdatedAt ? ` · ${formatTimestamp(currentSession.contextSummaryUpdatedAt)}` : ''}`
    : settings?.openClawSessionSummariesEnabled
      ? 'Fresh'
      : 'Disabled';
  const branchStatusSummary = currentSession
    ? currentSession.parentSessionId
      ? `Branch depth ${currentSession.branchDepth} · ${currentSession.branchChildrenCount} child branch${currentSession.branchChildrenCount === 1 ? '' : 'es'}`
      : currentSession.branchChildrenCount > 0
        ? `${currentSession.branchChildrenCount} branch${currentSession.branchChildrenCount === 1 ? '' : 'es'}`
        : 'No branches yet'
    : settings?.openClawSessionBranchingEnabled
      ? 'Ready for new branches'
      : 'Branching disabled';
  const openAutomationNudgeCount = automationNudges.filter(nudge => !nudge.dismissedAt).length;
  const queuedAutomationRunCount = automationRuns.filter(run => run.status === 'queued' || run.status === 'running').length;
  const automationSummary = !automationPermissionGranted
    ? 'Blocked by account permission'
    : `${automationHeartbeat.enabled ? `Heartbeat ${automationHeartbeat.intervalMinutes}m` : 'Heartbeat off'} · ${automationSchedules.length} schedule${automationSchedules.length === 1 ? '' : 's'} · ${automationMonitors.length} monitor${automationMonitors.length === 1 ? '' : 's'} · ${openAutomationNudgeCount} nudge${openAutomationNudgeCount === 1 ? '' : 's'} · ${queuedAutomationRunCount} active run${queuedAutomationRunCount === 1 ? '' : 's'}`;
  const visibleChatHistory = useMemo(
  () => sanitizeOpenClawMessages(deferredChatHistory).filter(isVisibleMessage),
  [deferredChatHistory, isVisibleMessage]
);
  const shellOutputByMessage = useMemo(() => {
    const next = new Map<string, ShellOutputEntry[]>();
    for (const output of shellOutput) {
      if (!output.messageId) continue;
      const bucket = next.get(output.messageId) ?? [];
      bucket.push(output);
      next.set(output.messageId, bucket);
    }
    return next;
  }, [shellOutput]);
  const renderVisibleChatMessage = (msg: OpenClawMessage, index: number) => {
    const messageSources = normalizeToolSources(msg.sources);
    const outputsForMessage = msg.id ? (shellOutputByMessage.get(msg.id) ?? []) : [];

    return (
      <VisibleChatMessageRow
        msg={msg}
        index={index}
        isStreaming={isStreaming}
        isLast={index === visibleChatHistory.length - 1}
        currentSessionId={currentSessionId}
        liveStats={liveStats}
        streamPhase={streamPhase}
        outputsForMessage={outputsForMessage}
        messageSources={messageSources}
        branchingEnabled={settings?.openClawSessionBranchingEnabled !== false}
        onBranchFromMessage={handleBranchFromMessage}
        onCopyMessage={handleCopyMessage}
      />
    );
  };
  const showingKnowledgeBase = view === 'knowledge-base';
  const showingSettings = view === 'settings';
  const activeModeSummary = [
    internetEnabled ? 'Internet' : null,
    ragEnabled ? 'RAG' : null,
    unrestrictedEnabled ? 'Unrestricted' : null,
    uncensoredEnabled ? 'Uncensored' : null,
    uwafBrowserEnabled
      ? uwafBrowserMode === 'stealth'
        ? 'Stealth'
        : 'UWAF'
      : null,
  ].filter(Boolean) as string[];
  const activeModeCount = activeModeSummary.length;
  const modeButtonSummary = activeModeCount > 0
    ? activeModeSummary.slice(0, 2).join(' · ') + (activeModeCount > 2 ? ` +${activeModeCount - 2}` : '')
    : 'Internet, browser, RAG, and answer modes';
  const openClawChrome = isMobileViewport ? (
    <header className="mobile-topbar">
      <button
        type="button"
        className="mobile-topbar-button"
        onClick={() => {
          toggleRightRail();
          setMobileHeaderMenuOpen(false);
          setMobileModelMenuOpen(false);
        }}
        aria-label={mobileRailOpen ? 'Close WorkSpaces drawer' : 'Open WorkSpaces navigation'}
        title={mobileRailOpen ? 'Close WorkSpaces drawer' : 'Open WorkSpaces navigation'}
      >
        <Menu size={18} />
      </button>

      <div className="mobile-topbar-center">
        <button
          type="button"
          className="mobile-topbar-pill"
          onClick={() => {
            setMobileModelMenuOpen(open => !open);
            setMobileHeaderMenuOpen(false);
          }}
          disabled={modelsLoading || models.length === 0}
          style={{ opacity: modelsLoading || models.length === 0 ? 0.7 : 1 }}
        >
          <span className="mobile-topbar-pill-label">{selectedModelButtonLabel}</span>
          <ChevronDown
            size={15}
            style={{ transform: mobileModelMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.18s ease' }}
          />
        </button>

        {mobileModelMenuOpen && (
          <div className="mobile-topbar-dropdown">
            {models.length === 0 ? (
              <div className="mobile-topbar-dropdown-empty">
                {modelsLoading
                  ? 'Loading models...'
                  : 'No models available for the selected provider.'}
              </div>
            ) : (
              <>
                <div className="mobile-topbar-dropdown-section">
                  {selectedModelIsOllama ? 'Installed Ollama Models' : 'Provider Models'}
                </div>
                {sortedModels.map(({ model, favorite }) => {
                  const active = model.name === selectedModel;
                  const favoriteLabel = favorite ? `Remove ${model.name} from favorites` : `Favorite ${model.name}`;
                  return (
                    <div
                      key={model.name}
                      role="button"
                      tabIndex={0}
                      className={`mobile-topbar-menu-item${active ? ' is-active' : ''}`}
                      onClick={() => void selectOpenClawModel(model.name)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          void selectOpenClawModel(model.name);
                        }
                      }}
                    >
                      <button
                        type="button"
                        onClick={(event) => toggleFavoriteModel(event, model.name)}
                        aria-label={favoriteLabel}
                        title={favoriteLabel}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 7,
                          border: 'none',
                          background: favorite ? 'rgba(245, 158, 11, 0.16)' : 'transparent',
                          color: favorite ? '#f59e0b' : 'var(--text-secondary)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        <Star size={14} fill={favorite ? 'currentColor' : 'none'} />
                      </button>
                      <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{model.name}</span>
                      {(active || favorite) && <span>{active ? 'Selected' : 'Favorite'}</span>}
                    </div>
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
            setMobileModelMenuOpen(false);
          }}
          aria-label="Open WorkSpaces tools"
          title="WorkSpaces tools"
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
                setRagAccess(!ragEnabled);
                setMobileHeaderMenuOpen(false);
              }}
            >
              <span>Knowledge Base</span>
              <span>{ragEnabled ? 'On' : 'Off'}</span>
            </button>
            <button
              type="button"
              className={`mobile-topbar-menu-item${unrestrictedEnabled ? ' is-active' : ''}`}
              style={unrestrictedEnabled ? { color: '#f59e0b', borderColor: '#f59e0b', background: 'rgba(245, 158, 11, 0.12)' } : undefined}
              onClick={() => {
                toggleUnrestricted();
                setMobileHeaderMenuOpen(false);
              }}
            >
              <span>Unrestricted</span>
              <span>{unrestrictedEnabled ? 'On' : 'Off'}</span>
            </button>
            <button
              type="button"
              className={`mobile-topbar-menu-item${uncensoredEnabled ? ' is-active' : ''}`}
              style={uncensoredEnabled ? { color: '#ef4444', borderColor: '#ef4444', background: 'rgba(239, 68, 68, 0.12)' } : undefined}
              onClick={() => {
                toggleUncensored();
                setMobileHeaderMenuOpen(false);
              }}
            >
              <span>Uncensored</span>
              <span>{uncensoredEnabled ? 'On' : 'Off'}</span>
            </button>
            {selectedModelIsOllama && (
              <button
                type="button"
                className="mobile-topbar-menu-item"
                onClick={() => {
                  void stopSelectedModel();
                  setMobileHeaderMenuOpen(false);
                }}
                disabled={!selectedModel || stoppingModel}
              >
                <span>{stoppingModel ? 'Stopping model...' : 'Stop model'}</span>
                <Square size={13} />
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  ) : (
    <header className="header">
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        {railCollapsed && (
          <button
            type="button"
            className="btn-icon"
            onClick={toggleRightRail}
            aria-label="Expand WorkSpaces rail"
            title="Expand rail"
          >
            <ChevronRight size={18} />
          </button>
        )}
        <button
          type="button"
          className="glass-panel"
          ref={modelMenuButtonRef}
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
              {selectedModel ? `${selectedModelIsOllama ? 'Local' : 'Provider'} model` : 'Model'}
            </span>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
              {selectedModelButtonLabel}
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
                disabled={!selectedModel || stoppingModel}
                title={selectedModel
                  ? `Stop ${selectedModel} in Ollama so the next request reloads it cleanly.`
                  : 'Select a model first.'}
                style={{
                  padding: '8px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: !selectedModel || stoppingModel ? 'not-allowed' : 'pointer',
                  color: 'var(--text-primary)',
                  opacity: !selectedModel || stoppingModel ? 0.7 : 1,
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
          <Popover
            open
            onClose={() => setModelMenuOpen(false)}
            anchorRef={modelMenuButtonRef}
            width={Math.min(360, typeof window !== 'undefined' ? window.innerWidth - 48 : 360)}
            maxHeight={340}
            zIndex={1200}
            side="bottom"
            align="start"
            className="glass-panel"
            style={{
              padding: '6px',
              borderRadius: '14px',
              background: 'var(--bg-surface)',
              boxShadow: '0 18px 48px rgba(0,0,0,0.45)',
              overflowY: 'auto',
            }}
          >
            {models.length === 0 ? (
              <div style={{ padding: '14px 12px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                {modelsLoading
                  ? 'Loading models...'
                  : 'No models available for the selected provider.'}
              </div>
            ) : (
              <>
                <div style={{
                  padding: '8px 10px',
                  fontSize: '0.72rem',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.8px',
                  borderBottom: '1px solid var(--border-color)',
                  marginBottom: '4px'
                }}>
                  {selectedModelIsOllama ? 'Installed Ollama Models' : 'Provider Models'}
                </div>
                {sortedModels.map(({ model, favorite }) => {
                  const active = model.name === selectedModel;
                  const favoriteLabel = favorite ? `Remove ${model.name} from favorites` : `Favorite ${model.name}`;
                  return (
                    <div
                      key={model.name}
                      role="button"
                      tabIndex={0}
                      onClick={() => void selectOpenClawModel(model.name)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          void selectOpenClawModel(model.name);
                        }
                      }}
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
                      <button
                        type="button"
                        onClick={(event) => toggleFavoriteModel(event, model.name)}
                        aria-label={favoriteLabel}
                        title={favoriteLabel}
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '8px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: favorite ? 'rgba(245, 158, 11, 0.16)' : 'var(--bg-glass)',
                          border: favorite ? '1px solid rgba(245, 158, 11, 0.45)' : '1px solid var(--border-color)',
                          color: favorite ? '#f59e0b' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        <Star size={14} fill={favorite ? 'currentColor' : 'none'} />
                      </button>
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
                          {selectedModelIsOllama ? 'Local Ollama model' : 'External provider model'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </Popover>
        )}
      </div>

      <div className="openclaw-mode-toolbar">
        <div className={`openclaw-mode-dropdown is-featured${headerModeMenuOpen === 'modes' ? ' is-open' : ''}${activeModeCount > 0 ? ' is-active tone-danger' : ' tone-accent'}`}>
          <button
            type="button"
            className="openclaw-mode-trigger glass-panel"
            ref={modesMenuButtonRef}
            onClick={() => setHeaderModeMenuOpen(current => current === 'modes' ? null : 'modes')}
            aria-haspopup="menu"
            aria-expanded={headerModeMenuOpen === 'modes'}
          >
            <span className="openclaw-mode-icon">
              <Wand2 size={16} color={activeModeCount > 0 ? '#f97316' : 'var(--accent-primary)'} />
            </span>
            <span className="openclaw-mode-copy">
              <span className="openclaw-mode-label">Workspace modes</span>
              <span className="openclaw-mode-status">{activeModeCount > 0 ? modeButtonSummary : 'Configure modes'}</span>
            </span>
            <ChevronDown
              size={15}
              className="openclaw-mode-chevron"
              style={{ transform: headerModeMenuOpen === 'modes' ? 'rotate(180deg)' : 'rotate(0deg)' }}
            />
          </button>
          {headerModeMenuOpen === 'modes' && (
            <Popover
              open
              onClose={() => {
                setHeaderModeMenuOpen(null);
                setRagFolderPopoverOpen(false);
              }}
              anchorRef={modesMenuButtonRef}
              additionalIgnoreRefs={[ragFolderPopoverRef]}
              width={280}
              maxHeight={500}
              zIndex={1400}
              side="bottom"
              align="end"
              className="openclaw-mode-menu glass-panel"
              role="menu"
              manageFocus={false}
              style={{
                padding: '12px',
                display: 'grid',
                gap: '12px',
                position: 'fixed',
                borderRadius: '16px',
                border: '1px solid var(--border-color)',
                background: 'color-mix(in srgb, var(--bg-surface) 92%, black 8%)',
                boxShadow: '0 24px 54px rgba(0,0,0,0.45)',
              }}
            >
              <div className="openclaw-mode-menu-header">
                <div className="openclaw-mode-menu-title-row">
                  <span className="openclaw-mode-menu-icon">
                    <Wand2 size={16} color="#f97316" />
                  </span>
                  <div className="openclaw-mode-menu-title-copy">
                    <div className="openclaw-mode-menu-title">Workspace modes</div>
                    <div className="openclaw-mode-menu-status">{activeModeCount} active</div>
                  </div>
                </div>
                <p className="openclaw-mode-menu-description">
                  Keep the header clean and switch internet, browser, retrieval, and answer behavior from one place.
                </p>
              </div>

              <div className="openclaw-mode-menu-actions">
                <button
                  type="button"
                  className={`openclaw-mode-action${internetEnabled ? ' is-active' : ''}`}
                  onClick={() => toggleInternetAccess()}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Globe size={15} color={internetEnabled ? 'var(--accent-primary)' : 'var(--text-secondary)'} />
                    Internet
                  </span>
                  <span>{internetEnabled ? 'On' : 'Off'}</span>
                </button>

                {uwafBrowserEnabled && (
                  <div className="openclaw-mode-section">
                    <div className="openclaw-mode-section-header">
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {uwafBrowserMode === 'stealth'
                          ? <Shield size={15} color="#a855f7" />
                          : <Globe size={15} color="var(--accent-primary)" />}
                        UWAF browser
                      </span>
                      <span>{uwafBrowserMode === 'stealth' ? 'Stealth' : 'Direct'}</span>
                    </div>
                    <div className="openclaw-mode-segmented">
                      <button
                        type="button"
                        className={`openclaw-mode-segment${uwafBrowserMode === 'direct' ? ' is-active' : ''}`}
                        onClick={() => switchUwafBrowserMode('direct')}
                      >
                        Direct
                      </button>
                      <button
                        type="button"
                        className={`openclaw-mode-segment${uwafBrowserMode === 'stealth' ? ' is-active is-stealth' : ''}`}
                        onClick={() => switchUwafBrowserMode('stealth')}
                      >
                        Stealth
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  className={`openclaw-mode-action${ragEnabled ? ' is-active' : ''}`}
                  onClick={() => setRagAccess(!ragEnabled)}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <BookOpen size={15} color={ragEnabled ? 'var(--accent-primary)' : 'var(--text-secondary)'} />
                    RAG
                  </span>
                  <span>{ragEnabled ? 'On' : 'Off'}</span>
                </button>
                <div style={{ position: 'relative' }}>
                  <button
                    ref={ragFolderButtonRef}
                    type="button"
                    className={`openclaw-mode-action${ragFolderPath ? ' is-active' : ''}`}
                    disabled={!ragEnabled}
                    title={!ragEnabled ? 'Enable RAG first to scope to a folder' : (ragFolderPath ? `Folder: ${ragFolderPath}` : 'Scope RAG to a folder')}
                    onClick={() => ragEnabled && setRagFolderPopoverOpen(v => !v)}
                    style={{ opacity: ragEnabled ? 1 : 0.5, cursor: ragEnabled ? 'pointer' : 'not-allowed' }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Folder size={15} color={ragFolderPath ? 'var(--accent-primary)' : 'var(--text-secondary)'} />
                      {ragFolderPath
                        ? `📁 ${ragFolderPath.split('/').pop() || 'root'}`
                        : 'Folders'}
                    </span>
                    {ragFolderPath && (
                      <span
                        role="button"
                        aria-label="Clear folder"
                        onClick={(e) => { e.stopPropagation(); setRagFolderPath(null); }}
                        style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', color: 'var(--text-secondary)' }}
                      >
                        <X size={12} />
                      </span>
                    )}
                  </button>
                  <KnowledgeBaseTreePopover
                    open={ragFolderPopoverOpen}
                    onClose={() => setRagFolderPopoverOpen(false)}
                    selectedPath={ragFolderPath}
                    onSelect={(p) => { setRagFolderPath(p); setRagFolderPopoverOpen(false); }}
                    anchorRef={ragFolderButtonRef as React.RefObject<HTMLElement>}
                    popoverRef={ragFolderPopoverRef}
                    maxHeight={320}
                    zIndex={1500}
                  />
                </div>

                <button
                  type="button"
                  className={`openclaw-mode-action${unrestrictedEnabled ? ' is-active is-amber' : ''}`}
                  onClick={() => toggleUnrestricted()}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Wand2 size={15} color={unrestrictedEnabled ? '#f59e0b' : 'var(--text-secondary)'} />
                    Unrestricted
                  </span>
                  <span>{unrestrictedEnabled ? 'On' : 'Off'}</span>
                </button>

                <button
                  type="button"
                  className={`openclaw-mode-action${uncensoredEnabled ? ' is-active is-danger' : ''}`}
                  onClick={() => toggleUncensored()}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Wand2 size={15} color={uncensoredEnabled ? '#ef4444' : 'var(--text-secondary)'} />
                    Uncensored
                  </span>
                  <span>{uncensoredEnabled ? 'On' : 'Off'}</span>
                </button>
              </div>
            </Popover>
          )}
        </div>
      </div>
    </header>
  );

  if (!settings) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} color="var(--accent-primary)" />
      </div>
    );
  }

  return (
    <div className={`openclaw-shell openclaw-rail-left${railCollapsed ? ' rail-collapsed' : ''}`}>
      {isMobileViewport && mobileRailOpen && (
        <button
          type="button"
          className="mobile-surface-overlay"
          aria-label="Close WorkSpaces drawer"
          onClick={() => setMobileRailOpen(false)}
        />
      )}

      <section className="openclaw-main-panel">
        <div className="openclaw-main-chrome">
          {openClawChrome}
          {selectedModelIsOllama && !isMobileViewport && (
            <div className="ollama-health-strip" style={{ borderTop: 'none', padding: '6px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                <div className="ollama-health-badge" style={{ color: healthStatusTone, padding: '4px 8px', fontSize: '0.72rem' }}>
                  {ollamaHealthLoading
                    ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                    : ollamaHealth?.status === 'online'
                      ? <Wifi size={12} />
                      : ollamaHealth?.status === 'degraded'
                        ? <AlertCircle size={12} />
                        : <WifiOff size={12} />}
                  <span>{healthStatusLabel}</span>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
                  title={ollamaHealth?.online && ollamaHealth.loadedModels.length > 0 ? 'Loaded: ' + ollamaHealth.loadedModels.join(', ') : undefined}>
                  {runtimeMetaLabel}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => void refreshOllamaHealth(selectedModel, settings.ollamaHost)}
                  disabled={ollamaHealthLoading}
                  title="Refresh Ollama health"
                >
                  {ollamaHealthLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
                </button>

                {lastSubmission && (
                  <>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => void retryLastSubmission()}
                      disabled={isStreaming}
                      title="Retry last message"
                    >
                      <Redo2 size={13} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => void retryLastSubmission({ disableInternet: true })}
                      disabled={isStreaming}
                      title="Retry without web"
                    >
                      <Globe size={13} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => void retryLastSubmission({ stopModelFirst: true })}
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
        </div>

        {showingKnowledgeBase || showingSettings ? (
          <div className="chat-scroll-shell">
            {showingSettings
              ? settingsContent || (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
                  Settings content is unavailable.
                </div>
              )
              : knowledgeBaseContent || (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
                  Knowledge Base content is unavailable.
                </div>
              )}
          </div>
        ) : (
          <>

        <div className="chat-scroll-shell">
          <div ref={chatAreaRef} className="chat-area openclaw-chat-area" onScroll={handleChatScroll}>
            {automationPermissionGranted && automationNudges.length > 0 && (
              <div style={{ display: 'grid', gap: '10px', marginBottom: '18px' }}>
                <div className="openclaw-card" style={{ padding: '14px 16px' }}>
                  <div className="openclaw-card-header">
                    <div>
                      <div className="openclaw-section-label">Automation nudges</div>
                      <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Background reminders, heartbeat check-ins, schedules, and monitor triggers surfaced by the worker.
                      </div>
                    </div>
                    <button
                      type="button"
                      className="openclaw-inline-button"
                      onClick={() => setWorkspaceControlsModalOpen(true)}
                    >
                      Review
                    </button>
                  </div>
                  <div style={{ display: 'grid', gap: '10px', marginTop: '10px' }}>
                    {automationNudges.slice(0, 3).map(nudge => (
                      <div
                        key={nudge.id}
                        style={{
                          display: 'grid',
                          gap: '8px',
                          padding: '12px',
                          borderRadius: '14px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--panel-bg)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ fontSize: '0.88rem', fontWeight: 700 }}>{nudge.title}</div>
                            <div style={{ marginTop: '4px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              {formatAutomationTimestamp(nudge.createdAt)}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            {nudge.sessionId && (
                              <button
                                type="button"
                                className="openclaw-inline-button"
                                onClick={() => openAutomationNudgeSession(nudge)}
                              >
                                Open thread
                              </button>
                            )}
                            <button
                              type="button"
                              className="openclaw-inline-button"
                              onClick={() => void dismissAutomationNudge(nudge.id)}
                              disabled={automationSaving}
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                          {nudge.message}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {visibleChatHistory.length === 0 ? (
              <div className="openclaw-empty-state">
                <div style={{ textAlign: 'center', maxWidth: '720px', margin: '0 auto' }}>
                  <p style={{ margin: '0 0 16px', fontSize: '0.95rem', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                    Agent workspace ready for your next task.
                  </p>
                  <div className="openclaw-context-pills" style={{ justifyContent: 'center', marginTop: '16px' }}>
                    {persona.name && <span className="openclaw-pill accent">{persona.name}</span>}
                    <span className="openclaw-pill accent">{activeModeOption.label} mode</span>
                    <span className="openclaw-pill">{activeStyleOption.label} responses</span>
                    <span className="openclaw-pill">{provider === 'ollama' ? 'Local Ollama' : 'External provider'}</span>
                    {hasMemory && <span className="openclaw-pill accent">Memory loaded</span>}
                    {internetEnabled && <span className="openclaw-pill accent">Internet on</span>}
                    {ragEnabled && <span className="openclaw-pill accent">Knowledge Base on</span>}
                    {unrestrictedEnabled && <span className="openclaw-pill" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>Unrestricted</span>}
                    {uncensoredEnabled && <span className="openclaw-pill" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>Uncensored</span>}
                  </div>
                </div>
              </div>
            ) : (
              visibleChatHistory.map((msg, index) => (
                <div key={msg.id || index}>
                  {renderVisibleChatMessage(msg, index)}
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
              aria-label="Scroll to latest WorkSpaces message"
              title="Jump to latest message"
              style={{ right: '18px', bottom: '16px' }}
            >
              <ChevronDown size={19} />
            </button>
          )}
        </div>

        <div className="openclaw-composer">
          <div className="openclaw-context-pills">
            <span className="openclaw-pill accent">Mode: {activeModeOption.label}</span>
            <span className="openclaw-pill">Style: {activeStyleOption.label}</span>
            <span className="openclaw-pill">
              {agentPreferences.askClarifyingQuestionFirst ? 'Clarify first' : 'Assume and move'}
            </span>
            <span className="openclaw-pill">Continue: {effectiveSessionAutoContinueMode}</span>
            <span className="openclaw-pill">Context: {currentContextSummaryStatus}</span>
            {settings?.openClawSessionBranchingEnabled && <span className="openclaw-pill">Branches: {branchStatusSummary}</span>}
            {persona.name && <span className="openclaw-pill">{persona.name}</span>}
            {userProfile.name && <span className="openclaw-pill">User: {userProfile.name}</span>}
            {taskState.objective.trim() && <span className="openclaw-pill">Objective set</span>}
            {taskState.nextStep.trim() && <span className="openclaw-pill">Next step pinned</span>}
            {taskState.checklist.length > 0 && <span className="openclaw-pill">Checklist: {taskState.checklist.length}</span>}
            {hasWorkspaceNotes && <span className="openclaw-pill">Notes attached</span>}
            {hasSuccessCriteria && <span className="openclaw-pill">Success criteria attached</span>}
          </div>

          {!isStreaming && continuationPending && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 12px', borderRadius: '12px', border: '1px solid var(--accent-border)', background: 'var(--accent-faint)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                The last assistant turn stopped with unfinished tool work. Continue this session to let WorkSpaces pick up where it left off.
              </div>
              <button
                type="button"
                className="openclaw-inline-button"
                onClick={() => void handleSendMessage('continue')}
              >
                <Redo2 size={14} />
                Continue task
              </button>
            </div>
          )}

          {autoContinuePending && (
            <div style={{ fontSize: '0.78rem', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Loader2 size={12} className="animate-spin" />
              Safe auto-continue is resuming this task.
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleNewSession}
              style={{ padding: '11px 12px', borderRadius: '12px', flexShrink: 0 }}
              title="New WorkSpaces task thread"
            >
              <Plus size={16} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="*/*"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            <button
              className="btn btn-secondary"
              style={{ padding: '10px', borderRadius: '10px', flexShrink: 0 }}
              onClick={() => fileInputRef.current?.click()}
              title="Attach files or images"
              disabled={isStreaming || processingAttachments}
            >
              {processingAttachments ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Paperclip size={16} />}
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              {(pendingImages.length > 0 || pendingAttachments.length > 0 || attachmentError) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '8px 12px', background: 'rgba(0,0,0,0.2)', borderRadius: '10px 10px 0 0', borderBottom: '1px solid var(--border-color)' }}>
                  {pendingImages.map((img, i) => (
                    <div key={`img-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', borderRadius: '16px', background: 'var(--accent-soft)', fontSize: '0.78rem', maxWidth: '100%' }}>
                      <ObjectUrlImage src={img.previewUrl} alt={img.name} style={{ width: '24px', height: '24px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                        <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{img.name}</span>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.68rem' }}>{getImageAttachmentSummary(img.attachmentMode, Boolean(img.ocrText?.trim()))}</span>
                      </div>
                      <select
                        value={img.attachmentMode}
                        onChange={(event) => updatePendingImageMode(i, event.target.value as ImageAttachmentMode)}
                        style={{
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          background: 'rgba(0,0,0,0.18)',
                          color: 'var(--text-primary)',
                          padding: '3px 6px',
                          fontSize: '0.72rem'
                        }}
                        title={img.statusMessage || 'Choose how this image should be sent to the model'}
                      >
                        {IMAGE_ATTACHMENT_MODE_OPTIONS.map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <button onClick={() => removePendingImage(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 0, flexShrink: 0 }}><X size={12} /></button>
                    </div>
                  ))}
                  {pendingAttachments.map((att, i) => (
                    <div key={`att-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '20px', background: 'var(--accent-soft)', fontSize: '0.78rem' }}>
                      <span style={{ maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.name}</span>
                      <button onClick={() => removePendingAttachment(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 0 }}><X size={12} /></button>
                    </div>
                  ))}
                  {processingAttachments && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '20px', background: 'rgba(255,255,255,0.05)', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
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
              <textarea
                ref={composerRef}
                className="input-field"
                rows={2}
                placeholder={composerPlaceholder}
                value={message}
                onChange={e => setMessage(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSendMessage();
                  }
                }}
                disabled={isStreaming}
                style={{ resize: 'vertical', minHeight: '56px', borderRadius: pendingImages.length > 0 || pendingAttachments.length > 0 || attachmentError ? '0 0 10px 10px' : undefined }}
              />
            </div>
            {isStreaming ? (
              <button
                className="btn btn-secondary"
                style={{ padding: '11px 12px', borderRadius: '12px', color: 'var(--danger)', borderColor: 'var(--danger)', flexShrink: 0 }}
                onClick={handleStopStreaming}
              >
                <Square size={18} fill="currentColor" />
              </button>
            ) : (
              <button
                className="btn btn-primary"
                style={{ padding: '11px 12px', borderRadius: '12px', opacity: (!message.trim() && pendingImages.length === 0 && pendingAttachments.length === 0) || modelsLoading ? 0.55 : 1, flexShrink: 0 }}
                onClick={() => void handleSendMessage()}
                disabled={(!message.trim() && pendingImages.length === 0 && pendingAttachments.length === 0) || modelsLoading || processingAttachments}
              >
                <Send size={18} />
              </button>
            )}
          </div>

          {(internetEnabled || ragEnabled || hasWorkspaceNotes || hasSuccessCriteria) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {internetEnabled && (
                <span>Internet mode lets the model search the web when it needs current information, with citations for sources.</span>
              )}
              {ragEnabled && (
                <span>Knowledge Base mode injects matching local document context before generation.</span>
              )}
              {hasWorkspaceNotes && (
                <span>Workspace notes stay attached until you clear them from the rail.</span>
              )}
              {hasSuccessCriteria && (
                <span>Success criteria are included as part of the task brief.</span>
              )}
            </div>
          )}
        </div>
          </>
        )}
      </section>

      <aside className={`openclaw-rail${railCollapsed ? ' is-collapsed' : ''}${isMobileViewport ? ' is-mobile-drawer' : ''}${isMobileViewport && mobileRailOpen ? ' is-mobile-open' : ''}`}>
        {!railCollapsed && (
          <>
            <div style={{ padding: '18px 24px', display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between' }}>
              <button
                type="button"
                onClick={() => {
                  closeMobileChrome();
                  onNavigateToWorkspace?.();
                }}
                title="Go to WorkSpaces"
                aria-label="Go to WorkSpaces"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  minWidth: 0,
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  color: 'inherit',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <div style={{ position: 'relative', width: '85px', height: '85px', flexShrink: 0 }}>
                  <Image src="/logo.png" alt="PeakUI" fill style={{ objectFit: 'contain' }} sizes="85px" />
                </div>
                <div>
                  <h2 style={{ fontSize: '1.2rem', margin: 0 }}>PeakUI</h2>
                  <div style={{ fontSize: '0.8rem', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                    <div className="status-indicator"></div> Engine Online
                  </div>
                </div>
              </button>
              <button
                type="button"
                className="btn-icon"
                onClick={toggleRightRail}
                aria-label="Collapse WorkSpaces workspace rail"
                title="Collapse workspace rail"
              >
                <ChevronLeft size={18} />
              </button>
            </div>

            <div style={{ padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div className={`nav-item${showingKnowledgeBase ? ' active' : ''}`} onClick={() => {
                closeMobileChrome();
                onNavigateToKnowledgeBase?.();
              }} title="Go to Knowledge Base">
                <Database size={18} /> <span className="sidebar-label">Knowledge Base (RAG)</span>
              </div>
              <div className={`nav-item${!showingKnowledgeBase && !showingSettings ? ' active' : ''}`} onClick={() => {
                closeMobileChrome();
                onNavigateToWorkspace?.();
              }} title="Go to WorkSpaces">
                <Wand2 size={18} /> <span className="sidebar-label">WorkSpaces</span>
              </div>
              <div className={`nav-item${showingSettings ? ' active' : ''}`} onClick={() => {
                closeMobileChrome();
                onNavigateToSettings?.();
              }} title="Settings">
                <Settings size={18} /> <span className="sidebar-label">Settings</span>
              </div>
            </div>
          </>
        )}
        {railCollapsed ? (
          <div className="openclaw-rail-collapsed-shell">
            <button
              type="button"
              className="btn-icon"
              onClick={toggleRightRail}
              aria-label="Expand WorkSpaces workspace rail"
              title="Expand workspace rail"
            >
              <ChevronRight size={18} />
            </button>

            <div style={{
              width: '42px',
              height: '42px',
              borderRadius: '14px',
              background: 'var(--accent-gradient)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 10px 24px var(--accent-glow)',
            }}>
              <Wand2 size={20} color="white" />
            </div>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleNewSession}
              style={{ width: '100%', padding: '10px', borderRadius: '12px' }}
              title="New WorkSpaces task thread"
            >
              <Plus size={16} />
            </button>

            <div className="openclaw-rail-stat-cluster">
              <div className="openclaw-rail-stat" title={`Mode: ${activeModeOption.label}`}>
                <Wand2 size={14} />
                <span className="openclaw-rail-stat-label">{compactModeLabel}</span>
              </div>
              <div className="openclaw-rail-stat" title={`${sessions.length} task threads`}>
                <MessageSquare size={14} />
                <span className="openclaw-rail-stat-label">{sessions.length > 99 ? '99+' : sessions.length}</span>
              </div>
              <div className={`openclaw-rail-stat${internetEnabled ? ' is-active' : ''}`} title={`Internet ${internetEnabled ? 'enabled' : 'disabled'}`}>
                <Globe size={14} />
                <span className="openclaw-rail-stat-label">{internetEnabled ? 'ON' : 'OFF'}</span>
              </div>
            </div>

            <div
              className="openclaw-rail-collapsed-footer"
              title={provider === 'ollama'
                ? `${healthStatusLabel} · ${runtimeMetaLabel}`
                : connectionStatus === 'error'
                  ? 'External provider connection issue detected'
                  : connectionStatus === 'checking'
                    ? 'Checking external provider connection'
                    : 'External provider ready'}
            >
              <span className="openclaw-rail-status-dot" style={{ background: collapsedRailFooterTone, boxShadow: `0 0 12px ${collapsedRailFooterTone}` }} />
              <span>{collapsedRailFooterLabel}</span>
            </div>
          </div>
        ) : (
          <>
            <div className="openclaw-rail-scroll" onClick={() => {
              if (sessionMenuOpen) setSessionMenuOpen(null);
              if (createMenuOpen) setCreateMenuOpen(false);
            }}>
              <div className="openclaw-card openclaw-card-sessions" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                    <span className="openclaw-section-label">Sessions</span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                      {filteredSessions.length} threads
                    </span>
                  </div>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setSessionSelectionMode(value => !value);
                        setSelectedSessionIds([]);
                        setSessionMenuOpen(null);
                        setRenamingSessionId(null);
                      }}
                      style={{ padding: '6px 8px', borderRadius: '8px', fontSize: '0.72rem' }}
                    >
                      {sessionSelectionMode ? 'Cancel' : 'Select'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      ref={createMenuButtonRef}
                      onClick={event => {
                        event.stopPropagation();
                        setCreateMenuOpen(value => !value);
                        setSessionMenuOpen(null);
                      }}
                      style={{ padding: '6px 8px', borderRadius: '8px', fontSize: '0.72rem' }}
                    >
                      <Plus size={12} />
                    </button>
                    {createMenuOpen && (
                      <Popover
                        open
                        onClose={() => setCreateMenuOpen(false)}
                        anchorRef={createMenuButtonRef}
                        width={180}
                        zIndex={1200}
                        side="bottom"
                        align="end"
                        manageFocus={false}
                        style={{
                          padding: '6px',
                          borderRadius: '12px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--sidebar-bg)',
                          boxShadow: '0 12px 24px rgba(0,0,0,0.35)',
                          display: 'grid',
                          gap: '4px',
                        }}
                      >
                        <button
                          type="button"
                          className="openclaw-choice-row"
                          onClick={() => {
                            handleNewSession();
                            setCreateMenuOpen(false);
                          }}
                          disabled={isStreaming}
                          style={{ padding: '9px 10px' }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Plus size={12} /> New task thread</span>
                        </button>
                        <button
                          type="button"
                          className="openclaw-choice-row"
                          onClick={() => {
                            setShowNewFolderModal(true);
                            setCreateMenuOpen(false);
                          }}
                          style={{ padding: '9px 10px' }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Folder size={12} /> New folder</span>
                        </button>
                        <button
                          type="button"
                          className="openclaw-choice-row"
                          onClick={() => {
                            setShowNewTagModal(true);
                            setCreateMenuOpen(false);
                          }}
                          style={{ padding: '9px 10px' }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Tag size={12} /> New tag</span>
                        </button>
                      </Popover>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingTop: 6 }}>
                  <button
                    type="button"
                    onClick={() => setSelectedFolderId(null)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: '999px',
                      border: selectedFolderId === null ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                      background: selectedFolderId === null ? 'var(--accent-soft)' : 'transparent',
                      color: selectedFolderId === null ? 'var(--accent-primary)' : 'var(--text-secondary)',
                      fontSize: '0.68rem',
                      cursor: 'pointer',
                    }}
                  >
                    All {sessions.length}
                  </button>
                  {folders.map(folder => (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => setSelectedFolderId(selectedFolderId === folder.id ? null : folder.id)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '3px 8px',
                        borderRadius: '999px',
                        border: selectedFolderId === folder.id ? `1px solid ${folder.color}` : '1px solid var(--border-color)',
                        background: selectedFolderId === folder.id ? `${folder.color}20` : 'transparent',
                        color: selectedFolderId === folder.id ? folder.color : 'var(--text-secondary)',
                        fontSize: '0.68rem',
                        cursor: 'pointer',
                      }}
                    >
                      <Folder size={10} /><span>{folder.name}</span><span>{folderSessionCounts[folder.id] || 0}</span>
                    </button>
                  ))}
                  {tags.map(tagItem => (
                    <button
                      key={tagItem.id}
                      type="button"
                      onClick={() => setSelectedTagId(selectedTagId === tagItem.id ? null : tagItem.id)}
                      style={{
                        padding: '3px 8px',
                        borderRadius: '999px',
                        border: selectedTagId === tagItem.id ? `1px solid ${tagItem.color}` : '1px solid var(--border-color)',
                        background: selectedTagId === tagItem.id ? `${tagItem.color}20` : 'transparent',
                        color: selectedTagId === tagItem.id ? tagItem.color : 'var(--text-secondary)',
                        fontSize: '0.68rem',
                        cursor: 'pointer',
                      }}
                    >
                      <Tag size={10} /> {tagItem.name} {tagSessionCounts[tagItem.id] || 0}
                    </button>
                  ))}
                </div>

                  {sessionSelectionMode && (
                    <div style={{ display: 'grid', gap: '8px', padding: '10px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.02)' }}>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        {selectedVisibleSessionCount} selected on this page
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        <button
                          type="button"
                          className="openclaw-inline-button"
                          onClick={() => setSelectedSessionIds(visibleSessions.map(session => session.id).filter(Boolean))}
                          disabled={visibleSessions.length === 0}
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          className="openclaw-inline-button"
                          onClick={() => setSelectedSessionIds([])}
                          disabled={selectedSessionIds.length === 0}
                        >
                          Clear selection
                        </button>
                        <button
                          type="button"
                          className="openclaw-inline-button"
                          onClick={() => void handleClearSelectedSessions()}
                          disabled={selectedSessionIds.length === 0}
                          style={{ color: 'var(--danger)' }}
                        >
                          <Trash2 size={12} /> Delete selected
                        </button>
                        <button
                          type="button"
                          className="openclaw-inline-button"
                          onClick={() => void handleClearAllSessions()}
                          disabled={sessions.length === 0}
                          style={{ color: 'var(--danger)' }}
                        >
                          Clear all
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="openclaw-list-scroll">
                    {filteredSessions.length === 0 ? (
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', padding: '8px 4px' }}>
                        {sessions.length === 0 ? 'No saved WorkSpaces sessions yet.' : 'No sessions match the current folder/tag filters.'}
                      </div>
                    ) : visibleSessions.map(session => {
                      const active = session.id === currentSessionId;
                      const selected = selectedSessionIds.includes(session.id);
                      return (
                        <div
                          key={session.id}
                          style={{
                            position: 'relative',
                            borderRadius: '12px',
                            border: `1px solid ${active ? 'var(--accent-primary)' : selected ? 'var(--accent-border)' : 'var(--border-color)'}`,
                            background: active ? 'var(--accent-soft)' : selected ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.02)',
                          }}
                        >
                          {renamingSessionId === session.id ? (
                            <form
                              onSubmit={event => {
                                event.preventDefault();
                                void handleRenameSession(session.id);
                              }}
                              style={{ display: 'grid', gap: '8px', padding: '10px 12px' }}
                            >
                              <input
                                autoFocus
                                value={renameValue}
                                onChange={event => setRenameValue(event.target.value)}
                                onBlur={() => {
                                  setRenamingSessionId(null);
                                  setRenameValue('');
                                }}
                                onKeyDown={event => {
                                  if (event.key === 'Escape') {
                                    setRenamingSessionId(null);
                                    setRenameValue('');
                                  }
                                }}
                                className="input-field"
                                style={{ width: '100%' }}
                              />
                            </form>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'stretch', gap: '6px' }}>
                              {sessionSelectionMode && (
                                <button
                                  type="button"
                                  onClick={() => toggleSessionSelection(session.id)}
                                  style={{
                                    border: 'none',
                                    background: 'transparent',
                                    color: selected ? 'var(--accent-primary)' : 'var(--text-secondary)',
                                    cursor: 'pointer',
                                    padding: '6px 0 6px 10px',
                                  }}
                                  aria-label={selected ? 'Deselect session' : 'Select session'}
                                >
                                  <Check size={14} style={{ opacity: selected ? 1 : 0.25 }} />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => switchSession(session)}
                                disabled={isStreaming}
                                style={{
                                  width: '100%',
                                  display: 'grid',
                                  gap: '4px',
                                  border: 'none',
                                  background: 'transparent',
                                  color: 'inherit',
                                  padding: `6px 10px 6px ${sessionSelectionMode ? '4px' : '10px'}`,
                                  cursor: isStreaming ? 'not-allowed' : 'pointer',
                                  opacity: isStreaming ? 0.7 : 1,
                                  textAlign: 'left',
                                  fontFamily: 'inherit',
                                }}
                              >
                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                                  {session.pinned ? <Pin size={12} /> : <MessageSquare size={12} style={{ opacity: 0.6 }} />}
                                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.84rem', fontWeight: 700, color: active ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                                    {session.title}
                                  </span>
                                </span>
                                <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                  Updated {formatTimestamp(session.updatedAt)}
                                </span>
                                <span style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                                  {(session.branchLabel || session.parentSessionId || session.branchChildrenCount > 0) && (
                                    <span style={{ fontSize: '0.7rem', color: 'var(--accent-primary)' }}>
                                      {session.parentSessionId ? `Branch ${session.branchDepth}` : session.branchChildrenCount > 0 ? `${session.branchChildrenCount} branch${session.branchChildrenCount === 1 ? '' : 'es'}` : 'Main thread'}
                                    </span>
                                  )}
                                  {session.analytics && (
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                                      {session.analytics.assistantTokens.toLocaleString()} tok · {session.analytics.toolCalls} tool{session.analytics.toolCalls === 1 ? '' : 's'}
                                    </span>
                                  )}
                                </span>
                                {session.tags && session.tags.length > 0 && (
                                  <span style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    {session.tags.slice(0, 3).map(tagItem => (
                                      <span
                                        key={tagItem.id}
                                        style={{
                                          width: '8px',
                                          height: '8px',
                                          borderRadius: '50%',
                                          background: tagItem.color,
                                        }}
                                        title={tagItem.name}
                                      />
                                    ))}
                                  </span>
                                )}
                              </button>
                              <button
                                type="button"
                                ref={el => { sessionMenuButtonRefs.current[session.id] = el; }}
                                onClick={() => setSessionMenuOpen(session.id === sessionMenuOpen ? null : session.id)}
                                style={{
                                  border: 'none',
                                  background: 'transparent',
                                  color: 'var(--text-secondary)',
                                  cursor: 'pointer',
                                  padding: '6px 8px 6px 0',
                                }}
                                aria-label="Session options"
                              >
                                <MoreHorizontal size={14} />
                              </button>
                            </div>
                          )}
                          {sessionMenuOpen === session.id && renamingSessionId !== session.id && (
                            <Popover
                              open
                              onClose={() => setSessionMenuOpen(null)}
                              anchorRef={{ current: sessionMenuButtonRefs.current[session.id] }}
                              width={200}
                              maxHeight={320}
                              zIndex={1200}
                              side="bottom"
                              align="end"
                              manageFocus={false}
                              style={{
                                background: 'var(--sidebar-bg)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '10px',
                                padding: '4px',
                                boxShadow: '0 12px 24px rgba(0,0,0,0.35)',
                                overflowY: 'auto',
                              }}
                            >
                              {([
                                { icon: <Pin size={12} />, label: session.pinned ? 'Unpin' : 'Pin', action: () => void handlePinSession(session.id, session.pinned) },
                                { icon: <BookOpen size={12} />, label: 'Rename', action: () => { setRenamingSessionId(session.id); setRenameValue(session.title); setSessionMenuOpen(null); } },
                                ...(settings?.openClawSessionBranchingEnabled
                                  ? [
                                      { icon: <Copy size={12} />, label: 'Branch latest state', action: () => { void handleBranchFromMessage(session.messages[session.messages.length - 1]?.id, `${session.title} branch`, session.id); setSessionMenuOpen(null); } },
                                      { icon: <MessageSquare size={12} />, label: 'Compare branches', action: () => { openBranchCompare(session.id); setSessionMenuOpen(null); } },
                                    ]
                                  : []),
                                { icon: <Copy size={12} />, label: 'Copy to clipboard', action: () => void handleCopySession(session) },
                                { icon: <Trash2 size={12} />, label: 'Delete', action: () => void handleDeleteSession(session.id), danger: true },
                              ]).map(item => (
                                <div
                                  key={item.label}
                                  onClick={item.action}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '7px 10px',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontSize: '0.82rem',
                                    color: item.danger ? 'var(--danger)' : 'var(--text-primary)',
                                  }}
                                >
                                  {item.icon}
                                  <span>{item.label}</span>
                                </div>
                              ))}
                              <div className="openclaw-section-label" style={{ padding: '8px 10px 4px', fontSize: '0.68rem' }}>Folder</div>
                              <div
                                onClick={() => { void handleAddToFolder(session.id, null); setSessionMenuOpen(null); }}
                                style={{ padding: '7px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem' }}
                              >
                                {session.folderId ? 'Remove from folder' : 'No folder'}
                              </div>
                              {folders.length > 0 ? folders.map(folder => (
                                <div
                                  key={folder.id}
                                  onClick={() => { void handleAddToFolder(session.id, folder.id); setSessionMenuOpen(null); }}
                                  style={{ padding: '7px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem' }}
                                >
                                  {session.folderId === folder.id ? '✓ ' : ''}{folder.name}
                                </div>
                              )) : (
                                <div
                                  onClick={() => { setShowNewFolderModal(true); setSessionMenuOpen(null); }}
                                  style={{ padding: '7px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem' }}
                                >
                                  Create first folder
                                </div>
                              )}
                              <div className="openclaw-section-label" style={{ padding: '8px 10px 4px', fontSize: '0.68rem' }}>Tags</div>
                              {tags.length > 0 ? tags.map(tagItem => {
                                const hasTag = Boolean(session.tags?.some(sessionTag => sessionTag?.id === tagItem.id));
                                return (
                                  <div
                                    key={tagItem.id}
                                    onClick={() => {
                                      if (hasTag) {
                                        void handleRemoveTagFromSession(session.id, tagItem.id);
                                      } else {
                                        void handleAddTagToSession(session.id, tagItem.id);
                                      }
                                      setSessionMenuOpen(null);
                                    }}
                                    style={{ padding: '7px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem' }}
                                  >
                                    {hasTag ? '✓ ' : ''}{tagItem.name}
                                  </div>
                                );
                              }) : (
                                <div
                                  onClick={() => { setShowNewTagModal(true); setSessionMenuOpen(null); }}
                                  style={{ padding: '7px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem' }}
                                >
                                  Create first tag
                                </div>
                              )}
                            </Popover>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {filteredSessions.length > SESSION_PAGE_SIZE && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', paddingTop: '4px' }}>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                        Page {activeSessionListPage + 1} of {sessionPageCount}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          type="button"
                          className="openclaw-inline-button"
                          onClick={() => setSessionListPage(page => Math.max(0, page - 1))}
                          disabled={activeSessionListPage === 0}
                        >
                          Previous
                        </button>
                        <button
                          type="button"
                          className="openclaw-inline-button"
                          onClick={() => setSessionListPage(page => Math.min(sessionPageCount - 1, page + 1))}
                          disabled={activeSessionListPage >= sessionPageCount - 1}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              <button
                type="button"
                onClick={() => setWorkspaceControlsModalOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={workspaceControlsModalOpen}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid var(--border-color)',
                  background: 'rgba(255,255,255,0.02)',
                  color: 'inherit',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', textWrap: 'nowrap' }}>
                  Workspace Controls
                </span>
                <Settings size={14} color="var(--text-secondary)" style={{ flexShrink: 0 }} />
              </button>
              {workspaceControlsModalOpen && (
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Workspace controls"
                  onClick={() => setWorkspaceControlsModalOpen(false)}
                  style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 1200,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '20px',
                    background: 'rgba(3, 6, 23, 0.66)',
                    backdropFilter: 'blur(8px)',
                  }}
                >
                  <div
                    onClick={event => event.stopPropagation()}
                    style={{
                      width: 'min(960px, calc(100vw - 32px))',
                      maxHeight: 'min(88vh, 960px)',
                      overflowY: 'auto',
                      padding: '18px',
                      borderRadius: '18px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--sidebar-bg)',
                      boxShadow: '0 24px 72px rgba(0, 0, 0, 0.42)',
                      display: 'grid',
                      gap: '14px',
                    }}
                  >
                    <div className="openclaw-card" style={{ gap: '12px', position: 'sticky', top: 0, zIndex: 1, background: 'var(--sidebar-bg)' }}>
                      <div className="openclaw-card-header">
                        <div>
                          <div className="openclaw-section-label">Workspace controls</div>
                          <div style={{ marginTop: '6px', fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                            Configure how WorkSpaces works in this browser
                          </div>
                          <div style={{ marginTop: '6px', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                            {responseStyleSummary}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="openclaw-inline-button"
                          onClick={() => setWorkspaceControlsModalOpen(false)}
                        >
                          <X size={14} />
                          Close
                        </button>
                      </div>
                      <div className="openclaw-disclosure-pill-row">
                        <span className="openclaw-disclosure-pill">Workspace: {currentWorkspace?.name || 'None'}</span>
                        <span className="openclaw-disclosure-pill">Task state: {taskStateSummary}</span>
                        <span className="openclaw-disclosure-pill">Persona: {personaSummary}</span>
                        <span className="openclaw-disclosure-pill">Profile: {userProfileSummary}</span>
                        <span className="openclaw-disclosure-pill">Shell: {shellGranted ? (shellEnabled ? 'Enabled' : 'Disabled') : 'Blocked'}</span>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gap: '12px' }}>
              <div className="openclaw-card">
                <div className="openclaw-card-header">
                  <div>
                    <div className="openclaw-section-label">Workspace</div>
                    <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {workspaceSummary}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="openclaw-inline-button"
                    onClick={() => void loadWorkspaces()}
                    disabled={workspaceLoading}
                  >
                    {workspaceLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    Refresh
                  </button>
                </div>
                <div style={{ display: 'grid', gap: '10px' }}>
                  <div>
                    <label className="openclaw-field-label" htmlFor="openclaw-workspace-select">Selected workspace</label>
                    <select
                      id="openclaw-workspace-select"
                      className="input-field"
                      value={currentWorkspace?.id || ''}
                      onChange={event => setCurrentWorkspaceId(event.target.value)}
                    >
                      {workspaces.map(workspace => (
                        <option key={workspace.id} value={workspace.id}>
                          {workspace.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {currentWorkspace && (
                    <>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                        {currentWorkspace.description || 'No workspace description set.'}
                      </div>
                      <div className="openclaw-disclosure-pill-row">
                        <span className="openclaw-disclosure-pill">Root: {currentWorkspace.hostPath}</span>
                        <span className="openclaw-disclosure-pill">BOOT.md</span>
                        <span className="openclaw-disclosure-pill">TOOLS.md</span>
                        <span className="openclaw-disclosure-pill">skills/{currentWorkspace.skillCount}</span>
                      </div>
                      <div style={{ display: 'grid', gap: '8px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                          <input
                            type="checkbox"
                            checked={currentWorkspace.autoGitBackup}
                            onChange={event => void updateCurrentWorkspace({ autoGitBackup: event.target.checked })}
                          />
                          Auto-commit workspace files to git when changes are detected
                        </label>
                        {currentWorkspace.lastGitBackupCommit && (
                          <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                            Last backup: {currentWorkspace.lastGitBackupAt || 'unknown'} · {currentWorkspace.lastGitBackupCommit.slice(0, 12)}
                          </div>
                        )}
                        {currentWorkspace.lastGitBackupError && (
                          <div style={{ fontSize: '0.76rem', color: 'var(--danger)' }}>
                            Git backup warning: {currentWorkspace.lastGitBackupError}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                  <div style={{ display: 'grid', gap: '8px', paddingTop: '4px', borderTop: '1px solid var(--border-color)' }}>
                    <div className="openclaw-section-label">Create workspace</div>
                    <input
                      className="input-field"
                      value={newWorkspaceName}
                      onChange={event => setNewWorkspaceName(event.target.value)}
                      placeholder="Workspace name"
                    />
                    <textarea
                      className="input-field"
                      rows={2}
                      value={newWorkspaceDescription}
                      onChange={event => setNewWorkspaceDescription(event.target.value)}
                      placeholder="Optional description"
                      style={{ resize: 'vertical' }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="openclaw-inline-button"
                        onClick={() => void createWorkspace()}
                        disabled={creatingWorkspace}
                      >
                        {creatingWorkspace ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                        Create workspace
                      </button>
                      <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                        Each workspace gets its own `BOOT.md`, `TOOLS.md`, and `skills/` folder.
                      </span>
                    </div>
                    {workspaceError && (
                      <div style={{ fontSize: '0.76rem', color: 'var(--danger)' }}>
                        {workspaceError}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="openclaw-card">
                <div className="openclaw-card-header">
                  <div>
                    <div className="openclaw-section-label">Session intelligence</div>
                    <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Context memory, continuation behavior, branching, and analytics for the active WorkSpaces thread.
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {continuationPending && (
                      <button
                        type="button"
                        className="openclaw-inline-button"
                        onClick={() => void handleSendMessage('continue')}
                      >
                        <Redo2 size={14} />
                        Continue
                      </button>
                    )}
                    {settings?.openClawSessionBranchingEnabled && (
                      <>
                        <button
                          type="button"
                          className="openclaw-inline-button"
                          onClick={() => void handleBranchFromMessage(chatHistory[chatHistory.length - 1]?.id, `${currentSession?.title || 'Draft'} branch`)}
                          disabled={isStreaming || chatHistory.length === 0}
                        >
                          <Copy size={14} />
                          Branch latest
                        </button>
                        <button
                          type="button"
                          className="openclaw-inline-button"
                          onClick={() => openBranchCompare()}
                          disabled={currentBranchFamily.length < 2}
                        >
                          <MessageSquare size={14} />
                          Compare
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div style={{ display: 'grid', gap: '10px' }}>
                  <div className="openclaw-disclosure-pill-row">
                    <span className="openclaw-disclosure-pill">{autoContinueSummaryLabel}</span>
                    <span className="openclaw-disclosure-pill">Context: {currentContextSummaryStatus}</span>
                    <span className="openclaw-disclosure-pill">Analytics: {settings?.openClawSessionAnalyticsEnabled ? 'On' : 'Off'}</span>
                    <span className="openclaw-disclosure-pill">{branchStatusSummary}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                    <div style={{ padding: '12px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--panel-bg)' }}>
                      <div className="openclaw-section-label">Analytics</div>
                      <div style={{ marginTop: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                        {currentSessionAnalyticsSummary}
                      </div>
                    </div>
                    <div style={{ padding: '12px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--panel-bg)' }}>
                      <div className="openclaw-section-label">Branch family</div>
                      <div style={{ marginTop: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                        {currentBranchFamily.length > 0
                          ? `${currentBranchFamily.length} related thread${currentBranchFamily.length === 1 ? '' : 's'} in this branch family.`
                          : 'No related branches loaded.'}
                      </div>
                    </div>
                  </div>
                  {currentSession?.summary && (
                    <div style={{ padding: '12px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--panel-bg)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                      <div className="openclaw-section-label" style={{ marginBottom: '8px' }}>Session summary</div>
                      {currentSession.summary}
                    </div>
                  )}
                  {currentSession?.contextSummary && (
                    <div style={{ padding: '12px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--panel-bg)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                      <div className="openclaw-card-header" style={{ marginBottom: '8px' }}>
                        <div>
                          <div className="openclaw-section-label">What I’m carrying forward</div>
                          <div style={{ marginTop: '4px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            Compact working memory for older turns in this thread.
                          </div>
                        </div>
                        <div style={{ display: 'inline-flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="openclaw-inline-button"
                            onClick={() => updateCurrentThreadMemorySafe('refresh')}
                            disabled={isStreaming}
                          >
                            Refresh
                          </button>
                          <button
                            type="button"
                            className="openclaw-inline-button"
                            onClick={() => updateCurrentThreadMemorySafe('clear')}
                            disabled={isStreaming}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      {currentSession.contextSummary}
                    </div>
                  )}
                  {currentSession && !currentSession.contextSummary && settings?.openClawSessionSummariesEnabled && (
                    <div style={{ padding: '12px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--panel-bg)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                      <div className="openclaw-card-header">
                        <div>
                          <div className="openclaw-section-label">What I’m carrying forward</div>
                          <div style={{ marginTop: '4px' }}>No compact working memory has been created for this thread yet.</div>
                        </div>
                        <button
                          type="button"
                          className="openclaw-inline-button"
                          onClick={() => updateCurrentThreadMemorySafe('refresh')}
                          disabled={isStreaming}
                        >
                          Refresh memory
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="openclaw-card">
                <div className="openclaw-card-header">
                  <div>
                    <div className="openclaw-section-label">Agent mode</div>
                    <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {activeAgentMode?.label || 'Plan'} · Persistent per browser
                    </div>
                  </div>
                  <button
                    type="button"
                    className="openclaw-inline-button"
                    onClick={() => setAgentModePanelOpen(value => !value)}
                  >
                    {agentModePanelOpen ? 'Collapse' : 'Expand'}
                    <ChevronDown size={14} style={{ transform: agentModePanelOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
                  </button>
                </div>
                {agentModePanelOpen && (
                  <div className="openclaw-choice-grid">
                    {OPENCLAW_AGENT_MODE_OPTIONS.map(option => {
                      const active = agentPreferences.mode === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={`openclaw-choice-card${active ? ' active' : ''}`}
                          onClick={() => updateAgentPreferences({ mode: option.id })}
                        >
                          <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{option.label}</div>
                          <div style={{ marginTop: '6px', fontSize: '0.8rem', lineHeight: 1.55, color: active ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>
                            {option.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="openclaw-card">
                <button
                  type="button"
                  className="openclaw-disclosure-toggle"
                  onClick={() => setResponseStylePanelOpen(open => !open)}
                  aria-expanded={responseStylePanelOpen}
                >
                  <div className="openclaw-disclosure-summary">
                    <div>
                      <div className="openclaw-section-label">Response style</div>
                      <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {responseStyleSummary}
                      </div>
                    </div>
                  </div>
                  <ChevronDown
                    size={16}
                    className={`openclaw-disclosure-chevron${responseStylePanelOpen ? ' is-open' : ''}`}
                  />
                </button>
                {responseStylePanelOpen && (
                  <div className="openclaw-disclosure-body">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className={`openclaw-toggle${agentPreferences.askClarifyingQuestionFirst ? ' active' : ''}`}
                        onClick={() => updateAgentPreferences({
                          askClarifyingQuestionFirst: !agentPreferences.askClarifyingQuestionFirst,
                        })}
                      >
                        {agentPreferences.askClarifyingQuestionFirst ? 'Clarify first' : 'Assume and move'}
                      </button>
                    </div>
                    <div style={{ display: 'grid', gap: '10px', marginTop: '10px' }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        Session auto-continue
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {[
                          { value: 'manual' as const, label: 'Manual', desc: 'Never continue automatically' },
                          { value: 'ask' as const, label: 'Ask', desc: 'Suggest continue when a session stops mid-flow' },
                          { value: 'safe' as const, label: 'Safe', desc: 'Automatically continue capped unfinished tool flows' },
                        ].map(option => {
                          const active = effectiveSessionAutoContinueMode === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              className={`openclaw-toggle${active ? ' active' : ''}`}
                              onClick={() => {
                                if (!settings) return;
                                if (!currentSessionId) {
                                  setDraftSessionAutoContinueMode(option.value);
                                  return;
                                }
                                persistSessionIntelligenceSafe({ autoContinueMode: option.value });
                              }}
                              title={option.desc}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <Wand2 size={12} />
                        <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                          {effectiveSessionAutoContinueMode === 'safe'
                            ? `Safe mode can chain up to ${effectiveSessionAutoContinueMaxSteps} automatic follow-up step${effectiveSessionAutoContinueMaxSteps === 1 ? '' : 's'} before stopping.`
                            : effectiveSessionAutoContinueMode === 'ask'
                              ? 'Ask mode raises a continuation prompt when the last assistant turn stopped mid-flow.'
                              : 'Manual mode never resumes by itself. Use Continue task when you want the agent to pick up again.'}
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 180px) 92px', gap: '10px', alignItems: 'center' }}>
                        <label className="openclaw-field-label" htmlFor="openclaw-auto-continue-max-steps" style={{ marginBottom: 0 }}>
                          Auto-continue step cap
                        </label>
                        <input
                          id="openclaw-auto-continue-max-steps"
                          className="input-field"
                          type="number"
                          min={1}
                          max={10}
                          value={effectiveSessionAutoContinueMaxSteps}
                          onChange={event => {
                            const nextValue = Math.max(1, Math.min(10, Number(event.target.value) || 1));
                            if (!currentSessionId) {
                              setDraftSessionAutoContinueMaxSteps(nextValue);
                              return;
                            }
                            persistSessionIntelligenceSafe({ autoContinueMaxSteps: nextValue });
                          }}
                        />
                      </div>
                    </div>
                    <div className="openclaw-choice-grid">
                      {OPENCLAW_RESPONSE_STYLE_OPTIONS.map(option => {
                        const active = agentPreferences.responseStyle === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            className={`openclaw-choice-row${active ? ' active' : ''}`}
                            onClick={() => updateAgentPreferences({ responseStyle: option.id })}
                          >
                            <span style={{ fontWeight: 700 }}>{option.label}</span>
                            <span style={{ color: active ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>{option.description}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div className="openclaw-card">
                <button
                  type="button"
                  className="openclaw-disclosure-toggle"
                  onClick={() => setTaskStatePanelOpen(open => !open)}
                  aria-expanded={taskStatePanelOpen}
                >
                  <div className="openclaw-disclosure-summary">
                    <div>
                      <div className="openclaw-section-label">Task state</div>
                      <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {taskStateSummary}
                      </div>
                    </div>
                  </div>
                  <ChevronDown
                    size={16}
                    className={`openclaw-disclosure-chevron${taskStatePanelOpen ? ' is-open' : ''}`}
                  />
                </button>
                {taskStatePanelOpen && (
                  <div className="openclaw-disclosure-body">
                    <div className="openclaw-card-header">
                      <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          Keep the objective, status, next step, and done criteria separate from the transcript.
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        {latestAssistantChecklistSuggestion.length > 0 && (
                          <button
                            type="button"
                            className="openclaw-inline-button"
                            onClick={replaceChecklistFromLatestAssistant}
                          >
                            <ListTodo size={12} />
                            {taskState.checklist.length > 0 ? 'Replace checklist' : 'Pin checklist'}
                          </button>
                        )}
                        {hasTaskState && (
                          <button
                            type="button"
                            className="openclaw-inline-button"
                            onClick={() => updateTaskState(DEFAULT_OPENCLAW_TASK_STATE)}
                          >
                            Clear
                          </button>
                        )}
                        <button
                          type="button"
                          className="openclaw-inline-button"
                          onClick={addChecklistItem}
                        >
                          <Plus size={12} />
                          Add item
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: '10px' }}>
                      <div>
                        <label className="openclaw-field-label" htmlFor="openclaw-objective">Objective</label>
                        <textarea
                          id="openclaw-objective"
                          className="input-field"
                          rows={3}
                          value={taskState.objective}
                          onChange={e => updateTaskState({ objective: e.target.value })}
                          placeholder="What is this task trying to accomplish?"
                          style={{ resize: 'vertical' }}
                        />
                      </div>
                      <div>
                        <label className="openclaw-field-label" htmlFor="openclaw-current-status">Current status</label>
                        <textarea
                          id="openclaw-current-status"
                          className="input-field"
                          rows={2}
                          value={taskState.currentStatus}
                          onChange={e => updateTaskState({ currentStatus: e.target.value })}
                          placeholder="What is already known, done, or blocked?"
                          style={{ resize: 'vertical' }}
                        />
                      </div>
                      <div>
                        <label className="openclaw-field-label" htmlFor="openclaw-next-step">Next step</label>
                        <textarea
                          id="openclaw-next-step"
                          className="input-field"
                          rows={2}
                          value={taskState.nextStep}
                          onChange={e => updateTaskState({ nextStep: e.target.value })}
                          placeholder="What should happen immediately next?"
                          style={{ resize: 'vertical' }}
                        />
                      </div>
                      <div>
                        <label className="openclaw-field-label" htmlFor="openclaw-done-criteria">Done criteria</label>
                        <textarea
                          id="openclaw-done-criteria"
                          className="input-field"
                          rows={3}
                          value={taskState.doneCriteria}
                          onChange={e => updateTaskState({ doneCriteria: e.target.value })}
                          placeholder="How will you know this task is done?"
                          style={{ resize: 'vertical' }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: '8px' }}>
                      <div className="openclaw-section-label">Pinned checklist</div>

                      {taskState.checklist.length === 0 ? (
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                          {latestAssistantChecklistSuggestion.length > 0
                            ? 'The latest assistant answer includes a checklist you can pin here.'
                            : 'Pin checklist steps from an assistant answer or add your own items manually.'}
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gap: '8px' }}>
                          {taskState.checklist.map(item => (
                            <div key={item.id} className="openclaw-checklist-row">
                              <button
                                type="button"
                                className={`openclaw-check-toggle${item.completed ? ' completed' : ''}`}
                                onClick={() => toggleChecklistItem(item.id)}
                                aria-label={item.completed ? 'Mark checklist item incomplete' : 'Mark checklist item complete'}
                              >
                                {item.completed ? <Check size={12} /> : <Square size={11} />}
                              </button>
                              <input
                                className="input-field"
                                value={item.text}
                                onChange={e => updateChecklistItem(item.id, e.target.value)}
                                placeholder="Checklist item"
                                style={{ padding: '10px 12px' }}
                              />
                              <button
                                type="button"
                                className="openclaw-inline-button"
                                onClick={() => removeChecklistItem(item.id)}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="openclaw-card">
                <button
                  type="button"
                  className="openclaw-disclosure-toggle"
                  onClick={() => setWorkspaceBriefPanelOpen(open => !open)}
                  aria-expanded={workspaceBriefPanelOpen}
                >
                  <div className="openclaw-disclosure-summary">
                    <div>
                      <div className="openclaw-section-label">Workspace brief</div>
                      <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {workspaceBriefSummary}
                      </div>
                    </div>
                  </div>
                  <ChevronDown
                    size={16}
                    className={`openclaw-disclosure-chevron${workspaceBriefPanelOpen ? ' is-open' : ''}`}
                  />
                </button>
                {workspaceBriefPanelOpen && (
                  <div className="openclaw-disclosure-body">
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                      Injected into every WorkSpaces request
                    </div>
                    <div style={{ display: 'grid', gap: '10px' }}>
                      <div>
                        <label className="openclaw-field-label" htmlFor="openclaw-workspace-notes">Workspace notes</label>
                        <textarea
                          id="openclaw-workspace-notes"
                          className="input-field"
                          rows={4}
                          value={agentPreferences.workspaceNotes}
                          onChange={e => updateAgentPreferences({ workspaceNotes: e.target.value })}
                          placeholder="Constraints, current setup, project context, known blockers..."
                          style={{ resize: 'vertical' }}
                        />
                      </div>
                      <div>
                        <label className="openclaw-field-label" htmlFor="openclaw-success-criteria">Success criteria</label>
                        <textarea
                          id="openclaw-success-criteria"
                          className="input-field"
                          rows={3}
                          value={agentPreferences.successCriteria}
                          onChange={e => updateAgentPreferences({ successCriteria: e.target.value })}
                          placeholder="What must be true for this task to count as done?"
                          style={{ resize: 'vertical' }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="openclaw-card">
                <div className="openclaw-card-header">
                  <div>
                    <div className="openclaw-section-label">Agent persona</div>
                    <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {personaSummary}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="openclaw-inline-button"
                    onClick={() => setPersonaPanelOpen(v => !v)}
                  >
                    {personaPanelOpen ? 'Collapse' : 'Edit'}
                  </button>
                </div>
                {personaPanelOpen && (
                  <div style={{ display: 'grid', gap: '10px' }}>
                    <div>
                      <label className="openclaw-field-label">Template</label>
                      <div className="openclaw-choice-grid">
                        {([
                          { id: 'custom', label: 'Custom', description: 'Build your own persona from scratch.' },
                          { id: 'developer', label: 'Developer', description: 'Code-first, technical, review-oriented.' },
                          { id: 'researcher', label: 'Researcher', description: 'Evidence-driven, thorough, balanced.' },
                          { id: 'writer', label: 'Writer', description: 'Clear, engaging, audience-aware.' },
                          { id: 'analyst', label: 'Analyst', description: 'Precise, structured, metrics-first.' },
                          { id: 'product-manager', label: 'Product', description: 'User-centric, prioritization-focused.' },
                          { id: 'system-admin', label: 'Ops', description: 'Conservative, safety-first, procedural.' },
                        ] as Array<{ id: OpenClawPersonaTemplateId; label: string; description: string }>).map(option => {
                          const active = persona.templateId === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              className={`openclaw-choice-card${active ? ' active' : ''}`}
                              onClick={() => {
                                const next = applyPersonaTemplate(option.id, persona);
                                setPersona({ ...next, templateId: option.id });
                                void saveSettingsPatch({
                                  openClawPersonaTemplate: option.id,
                                  openClawPersonaName: next.name,
                                  openClawPersonaTone: next.tone,
                                  openClawPersonaExpertise: next.expertise,
                                  openClawPersonaBoundaries: next.boundaries,
                                  openClawPersonaOperatingInstructions: next.operatingInstructions,
                                });
                              }}
                            >
                              <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{option.label}</div>
                              <div style={{ marginTop: '6px', fontSize: '0.8rem', lineHeight: 1.55, color: active ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>
                                {option.description}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <label className="openclaw-field-label" htmlFor="openclaw-persona-name">Name</label>
                      <input
                        id="openclaw-persona-name"
                        className="input-field"
                        value={persona.name}
                        onChange={e => {
                          const next = { ...persona, name: e.target.value };
                          setPersona(next);
                          void saveSettingsPatch({ openClawPersonaName: next.name });
                        }}
                        placeholder="Agent display name"
                      />
                    </div>
                    <div>
                      <label className="openclaw-field-label" htmlFor="openclaw-persona-tone">Tone</label>
                      <textarea
                        id="openclaw-persona-tone"
                        className="input-field"
                        rows={2}
                        value={persona.tone}
                        onChange={e => {
                          const next = { ...persona, tone: e.target.value };
                          setPersona(next);
                          void saveSettingsPatch({ openClawPersonaTone: next.tone });
                        }}
                        placeholder="How the agent should sound (e.g., concise, formal, friendly)"
                        style={{ resize: 'vertical' }}
                      />
                    </div>
                    <div>
                      <label className="openclaw-field-label" htmlFor="openclaw-persona-expertise">Expertise</label>
                      <textarea
                        id="openclaw-persona-expertise"
                        className="input-field"
                        rows={2}
                        value={persona.expertise}
                        onChange={e => {
                          const next = { ...persona, expertise: e.target.value };
                          setPersona(next);
                          void saveSettingsPatch({ openClawPersonaExpertise: next.expertise });
                        }}
                        placeholder="What the agent should know about"
                        style={{ resize: 'vertical' }}
                      />
                    </div>
                    <div>
                      <label className="openclaw-field-label" htmlFor="openclaw-persona-boundaries">Boundaries</label>
                      <textarea
                        id="openclaw-persona-boundaries"
                        className="input-field"
                        rows={2}
                        value={persona.boundaries}
                        onChange={e => {
                          const next = { ...persona, boundaries: e.target.value };
                          setPersona(next);
                          void saveSettingsPatch({ openClawPersonaBoundaries: next.boundaries });
                        }}
                        placeholder="What the agent must NOT do or pretend to do"
                        style={{ resize: 'vertical' }}
                      />
                    </div>
                    <div>
                      <label className="openclaw-field-label" htmlFor="openclaw-persona-instructions">Operating instructions</label>
                      <textarea
                        id="openclaw-persona-instructions"
                        className="input-field"
                        rows={2}
                        value={persona.operatingInstructions}
                        onChange={e => {
                          const next = { ...persona, operatingInstructions: e.target.value };
                          setPersona(next);
                          void saveSettingsPatch({ openClawPersonaOperatingInstructions: next.operatingInstructions });
                        }}
                        placeholder="Default behavior rules (e.g., ask clarifications, show task state)"
                        style={{ resize: 'vertical' }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="openclaw-card">
                <div className="openclaw-card-header">
                  <div>
                    <div className="openclaw-section-label">User profile</div>
                    <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {userProfileSummary}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="openclaw-inline-button"
                    onClick={() => setUserProfilePanelOpen(v => !v)}
                  >
                    {userProfilePanelOpen ? 'Collapse' : 'Edit'}
                  </button>
                </div>
                {userProfilePanelOpen && (
                  <div style={{ display: 'grid', gap: '10px' }}>
                    <div>
                      <label className="openclaw-field-label" htmlFor="openclaw-user-name">Name</label>
                      <input
                        id="openclaw-user-name"
                        className="input-field"
                        value={userProfile.name}
                        onChange={e => {
                          const next = { ...userProfile, name: e.target.value };
                          setUserProfile(next);
                          void saveSettingsPatch({ openClawUserProfileName: next.name });
                        }}
                        placeholder="Your name"
                      />
                    </div>
                    <div>
                      <label className="openclaw-field-label" htmlFor="openclaw-user-role">Role</label>
                      <input
                        id="openclaw-user-role"
                        className="input-field"
                        value={userProfile.role}
                        onChange={e => {
                          const next = { ...userProfile, role: e.target.value };
                          setUserProfile(next);
                          void saveSettingsPatch({ openClawUserProfileRole: next.role });
                        }}
                        placeholder="e.g., Software Engineer, Product Manager"
                      />
                    </div>
                    <div>
                      <label className="openclaw-field-label" htmlFor="openclaw-user-preferences">Preferences</label>
                      <textarea
                        id="openclaw-user-preferences"
                        className="input-field"
                        rows={2}
                        value={userProfile.preferences}
                        onChange={e => {
                          const next = { ...userProfile, preferences: e.target.value };
                          setUserProfile(next);
                          void saveSettingsPatch({ openClawUserProfilePreferences: next.preferences });
                        }}
                        placeholder="How you like to receive answers (e.g., bullet points, minimal prose)"
                        style={{ resize: 'vertical' }}
                      />
                    </div>
                    <div>
                      <label className="openclaw-field-label" htmlFor="openclaw-user-context">Context</label>
                      <textarea
                        id="openclaw-user-context"
                        className="input-field"
                        rows={3}
                        value={userProfile.context}
                        onChange={e => {
                          const next = { ...userProfile, context: e.target.value };
                          setUserProfile(next);
                          void saveSettingsPatch({ openClawUserProfileContext: next.context });
                        }}
                        placeholder="Relevant background for the agent to know (team, stack, goals)"
                        style={{ resize: 'vertical' }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="openclaw-card">
                <div className="openclaw-card-header">
                  <div>
                    <div className="openclaw-section-label">Shell execution</div>
                    <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {!shellGranted ? 'Blocked by account permission' : shellEnabled ? 'Enabled' : 'Disabled'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="openclaw-inline-button"
                    onClick={() => {
                      if (!shellGranted) return;
                      setWorkspaceControlsModalOpen(false);
                      setShellSettingsOpen(true);
                    }}
                    disabled={!shellGranted}
                  >
                    <Settings size={14} /> Configure
                  </button>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {!shellGranted
                    ? 'This account does not have WorkSpaces shell permission. An admin must grant it in Settings -> User Management before personal shell settings can take effect.'
                    : shellEnabled
                      ? 'Agent can request shell command execution. Commands require approval in ask-first mode.'
                      : 'Shell execution is disabled in personal settings. Enable it to allow command execution.'}
                </div>
              </div>

              <div className="openclaw-card">
                <button
                  type="button"
                  className="openclaw-disclosure-toggle"
                  onClick={() => {
                    setAutomationPanelOpen(open => !open);
                    if (!automationPanelOpen) {
                      void loadAutomationState();
                    }
                  }}
                  aria-expanded={automationPanelOpen}
                >
                  <div className="openclaw-disclosure-summary">
                    <div>
                      <div className="openclaw-section-label">Autonomous scheduling</div>
                      <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {automationLoading ? 'Loading automation state...' : automationSummary}
                      </div>
                    </div>
                    <div className="openclaw-disclosure-pill-row">
                      <span className="openclaw-disclosure-pill">
                        Worker: {automationWorker.running ? 'Running' : 'Stopped'}
                      </span>
                      <span className="openclaw-disclosure-pill">
                        Nudges: {openAutomationNudgeCount}
                      </span>
                    </div>
                  </div>
                  <ChevronDown
                    size={16}
                    className={`openclaw-disclosure-chevron${automationPanelOpen ? ' is-open' : ''}`}
                  />
                </button>

                {automationPanelOpen && (
                  <div className="openclaw-disclosure-body">
                    {!automationPermissionGranted ? (
                      <div style={{ display: 'grid', gap: '8px' }}>
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                          This account does not have WorkSpaces automation permission. An admin must grant it before heartbeat check-ins, schedules, monitors, or wake events can run.
                        </div>
                        {automationActionRequired && (
                          <div style={{ fontSize: '0.78rem', color: 'var(--danger)' }}>
                            {automationActionRequired}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gap: '14px' }}>
                        <div className="openclaw-card">
                          <div className="openclaw-card-header">
                            <div>
                              <div className="openclaw-section-label">Worker status</div>
                              <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                Polling background heartbeats, cron schedules, file checks, and URL checks every 30 seconds.
                              </div>
                            </div>
                            <button
                              type="button"
                              className="openclaw-inline-button"
                              onClick={() => void loadAutomationState()}
                              disabled={automationLoading}
                            >
                              {automationLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                              Refresh
                            </button>
                          </div>
                          <div style={{ display: 'grid', gap: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            <div>Status: {automationWorker.running ? 'running' : 'stopped'} · loops: {automationWorker.loopCount}</div>
                            <div>Started: {formatAutomationTimestamp(automationWorker.startedAt)}</div>
                            <div>Last tick: {formatAutomationTimestamp(automationWorker.lastTickAt)}</div>
                            {automationWorker.lastError && (
                              <div style={{ color: 'var(--danger)' }}>Last worker error: {automationWorker.lastError}</div>
                            )}
                            {automationError && (
                              <div style={{ color: 'var(--danger)' }}>{automationError}</div>
                            )}
                          </div>
                        </div>

                        <div className="openclaw-card">
                          <div className="openclaw-card-header">
                            <div>
                              <div className="openclaw-section-label">Heartbeat check-ins</div>
                              <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                Create proactive reminders for stale WorkSpaces threads.
                              </div>
                            </div>
                            <button
                              type="button"
                              className={`openclaw-toggle${automationHeartbeat.enabled ? ' active' : ''}`}
                              onClick={() => void saveHeartbeatConfig({ enabled: !automationHeartbeat.enabled })}
                              disabled={automationSaving}
                            >
                              {automationHeartbeat.enabled ? 'Enabled' : 'Disabled'}
                            </button>
                          </div>
                          <div style={{ display: 'grid', gap: '10px' }}>
                            <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                              <label style={{ display: 'grid', gap: '6px' }}>
                                <span className="openclaw-field-label">Interval (minutes)</span>
                                <input
                                  className="input-field"
                                  type="number"
                                  min={15}
                                  max={1440}
                                  value={automationHeartbeat.intervalMinutes}
                                  onChange={event => setAutomationHeartbeat(current => ({
                                    ...current,
                                    intervalMinutes: Math.max(15, Number(event.target.value) || 15),
                                  }))}
                                />
                              </label>
                              <label style={{ display: 'grid', gap: '6px' }}>
                                <span className="openclaw-field-label">Stale after (minutes)</span>
                                <input
                                  className="input-field"
                                  type="number"
                                  min={15}
                                  max={10080}
                                  value={automationHeartbeat.staleAfterMinutes}
                                  onChange={event => setAutomationHeartbeat(current => ({
                                    ...current,
                                    staleAfterMinutes: Math.max(15, Number(event.target.value) || 15),
                                  }))}
                                />
                              </label>
                            </div>
                            <label style={{ display: 'grid', gap: '6px' }}>
                              <span className="openclaw-field-label">Heartbeat prompt</span>
                              <textarea
                                className="input-field"
                                rows={3}
                                value={automationHeartbeat.promptTemplate}
                                onChange={event => setAutomationHeartbeat(current => ({
                                  ...current,
                                  promptTemplate: event.target.value,
                                }))}
                                style={{ resize: 'vertical' }}
                                placeholder="Review stale WorkSpaces tasks and suggest the single best next action."
                              />
                            </label>
                            <label style={{ display: 'grid', gap: '6px' }}>
                              <span className="openclaw-field-label">Delivery mode</span>
                              <select
                                className="input-field"
                                value={automationHeartbeat.deliveryMode}
                                onChange={event => setAutomationHeartbeat(current => ({
                                  ...current,
                                  deliveryMode: event.target.value === 'background-run' ? 'background-run' : 'nudge',
                                }))}
                              >
                                <option value="nudge">Nudge only</option>
                                <option value="background-run">Run model unattended</option>
                              </select>
                            </label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="openclaw-inline-button"
                                onClick={() => void saveHeartbeatConfig({
                                  intervalMinutes: automationHeartbeat.intervalMinutes,
                                  staleAfterMinutes: automationHeartbeat.staleAfterMinutes,
                                  promptTemplate: automationHeartbeat.promptTemplate,
                                  deliveryMode: automationHeartbeat.deliveryMode,
                                })}
                                disabled={automationSaving}
                              >
                                Save heartbeat
                              </button>
                              <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                Next run: {formatAutomationTimestamp(automationHeartbeat.nextRunAt)} · Last status: {automationHeartbeat.lastStatus}
                              </span>
                            </div>
                            {automationHeartbeat.deliveryMode === 'background-run' && (
                              <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                Unattended runs attach to the current WorkSpaces thread and selected workspace when available.
                              </div>
                            )}
                            {automationHeartbeat.lastError && (
                              <div style={{ fontSize: '0.76rem', color: 'var(--danger)' }}>
                                {automationHeartbeat.lastError}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="openclaw-card">
                          <div className="openclaw-card-header">
                            <div>
                              <div className="openclaw-section-label">Cron schedules</div>
                              <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                Queue recurring task prompts without keeping a browser tab open.
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'grid', gap: '10px' }}>
                            {automationSchedules.length === 0 ? (
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                No recurring schedules yet.
                              </div>
                            ) : (
                              <div style={{ display: 'grid', gap: '10px' }}>
                                {automationSchedules.map(schedule => (
                                  <div key={schedule.id} style={{ display: 'grid', gap: '8px', padding: '12px', borderRadius: '14px', border: '1px solid var(--border-color)', background: 'var(--panel-bg)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                                      <div>
                                        <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{schedule.name}</div>
                                        <div style={{ marginTop: '4px', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                          {schedule.cronExpression} · {schedule.timezone} · {schedule.deliveryMode === 'background-run' ? 'background run' : 'nudge'} · next {formatAutomationTimestamp(schedule.nextRunAt)}
                                        </div>
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                        <button
                                          type="button"
                                          className={`openclaw-toggle${schedule.enabled ? ' active' : ''}`}
                                          onClick={() => void toggleAutomationSchedule(schedule)}
                                          disabled={automationSaving}
                                        >
                                          {schedule.enabled ? 'Enabled' : 'Paused'}
                                        </button>
                                        <button
                                          type="button"
                                          className="openclaw-inline-button"
                                          onClick={() => void deleteAutomationScheduleRecord(schedule.id)}
                                          disabled={automationSaving}
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    </div>
                                    <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                                      {schedule.prompt}
                                    </div>
                                    {schedule.lastError && (
                                      <div style={{ fontSize: '0.76rem', color: 'var(--danger)' }}>{schedule.lastError}</div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            <div style={{ display: 'grid', gap: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
                              <div className="openclaw-section-label">Create schedule</div>
                              <input
                                className="input-field"
                                value={newScheduleName}
                                onChange={event => setNewScheduleName(event.target.value)}
                                placeholder="Daily standup reminder"
                              />
                              <textarea
                                className="input-field"
                                rows={3}
                                value={newSchedulePrompt}
                                onChange={event => setNewSchedulePrompt(event.target.value)}
                                placeholder="What should the agent remind or review when this schedule fires?"
                                style={{ resize: 'vertical' }}
                              />
                              <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                                <input
                                  className="input-field"
                                  value={newScheduleCron}
                                  onChange={event => setNewScheduleCron(event.target.value)}
                                  placeholder="0 9 * * 1-5"
                                />
                                <input
                                  className="input-field"
                                  value={newScheduleTimezone}
                                  onChange={event => setNewScheduleTimezone(event.target.value)}
                                  placeholder="America/New_York"
                                />
                              </div>
                              <select
                                className="input-field"
                                value={newScheduleDeliveryMode}
                                onChange={event => setNewScheduleDeliveryMode(
                                  event.target.value === 'background-run' ? 'background-run' : 'nudge'
                                )}
                              >
                                <option value="nudge">Nudge only</option>
                                <option value="background-run">Run model unattended</option>
                              </select>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  className="openclaw-inline-button"
                                  onClick={() => void createAutomationScheduleRecord()}
                                  disabled={automationSaving}
                                >
                                  <Plus size={12} />
                                  Add schedule
                                </button>
                                <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                  Cron format: minute hour day month weekday
                                </span>
                              </div>
                              {newScheduleDeliveryMode === 'background-run' && (
                                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                  The run will post into the current WorkSpaces thread and selected workspace if one is active when you create it.
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="openclaw-card">
                          <div className="openclaw-card-header">
                            <div>
                              <div className="openclaw-section-label">Background monitors</div>
                              <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                Poll URLs or host files and raise nudges when they change, match content, or disappear.
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'grid', gap: '10px' }}>
                            {automationMonitors.length === 0 ? (
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                No monitors configured yet.
                              </div>
                            ) : (
                              <div style={{ display: 'grid', gap: '10px' }}>
                                {automationMonitors.map(monitor => (
                                  <div key={monitor.id} style={{ display: 'grid', gap: '8px', padding: '12px', borderRadius: '14px', border: '1px solid var(--border-color)', background: 'var(--panel-bg)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                                      <div>
                                        <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{monitor.name}</div>
                                        <div style={{ marginTop: '4px', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                          {monitor.kind.toUpperCase()} · {monitor.triggerMode} · {monitor.deliveryMode === 'background-run' ? 'background run' : 'nudge'} · every {monitor.checkIntervalSeconds}s · next {formatAutomationTimestamp(monitor.nextCheckAt)}
                                        </div>
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                        <button
                                          type="button"
                                          className={`openclaw-toggle${monitor.enabled ? ' active' : ''}`}
                                          onClick={() => void toggleAutomationMonitor(monitor)}
                                          disabled={automationSaving}
                                        >
                                          {monitor.enabled ? 'Enabled' : 'Paused'}
                                        </button>
                                        <button
                                          type="button"
                                          className="openclaw-inline-button"
                                          onClick={() => void deleteAutomationMonitorRecord(monitor.id)}
                                          disabled={automationSaving}
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                                      Target: {monitor.target}
                                      {monitor.expectedPattern ? `\nPattern: ${monitor.expectedPattern}` : ''}
                                      {monitor.lastSummary ? `\nLast summary: ${monitor.lastSummary}` : ''}
                                    </div>
                                    {monitor.lastError && (
                                      <div style={{ fontSize: '0.76rem', color: 'var(--danger)' }}>{monitor.lastError}</div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            <div style={{ display: 'grid', gap: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
                              <div className="openclaw-section-label">Create monitor</div>
                              <input
                                className="input-field"
                                value={newMonitorName}
                                onChange={event => setNewMonitorName(event.target.value)}
                                placeholder="Release notes page watcher"
                              />
                              <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                                <select
                                  className="input-field"
                                  value={newMonitorKind}
                                  onChange={event => setNewMonitorKind(event.target.value === 'file' ? 'file' : 'url')}
                                >
                                  <option value="url">URL monitor</option>
                                  <option value="file">File monitor</option>
                                </select>
                                <select
                                  className="input-field"
                                  value={newMonitorTriggerMode}
                                  onChange={event => setNewMonitorTriggerMode(
                                    event.target.value === 'contains' || event.target.value === 'missing'
                                      ? event.target.value
                                      : 'changed'
                                  )}
                                >
                                  <option value="changed">Changed</option>
                                  <option value="contains">Contains text</option>
                                  <option value="missing">Missing / unavailable</option>
                                </select>
                              </div>
                              <input
                                className="input-field"
                                value={newMonitorTarget}
                                onChange={event => setNewMonitorTarget(event.target.value)}
                                placeholder={newMonitorKind === 'url' ? 'https://example.com/feed' : '/home/user/project/file.txt'}
                              />
                              <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                                <input
                                  className="input-field"
                                  type="number"
                                  min={30}
                                  max={86400}
                                  value={newMonitorIntervalSeconds}
                                  onChange={event => setNewMonitorIntervalSeconds(Math.max(30, Number(event.target.value) || 30))}
                                  placeholder="300"
                                />
                                <input
                                  className="input-field"
                                  value={newMonitorExpectedPattern}
                                  onChange={event => setNewMonitorExpectedPattern(event.target.value)}
                                  placeholder={newMonitorTriggerMode === 'contains' ? 'Required text to match' : 'Optional pattern'}
                                  disabled={newMonitorTriggerMode === 'changed'}
                                />
                              </div>
                              <select
                                className="input-field"
                                value={newMonitorDeliveryMode}
                                onChange={event => setNewMonitorDeliveryMode(
                                  event.target.value === 'background-run' ? 'background-run' : 'nudge'
                                )}
                              >
                                <option value="nudge">Nudge only</option>
                                <option value="background-run">Run model unattended</option>
                              </select>
                              <button
                                type="button"
                                className="openclaw-inline-button"
                                onClick={() => void createAutomationMonitorRecord()}
                                disabled={automationSaving}
                              >
                                <Plus size={12} />
                                Add monitor
                              </button>
                              {newMonitorDeliveryMode === 'background-run' && (
                                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                  The run will use the current WorkSpaces thread and selected workspace as its target when available.
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="openclaw-card">
                          <div className="openclaw-card-header">
                            <div>
                              <div className="openclaw-section-label">Wake-on-event</div>
                              <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                Create a manual wake event now, or POST to `/api/openclaw/automation/wake-event` from an external trigger.
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'grid', gap: '10px' }}>
                            <input
                              className="input-field"
                              value={wakeEventTitle}
                              onChange={event => setWakeEventTitle(event.target.value)}
                              placeholder="Wake event title"
                            />
                            <textarea
                              className="input-field"
                              rows={3}
                              value={wakeEventMessage}
                              onChange={event => setWakeEventMessage(event.target.value)}
                              placeholder="What happened, and what should the agent know?"
                              style={{ resize: 'vertical' }}
                            />
                            <select
                              className="input-field"
                              value={wakeEventDeliveryMode}
                              onChange={event => setWakeEventDeliveryMode(
                                event.target.value === 'background-run' ? 'background-run' : 'nudge'
                              )}
                            >
                              <option value="nudge">Nudge only</option>
                              <option value="background-run">Run model unattended</option>
                            </select>
                            <button
                              type="button"
                              className="openclaw-inline-button"
                              onClick={() => void createAutomationWakeEventRecord()}
                              disabled={automationSaving}
                            >
                              Trigger wake event
                            </button>
                            {wakeEventDeliveryMode === 'background-run' && (
                              <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                The wake event will post into the current WorkSpaces thread and selected workspace if present.
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="openclaw-card">
                          <div className="openclaw-card-header">
                            <div>
                              <div className="openclaw-section-label">Recent unattended runs</div>
                              <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                Durable background execution history for heartbeat, schedule, monitor, and wake-event runs.
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'grid', gap: '10px' }}>
                            {automationRuns.length === 0 ? (
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                No unattended runs recorded yet.
                              </div>
                            ) : (
                              automationRuns.map(run => (
                                <div key={run.id} style={{ display: 'grid', gap: '6px', padding: '12px', borderRadius: '14px', border: '1px solid var(--border-color)', background: 'var(--panel-bg)' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                                    <div>
                                      <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{run.title}</div>
                                      <div style={{ marginTop: '4px', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                        {run.sourceKind} · {run.status} · {run.model || 'model pending'} · created {formatAutomationTimestamp(run.createdAt)}
                                      </div>
                                    </div>
                                    <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                      {run.sessionId ? 'Thread-linked' : 'Standalone'}
                                    </div>
                                  </div>
                                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                                    {run.resultPreview || run.error || run.prompt}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        <div className="openclaw-card">
                          <div className="openclaw-card-header">
                            <div>
                              <div className="openclaw-section-label">Nudge inbox</div>
                              <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                Recent heartbeat check-ins, schedule fires, monitor triggers, and wake events.
                              </div>
                            </div>
                            <button
                              type="button"
                              className="openclaw-inline-button"
                              onClick={() => void markAutomationNudgesSeen(automationNudges.map(nudge => nudge.id))}
                              disabled={automationSaving || automationNudges.length === 0}
                            >
                              Mark all seen
                            </button>
                          </div>
                          {automationNudges.length === 0 ? (
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                              No nudges are waiting right now.
                            </div>
                          ) : (
                            <div style={{ display: 'grid', gap: '10px' }}>
                              {automationNudges.map(nudge => (
                                <div key={nudge.id} style={{ display: 'grid', gap: '8px', padding: '12px', borderRadius: '14px', border: '1px solid var(--border-color)', background: 'var(--panel-bg)' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                                    <div>
                                      <div style={{ fontSize: '0.88rem', fontWeight: 700 }}>{nudge.title}</div>
                                      <div style={{ marginTop: '4px', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                        {formatAutomationTimestamp(nudge.createdAt)} · {nudge.kind}
                                      </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                      {nudge.sessionId && (
                                        <button
                                          type="button"
                                          className="openclaw-inline-button"
                                          onClick={() => openAutomationNudgeSession(nudge)}
                                        >
                                          Open thread
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        className="openclaw-inline-button"
                                        onClick={() => void dismissAutomationNudge(nudge.id)}
                                        disabled={automationSaving}
                                      >
                                        Dismiss
                                      </button>
                                    </div>
                                  </div>
                                  <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                                    {nudge.message}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="openclaw-card">
                <button
                  type="button"
                  className="openclaw-disclosure-toggle"
                  onClick={() => setWorkspaceCapabilitiesOpen(open => !open)}
                  aria-expanded={workspaceCapabilitiesOpen}
                >
                  <div className="openclaw-disclosure-summary">
                    <div>
                      <div className="openclaw-section-label">Workspace capabilities</div>
                      <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        Modeled after WorkSpaces’s task-first workspace flow
                      </div>
                    </div>
                    <div className="openclaw-disclosure-pill-row">
                      <span className="openclaw-disclosure-pill">FS: {filesystemAccessBadge}</span>
                      <span className="openclaw-disclosure-pill">Writes: {filesystemWriteBadge}</span>
                      <span className="openclaw-disclosure-pill">Code: {codeSandboxBadge}</span>
                      <span className="openclaw-disclosure-pill">Browser: {browserControlBadge}</span>
                    </div>
                  </div>
                  <ChevronDown
                    size={16}
                    className={`openclaw-disclosure-chevron${workspaceCapabilitiesOpen ? ' is-open' : ''}`}
                  />
                </button>

                {workspaceCapabilitiesOpen && (
                  <div className="openclaw-disclosure-body">
                    <div className="openclaw-card">
                      <div className="openclaw-card-header">
                        <div>
                          <div className="openclaw-section-label">Filesystem access</div>
                          <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {filesystemAccessSummary}
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {!filesystemGranted
                          ? 'This account does not have WorkSpaces filesystem permission. An admin must grant it in Settings -> User Management before approved paths in personal settings can take effect.'
                          : filesystemEnabled
                            ? allowedFilesystemPaths.length > 0
                              ? `Agent can inspect approved host paths in read-only mode: ${allowedFilesystemPaths.join(', ')}`
                              : 'Read-only mode is enabled, but no host paths are approved yet. Add paths in Settings to let the agent inspect files.'
                            : 'Filesystem access is disabled in personal settings. Enable it to allow read-only host file inspection.'}
                      </div>
                    </div>

                    <div className="openclaw-card">
                      <div className="openclaw-card-header">
                        <div>
                          <div className="openclaw-section-label">Filesystem writes</div>
                          <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {filesystemWriteSummary}
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {!filesystemGranted
                          ? 'This account does not have WorkSpaces filesystem permission, so write settings are ignored until an admin grants it.'
                          : filesystemWriteEnabled
                            ? allowedWritablePaths.length > 0
                              ? `Agent can create folders and write text files inside approved writable roots: ${allowedWritablePaths.join(', ')}`
                              : 'Write mode is enabled, but no writable roots are configured yet in Settings.'
                            : 'Filesystem writes are disabled in personal settings. Enable them if you want WorkSpaces to create or edit files.'}
                      </div>
                    </div>

                    <div className="openclaw-card">
                      <div className="openclaw-card-header">
                        <div>
                          <div className="openclaw-section-label">Code sandbox</div>
                          <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {codeSandboxSummary}
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {!codeGranted
                          ? 'This account does not have WorkSpaces code-execution permission. An admin must grant it before personal code settings can take effect.'
                          : codeExecutionEnabled
                            ? 'Agent can run short Python or Node scripts in the managed WorkSpaces workspace with sandbox guardrails.'
                            : 'Code execution sandbox is disabled in personal settings. Enable it to let WorkSpaces run short scripts.'}
                      </div>
                    </div>

                    <div className="openclaw-card">
                      <div className="openclaw-card-header">
                        <div>
                          <div className="openclaw-section-label">Browser control</div>
                          <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {browserControlSummary}
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {!browserGranted
                          ? 'This account does not have WorkSpaces browser permission. An admin must grant it before personal browser settings can take effect.'
                          : browserEnabled
                            ? browserMode === 'read-only'
                              ? 'Agent can navigate and inspect public web pages, but form fill and submit actions are blocked.'
                              : 'Agent can navigate public pages and request approval before submitting forms or other state-changing browser actions.'
                            : 'Browser control is disabled in personal settings. Enable it to allow page navigation, scraping, and controlled form workflows.'}
                      </div>
                    </div>

                    <div className="openclaw-card">
                      <div className="openclaw-card-header">
                        <div className="openclaw-section-label">Workspace capabilities</div>
                        <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>Modeled after WorkSpaces’s task-first workspace flow</span>
                      </div>
                      <div style={{ display: 'grid', gap: '8px' }}>
                        <div className="openclaw-capability-row">
                          <Bot size={15} />
                          <span>Persistent task modes, response styles, and task criteria.</span>
                        </div>
                        <div className="openclaw-capability-row">
                          <Globe size={15} />
                          <span>When Internet mode is on, the model can search the web for current information and cite sources.</span>
                        </div>
                        <div className="openclaw-capability-row">
                          <BookOpen size={15} />
                          <span>Optional Knowledge Base grounding for local project and document context.</span>
                        </div>
                        <div className="openclaw-capability-row">
                          <MessageSquare size={15} />
                          <span>Separate task threads so planning and execution sessions do not mix.</span>
                        </div>
                        <div className="openclaw-capability-row">
                          <Server size={15} />
                          <span>Optional read-only host file inspection for approved paths such as your workspace or `/tmp`.</span>
                        </div>
                        <div className="openclaw-capability-row">
                          <Wand2 size={15} />
                          <span>Managed file writes, sandboxed code runs, and browser workflows behind explicit approval gates.</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
                    </div>
                  </div>
                </div>
              )}
          </div>
            <div className="openclaw-card">
                <div className="openclaw-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <div className="openclaw-section-label">Canvas</div>
                    <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>{canvasArtifacts.length} artifact{canvasArtifacts.length !== 1 ? 's' : ''}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCanvasMinimized(prev => !prev)}
                    title={canvasMinimized ? 'Expand Canvas' : 'Minimize Canvas'}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {canvasMinimized ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                  </button>
                </div>
                {!canvasMinimized && (
                  <CanvasPanel
                    key={currentSessionId ?? 'draft-canvas'}
                    artifacts={canvasArtifacts}
                    onUpdate={async (id, content, name) => {
                      try {
                        const res = await fetch(`/api/canvas/artifacts/${id}`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ content, name })
                        });
                        if (res.ok) {
                          const data = await res.json();
                          setCanvasArtifacts(prev => prev.flatMap(a => {
                            if (!a) return [];
                            return [a.id === id ? data.artifact : a];
                          }));
                          return data.artifact;
                        }
                        const data = await res.json().catch(() => ({}));
                        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to update artifact');
                      } catch (error) {
                        console.error("Failed to update artifact:", error);
                        throw error;
                      }
                    }}
                    onDelete={async (id) => {
                      await deleteArtifactById(id);
                    }}
                    onRefresh={() => {
                      if (currentSessionId) {
                        return loadCanvasArtifacts(currentSessionId, { query: canvasSearchQuery });
                      }
                      return Promise.resolve();
                    }}
                    onDownload={(artifact) => {
                      if (isBinaryArtifact(artifact)) {
                        const a = document.createElement("a");
                        a.href = `/api/canvas/artifacts/${artifact.id}/download`;
                        a.download = artifact.name;
                        a.rel = "noopener";
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        return;
                      }
                      const blob = new Blob([artifact.content || ''], { type: artifact.mimeType });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = artifact.name;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    onFetchContent={async (id) => {
                      try {
                        const res = await fetch(`/api/canvas/artifacts/${id}`);
                        if (res.ok) {
                          const data = await res.json();
                          return data.artifact;
                        }
                      } catch (error) {
                        console.error("Failed to fetch artifact content:", error);
                      }
                      return null;
                    }}
                    onFetchRevisions={async (id) => {
                      try {
                        const res = await fetch(`/api/canvas/artifacts/${id}/revisions?includeContent=1`);
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) {
                          throw new Error(typeof data.error === 'string' ? data.error : 'Failed to fetch artifact revisions');
                        }
                        return Array.isArray(data.revisions) ? data.revisions as CanvasArtifactRevisionRecord[] : [];
                      } catch (error) {
                        console.error("Failed to fetch artifact revisions:", error);
                        throw error;
                      }
                    }}
                    onRestoreRevision={async (id, version) => {
                      try {
                        const res = await fetch(`/api/canvas/artifacts/${id}/revisions`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ version }),
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) {
                          throw new Error(typeof data.error === 'string' ? data.error : 'Failed to restore artifact revision');
                        }
                        setCanvasArtifacts(prev => prev.map(a => a?.id === id ? data.artifact : a));
                        return data.artifact;
                      } catch (error) {
                        console.error("Failed to restore artifact revision:", error);
                        throw error;
                      }
                    }}
                    onLoadMore={() => {
                      if (!currentSessionId || !canvasNextCursor) return;
                      void loadCanvasArtifacts(currentSessionId, { append: true, cursor: canvasNextCursor });
                    }}
                    onSearch={(query) => {
                      setCanvasSearchQuery(query);
                      if (!currentSessionId) return;
                      void loadCanvasArtifacts(currentSessionId, { query });
                    }}
                    hasMore={canvasHasMore}
                    loading={canvasLoading}
                    error={canvasError}
                    searchQuery={canvasSearchQuery}
                    totalCount={canvasTotalCount}
                  />
                )}
            </div>

            {/* UWAF Network Hub Panel */}
            {uwafBrowserEnabled && (
              <UwafNetworkPanel
                currentMode={uwafBrowserMode}
                onModeChange={switchUwafBrowserMode}
              />
            )}

            {/* UWAF Browser — Live View (shown when internet is enabled) */}
            {internetEnabled && uwafBrowserEnabled && settings?.openClawUwafLiveBrowser && currentSessionId && browserLiveStatus !== 'failed' && !browserModalOpen ? (
              <LiveBrowserView
                key={`${currentSessionId}:${uwafBrowserMode}:inline`}
                sessionId={currentSessionId}
                mode={uwafBrowserMode}
                currentUrl={uwafCurrentUrl}
                title={uwafCurrentTitle}
                onInterruptChange={setBrowserInterrupted}
                onStatusChange={setBrowserLiveStatus}
                enabled={true}
              />
            ) : null}

            {/* Live Browser Expand Button */}
            {internetEnabled && uwafBrowserEnabled && settings?.openClawUwafLiveBrowser && currentSessionId && browserLiveStatus !== 'failed' && !browserModalOpen && (
              <div style={{ padding: '4px 12px' }}>
                <button
                  onClick={() => setBrowserModalOpen(true)}
                  style={{
                    width: '100%',
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    padding: '6px 0',
                    borderRadius: 4,
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                  }}
                >
                  Expand Browser
                </button>
              </div>
            )}

            {/* Browser Modal */}
            {browserModalOpen && currentSessionId && (
              <BrowserModal
                key={`${currentSessionId}:${uwafBrowserMode}:modal`}
                sessionId={currentSessionId}
                mode={uwafBrowserMode}
                currentUrl={uwafCurrentUrl}
                title={uwafCurrentTitle}
                enabled={settings?.openClawUwafLiveBrowser ?? true}
                isOpen={browserModalOpen}
                onOpenChange={setBrowserModalOpen}
                onInterruptChange={setBrowserInterrupted}
                takeoverRequestId={browserTakeoverRequestId}
              />
            )}

            <div className="openclaw-rail-footer">
              {configSaving ? 'Saving settings...' : configError || connectionSummary || modelControlNote || selectedSessionInfo}
            </div>
          </>
        )}
      </aside>

      {showNewFolderModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowNewFolderModal(false)}
        >
          <div
            style={{
              background: 'var(--sidebar-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: '16px',
              padding: '24px',
              width: '320px',
              maxWidth: '90vw',
            }}
            onClick={event => event.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: '1rem' }}>New Folder</h3>
            <input
              type="text"
              placeholder="Folder name"
              value={newFolderName}
              onChange={event => setNewFolderName(event.target.value)}
              className="input-field"
              style={{ width: '100%', marginBottom: '12px' }}
              autoFocus
              onKeyDown={event => event.key === 'Enter' && void handleCreateFolder()}
            />
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              {['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'].map(color => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setNewFolderColor(color)}
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    border: newFolderColor === color ? '2px solid white' : '2px solid transparent',
                    background: color,
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowNewFolderModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void handleCreateFolder()}>Create</button>
            </div>
          </div>
        </div>
      )}

      {showNewTagModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowNewTagModal(false)}
        >
          <div
            style={{
              background: 'var(--sidebar-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: '16px',
              padding: '24px',
              width: '320px',
              maxWidth: '90vw',
            }}
            onClick={event => event.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: '1rem' }}>New Tag</h3>
            <input
              type="text"
              placeholder="Tag name"
              value={newTagName}
              onChange={event => setNewTagName(event.target.value)}
              className="input-field"
              style={{ width: '100%', marginBottom: '12px' }}
              autoFocus
              onKeyDown={event => event.key === 'Enter' && void handleCreateTag()}
            />
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              {['#10b981', '#6366f1', '#f59e0b', '#ef4444', '#8b5cf6'].map(color => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setNewTagColor(color)}
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    border: newTagColor === color ? '2px solid white' : '2px solid transparent',
                    background: color,
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowNewTagModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void handleCreateTag()}>Create</button>
            </div>
          </div>
        </div>
      )}

      {branchCompareOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Compare session branches"
          onClick={() => setBranchCompareOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1250,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            background: 'rgba(3, 6, 23, 0.66)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div
            onClick={event => event.stopPropagation()}
            style={{
              width: 'min(1200px, calc(100vw - 32px))',
              maxHeight: 'min(88vh, 960px)',
              overflowY: 'auto',
              padding: '18px',
              borderRadius: '18px',
              border: '1px solid var(--border-color)',
              background: 'var(--sidebar-bg)',
              boxShadow: '0 24px 72px rgba(0, 0, 0, 0.42)',
              display: 'grid',
              gap: '14px',
            }}
          >
            <div className="openclaw-card" style={{ gap: '12px', position: 'sticky', top: 0, zIndex: 1, background: 'var(--sidebar-bg)' }}>
              <div className="openclaw-card-header">
                <div>
                  <div className="openclaw-section-label">Compare branches</div>
                  <div style={{ marginTop: '6px', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                    Compare summaries, analytics, and latest outcomes across related WorkSpaces session branches.
                  </div>
                </div>
                <button
                  type="button"
                  className="openclaw-inline-button"
                  onClick={() => setBranchCompareOpen(false)}
                >
                  <X size={14} />
                  Close
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                <div>
                  <label className="openclaw-field-label" htmlFor="branch-compare-left">Left branch</label>
                  <select
                    id="branch-compare-left"
                    className="input-field"
                    value={branchCompareLeftId}
                    onChange={event => setBranchCompareLeftId(event.target.value)}
                  >
                    <option value="">Select session</option>
                    {(currentBranchFamily.length > 0 ? currentBranchFamily : safeSessions).map(session => (
                      <option key={session.id} value={session.id}>
                        {session.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="openclaw-field-label" htmlFor="branch-compare-right">Right branch</label>
                  <select
                    id="branch-compare-right"
                    className="input-field"
                    value={branchCompareRightId}
                    onChange={event => setBranchCompareRightId(event.target.value)}
                  >
                    <option value="">Select session</option>
                    {(currentBranchFamily.length > 0 ? currentBranchFamily : safeSessions)
                      .filter(session => session.id !== branchCompareLeftId)
                      .map(session => (
                        <option key={session.id} value={session.id}>
                          {session.title}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' }}>
              {[compareLeftSession, compareRightSession].map((session, index) => {
                const latestAssistant = session ? getLatestVisibleAssistantMessage(session.messages) : null;
                return (
                  <div key={index === 0 ? 'left' : 'right'} className="openclaw-card" style={{ gap: '12px' }}>
                    <div className="openclaw-card-header">
                      <div>
                        <div className="openclaw-section-label">{index === 0 ? 'Left branch' : 'Right branch'}</div>
                        <div style={{ marginTop: '4px', fontSize: '0.94rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {session?.title || 'No session selected'}
                        </div>
                        {session && (
                          <div style={{ marginTop: '6px', fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                            {session.branchLabel || 'Primary thread'} · Updated {formatTimestamp(session.updatedAt)}
                          </div>
                        )}
                      </div>
                    </div>
                    {session ? (
                      <div style={{ display: 'grid', gap: '10px' }}>
                        <div className="openclaw-disclosure-pill-row">
                          <span className="openclaw-disclosure-pill">{session.autoContinueMode} continue</span>
                          <span className="openclaw-disclosure-pill">{session.analytics?.assistantTokens.toLocaleString() || 0} tokens</span>
                          <span className="openclaw-disclosure-pill">{session.analytics?.toolCalls || 0} tools</span>
                          <span className="openclaw-disclosure-pill">{session.branchChildrenCount} child branches</span>
                        </div>
                        {session.summary && (
                          <div style={{ padding: '12px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--panel-bg)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                            <div className="openclaw-section-label" style={{ marginBottom: '8px' }}>Summary</div>
                            {session.summary}
                          </div>
                        )}
                        {session.contextSummary && (
                          <div style={{ padding: '12px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--panel-bg)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                            <div className="openclaw-section-label" style={{ marginBottom: '8px' }}>Working memory</div>
                            {session.contextSummary}
                          </div>
                        )}
                        <div style={{ padding: '12px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--panel-bg)' }}>
                          <div className="openclaw-section-label" style={{ marginBottom: '8px' }}>Latest assistant outcome</div>
                          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                            {latestAssistant?.content || 'No visible assistant response yet.'}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                        Select a session branch to compare.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Shell command approval modal */}
      <ShellCommandModal
        title={pendingApproval?.title || 'Tool Approval'}
        description={pendingApproval?.description}
        previewLabel={pendingApproval?.previewLabel || 'Request'}
        previewContent={pendingApproval?.previewContent || ''}
        toolKind={pendingApproval?.kind || 'shell'}
        isOpen={pendingApproval !== null}
        onApprove={handleToolApprove}
        onReject={handleToolReject}
        autoApproveSeconds={effectiveSessionAutoContinueMode === 'safe' ? 4 : undefined}
      />

      {/* Shell settings panel */}
      {shellSettingsOpen && (
        <ShellSettingsPanel onClose={() => {
          setShellSettingsOpen(false);
          void Promise.all([loadShellSettings(), loadSettings()]);
        }} />
      )}
    </div>
  );
}
