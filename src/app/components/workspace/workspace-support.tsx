import {
formatBytes,
type ExtractedFilePayload
} from '@/lib/file-shared';
import { normalizeMessageSources,type MessageSource } from '@/lib/message-sources';
import { type ResponsePresentation } from '@/lib/response-format';
import {
type SessionAnalytics,
type SessionAutoContinueMode
} from '@/lib/session-intelligence';
import { getStreamPhaseLabel,type UiStreamPhase } from '@/lib/stream-status';
import {
isCapabilityStatement
} from '@/lib/workspace-tool-narration-recovery';
import { isWindowsHostPath } from '@/lib/workspace-tool-path-check';
import {
buildEffectiveWorkspaceToolAccess,
type EffectiveWorkspaceToolAccess,
} from '@/lib/workspace-tool-tool-access';
import { wrapUntrustedToolResult } from '@/lib/workspace-tool-tool-output-trust';
import { type UwafBrowserToolResultEntry } from '@/lib/workspace-tool-tool-results';
import {
extractWorkspaceToolRequest,
type WorkspaceToolArchiveDocumentToolRequest,
type WorkspaceToolBrowserToolRequest,
type WorkspaceToolCalendarDocumentToolRequest,
type WorkspaceToolCodeToolRequest,
type WorkspaceToolCsvDocumentToolRequest,
type WorkspaceToolEmailDocumentToolRequest,
type WorkspaceToolFetchSummarizeToolRequest,
type WorkspaceToolFilesystemToolRequest,
type WorkspaceToolMarkdownDocumentToolRequest,
type WorkspaceToolMermaidDocumentToolRequest,
type WorkspaceToolPdfDocumentToolRequest,
type WorkspaceToolRequest,
type WorkspaceToolSlidesDocumentToolRequest,
type WorkspaceToolTaxReturnToolRequest,
type WorkspaceToolUwafBrowserToolRequest,
type WorkspaceToolWordDocumentToolRequest,
type WorkspaceToolWorkbookDocumentToolRequest
} from '@/lib/workspace-tool-tools';
import { Activity,Bot,Copy,MessageSquare } from 'lucide-react';
import React,{ memo,useEffect,useState } from 'react';
import { AssistantDownloads,ChatMessageContent,ThinkingBlock } from '../ChatMessageContent';
import MessageRenderBoundary from '../MessageRenderBoundary';
import ObjectUrlImage from '../ObjectUrlImage';
import ShellOutput from '../ShellOutput';
import SourceChips from '../SourceChips';

export type WorkspaceToolProvider = 'ollama' | 'openai-compatible';

export type ImageAttachmentMode = 'vision-only' | 'vision+ocr' | 'ocr-only';

export const MOBILE_BREAKPOINT = 960;

export const HUMAN_BROWSER_ASSIST_TIMEOUT_MS = 10 * 60 * 1000;

export const SESSION_PAGE_SIZE = 15;

export async function safeJson<T extends Record<string, unknown> = Record<string, unknown>>(
  res: Response,
): Promise<T> {
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    return {} as T
  }
  try {
    return (await res.json()) as T
  } catch {
    return {} as T
  }
}

export const IMAGE_ATTACHMENT_MODE_OPTIONS: Array<{ value: ImageAttachmentMode; label: string }> = [
  { value: 'vision-only', label: 'Vision only' },
  { value: 'vision+ocr', label: 'Vision + OCR' },
  { value: 'ocr-only', label: 'OCR only' },
];

export interface WorkspaceToolSession {
  id: string;
  title: string;
  updatedAt: number;
  pinned: boolean;
  surface: 'workspace-tool';
  messages: WorkspaceToolMessage[];
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

export interface WorkspaceToolWorkspaceRecord {
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

export interface AutomationWorkerState {
  running: boolean;
  startedAt: string | null;
  lastTickAt: string | null;
  loopCount: number;
  lastError: string | null;
}

export interface AutomationHeartbeatState {
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

export interface AutomationScheduleState {
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

export interface AutomationMonitorState {
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

export interface AutomationNotificationState {
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

export interface AutomationExecutionRunState {
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

export const DEFAULT_AUTOMATION_WORKER_STATE: AutomationWorkerState = {
  running: false,
  startedAt: null,
  lastTickAt: null,
  loopCount: 0,
  lastError: null,
};

export const DEFAULT_AUTOMATION_HEARTBEAT_STATE: AutomationHeartbeatState = {
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

export interface WorkspaceToolFolder {
  id: string;
  name: string;
  color: string;
  _count?: { sessions: number };
}

export interface WorkspaceToolTag {
  id: string;
  name: string;
  color: string;
  _count?: { sessions: number };
}

export interface WorkspaceToolModel {
  name: string;
  model: string;
}

export interface WorkspaceToolMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  hidden?: boolean;
  toolRequest?: 'shell' | 'filesystem' | 'web' | 'code' | 'browser' | 'unified_browser' | 'tax_return' | 'pdf_document' | 'workbook_document' | 'word_document' | 'csv_document' | 'email_document' | 'markdown_document' | 'slides_document' | 'archive_document' | 'calendar_document' | 'mermaid_document' | 'fetch_summarize' | 'image_generation' | 'notes_search' | 'notes_save' | 'http_request' | 'spreadsheet_query' | 'calendar_query';
  thinking?: string;
  presentation?: ResponsePresentation;
  sources?: MessageSource[];
  images?: WorkspaceToolImageAttachment[];
  attachments?: WorkspaceToolFileAttachment[];
  meta?: {
    tokens: number;
    duration: number;
    tps: number;
    timings?: WorkspaceToolLatencyTimings;
  };
  createdAt?: string;
}

export type WorkspaceToolLatencyTimings = Record<string, string | number | boolean | null>;

export interface WorkspaceToolImageAttachment {
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

export interface WorkspaceToolFileAttachment {
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

export function getWorkspaceToolImageSrc(image: WorkspaceToolImageAttachment) {
  if (image.previewUrl) return image.previewUrl;
  const mimeType = image.type || 'image/jpeg';
  return `data:${mimeType};base64,${image.data}`;
}

export function WorkspaceToolAttachedImagePreview({ image }: { image: WorkspaceToolImageAttachment }) {
  const [failed, setFailed] = useState(false);
  const imageSrc = getWorkspaceToolImageSrc(image);

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

export function getImageAttachmentSummary(mode: ImageAttachmentMode, hasOcrText: boolean) {
  if (mode === 'ocr-only') {
    return hasOcrText ? 'OCR text only' : 'OCR only selected, but no OCR text was extracted';
  }
  if (mode === 'vision+ocr') {
    return hasOcrText ? 'Image bytes + OCR text' : 'Image bytes only (no OCR text found)';
  }
  return 'Image bytes only';
}

export interface WorkspaceToolSettings {
  workspaceToolProvider: WorkspaceToolProvider;
  workspaceToolModel: string;
  workspaceToolBaseUrl: string;
  ollamaHost: string;
  ollamaUseCloudApi: boolean;
  ollamaApiKey: string;
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
  workspaceToolFileAccessMode: 'deny' | 'read-only';
  workspaceToolAllowedPaths: string;
  workspaceToolFileWriteMode: 'deny' | 'ask-first' | 'auto-approve';
  workspaceToolWritablePaths: string;
  workspaceToolHostAccessMode: 'deny' | 'ask-first' | 'auto-approve';
  workspaceToolWorkspaceHostRoot: string;
  workspaceToolCodeExecutionMode: 'deny' | 'ask-first' | 'auto-approve';
  workspaceToolBrowserMode: 'deny' | 'read-only' | 'ask-first';
  workspaceToolUwafBrowserMode: 'deny' | 'direct' | 'stealth';
  workspaceToolUwafDefaultMode: 'direct' | 'stealth';
  workspaceToolUwafLiveBrowser: boolean;
  workspaceToolAutomationExecutionEnabled: boolean;
  workspaceToolAutomationExecutionModel: string;
  workspaceToolAutomationExecutionMaxRunsPerHour: number;
  workspaceToolAutomationExecutionAttachWorkspace: boolean;
  workspaceToolAutomationExecutionAttachMemory: boolean;
  workspaceToolSessionAutoContinueDefault: SessionAutoContinueMode;
  workspaceToolSessionAutoContinueMaxSteps: number;
  workspaceToolMaxToolRoundsPerTurn: number;
  workspaceToolSessionSummariesEnabled: boolean;
  workspaceToolSessionSummaryTargetTokens: number;
  workspaceToolSessionPreserveTurns: number;
  workspaceToolSessionAnalyticsEnabled: boolean;
  workspaceToolSessionBranchingEnabled: boolean;
  ragEnabled: boolean;
  ragTopK: number;
  workspaceToolPersonaTemplate: string;
  workspaceToolPersonaName: string;
  workspaceToolPersonaTone: string;
  workspaceToolPersonaExpertise: string;
  workspaceToolPersonaBoundaries: string;
  workspaceToolPersonaOperatingInstructions: string;
  workspaceToolUserProfileName: string;
  workspaceToolUserProfileRole: string;
  workspaceToolUserProfilePreferences: string;
  workspaceToolUserProfileContext: string;
  workspaceToolFavoriteModels: string[];
}

export interface ParsedWorkspaceToolSettingsResponse {
  settings: WorkspaceToolSettings;
  effectiveToolAccess: EffectiveWorkspaceToolAccess;
}

export interface ParsedAutomationStateResponse {
  worker: AutomationWorkerState;
  heartbeat: AutomationHeartbeatState;
  schedules: AutomationScheduleState[];
  monitors: AutomationMonitorState[];
  nudges: AutomationNotificationState[];
  runs: AutomationExecutionRunState[];
}

export function parseAutomationWorkerState(value: unknown): AutomationWorkerState {
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

export function parseAutomationHeartbeatState(value: unknown): AutomationHeartbeatState {
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

export function parseAutomationSchedules(value: unknown): AutomationScheduleState[] {
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

export function parseAutomationMonitors(value: unknown): AutomationMonitorState[] {
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

export function parseAutomationNotifications(value: unknown): AutomationNotificationState[] {
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

export function parseAutomationRuns(value: unknown): AutomationExecutionRunState[] {
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

export function parseAutomationStateResponse(data: Record<string, unknown>): ParsedAutomationStateResponse {
  return {
    worker: parseAutomationWorkerState(data.worker),
    heartbeat: parseAutomationHeartbeatState(data.heartbeat),
    schedules: parseAutomationSchedules(data.schedules),
    monitors: parseAutomationMonitors(data.monitors),
    nudges: parseAutomationNotifications(data.nudges),
    runs: parseAutomationRuns(data.runs),
  };
}

export function formatAutomationTimestamp(value: string | null) {
  if (!value) return 'not run yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function parseWorkspaceToolPermissions(value: unknown): EffectiveWorkspaceToolAccess['permissions'] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is EffectiveWorkspaceToolAccess['permissions'][number] => typeof entry === 'string'
  );
}

export function parseWorkspaceToolAccess(
  value: unknown,
  fallback: EffectiveWorkspaceToolAccess
): EffectiveWorkspaceToolAccess {
  if (!value || typeof value !== 'object') return fallback;

  const candidate = value as Partial<EffectiveWorkspaceToolAccess>;
  return {
    permissions: fallback.permissions,
    shellGranted: candidate.shellGranted === true,
    shellEnabled: candidate.shellEnabled === true,
    filesystemGranted: candidate.filesystemGranted === true,
    filesystemEnabled: candidate.filesystemEnabled === true,
    filesystemWriteEnabled: candidate.filesystemWriteEnabled === true,
    codeGranted: candidate.codeGranted === true,
    codeExecutionEnabled: candidate.codeExecutionEnabled === true,
    hostAccessGranted: candidate.hostAccessGranted === true,
    hostAccessEnabled: candidate.hostAccessEnabled === true,
    hostAccessMode: candidate.hostAccessMode === 'auto-approve' || candidate.hostAccessMode === 'ask-first'
      ? candidate.hostAccessMode
      : 'deny',
    workspaceHostRoot: typeof candidate.workspaceHostRoot === 'string' && candidate.workspaceHostRoot.trim().length > 0
      ? candidate.workspaceHostRoot
      : fallback.workspaceHostRoot,
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

export function parseFavoriteModelsPayload(value: unknown): string[] {
  let list: unknown = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      list = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.filter((entry): entry is string => typeof entry === 'string');
}

export function parseWorkspaceToolSettingsResponse(data: Record<string, unknown>): ParsedWorkspaceToolSettingsResponse {
  const settings: WorkspaceToolSettings = {
    workspaceToolProvider: data.workspaceToolProvider === 'openai-compatible' ? 'openai-compatible' : 'ollama',
    workspaceToolModel: typeof data.workspaceToolModel === 'string' ? data.workspaceToolModel : '',
    workspaceToolBaseUrl: typeof data.workspaceToolBaseUrl === 'string' ? data.workspaceToolBaseUrl : '',
    ollamaHost: typeof data.ollamaHost === 'string' ? data.ollamaHost : 'http://127.0.0.1:11434',
    ollamaUseCloudApi: data.ollamaUseCloudApi === true,
    ollamaApiKey: typeof data.ollamaApiKey === 'string' ? data.ollamaApiKey : '',
    modelKeepAlive: data.modelKeepAlive === true,
    ollamaKeepAlive: typeof data.ollamaKeepAlive === 'string' && data.ollamaKeepAlive.trim() ? data.ollamaKeepAlive : '0',
    theme: typeof data.theme === 'string' ? data.theme : 'aurora',
    shellExecutionTarget: data.shellExecutionTarget === 'host' ? 'host' : 'container',
    shellExecutionMode: typeof data.shellExecutionMode === 'string' ? data.shellExecutionMode : 'ask-first',
    shellAllowedCommands: typeof data.shellAllowedCommands === 'string' ? data.shellAllowedCommands : '',
    shellHostAllowedRoots: typeof data.shellHostAllowedRoots === 'string' ? data.shellHostAllowedRoots : '~/.peakui/workspace',
    shellHostAllowedEnvVars: typeof data.shellHostAllowedEnvVars === 'string' ? data.shellHostAllowedEnvVars : 'PATH\nHOME\nUSER\nSHELL\nLANG\nTERM',
    shellHostMaxTimeoutMs: typeof data.shellHostMaxTimeoutMs === 'number' ? data.shellHostMaxTimeoutMs : 60000,
    shellHostMaxOutputBytes: typeof data.shellHostMaxOutputBytes === 'number' ? data.shellHostMaxOutputBytes : 262144,
    workspaceToolFileAccessMode: data.workspaceToolFileAccessMode === 'read-only' ? 'read-only' : 'deny',
    workspaceToolAllowedPaths: typeof data.workspaceToolAllowedPaths === 'string' ? data.workspaceToolAllowedPaths : '',
    workspaceToolFileWriteMode: data.workspaceToolFileWriteMode === 'auto-approve' || data.workspaceToolFileWriteMode === 'ask-first'
      ? data.workspaceToolFileWriteMode
      : 'deny',
    workspaceToolWritablePaths: typeof data.workspaceToolWritablePaths === 'string' ? data.workspaceToolWritablePaths : '',
    workspaceToolHostAccessMode: data.workspaceToolHostAccessMode === 'auto-approve' || data.workspaceToolHostAccessMode === 'ask-first'
      ? data.workspaceToolHostAccessMode
      : 'deny',
    workspaceToolWorkspaceHostRoot: typeof data.workspaceToolWorkspaceHostRoot === 'string' ? data.workspaceToolWorkspaceHostRoot : '',
    workspaceToolCodeExecutionMode: data.workspaceToolCodeExecutionMode === 'auto-approve' || data.workspaceToolCodeExecutionMode === 'ask-first'
      ? data.workspaceToolCodeExecutionMode
      : 'deny',
    workspaceToolBrowserMode: data.workspaceToolBrowserMode === 'read-only' || data.workspaceToolBrowserMode === 'ask-first'
      ? data.workspaceToolBrowserMode
      : 'deny',
    workspaceToolUwafBrowserMode: data.workspaceToolUwafBrowserMode === 'direct' || data.workspaceToolUwafBrowserMode === 'stealth'
      ? data.workspaceToolUwafBrowserMode
      : 'deny',
    workspaceToolUwafDefaultMode: data.workspaceToolUwafDefaultMode === 'stealth' ? 'stealth' : 'direct',
    workspaceToolUwafLiveBrowser: data.workspaceToolUwafLiveBrowser !== false,
    workspaceToolAutomationExecutionEnabled: data.workspaceToolAutomationExecutionEnabled === true,
    workspaceToolAutomationExecutionModel: typeof data.workspaceToolAutomationExecutionModel === 'string' ? data.workspaceToolAutomationExecutionModel : '',
    workspaceToolAutomationExecutionMaxRunsPerHour: typeof data.workspaceToolAutomationExecutionMaxRunsPerHour === 'number'
      ? data.workspaceToolAutomationExecutionMaxRunsPerHour
      : 6,
    workspaceToolAutomationExecutionAttachWorkspace: data.workspaceToolAutomationExecutionAttachWorkspace !== false,
    workspaceToolAutomationExecutionAttachMemory: data.workspaceToolAutomationExecutionAttachMemory !== false,
    workspaceToolSessionAutoContinueDefault: data.workspaceToolSessionAutoContinueDefault === 'safe'
      ? 'safe'
      : data.workspaceToolSessionAutoContinueDefault === 'ask'
        ? 'ask'
        : 'manual',
    workspaceToolSessionAutoContinueMaxSteps: typeof data.workspaceToolSessionAutoContinueMaxSteps === 'number'
      ? data.workspaceToolSessionAutoContinueMaxSteps
      : 3,
    workspaceToolMaxToolRoundsPerTurn: typeof data.workspaceToolMaxToolRoundsPerTurn === 'number'
      ? data.workspaceToolMaxToolRoundsPerTurn
      : 100,
    workspaceToolSessionSummariesEnabled: data.workspaceToolSessionSummariesEnabled !== false,
    workspaceToolSessionSummaryTargetTokens: typeof data.workspaceToolSessionSummaryTargetTokens === 'number'
      ? data.workspaceToolSessionSummaryTargetTokens
      : 6000,
    workspaceToolSessionPreserveTurns: typeof data.workspaceToolSessionPreserveTurns === 'number'
      ? data.workspaceToolSessionPreserveTurns
      : 6,
    workspaceToolSessionAnalyticsEnabled: data.workspaceToolSessionAnalyticsEnabled !== false,
    workspaceToolSessionBranchingEnabled: data.workspaceToolSessionBranchingEnabled !== false,
    ragEnabled: data.ragEnabled === true,
    ragTopK: typeof data.ragTopK === 'number' ? data.ragTopK : 8,
    workspaceToolPersonaTemplate: typeof data.workspaceToolPersonaTemplate === 'string' ? data.workspaceToolPersonaTemplate : 'custom',
    workspaceToolPersonaName: typeof data.workspaceToolPersonaName === 'string' ? data.workspaceToolPersonaName : '',
    workspaceToolPersonaTone: typeof data.workspaceToolPersonaTone === 'string' ? data.workspaceToolPersonaTone : '',
    workspaceToolPersonaExpertise: typeof data.workspaceToolPersonaExpertise === 'string' ? data.workspaceToolPersonaExpertise : '',
    workspaceToolPersonaBoundaries: typeof data.workspaceToolPersonaBoundaries === 'string' ? data.workspaceToolPersonaBoundaries : '',
    workspaceToolPersonaOperatingInstructions: typeof data.workspaceToolPersonaOperatingInstructions === 'string' ? data.workspaceToolPersonaOperatingInstructions : '',
    workspaceToolUserProfileName: typeof data.workspaceToolUserProfileName === 'string' ? data.workspaceToolUserProfileName : '',
    workspaceToolUserProfileRole: typeof data.workspaceToolUserProfileRole === 'string' ? data.workspaceToolUserProfileRole : '',
    workspaceToolUserProfilePreferences: typeof data.workspaceToolUserProfilePreferences === 'string' ? data.workspaceToolUserProfilePreferences : '',
    workspaceToolUserProfileContext: typeof data.workspaceToolUserProfileContext === 'string' ? data.workspaceToolUserProfileContext : '',
    workspaceToolFavoriteModels: parseFavoriteModelsPayload(data.workspaceToolFavoriteModels),
  };

  const permissions = parseWorkspaceToolPermissions(data.permissions);
  const fallbackToolAccess = buildEffectiveWorkspaceToolAccess(settings, permissions);

  return {
    settings,
    effectiveToolAccess: parseWorkspaceToolAccess(data.effectiveToolAccess, fallbackToolAccess),
  };
}

export interface ShellOutputEntry {
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

export interface ShellExecutionRequest {
  command: string;
  description?: string;
  approvalToken?: string;
  messageId: string;
  auditId?: string;
}

export interface FilesystemToolResultEntry {
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

export interface PendingToolApprovalBase {
  title: string;
  description?: string;
  previewLabel: string;
  previewContent: string;
  approvalToken?: string;
  messageId: string;
}

export type PendingToolApproval =
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
      request: WorkspaceToolFilesystemToolRequest;
    })
  | (PendingToolApprovalBase & {
      kind: 'code';
      request: WorkspaceToolCodeToolRequest & { sessionId: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'browser';
      request: WorkspaceToolBrowserToolRequest & { sessionId: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'unified_browser';
      request: WorkspaceToolUwafBrowserToolRequest & { sessionId: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'tax_return';
      request: WorkspaceToolTaxReturnToolRequest & { sessionId: string; messageId?: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'pdf_document';
      request: WorkspaceToolPdfDocumentToolRequest & { sessionId: string; messageId?: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'workbook_document';
      request: WorkspaceToolWorkbookDocumentToolRequest & { sessionId: string; messageId?: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'word_document';
      request: WorkspaceToolWordDocumentToolRequest & { sessionId: string; messageId?: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'csv_document';
      request: WorkspaceToolCsvDocumentToolRequest & { sessionId: string; messageId?: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'email_document';
      request: WorkspaceToolEmailDocumentToolRequest & { sessionId: string; messageId?: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'markdown_document';
      request: WorkspaceToolMarkdownDocumentToolRequest & { sessionId: string; messageId?: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'slides_document';
      request: WorkspaceToolSlidesDocumentToolRequest & { sessionId: string; messageId?: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'archive_document';
      request: WorkspaceToolArchiveDocumentToolRequest & { sessionId: string; messageId?: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'calendar_document';
      request: WorkspaceToolCalendarDocumentToolRequest & { sessionId: string; messageId?: string };
    })
  | (PendingToolApprovalBase & {
      kind: 'mermaid_document';
      request: WorkspaceToolMermaidDocumentToolRequest & { sessionId: string; messageId?: string };
    });

export type ToolApprovalResolution =
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

export interface WebToolResultEntry {
  query: string;
  description?: string;
  context?: string;
  sources: MessageSource[];
  success: boolean;
  error?: string;
}

export interface IrsFormSummaryEntry {
  formId: string;
  filename: string;
  title: string;
  sizeBytes: number;
}

export interface IrsFormFieldEntry {
  name: string;
  type: string;
}

export interface IrsFormDetailEntry {
  formId: string;
  filename: string;
  title: string;
  fieldCount: number;
  fields: IrsFormFieldEntry[];
  pageText: string;
  warnings: string[];
}

export interface TaxReturnToolResultEntry {
  action: 'generate_review_pdf' | 'fill_pdf_form' | 'list_forms' | 'inspect_form';
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
  forms?: IrsFormSummaryEntry[];
  formDetail?: IrsFormDetailEntry;
  error?: string;
}

export interface PdfDocumentToolResultEntry {
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

export interface WorkbookDocumentToolResultEntry {
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

export interface WordDocumentToolResultEntry {
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

export interface CsvDocumentToolResultEntry {
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

export interface EmailDocumentToolResultEntry {
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

export interface MarkdownDocumentToolResultEntry {
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

export interface SlidesDocumentToolResultEntry {
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

export interface ArchiveDocumentToolResultEntry {
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

export interface CalendarDocumentToolResultEntry {
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

export interface MermaidDocumentToolResultEntry {
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

export interface FetchSummarizeToolResultEntry {
  success: boolean;
  url: string;
  title?: string;
  summary?: string[];
  quote?: string;
  error?: string;
}

export interface ImageGenerationToolResultEntry {
  success: boolean;
  prompt: string;
  images?: Array<{ filename: string; url: string }>;
  error?: string;
}

export interface CodeToolResultEntry {
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

export interface BrowserToolResultEntry {
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

export type WorkspaceToolStreamFrame = {
  task_id?: unknown;
  error?: unknown;
  status?: unknown;
  sources?: unknown;
  knowledge_sources?: unknown;
  /** Native tool calls (workspaceToolNativeToolCalls='on'), one JSON line per frame. */
  native_tool_calls?: Array<{ name: string; args: Record<string, unknown> }>;
  message?: {
    thinking?: unknown;
    content?: unknown;
  };
  done?: unknown;
  eval_count?: number;
  eval_duration?: number;
  timings?: unknown;
};

export const WORKSPACE_TOOL_API_KEY_STORAGE = 'peakui-workspace-tool-api-key';

export const WORKSPACE_TOOL_INTERNET_STORAGE = 'peakui-workspace-tool-internet-enabled';

export const WORKSPACE_TOOL_RAG_STORAGE = 'peakui-workspace-tool-rag-enabled';

export const WORKSPACE_TOOL_UNRESTRICTED_STORAGE = 'peakui-workspace-tool-unrestricted';

export const WORKSPACE_TOOL_UNCENSORED_STORAGE = 'peakui-workspace-tool-uncensored';

export const WORKSPACE_TOOL_ACCOUNTANT_STORAGE = 'peakui-workspace-tool-accountant';

export const WORKSPACE_TOOL_IMAGE_GEN_STORAGE = 'peakui-workspace-tool-image-gen';

export const WORKSPACE_TOOL_AGENT_STORAGE = 'peakui-workspace-tool-agent-preferences';

export const WORKSPACE_TOOL_RAIL_STORAGE = 'peakui-workspace-tool-rail-collapsed';

export const WORKSPACE_TOOL_TASK_STATE_STORAGE = 'peakui-workspace-tool-task-states';

export const WORKSPACE_TOOL_DRAFT_TASK_ID = '__draft__';

export const WORKSPACE_TOOL_PERSONA_STORAGE = 'peakui-workspace-tool-persona';

export const WORKSPACE_TOOL_USER_PROFILE_STORAGE = 'peakui-workspace-tool-user-profile';

export const WORKSPACE_TOOL_CURRENT_SESSION_STORAGE = 'peakui-workspace-tool-current-session';

export const WORKSPACE_TOOL_CURRENT_WORKSPACE_STORAGE = 'peakui-workspace-tool-current-workspace';

export function splitFolderPrefix(ragQuery: string | null | undefined): { folder: string | null; query: string } {
  const raw = typeof ragQuery === 'string' ? ragQuery : '';
  const match = raw.match(/^folder:(\S+)\s*/);
  if (!match) return { folder: null, query: raw };
  return { folder: match[1], query: raw.slice(match[0].length) };
}

export function getChatTitle(messages: WorkspaceToolMessage[]) {
  const firstMessage = messages.find(message => message?.role === 'user' && message.content.trim());
  const base = firstMessage?.content.trim() || 'WorkSpaces';
  return base.substring(0, 36) + (base.length > 36 ? '...' : '');
}

export function formatTimestamp(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function isVisibleMessage(message: WorkspaceToolMessage) {
  return Boolean(message) && !message.hidden;
}

export function describeShellRequest(command: string, description?: string) {
  const summary = description?.trim();
  return summary ? `Running shell command: ${summary}` : `Running shell command: \`${command}\``
}

export function describeFilesystemRequest(action: WorkspaceToolFilesystemToolRequest['action'], requestedPath: string) {
  if (action === 'list') return `Listing directory: \`${requestedPath}\``;
  if (action === 'stat') return `Inspecting path metadata: \`${requestedPath}\``;
  if (action === 'mkdir') return `Creating directory: \`${requestedPath}\``;
  if (action === 'append') return `Appending to file: \`${requestedPath}\``;
  if (action === 'write') return `Writing file: \`${requestedPath}\``;
  return `Reading file: \`${requestedPath}\``;
}

export function describeWebResearchRequest(query: string, description?: string) {
  const summary = description?.trim();
  return summary ? `Researching the web: ${summary}` : `Researching the web for: \`${query}\``;
}

export function describeCodeExecutionRequest(request: WorkspaceToolCodeToolRequest) {
  const summary = request.description?.trim();
  const target = request.workspacePath?.trim() ? ` in \`${request.workspacePath.trim()}\`` : '';
  return summary
    ? `Running sandboxed ${request.runtime} code: ${summary}`
    : `Running sandboxed ${request.runtime} code${target}`;
}

export function describeBrowserRequest(request: WorkspaceToolBrowserToolRequest) {
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

export function describeUwafBrowserRequest(request: WorkspaceToolUwafBrowserToolRequest) {
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

export function describeTaxReturnRequest(request: WorkspaceToolTaxReturnToolRequest) {
  if (request.description?.trim()) return `Tax tool: ${request.description.trim()}`
  const folder = request.folder?.trim() ? ` from Knowledge Base folder \`${request.folder.trim()}\`` : ''
  if (request.action === 'list_forms') return 'Listing available IRS forms'
  if (request.action === 'inspect_form') return `Inspecting IRS form \`${request.formId?.trim() || '?'}\` fields`
  if (request.action === 'fill_pdf_form') {
    const target = request.formId?.trim() ? `IRS form \`${request.formId.trim()}\`` : 'a tax PDF form'
    return `Filling ${target}${folder}`
  }
  return `Generating a tax review PDF${folder}`
}

export function describePdfDocumentRequest(request: WorkspaceToolPdfDocumentToolRequest) {
  return request.description?.trim()
    ? `PDF generation: ${request.description.trim()}`
    : `Generating downloadable PDF: \`${request.filename || request.title}.pdf\``;
}

export function describeWorkbookDocumentRequest(request: WorkspaceToolWorkbookDocumentToolRequest) {
  return request.description?.trim()
    ? `Excel workbook generation: ${request.description.trim()}`
    : `Generating downloadable Excel workbook: \`${request.filename || request.title}.xlsx\``;
}

export function describeWordDocumentRequest(request: WorkspaceToolWordDocumentToolRequest) {
  return request.description?.trim()
    ? `Word document generation: ${request.description.trim()}`
    : `Generating downloadable Word document: \`${request.filename || request.title}.docx\``;
}

export function describeCsvDocumentRequest(request: WorkspaceToolCsvDocumentToolRequest) {
  return request.description?.trim()
    ? `CSV export: ${request.description.trim()}`
    : `Generating downloadable CSV: \`${request.filename || request.title}.csv\``;
}

export function describeEmailDocumentRequest(request: WorkspaceToolEmailDocumentToolRequest) {
  return request.description?.trim()
    ? `Email draft: ${request.description.trim()}`
    : `Generating downloadable email draft: \`${request.filename || request.title || request.subject}.eml\``;
}

export function describeFetchSummarizeRequest(request: WorkspaceToolFetchSummarizeToolRequest) {
  return request.description?.trim()
    ? `Fetch and summarize: ${request.description.trim()} (${request.url})`
    : `Fetch and summarize web page: ${request.url}`;
}

export function describeMarkdownDocumentRequest(request: WorkspaceToolMarkdownDocumentToolRequest) {
  return request.description?.trim()
    ? `Markdown document: ${request.description.trim()}`
    : `Generating downloadable Markdown document: \`${request.filename || request.title}.md\``;
}

export function describeSlidesDocumentRequest(request: WorkspaceToolSlidesDocumentToolRequest) {
  return request.description?.trim()
    ? `Slide deck: ${request.description.trim()}`
    : `Generating slide deck with ${request.slides.length} slides: \`${request.filename || request.title}.pptx\``;
}

export function describeArchiveDocumentRequest(request: WorkspaceToolArchiveDocumentToolRequest) {
  return request.description?.trim()
    ? `Archive: ${request.description.trim()}`
    : `Bundling ${request.entries.length} files into \`${request.filename || request.title}.zip\``;
}

export function describeCalendarDocumentRequest(request: WorkspaceToolCalendarDocumentToolRequest) {
  return request.description?.trim()
    ? `Calendar event: ${request.description.trim()}`
    : `Creating calendar event(s): \`${request.filename || request.title}.ics\``;
}

export function describeMermaidDocumentRequest(request: WorkspaceToolMermaidDocumentToolRequest) {
  return request.description?.trim()
    ? `Mermaid diagram: ${request.description.trim()}`
    : `Rendering Mermaid diagram as ${request.format || 'svg'}: \`${request.filename || request.title}.${request.format || 'svg'}\``;
}

export function normalizeToolSources(value: unknown): MessageSource[] {
  return normalizeMessageSources(value);
}

export function normalizeLatencyTimings(value: unknown): WorkspaceToolLatencyTimings | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const normalized: WorkspaceToolLatencyTimings = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' || raw === null) {
      normalized[key] = raw;
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function formatTimingSeconds(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)}s` : '';
}

export function formatLatencySummary(timings?: WorkspaceToolLatencyTimings) {
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

export function formatLoadedUntil(value?: string) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export const VisibleChatMessageRow = memo(function VisibleChatMessageRow({
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
  canvasArtifactNames,
}: {
  msg: WorkspaceToolMessage;
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
  onCopyMessage?: (message: WorkspaceToolMessage) => void;
  canvasArtifactNames?: Map<string, string>;
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
                canvasArtifactNames={canvasArtifactNames}
              />
              {!isToolBridgeMessage && messageSources.length > 0 && (
                <SourceChips sources={messageSources} />
              )}
              {!isToolBridgeMessage && messageContent.trim() && (
                <AssistantDownloads content={messageContent} index={index} presentation={msg.presentation} sessionId={currentSessionId ?? undefined} messageId={msg.id} canvasArtifactNames={canvasArtifactNames} />
              )}
            </MessageRenderBoundary>
          ) : (
            <>
              {msg.images && msg.images.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: messageContent.trim() ? '10px' : 0 }}>
                  {msg.images.map((image, imageIndex) => (
                    <WorkspaceToolAttachedImagePreview key={`${image.name}-${imageIndex}`} image={image} />
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
            className="workspace-tool-inline-button"
            onClick={() => void onCopyMessage?.(msg)}
          >
            <Copy size={12} />
            Copy message
          </button>
          {branchingEnabled && (
            <button
              type="button"
              className="workspace-tool-inline-button"
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

export function normalizeExtractedToolRequestName(value: unknown): WorkspaceToolMessage['toolRequest'] {
  // Whitelist must match WorkspaceToolName in @/lib/workspace-tool-tools so all 18 tool
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
    ? value as WorkspaceToolMessage['toolRequest']
    : undefined
}

export function isSubstantiveProseAnswer(content: string): boolean {
  const text = (content || '').trim();
  if (text.length < 200) return false;
  const nonEmptyLines = text.split('\n').map(line => line.trim()).filter(Boolean);
  if (nonEmptyLines.length < 3) return false;
  if (detectMissingToolIntent(text)) return false;
  return true;
}

export function detectMissingToolIntent(content: string): boolean {
  const text = content.trim();
  if (!text) return false;

  // A capability/identity statement ("I am a local-first agent...", "my
  // capabilities include...") is a plain-text answer, not a tool narration.
  // Never nudge on it — otherwise "what are your capabilities" loops.
  if (isCapabilityStatement(text)) return false;

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

export function normalizeWorkspaceToolMessage(value: unknown): WorkspaceToolMessage | null {
  if (!value || typeof value !== 'object') return null;

  const raw = value as Partial<WorkspaceToolMessage>;
  if (raw.role !== 'user' && raw.role !== 'assistant' && raw.role !== 'system') {
    return null;
  }

  const rawContent = typeof raw.content === 'string' ? raw.content : '';
  const extractedToolRequest = raw.role === 'assistant' && rawContent.includes('<workspace_tool')
    ? extractWorkspaceToolRequest(rawContent)
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
  const hidden = raw.hidden === true || Boolean(extractedToolRequest?.request) || rawContent.includes('<workspace_tool');
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

export function parseTimestampValue(value: unknown, fallback: number | null = null) {
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

export function normalizeWorkspaceToolSession(value: unknown): WorkspaceToolSession | null {
  if (!value || typeof value !== 'object') return null;

  const raw = value as Partial<WorkspaceToolSession>;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
  if (!id) return null;

  const messages = Array.isArray(raw.messages)
    ? raw.messages
        .map(normalizeWorkspaceToolMessage)
        .filter((message): message is WorkspaceToolMessage => Boolean(message))
    : [];

  return {
    id,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'WorkSpaces',
    updatedAt: parseTimestampValue(raw.updatedAt, Date.now()) ?? Date.now(),
    pinned: raw.pinned === true,
    surface: 'workspace-tool',
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

export function sanitizeWorkspaceToolMessages(messages: unknown): WorkspaceToolMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .map(normalizeWorkspaceToolMessage)
    .filter((message): message is WorkspaceToolMessage => Boolean(message));
}

export function stripAttachmentVisionData(messages: WorkspaceToolMessage[]): WorkspaceToolMessage[] {
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

export function sanitizeWorkspaceToolSessions(sessions: unknown): WorkspaceToolSession[] {
  if (!Array.isArray(sessions)) return [];
  return sessions
    .map(normalizeWorkspaceToolSession)
    .filter((session): session is WorkspaceToolSession => Boolean(session));
}

export function getLatestVisibleAssistantMessage(messages: WorkspaceToolMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant' && !message.hidden) {
      return message;
    }
  }
  return null;
}

export function isAbsoluteUnixPath(value: string) {
  return value.startsWith('/');
}

export function pathLooksLikeHostFilesystemTarget(requestedPath: string, allowedPaths: string[]) {
  if (requestedPath.startsWith('/home') || requestedPath.startsWith('/tmp') || requestedPath.startsWith('/mnt/workspace-tool') || isWindowsHostPath(requestedPath)) {
    return true;
  }

  return allowedPaths.some(root =>
    requestedPath === root
    || requestedPath.startsWith(`${root}/`)
    || root.startsWith(`${requestedPath}/`)
  );
}

export function inferFilesystemRequestFromShellCommand(
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

export function getWorkspaceToolRequestSignature(request: WorkspaceToolRequest) {
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
    const uwaf = request.request as WorkspaceToolUwafBrowserToolRequest
    return `unified_browser:${uwaf.action}:${uwaf.query?.trim() || ''}:${uwaf.providerId?.trim() || ''}:${uwaf.url?.trim() || ''}:${uwaf.browserMode || ''}:${uwaf.stealthProfile || ''}:${uwaf.linkIndex ?? ''}:${uwaf.linkText?.trim() || ''}:${uwaf.formIndex ?? ''}:${JSON.stringify(uwaf.values || {})}:${uwaf.mode || ''}:${uwaf.depth ?? ''}:${uwaf.selector?.trim() || ''}:${uwaf.text || ''}:${uwaf.key?.trim() || ''}:${uwaf.tabIndex ?? ''}:${uwaf.timeoutMs ?? ''}:${uwaf.deltaY ?? ''}:${uwaf.optionValue?.trim() || ''}:${uwaf.optionLabel?.trim() || ''}`;
  }

  if (request.name === 'tax_return') {
    const tax = request.request as WorkspaceToolTaxReturnToolRequest
    return `tax_return:${tax.action}:${tax.folder?.trim() || ''}:${tax.taxYear?.trim() || ''}:${tax.templateDocumentId?.trim() || ''}:${tax.formId?.trim() || ''}:${tax.flatten === true ? 'flatten' : ''}:${Object.keys(tax.fields || {}).length}`
  }

  if (request.name === 'pdf_document') {
    const pdf = request.request as WorkspaceToolPdfDocumentToolRequest
    return `pdf_document:${pdf.title.trim()}:${pdf.filename?.trim() || ''}:${pdf.template || ''}:${(pdf.content || '').trim().slice(0, 2000)}:${JSON.stringify({
      sections: pdf.sections,
      fields: pdf.fields,
      tables: pdf.tables,
      callouts: pdf.callouts,
    }).slice(0, 2000)}`;
  }

  if (request.name === 'workbook_document') {
    const workbook = request.request as WorkspaceToolWorkbookDocumentToolRequest
    return `workbook_document:${workbook.title.trim()}:${workbook.filename?.trim() || ''}:${workbook.template || ''}:${JSON.stringify({
      sheets: workbook.sheets,
      metadata: workbook.metadata,
    }).slice(0, 6000)}`;
  }

  if (request.name === 'word_document') {
    const word = request.request as WorkspaceToolWordDocumentToolRequest
    return `word_document:${word.title.trim()}:${word.filename?.trim() || ''}:${word.template || ''}:${(word.content || '').trim().slice(0, 2000)}:${JSON.stringify({
      sections: word.sections,
      fields: word.fields,
      tables: word.tables,
      callouts: word.callouts,
      metadata: word.metadata,
    }).slice(0, 6000)}`;
  }

  if (request.name === 'csv_document') {
    const csv = request.request as WorkspaceToolCsvDocumentToolRequest
    return `csv_document:${csv.title.trim()}:${csv.filename?.trim() || ''}:${(csv.content || '').trim().slice(0, 2000)}:${JSON.stringify({
      headers: csv.headers,
      rows: csv.rows?.slice(0, 20),
    }).slice(0, 4000)}`;
  }

  if (request.name === 'email_document') {
    const email = request.request as WorkspaceToolEmailDocumentToolRequest
    return `email_document:${email.title?.trim() || email.subject.trim()}:${email.filename?.trim() || ''}:${email.to?.trim() || ''}:${email.subject.trim()}:${(email.body || '').trim().slice(0, 2000)}`;
  }

  if (request.name === 'fetch_summarize') {
    const fetchSummarize = request.request as WorkspaceToolFetchSummarizeToolRequest
    return `fetch_summarize:${fetchSummarize.url.trim()}`;
  }

  if (request.name === 'markdown_document') {
    const markdown = request.request as WorkspaceToolMarkdownDocumentToolRequest
    return `markdown_document:${markdown.title.trim()}:${markdown.filename?.trim() || ''}:${(markdown.content || '').trim().slice(0, 2000)}`;
  }

  if (request.name === 'slides_document') {
    const slides = request.request as WorkspaceToolSlidesDocumentToolRequest
    return `slides_document:${slides.title.trim()}:${slides.filename?.trim() || ''}:${slides.slides.length}`;
  }

  if (request.name === 'archive_document') {
    const archive = request.request as WorkspaceToolArchiveDocumentToolRequest
    return `archive_document:${archive.title.trim()}:${archive.filename?.trim() || ''}:${archive.entries.length}`;
  }

  if (request.name === 'calendar_document') {
    const calendar = request.request as WorkspaceToolCalendarDocumentToolRequest
    return `calendar_document:${(calendar.title ?? '').trim()}:${calendar.filename?.trim() || ''}:${calendar.events.length}`;
  }

  if (request.name === 'mermaid_document') {
    const mermaid = request.request as WorkspaceToolMermaidDocumentToolRequest
    return `mermaid_document:${mermaid.title.trim()}:${mermaid.filename?.trim() || ''}:${mermaid.format || 'svg'}`;
  }

  if (request.name === 'filesystem') {
    return `filesystem:${request.request.action}:${request.request.path.trim()}`;
  }

  const fallback = request as any;
  return `${fallback.name}:${JSON.stringify(fallback.request).slice(0, 200)}`;
}

export function describeDocumentToolRequest(request: WorkspaceToolRequest): { description?: string; filename?: string } | null {
  if (!isDocumentToolName(request.name)) return null
  const payload = (request as unknown as { request?: Record<string, unknown> }).request
  if (!payload || typeof payload !== 'object') return null
  const description = typeof payload.description === 'string' && payload.description.trim()
    ? payload.description.trim()
    : undefined
  const filename = typeof payload.filename === 'string' && payload.filename.trim()
    ? payload.filename.trim()
    : undefined
  return { description, filename }
}

export function isDocumentToolName(name: WorkspaceToolRequest['name']): boolean {
  return name === 'pdf_document'
    || name === 'workbook_document'
    || name === 'word_document'
    || name === 'csv_document'
    || name === 'email_document'
    || name === 'markdown_document'
    || name === 'slides_document'
    || name === 'archive_document'
    || name === 'calendar_document'
    || name === 'mermaid_document'
}

export function describeToolDisplayName(name: WorkspaceToolRequest['name']): string {
  switch (name) {
    case 'pdf_document': return 'PDF generator'
    case 'workbook_document': return 'Excel workbook generator'
    case 'word_document': return 'Word document generator'
    case 'csv_document': return 'CSV exporter'
    case 'email_document': return 'email writer'
    case 'markdown_document': return 'markdown writer'
    case 'slides_document': return 'slide deck generator'
    case 'archive_document': return 'archive builder'
    case 'calendar_document': return 'calendar event generator'
    case 'mermaid_document': return 'mermaid diagram renderer'
    case 'web': return 'web research'
    case 'shell': return 'shell command'
    case 'code': return 'code execution'
    case 'browser': return 'browser action'
    case 'unified_browser': return 'UWAF browser action'
    case 'filesystem': return 'filesystem tool'
    case 'tax_return': return 'tax return generator'
    case 'fetch_summarize': return 'URL summarizer'
    case 'image_generation': return 'image generator'
    case 'notes_search': return 'notes search'
    case 'notes_save': return 'notes save'
    case 'http_request': return 'HTTP request'
    case 'spreadsheet_query': return 'spreadsheet query'
    case 'calendar_query': return 'calendar query'
    default: return name
  }
}

export function recordToolReliability(model: string, tool: string, success: boolean, errorMessage?: string) {
  try {
    void fetch('/api/workspace-tool/reliability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, tool, success, errorMessage }),
    }).catch(() => {})
  } catch {
    // Diagnostics must never create user-facing failures.
  }
}

export function buildRecoveryWrapperExample(toolName: WorkspaceToolRequest['name'] | undefined): string {
  switch (toolName) {
    case 'slides_document':
      return '<workspace_tool name="slides_document">{"title":"<deck title>","description":"<what the user asked for>","slides":[{"layout":"title","title":"<cover slide title>"},{"layout":"bullets","title":"<section title>","bullets":["<bullet 1>","<bullet 2>"]}]}</workspace_tool>'
    case 'pdf_document':
      return '<workspace_tool name="pdf_document">{"title":"<document title>","description":"<what the user asked for>","sections":[{"heading":"<section heading>","content":"<paragraph>"}]}</workspace_tool>'
    case 'workbook_document':
      return '<workspace_tool name="workbook_document">{"title":"<workbook title>","description":"<what the user asked for>","sheets":[{"name":"<sheet name>","columns":["<col a>","<col b>"],"rows":[["<row 1a>","<row 1b>"]]}]}</workspace_tool>'
    case 'word_document':
      return '<workspace_tool name="word_document">{"title":"<doc title>","description":"<what the user asked for>","sections":[{"heading":"<heading>","content":"<paragraph>"}]}</workspace_tool>'
    case 'csv_document':
      return '<workspace_tool name="csv_document">{"title":"<csv title>","description":"<what the user asked for>","columns":["<col a>","<col b>"],"rows":[["<row 1a>","<row 1b>"]]}</workspace_tool>'
    case 'email_document':
      return '<workspace_tool name="email_document">{"subject":"<email subject>","description":"<what the user asked for>","body":"<email body>","to":["<recipient@example.com>"]}</workspace_tool>'
    case 'markdown_document':
      return '<workspace_tool name="markdown_document">{"title":"<doc title>","description":"<what the user asked for>","content":"# <heading>\\n\\n<markdown body>"}</workspace_tool>'
    case 'archive_document':
      return '<workspace_tool name="archive_document">{"title":"<archive title>","description":"<what the user asked for>","entries":[{"name":"<file.txt>","mimeType":"text/plain","content":"<utf-8 content>"}]}</workspace_tool>'
    case 'calendar_document':
      return '<workspace_tool name="calendar_document">{"title":"<calendar title>","description":"<what the user asked for>","events":[{"uid":"<unique-id>","title":"<event title>","start":"<ISO 8601 start>","end":"<ISO 8601 end>"}]}</workspace_tool>'
    case 'mermaid_document':
      return '<workspace_tool name="mermaid_document">{"title":"<diagram title>","description":"<what the user asked for>","diagram":"graph TD; A[<node a>] --> B[<node b>]","format":"svg"}</workspace_tool>'
    case 'web':
      return '<workspace_tool name="web">{"query":"<search query>"}</workspace_tool>'
    case 'shell':
      return '<workspace_tool name="shell">{"command":"<command to run>","description":"<what it does>"}</workspace_tool>'
    case 'filesystem':
      return '<workspace_tool name="shell">{"command":"ls -la <path>","description":"<what you want to know>"}</workspace_tool>'
    case 'tax_return':
      return '<workspace_tool name="tax_return">{"action":"generate_review_pdf","folder":"<kb folder>","taxYear":"<YYYY>"}</workspace_tool>'
    case 'fetch_summarize':
      return '<workspace_tool name="fetch_summarize">{"url":"<https URL>","description":"<what to summarize>"}</workspace_tool>'
    case 'image_generation':
      return '<workspace_tool name="image_generation">{"prompt":"<image description>","negativePrompt":"<what to avoid>","width":1024,"height":1024}</workspace_tool>'
    default:
      return '<workspace_tool name="<registered tool name>">{"<field>":"<value>"}</workspace_tool>'
  }
}

export function formatShellToolResult(entry: ShellOutputEntry): string {
  const lines = [
    'Shell command result:',
    `Target: ${entry.target === 'host' ? 'host machine' : 'container'}`,
    `Command: ${entry.command}`,
    `Status: ${entry.success ? 'completed' : entry.rejected ? 'rejected' : entry.blocked ? 'blocked' : 'failed'}`,
    `Exit code: ${entry.exitCode ?? 'none'}`,
    `Duration: ${entry.duration}ms`,
  ];

  if (entry.stdout?.trim()) {
    // STDOUT can echo arbitrary external content (e.g. `curl` of a page) —
    // wrap it as untrusted so any embedded instructions can't be obeyed.
    lines.push('', 'STDOUT:', wrapUntrustedToolResult('shell', entry.stdout.trim()));
  }

  if (entry.stderr?.trim()) {
    lines.push('', 'STDERR:', wrapUntrustedToolResult('shell', entry.stderr.trim()));
  }

  lines.push('', 'Use this result to continue the task. Do not claim anything beyond what the command output shows.');
  return lines.join('\n');
}

export function formatFilesystemToolResult(entry: FilesystemToolResultEntry): string {
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

export function formatCodeToolResult(entry: CodeToolResultEntry): string {
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

export function pruneInterruptedMessages(messages: WorkspaceToolMessage[]) {
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

export function formatWebToolResult(entry: WebToolResultEntry): string {
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
    // Web context is raw external page/snippet text — wrap it as untrusted
    // so embedded prompt-injection / delimiter forgery can't be read as
    // instructions. The trusted "Public web context:" label stays outside.
    lines.push('', 'Public web context:', wrapUntrustedToolResult('web', entry.context.trim()));
  }

  lines.push('', 'Use this result to continue the task. Base factual claims on these sources and cite them with inline markers like [^1].');
  return lines.join('\n');
}

export function formatBrowserToolResult(entry: BrowserToolResultEntry): string {
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
    // Page text is raw rendered page content — wrap as untrusted.
    lines.push('', 'Page text:', wrapUntrustedToolResult('browser', entry.text.trim()));
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

export function formatTaxReturnToolResult(entry: TaxReturnToolResultEntry): string {
  const lines = [
    'Tax return tool result:',
    `Action: ${entry.action}`,
    `Status: ${entry.success ? 'completed' : 'failed'}`,
  ];

  if (!entry.success) {
    if (entry.error?.trim()) lines.push(`Error: ${entry.error.trim()}`);
    lines.push('', 'Use this result to continue the task. Do not claim a PDF was generated if this result failed.');
    return lines.join('\n');
  }

  // Read-only catalog actions: no artifact, no client data.
  if (entry.action === 'list_forms') {
    const forms = entry.forms ?? [];
    lines.push('', `Available IRS forms: ${forms.length}`);
    forms.slice(0, 120).forEach(form => lines.push(`- ${form.formId} — ${form.title} (${form.filename})`));
    if (forms.length === 0) {
      lines.push('', 'No IRS forms found in the catalog. Ask the user to confirm the irs_forms directory is deployed.');
    }
    lines.push('', 'To fill a form, call inspect_form with the formId to get its exact field names, then fill_pdf_form with formId and fields.');
    return lines.join('\n');
  }

  if (entry.action === 'inspect_form') {
    const detail = entry.formDetail;
    if (!detail) {
      lines.push('', 'No form detail returned. Confirm the formId is valid (use list_forms to see available ids).');
      return lines.join('\n');
    }
    lines.push(
      '',
      `Form: ${detail.title}`,
      `Form id: ${detail.formId}`,
      `Filename: ${detail.filename}`,
      `Fillable fields: ${detail.fieldCount}`,
    );
    if (detail.fields.length > 0) {
      const checkboxes = detail.fields.filter(field => field.type === 'checkbox');
      const radios = detail.fields.filter(field => field.type === 'radio' || field.type === 'dropdown' || field.type === 'optionlist');
      const other = detail.fields.filter(field => field.type !== 'checkbox' && field.type !== 'radio' && field.type !== 'dropdown' && field.type !== 'optionlist');
      if (other.length > 0) {
        lines.push('', 'Text / other fields (name — type):');
        other.slice(0, 100).forEach(field => lines.push(`- ${field.name} — ${field.type}`));
      }
      if (checkboxes.length > 0) {
        lines.push('', `Checkboxes (${checkboxes.length}) — check ONLY the ones the client's situation actually warrants; OMIT every other checkbox:`,
          'To CHECK a box: include it in "fields" with a truthy value (e.g. "yes", "1", "x", "true").',
          'To LEAVE a box unchecked: omit it from "fields" entirely. Do not pass "no" or "false" — just leave it out.');
        checkboxes.slice(0, 120).forEach(field => lines.push(`- ${field.name}`));
      }
      if (radios.length > 0) {
        lines.push('', 'Choice fields — radio / dropdown / option list (set the value that matches the client\'s situation):');
        radios.slice(0, 80).forEach(field => lines.push(`- ${field.name} — ${field.type}`));
      }
    }
    if (detail.pageText) {
      lines.push('', 'First-page text (labels/line items) — match each checkbox/field to the line it controls:', detail.pageText.slice(0, 2000));
    }
    if (detail.warnings.length > 0) {
      lines.push('', 'Warnings:');
      detail.warnings.forEach(warning => lines.push(`- ${warning}`));
    }
    lines.push('', 'Use these exact field names when calling fill_pdf_form with this formId. For checkboxes, reason from the client documents about which boxes apply (filing status, dependents, credits, exemptions) and check only those — leave the rest unchecked by omitting them.');
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

export function artifactDownloadInstruction(artifactName: string): string {
  return [
    'DOWNLOAD LINK (mandatory): when presenting the download link, output the artifact name as the link text and the EXACT relative Download URL below.',
    'Format: [' + artifactName + '](<URL>)',
    'The URL MUST stay relative — start with /api/canvas/artifacts/ and contain NO protocol (no https://, no http://), NO domain (no gpt.dachicorp.com, peakui.com, localhost, or anything else), NO leading double slash (//), and NO path prefix like /workspace/ or /chat/.',
    'If you copy the URL from this prompt, copy it character-for-character including the leading slash. An absolute URL like https://anything/file.pptx will NOT download — the browser will resolve it against the wrong host and return 404.',
    'Example of CORRECT output: [' + artifactName + '](/api/canvas/artifacts/<id>/download)',
    'Example of WRONG output (do not produce): [' + artifactName + '](https://gpt.dachicorp.com/' + artifactName + ')',
  ].join(' ');
}

export function formatPdfDocumentToolResult(entry: PdfDocumentToolResultEntry): string {
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

export function formatWorkbookDocumentToolResult(entry: WorkbookDocumentToolResultEntry): string {
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

export function formatWordDocumentToolResult(entry: WordDocumentToolResultEntry): string {
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

export function formatCsvDocumentToolResult(entry: CsvDocumentToolResultEntry): string {
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

export function formatEmailDocumentToolResult(entry: EmailDocumentToolResultEntry): string {
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

export function formatMarkdownDocumentToolResult(entry: MarkdownDocumentToolResultEntry): string {
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

export function formatSlidesDocumentToolResult(entry: SlidesDocumentToolResultEntry): string {
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

export function formatArchiveDocumentToolResult(entry: ArchiveDocumentToolResultEntry): string {
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

export function formatCalendarDocumentToolResult(entry: CalendarDocumentToolResultEntry): string {
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

export function formatMermaidDocumentToolResult(entry: MermaidDocumentToolResultEntry): string {
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

export function formatFetchSummarizeToolResult(entry: FetchSummarizeToolResultEntry): string {
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
  if (entry.quote) {
    // The key quote is verbatim text from the fetched page — wrap as untrusted.
    lines.push('', `Key quote: "${wrapUntrustedToolResult('fetch_summarize', entry.quote)}"`);
  }

  lines.push('', 'Use this result to answer the user. Cite the source URL explicitly.');
  return lines.join('\n');
}

export function formatImageGenerationToolResult(entry: ImageGenerationToolResultEntry): string {
  const lines = [
    'Image generation tool result:',
    `Prompt: ${entry.prompt}`,
    `Status: ${entry.success ? 'completed' : 'failed'}`,
  ];

  if (!entry.success) {
    if (entry.error?.trim()) lines.push(`Error: ${entry.error.trim()}`);
    lines.push('', 'Use this result to continue the task. Do not claim an image was generated if this result failed.');
    return lines.join('\n');
  }

  if (entry.images && entry.images.length > 0) {
    lines.push('', 'IMAGES READY — the generation is COMPLETE. Do not call image_generation again, do not run shell/filesystem commands to "save" or "locate" the image, and do not question the URL scheme (HTTP vs HTTPS) — the runtime serves these URLs itself and they work.');
    entry.images.forEach(image => lines.push(`![${entry.prompt}](${image.url})`));
    lines.push('', 'YOUR NEXT MESSAGE must be the final answer to the user: embed the image(s) above in markdown exactly as shown and briefly present them. Do not call any more tools, do not attempt to copy the image to the filesystem.');
  } else {
    lines.push('', 'No images were returned. Report this to the user.');
  }

  return lines.join('\n');
}

export function formatHttpRequestToolResult(data: { status?: number; ok?: boolean; contentType?: string; body?: string | null; truncated?: boolean; finalUrl?: string }): string {
  const lines = [
    'HTTP request tool result:',
    `Status: ${data.status ?? 'unknown'}${data.ok === false ? ' (error)' : ''}`,
    `Content-Type: ${data.contentType || 'unknown'}`,
  ];
  if (data.finalUrl) lines.push(`Final URL: ${data.finalUrl}`);
  if (data.body) {
    lines.push('', 'Response body:', data.body);
    if (data.truncated) lines.push('', '(response truncated)');
  } else {
    lines.push('', 'No text body returned (binary or empty).');
  }
  lines.push('', 'Use this response to answer the user. Cite the status code and any data you actually received; do not invent fields.');
  return lines.join('\n');
}

export function formatSpreadsheetQueryToolResult(data: { headers?: string[]; rows?: string[][]; rowCount?: number; truncated?: boolean }): string {
  const lines = ['Spreadsheet query tool result:'];
  const headers = Array.isArray(data.headers) ? data.headers : [];
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (headers.length === 0) {
    lines.push('Status: completed', 'No data found.', '', 'Tell the user the file is empty or has no header row.');
    return lines.join('\n');
  }
  lines.push(`Status: completed`, `Columns: ${headers.join(' | ')}`, `Rows: ${rows.length}${data.truncated ? ' (truncated)' : ''}`);
  rows.forEach((row, index) => {
    lines.push(`  ${index + 1}. ${row.join(' | ')}`);
  });
  lines.push('', 'Answer the user\'s question using these rows. Do not invent data beyond what is shown.');
  return lines.join('\n');
}

export function formatCalendarQueryToolResult(data: { events?: Array<Record<string, string>>; eventCount?: number }): string {
  const lines = ['Calendar query tool result:'];
  const events = Array.isArray(data.events) ? data.events : [];
  if (events.length === 0) {
    lines.push('Status: completed', 'No events found.', '', 'Tell the user the calendar has no events.');
    return lines.join('\n');
  }
  lines.push(`Status: completed`, `Events: ${events.length}`);
  events.forEach((event, index) => {
    const summary = event.SUMMARY || event.summary || '(untitled)';
    const start = event.DTSTART || event.dtstart || '';
    const location = event.LOCATION || event.location || '';
    lines.push(`  ${index + 1}. ${summary}${start ? ` — ${start}` : ''}${location ? ` @ ${location}` : ''}`);
  });
  lines.push('', 'Answer the user\'s question using these events. Do not invent events beyond what is shown.');
  return lines.join('\n');
}

export function formatNotesSearchToolResult(data: { query?: string; results?: Array<{ title: string; excerpt: string; createdAt: string }> }): string {
  const lines = [
    'Notes search tool result:',
    `Query: ${data.query || ''}`,
  ];
  const results = Array.isArray(data.results) ? data.results : [];
  if (results.length === 0) {
    lines.push('Status: completed', 'Results: none', '', 'No saved notes matched. Tell the user you have no notes on this, then answer from the current conversation only.');
  } else {
    lines.push('Status: completed', `Results: ${results.length}`);
    results.forEach((note, index) => {
      lines.push('', `[${index + 1}] ${note.title}${note.createdAt ? ` (${note.createdAt.slice(0, 10)})` : ''}`);
      lines.push(note.excerpt);
    });
    lines.push('', 'Use these notes only where they are relevant to the current request. Cite them as your saved notes, not as fresh search results.');
  }
  return lines.join('\n');
}

export interface WorkspaceToolWorkspaceProps {
  onNavigateToKnowledgeBase?: () => void;
  onNavigateToWorkspace?: () => void;
  onNavigateToSettings?: () => void;
  view?: 'workspace' | 'knowledge-base' | 'settings';
  knowledgeBaseContent?: React.ReactNode;
  settingsContent?: React.ReactNode;
  settingsRevision?: number;
}