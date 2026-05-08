"use client";

import React, { useEffect, useMemo, useRef, useState, useDeferredValue, useCallback, memo } from 'react';
import { Activity, AlertCircle, BookOpen, Bot, Check, ChevronDown, ChevronLeft, ChevronRight, Cpu, Database, Download, FileText, Globe, ListTodo, Loader2, Menu, MessageSquare, MoreHorizontal, Paperclip, Plus, Redo2, RefreshCw, Send, Server, Shield, Square, Wand2, Wifi, WifiOff, X } from 'lucide-react';
import { ChatMessageContent, AssistantDownloads, ThinkingBlock } from './ChatMessageContent';
import HelpHint from './HelpHint';
import SourceChips from './SourceChips';
import { mergeMessageSources, type MessageSource } from '@/lib/message-sources';
import { inferResponsePresentation, type ResponsePresentation } from '@/lib/response-format';
import {
  buildOpenClawTaskStateBrief,
  buildOpenClawWorkspaceBrief,
  DEFAULT_OPENCLAW_AGENT_PREFERENCES,
  DEFAULT_OPENCLAW_TASK_STATE,
  OPENCLAW_AGENT_MODE_OPTIONS,
  OPENCLAW_QUICK_PROMPTS,
  OPENCLAW_RESPONSE_STYLE_OPTIONS,
  createOpenClawChecklistItems,
  extractOpenClawChecklistSuggestions,
  type OpenClawAgentMode,
  type OpenClawAgentPreferences,
  type OpenClawTaskState,
  type OpenClawResponseStyle,
} from '@/lib/openclaw-agent';
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
import { Settings } from 'lucide-react';
import { getStreamPhaseLabel, isServerStreamStatus, type UiStreamPhase } from '@/lib/stream-status';
import { applyTheme } from '@/lib/theme-options';
import { useStickyScroll } from '@/lib/use-sticky-scroll';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, formatBytes, type ExtractedFilePayload } from '@/lib/file-shared';
import {
  extractOpenClawToolRequest,
  type OpenClawBrowserToolRequest,
  type OpenClawCodeToolRequest,
  type OpenClawFilesystemToolRequest,
  type OpenClawToolRequest,
  type OpenClawUwafBrowserToolRequest,
} from '@/lib/openclaw-tools';
import UwafNetworkPanel from './UwafNetworkPanel';
import UwafBrowserPreview from './UwafBrowserPreview';

type OpenClawProvider = 'ollama' | 'openai-compatible';
const MOBILE_BREAKPOINT = 960;

interface OpenClawSession {
  id: string;
  title: string;
  updatedAt: number;
  pinned: boolean;
  surface: 'openclaw';
  messages: OpenClawMessage[];
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
  toolRequest?: 'shell' | 'filesystem' | 'web' | 'code' | 'browser' | 'unified_browser';
  thinking?: string;
  presentation?: ResponsePresentation;
  sources?: MessageSource[];
  images?: OpenClawImageAttachment[];
  attachments?: OpenClawFileAttachment[];
  meta?: {
    tokens: number;
    duration: number;
    tps: number;
  };
}

interface OpenClawImageAttachment {
  name: string;
  type: string;
  size: number;
  data: string;
  dataUrl: string;
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
  statusMessage?: string;
}

interface OpenClawSettings {
  openClawProvider: OpenClawProvider;
  openClawModel: string;
  openClawBaseUrl: string;
  ollamaHost: string;
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
  openClawUwafScreenshots: boolean;
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
    });

type ToolApprovalResolution =
  | ShellOutputEntry
  | FilesystemToolResultEntry
  | CodeToolResultEntry
  | BrowserToolResultEntry
  | UwafBrowserToolResultEntry;

interface WebToolResultEntry {
  query: string;
  description?: string;
  context?: string;
  sources: MessageSource[];
  success: boolean;
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
  source: 'clear_web' | 'dark_web';
  success: boolean;
  error?: string;
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
  message?: {
    thinking?: unknown;
    content?: unknown;
  };
  done?: unknown;
  eval_count?: number;
  eval_duration?: number;
};

const OPENCLAW_API_KEY_STORAGE = 'view-llama-openclaw-api-key';
const OPENCLAW_INTERNET_STORAGE = 'view-llama-openclaw-internet-enabled';
const OPENCLAW_AGENT_STORAGE = 'view-llama-openclaw-agent-preferences';
const OPENCLAW_RAIL_STORAGE = 'view-llama-openclaw-rail-collapsed';
const OPENCLAW_TASK_STATE_STORAGE = 'view-llama-openclaw-task-states';
const OPENCLAW_DRAFT_TASK_ID = '__draft__';
const OPENCLAW_PERSONA_STORAGE = 'view-llama-openclaw-persona';
const OPENCLAW_USER_PROFILE_STORAGE = 'view-llama-openclaw-user-profile';
const OPENCLAW_CURRENT_SESSION_STORAGE = 'view-llama-openclaw-current-session';

function getChatTitle(messages: OpenClawMessage[]) {
  const firstMessage = messages.find(message => message.role === 'user' && message.content.trim());
  const base = firstMessage?.content.trim() || 'Open Claw';
  return base.substring(0, 36) + (base.length > 36 ? '...' : '');
}

function formatTimestamp(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function isVisibleMessage(message: OpenClawMessage) {
  return !message.hidden;
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
  const modeLabel = request.browserMode === 'stealth' ? 'Stealth' : 'Direct';
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
  if (request.action === 'click') {
    return request.linkIndex !== undefined
      ? `UWAF ${modeLabel}: Clicking link ${request.linkIndex}`
      : `UWAF ${modeLabel}: Clicking link matching \`${request.linkText}\``;
  }
  if (request.action === 'submit') {
    return `UWAF ${modeLabel}: Submitting form ${request.formIndex ?? '?'}`;
  }
  return request.description?.trim()
    ? `UWAF ${modeLabel}: ${request.description.trim()}`
    : `UWAF ${modeLabel}: ${request.action}`;
}

function normalizeToolSources(value: unknown): MessageSource[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const source = item as Partial<MessageSource>;
    if (typeof source.filename !== 'string' || typeof source.content !== 'string' || typeof source.score !== 'number') {
      return [];
    }

    return [source as MessageSource];
  });
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

function shouldAutoPrepareOpenClawInternetContext(options: {
  prompt: string;
  hasImages: boolean;
  hasAttachments: boolean;
}) {
  const prompt = options.prompt.trim();
  if (!prompt || options.hasImages || options.hasAttachments) {
    return false;
  }

  if (
    /\b(?:my|this|current)\s+(?:cpu|gpu|ram|memory|disk|filesystem|machine|system|server|repo|repository|project|workspace|container|docker|vm|process|service|port|log)s?\b/i.test(prompt)
    || /\b(?:in|on)\s+(?:this|my)\s+(?:machine|system|repo|repository|project|workspace|container|docker|vm|server)\b/i.test(prompt)
    || /(?:^|\s)\/(?:home|tmp|usr|var|etc|opt|app|workspaces?)(?:\/|$)/i.test(prompt)
    || /`[^`]+`/.test(prompt)
  ) {
    return false;
  }

  return (
    /\b(?:search|look up|browse|google|web|internet|online)\b/i.test(prompt)
    || /\b(?:latest|recent|today|news|announcement|release(?:\s+notes?)?|version|pricing|benchmark|docs?|documentation|api|policy|regulation|law|official)\b/i.test(prompt)
    || /\b(?:verify|fact-?check|cite|sources?)\b/i.test(prompt)
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
    return `unified_browser:${uwaf.action}:${uwaf.url?.trim() || ''}:${uwaf.browserMode || ''}:${uwaf.linkIndex ?? ''}:${uwaf.linkText?.trim() || ''}:${uwaf.formIndex ?? ''}:${JSON.stringify(uwaf.values || {})}:${uwaf.mode || ''}:${uwaf.depth ?? ''}`;
  }

  return `filesystem:${request.request.action}:${request.request.path.trim()}`;
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
    if (entry.error?.trim()) {
      lines.push(`Error: ${entry.error.trim()}`);
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
  const modeLabel = entry.mode === 'stealth' ? 'Stealth (Tor)' : 'Direct (Clear Web)';
  const lines = [
    `Unified browser result [${modeLabel}]:`,
    `Action: ${entry.action}`,
    `Status: ${entry.success ? 'completed' : 'failed'}`,
    `Source: ${entry.source === 'dark_web' ? 'Dark Web' : 'Clear Web'}`,
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

  lines.push('', 'Use this result to continue the task. Cite sources with inline markers when making factual claims.');
  return lines.join('\n');
}

export interface OpenClawWorkspaceProps {
  onNavigateToChat?: () => void;
  onNavigateToKnowledgeBase?: () => void;
  onNavigateToWorkspace?: () => void;
  onNavigateToSettings?: () => void;
  view?: 'workspace' | 'knowledge-base';
  knowledgeBaseContent?: React.ReactNode;
}

export default function OpenClawWorkspace({
  onNavigateToChat,
  onNavigateToKnowledgeBase,
  onNavigateToWorkspace,
  onNavigateToSettings,
  view = 'workspace',
  knowledgeBaseContent,
}: OpenClawWorkspaceProps) {
  const getStoredInternetEnabled = () => {
    if (typeof window === 'undefined') return false;
    try {
      return window.sessionStorage.getItem(OPENCLAW_INTERNET_STORAGE) === 'true';
    } catch {
      return false;
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
                id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
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

  const getIsMobileViewport = () => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= MOBILE_BREAKPOINT;
  };

  const [settings, setSettings] = useState<OpenClawSettings | null>(null);
  const [models, setModels] = useState<OpenClawModel[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false);
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
  const [provider, setProvider] = useState<OpenClawProvider>('ollama');
  const [baseUrl, setBaseUrl] = useState('');
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
  const [connectionSummary, setConnectionSummary] = useState('');
  const [sessionMenuOpen, setSessionMenuOpen] = useState<string | null>(null);
  const [selectedSessionInfo, setSelectedSessionInfo] = useState<string>('');
  const [ragEnabled, setRagEnabled] = useState(false);
  const [internetEnabled, setInternetEnabled] = useState(getStoredInternetEnabled);
  const [uwafBrowserMode, setUwafBrowserMode] = useState<'direct' | 'stealth'>('direct');
  const [uwafScreenshot, setUwafScreenshot] = useState<string | null>(null);
  const [uwafCurrentUrl, setUwafCurrentUrl] = useState<string>('');
  const [uwafCurrentTitle, setUwafCurrentTitle] = useState<string>('');
  const [uwafShowPreview, setUwafShowPreview] = useState(false);
  const [stoppingModel, setStoppingModel] = useState(false);
  const [modelControlNote, setModelControlNote] = useState('');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [workspaceCapabilitiesOpen, setWorkspaceCapabilitiesOpen] = useState(false);
  const [rightRailCollapsed, setRightRailCollapsed] = useState(getStoredRightRailCollapsed);
  const [isMobileViewport, setIsMobileViewport] = useState(getIsMobileViewport);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [mobileHeaderMenuOpen, setMobileHeaderMenuOpen] = useState(false);
  const [mobileModelMenuOpen, setMobileModelMenuOpen] = useState(false);
  const [agentPreferences, setAgentPreferences] = useState<OpenClawAgentPreferences>(getStoredAgentPreferences);
  const [autoContinuePending, setAutoContinuePending] = useState(false);
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
  const [memoryContext, setMemoryContext] = useState<string>('');
  const [hasMemory, setHasMemory] = useState(false);
  // Shell execution state
  const [shellEnabled, setShellEnabled] = useState(false);
  const [shellSettingsOpen, setShellSettingsOpen] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingToolApproval | null>(null);
  const [, setExecutingCommand] = useState(false);
  const [shellOutput, setShellOutput] = useState<ShellOutputEntry[]>([]);
  // Canvas artifacts state
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
  const railCollapsed = rightRailCollapsed && !isMobileViewport;
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
    const syncViewport = () => {
      const nextIsMobile = window.innerWidth <= MOBILE_BREAKPOINT;
      setIsMobileViewport(nextIsMobile);
      if (!nextIsMobile) {
        setMobileRailOpen(false);
        setMobileHeaderMenuOpen(false);
        setMobileModelMenuOpen(false);
      }
    };

    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  const closeMobileChrome = () => {
    setMobileRailOpen(false);
    setMobileHeaderMenuOpen(false);
    setMobileModelMenuOpen(false);
    setModelMenuOpen(false);
  };

  const filesystemEnabled = settings?.openClawFileAccessMode === 'read-only';
  const filesystemWriteEnabled = settings?.openClawFileWriteMode !== 'deny';
  const codeExecutionEnabled = settings?.openClawCodeExecutionMode !== 'deny';
  const browserMode = settings?.openClawBrowserMode || 'deny';
  const browserEnabled = browserMode !== 'deny';
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
  const filesystemAccessSummary = filesystemEnabled
    ? allowedFilesystemPaths.length > 0
      ? `${allowedFilesystemPaths.length} approved path${allowedFilesystemPaths.length === 1 ? '' : 's'}`
      : 'Read-only mode, no approved paths'
    : 'Disabled';
  const filesystemAccessBadge = filesystemEnabled
    ? allowedFilesystemPaths.length > 0
      ? `${allowedFilesystemPaths.length} path${allowedFilesystemPaths.length === 1 ? '' : 's'}`
      : 'Read-only'
    : 'Off';
  const filesystemWriteSummary = filesystemWriteEnabled
    ? settings?.openClawFileWriteMode === 'auto-approve'
      ? 'Auto-approve'
      : settings?.openClawFileWriteMode === 'ask-first'
        ? 'Ask-first'
        : 'Disabled'
    : 'Disabled';
  const filesystemWriteBadge = filesystemWriteEnabled
    ? settings?.openClawFileWriteMode === 'auto-approve'
      ? 'Auto'
      : settings?.openClawFileWriteMode === 'ask-first'
        ? 'Ask-first'
        : 'Off'
    : 'Off';
  const codeSandboxSummary = codeExecutionEnabled
    ? settings?.openClawCodeExecutionMode === 'auto-approve'
      ? 'Auto-approve'
      : 'Ask-first'
    : 'Disabled';
  const codeSandboxBadge = codeExecutionEnabled
    ? settings?.openClawCodeExecutionMode === 'auto-approve'
      ? 'Auto'
      : 'Ask-first'
    : 'Off';
  const browserControlSummary = browserEnabled ? browserMode : 'Disabled';
  const browserControlBadge = browserEnabled ? browserMode : 'Off';
  const activeAgentMode = OPENCLAW_AGENT_MODE_OPTIONS.find(option => option.id === agentPreferences.mode);

  const persistApiKey = (value: string) => {
    setApiKey(value);
    try {
      window.localStorage.setItem(OPENCLAW_API_KEY_STORAGE, value);
    } catch {
      // Ignore browser storage failures.
    }
  };

  const loadSettings = async () => {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const nextSettings: OpenClawSettings = {
      openClawProvider: data.openClawProvider === 'openai-compatible' ? 'openai-compatible' : 'ollama',
      openClawModel: typeof data.openClawModel === 'string' ? data.openClawModel : '',
      openClawBaseUrl: typeof data.openClawBaseUrl === 'string' ? data.openClawBaseUrl : '',
      ollamaHost: typeof data.ollamaHost === 'string' ? data.ollamaHost : 'http://127.0.0.1:11434',
      theme: typeof data.theme === 'string' ? data.theme : 'aurora',
      shellExecutionTarget: data.shellExecutionTarget === 'host' ? 'host' : 'container',
      shellExecutionMode: typeof data.shellExecutionMode === 'string' ? data.shellExecutionMode : 'ask-first',
      shellAllowedCommands: typeof data.shellAllowedCommands === 'string' ? data.shellAllowedCommands : '',
      shellHostAllowedRoots: typeof data.shellHostAllowedRoots === 'string' ? data.shellHostAllowedRoots : '/tmp/viewllama-openclaw-workspace',
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
      openClawUwafScreenshots: data.openClawUwafScreenshots !== false,
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

    setSettings(nextSettings);
    setProvider(nextSettings.openClawProvider);
    setBaseUrl(nextSettings.openClawBaseUrl);
    setSelectedModel(nextSettings.openClawModel);
    setShellEnabled(nextSettings.shellExecutionMode !== 'deny');
    applyTheme(nextSettings.theme);

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

  const loadSessions = async () => {
    const res = await fetch('/api/chats?surface=openclaw');
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Failed to load Open Claw sessions');

    const nextSessions = data as OpenClawSession[];
    setSessions(nextSessions);
    const storedSelection = getStoredCurrentSessionSelection();

    if (storedSelection === OPENCLAW_DRAFT_TASK_ID) {
      setCurrentSessionId(null);
      setChatHistory([]);
      setSelectedSessionInfo('New Open Claw task thread');
      return;
    }

    const preferredSession = storedSelection
      ? nextSessions.find(session => session.id === storedSelection)
      : null;
    const nextSession = preferredSession || nextSessions[0];

    if (nextSession) {
      setCurrentSessionId(nextSession.id);
      setChatHistory(nextSession.messages || []);
      setSelectedSessionInfo(`${nextSession.title} · updated ${formatTimestamp(nextSession.updatedAt)}`);
    } else {
      setCurrentSessionId(null);
      setChatHistory([]);
      setSelectedSessionInfo('No saved sessions yet');
    }
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

  const loadCanvasArtifacts = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/canvas/artifacts?sessionId=${sessionId}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        setCanvasArtifacts(data.artifacts || []);
      }
    } catch (error) {
      console.error("Failed to load canvas artifacts:", error);
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
        setCanvasArtifacts(prev => prev.filter(a => a.id !== id));
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
      console.error('Open Claw model lookup failed:', error);
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
        selectedModel: modelName,
        selectedModelLoaded: false,
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
        throw new Error(data.error || 'Failed to save Open Claw settings');
      }

      const nextSettings: OpenClawSettings = {
        openClawProvider: data.openClawProvider === 'openai-compatible' ? 'openai-compatible' : 'ollama',
        openClawModel: typeof data.openClawModel === 'string' ? data.openClawModel : '',
        openClawBaseUrl: typeof data.openClawBaseUrl === 'string' ? data.openClawBaseUrl : '',
        ollamaHost: typeof data.ollamaHost === 'string' ? data.ollamaHost : 'http://127.0.0.1:11434',
        theme: typeof data.theme === 'string' ? data.theme : 'aurora',
        shellExecutionTarget: data.shellExecutionTarget === 'host' ? 'host' : 'container',
        shellExecutionMode: typeof data.shellExecutionMode === 'string' ? data.shellExecutionMode : 'ask-first',
        shellAllowedCommands: typeof data.shellAllowedCommands === 'string' ? data.shellAllowedCommands : '',
        shellHostAllowedRoots: typeof data.shellHostAllowedRoots === 'string' ? data.shellHostAllowedRoots : '/tmp/viewllama-openclaw-workspace',
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
        openClawUwafScreenshots: data.openClawUwafScreenshots !== false,
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

      setSettings(nextSettings);
      setProvider(nextSettings.openClawProvider);
      setBaseUrl(nextSettings.openClawBaseUrl);
      setSelectedModel(nextSettings.openClawModel);
      setShellEnabled(nextSettings.shellExecutionMode !== 'deny');
      applyTheme(nextSettings.theme);
      return nextSettings;
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : 'Failed to save Open Claw settings');
      throw error;
    } finally {
      setConfigSaving(false);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        await Promise.all([loadSettings(), loadSessions(), loadMemory(), loadShellSettings()]);
      } catch (error) {
        console.error('Failed to initialize Open Claw workspace:', error);
      }
    })();
    // load only once on mount
  }, []);

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
    const timer = window.setTimeout(() => {
      void verifyConnection(provider, baseUrl, apiKey, settings.ollamaHost);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [settings?.openClawProvider, settings?.openClawBaseUrl, settings?.ollamaHost, apiKeyLoaded, apiKey]);
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
          id: crypto.randomUUID(),
          text: '',
          completed: false,
        },
      ],
    }));
  };

  const updateChecklistItem = (id: string, text: string) => {
    updateTaskState(current => ({
      ...current,
      checklist: current.checklist.map(item => item.id === id ? { ...item, text } : item),
    }));
  };

  const toggleChecklistItem = (id: string) => {
    updateTaskState(current => ({
      ...current,
      checklist: current.checklist.map(item => item.id === id ? { ...item, completed: !item.completed } : item),
    }));
  };

  const removeChecklistItem = (id: string) => {
    updateTaskState(current => ({
      ...current,
      checklist: current.checklist.filter(item => item.id !== id),
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

  const refreshModels = async () => {
    if (!settings) return;
    await Promise.all([
      loadModels(provider, baseUrl),
      verifyConnection(provider, baseUrl, apiKey, settings.ollamaHost),
      provider === 'ollama' ? refreshOllamaHealth(selectedModel, settings.ollamaHost) : Promise.resolve(),
    ]);
  };

  const switchSession = (session: OpenClawSession) => {
    if (isStreaming) {
      setSelectedSessionInfo('Stop the current Open Claw run before switching task threads.');
      return;
    }
    closeMobileChrome();
    requestScrollReset();
    setCurrentSessionId(session.id);
    setChatHistory(session.messages || []);
    loadCanvasArtifacts(session.id);
    resetComposerDraftState();
    setLastSubmission(null);
    setSelectedSessionInfo(`${session.title} · updated ${formatTimestamp(session.updatedAt)}`);
    setSessionMenuOpen(null);
  };

  const createSession = async (baseMessages: OpenClawMessage[], sessionId: string) => {
    const title = getChatTitle(baseMessages);

    const res = await fetch('/api/chats/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: sessionId,
        title,
        messages: baseMessages,
        surface: 'openclaw',
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to create Open Claw session');
    }

    const session = data.session as OpenClawSession;
    setSessions(prev => {
      const existingIndex = prev.findIndex(item => item.id === session.id);
      if (existingIndex === -1) return [session, ...prev];
      const next = [...prev];
      next[existingIndex] = session;
      return next;
    });
    return session;
  };

  const handleNewSession = () => {
    if (isStreaming) {
      setSelectedSessionInfo('Stop the current Open Claw run before starting a new task thread.');
      return;
    }
    closeMobileChrome();
    resetComposerDraftState();
    setChatHistory([]);
    setCurrentSessionId(null);
    setStreamPhase(null);
    setLiveStats(null);
    setSessionMenuOpen(null);
    setModelControlNote('');
    setSelectedSessionInfo('New Open Claw task thread');
    setLastSubmission(null);
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

      void verifyConnection(provider, baseUrl, apiKey, settings?.ollamaHost || 'http://127.0.0.1:11434');
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

  const setInternetAccess = (nextValue: boolean) => {
    try {
      window.sessionStorage.setItem(OPENCLAW_INTERNET_STORAGE, String(nextValue));
    } catch {
      // Ignore browser storage failures.
    }
    setInternetEnabled(nextValue);
  };

  const applyQuickPrompt = (prompt: string, mode: OpenClawAgentMode) => {
    updateAgentPreferences({ mode });
    setMessage(prompt);
    pinToBottom();
    window.requestAnimationFrame(() => composerRef.current?.focus());
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
          messages,
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
        setShellEnabled(data.shellExecutionMode !== 'deny');
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
        id: crypto.randomUUID(),
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
        id: crypto.randomUUID(),
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
        id: crypto.randomUUID(),
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
        id: crypto.randomUUID(),
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
        return {
          action: request.action,
          path: request.path,
          success: false,
          error: typeof data.error === 'string' ? data.error : 'Filesystem request failed',
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
        throw new Error(data.error || 'Filesystem write request failed');
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
    const payload = { ...request, sessionId: options.sessionId };

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

  const executeUwafBrowserAction = async (payload: Record<string, unknown>): Promise<UwafBrowserToolResultEntry> => {
    try {
      const res = await fetch('/api/openclaw/uwaf-browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `UWAF browser action failed: ${res.status}`);
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
        screenshot: data.screenshot,
        mode: data.mode || 'direct',
        source: data.source || 'clear_web',
        success: true,
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

      resolve(await executeBrowserAction({
        ...approval.request,
        approvalToken: approval.approvalToken,
      }));
    } catch (error) {
      console.error('Approved tool execution failed:', error);
      const message = error instanceof Error ? error.message : 'Approved tool execution failed';

      if (approval.kind === 'shell') {
        resolve(appendShellOutput({
          id: crypto.randomUUID(),
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
        id: crypto.randomUUID(),
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
      setSelectedSessionInfo('Stop the current Open Claw run before deleting this task thread.');
      setSessionMenuOpen(null);
      return;
    }
    if (!confirm('Delete this Open Claw session?')) return;
    await fetch('/api/chats', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sessionId }),
    });
    setSessions(prev => prev.filter(session => session.id !== sessionId));
    setTaskStates(current => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    if (currentSessionId === sessionId) handleNewSession();
    setSessionMenuOpen(null);
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
    };
  };

  const buildAttachmentContext = (attachments: OpenClawFileAttachment[] = [], images: OpenClawImageAttachment[] = [], userText = '') => {
    const imageContext = images.map((image, idx) => [
      `[Attached image ${idx + 1}: ${image.name}]`,
      `MIME: ${image.type || 'image/*'}`,
      `Size: ${formatBytes(image.size)}`,
      'Model input: original image bytes via Ollama images array',
    ].join('\n'));

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
      if (attachmentText.trim()) lines.push('', attachmentText);
      return lines.join('\n');
    });

    return [...imageContext, ...fileContext, userText.trim()].filter(Boolean).join('\n\n');
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const newImages: OpenClawImageAttachment[] = [];
    const newAttachments: OpenClawFileAttachment[] = [];
    setAttachmentError(null);
    setProcessingAttachments(true);
    try {
      for (const file of files) {
        if (file.size > MAX_UPLOAD_BYTES) {
          setAttachmentError(`"${file.name}" is too large. Files are limited to ${MAX_UPLOAD_LABEL}.`);
          break;
        }
        if (file.type.startsWith('image/')) {
          const b64 = await readAsBase64Fn(file);
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

  const removePendingImage = (index: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index));
  };

  const removePendingAttachment = (index: number) => {
    setPendingAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const updateChatMessage = (messageId: string, updater: (message: OpenClawMessage) => OpenClawMessage) => {
    setChatHistory(prev => prev.map(message => (
      message.id === messageId ? updater(message) : message
    )));
  };


  // Batch updates for smoother rendering
  let pendingUpdates: { id: string; thinking?: string; content?: string; sources?: MessageSource[] }[] = [];
  let updateScheduled = false;

  const flushUpdates = () => {
    if (pendingUpdates.length === 0) return;
    const updates = [...pendingUpdates];
    pendingUpdates = [];
    setChatHistory(prev => {
      const next = [...prev];
      for (const u of updates) {
        const idx = next.findIndex(m => m.id === u.id);
        if (idx !== -1) {
          next[idx] = {
            ...next[idx],
            thinking: u.thinking !== undefined ? (next[idx].thinking || '') + u.thinking : next[idx].thinking,
            content: u.content !== undefined ? (next[idx].content || '') + u.content : next[idx].content,
            sources: u.sources !== undefined ? u.sources : next[idx].sources,
          };
        }
      }
      return next;
    });
    updateScheduled = false;
  };

  const scheduleUpdate = (id: string, update: { thinking?: string; content?: string; sources?: MessageSource[] }) => {
    const existing = pendingUpdates.findIndex(u => u.id === id);
    if (existing !== -1) {
      if (update.thinking) pendingUpdates[existing].thinking = (pendingUpdates[existing].thinking || '') + update.thinking;
      if (update.content) pendingUpdates[existing].content = (pendingUpdates[existing].content || '') + update.content;
      if (update.sources) pendingUpdates[existing].sources = update.sources;
    } else {
      pendingUpdates.push({ id, ...update });
    }
    if (!updateScheduled) {
      updateScheduled = true;
      requestAnimationFrame(() => {
        flushUpdates();
        updateScheduled = false;
      });
    }
  };

  const streamAssistantResponse = async (options: {
    assistantMessageId: string;
    conversationMessages: OpenClawMessage[];
    chatId: string;
    prompt: string;
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
    let finalMeta: OpenClawMessage['meta'] | undefined;

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
        surface: 'openclaw',
        provider,
        base_url: provider === 'openai-compatible' ? baseUrl : settings?.ollamaHost,
        api_key: apiKey,
        response_presentation: options.responsePresentation,
        internet_enabled: options.internetEnabledForTurn,
        internet_tool_enabled: options.internetToolEnabledForTurn,
        internet_query: options.prompt,
        messages: options.conversationMessages.map(message => ({
          role: message.role,
          content: message.content,
          ...(message.images?.length ? { images: message.images.map(img => img.data) } : {}),
        })),
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

      if (Array.isArray(data.sources)) {
        activeSources = mergeMessageSources(activeSources, normalizeToolSources(data.sources));
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
          scheduleUpdate(options.assistantMessageId, { content: messageFrame.content });
        }
      }

      if (data.done && data.eval_count && data.eval_duration) {
        const tokens = data.eval_count;
        const durationSec = data.eval_duration / 1e9;
        const tps = tokens / durationSec;
        finalMeta = { tokens, duration: durationSec, tps };
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
      },
      activeSources,
    };
  };

  const triggerAutoContinue = useCallback(() => {
    if (!agentPreferences.autoContinue || !taskState.objective.trim()) return;
    setAutoContinuePending(true);
    setTimeout(() => {
      setMessage('continue');
      const sendBtn = document.querySelector('[data-send-button]') as HTMLButtonElement;
      if (sendBtn) sendBtn.click();
      setAutoContinuePending(false);
    }, 500);
  }, [agentPreferences.autoContinue, taskState.objective]);

  const handleSendMessage = async (draftPrompt = message, draftInternetEnabled = internetEnabled) => {
    const prompt = draftPrompt.trim();
    if ((!prompt && pendingImages.length === 0 && pendingAttachments.length === 0) || isStreaming || !selectedModel || !settings) return;

    const chatId = currentSessionId ?? crypto.randomUUID();
    const effectiveTaskState = {
      ...taskState,
      objective: taskState.objective.trim() || prompt,
      currentStatus: taskState.currentStatus.trim() || 'Task captured. Waiting for the next workspace update.',
      nextStep: taskState.nextStep.trim() || 'Review the assistant output and update the pinned checklist.',
    };
    const messageImages = [...pendingImages];
    const messageAttachments = [...pendingAttachments];
    const attachmentContext = buildAttachmentContext(messageAttachments, messageImages, prompt);
    const userMessage: OpenClawMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: attachmentContext || prompt,
      images: messageImages,
      attachments: messageAttachments,
    };
    const assistantMessageId = crypto.randomUUID();
    const baseHistory = [...chatHistory, userMessage];
    const responsePresentation = inferResponsePresentation([{ role: 'user', content: prompt }]);

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
      { id: assistantMessageId, role: 'assistant', content: '' },
    ]);
    setCurrentSessionId(chatId);
    setIsStreaming(true);
    setStreamPhase(ragEnabled && Boolean(prompt.trim()) ? 'preparing-context' : 'connecting');

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

    try {
      const sessionSavePromise = createSession(baseHistory, chatId).catch(error => {
        console.error('Failed to persist Open Claw session before streaming:', error);
        return null;
      });
      const shouldPreloadInternetContext = draftInternetEnabled && shouldAutoPrepareOpenClawInternetContext({
        prompt,
        hasImages: messageImages.length > 0,
        hasAttachments: messageAttachments.length > 0,
      });
      if (controller.signal.aborted) return;

      const contextMessages: OpenClawMessage[] = [];
      let activeSources: MessageSource[] = [];
      const workspaceBrief = buildOpenClawWorkspaceBrief(agentPreferences);
      const taskStateBrief = buildOpenClawTaskStateBrief(effectiveTaskState);
      if (workspaceBrief) {
        contextMessages.push({
          id: crypto.randomUUID(),
          role: 'system',
          content: workspaceBrief,
          hidden: true,
        });
      }
      if (taskStateBrief) {
        contextMessages.push({
          id: crypto.randomUUID(),
          role: 'system',
          content: taskStateBrief,
          hidden: true,
        });
      }
      if (memoryContext) {
        contextMessages.push({
          id: crypto.randomUUID(),
          role: 'system',
          content: `Recent memory context (auto-loaded from previous sessions):\n\n${memoryContext}`,
          hidden: true,
        });
      }
      if (ragEnabled && prompt.trim()) {
        try {
          const ragRes = await fetch('/api/rag/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({ query: prompt, topK: 4 }),
          });

          if (ragRes.ok) {
            const ragData = await ragRes.json() as MessageSource[];
            if (Array.isArray(ragData) && ragData.length > 0) {
              activeSources = [...activeSources, ...ragData];
              const context = ragData
                .map((source, index) => {
                  const label = source.sourcePath && source.sourcePath !== source.filename
                    ? `${source.filename} (${source.sourcePath})`
                    : source.filename;
                  const meta = [
                    source.fileKind || null,
                    source.extension ? `.${source.extension}` : null,
                    typeof source.chunkIndex === 'number' ? `chunk ${source.chunkIndex + 1}` : null,
                    typeof source.documentSize === 'number' ? formatBytes(source.documentSize) : null,
                    `${Math.round(source.score * 100)}% match`,
                    source.mode || 'semantic',
                  ].filter(Boolean).join(' · ');
                  return `[Source ${index + 1}: ${label} | ${meta}]\n${source.content}`;
                })
                .join('\n\n---\n\n');
              contextMessages.push({
                id: crypto.randomUUID(),
                role: 'system',
                content: `Use the following knowledge base context when it is relevant to the Open Claw task. Most entries are retrieved excerpts from indexed files, but small files may be included as full-document context when safe. If the context is not enough, ask for a broader lookup or direct file inspection by naming the file, folder, or chunk you need. Cite the source and chunk when you can.\n\n${context}`,
                hidden: true,
              });
            }
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            throw error;
          }
          console.error('Open Claw RAG search failed:', error);
        }
      }

      if (activeSources.length > 0) {
        updateChatMessage(assistantMessageId, current => ({
          ...current,
          sources: activeSources,
        }));
      }

      let sessionHistory = [...baseHistory];
      let currentSources = [...activeSources];
      let finalAssistantMessage: OpenClawMessage | null = null;
      let nextAssistantId = assistantMessageId;
      let lastToolRequestSignature: string | null = null;
      let duplicateToolRequestCount = 0;

      for (let toolRound = 0; toolRound < 8; toolRound += 1) {
        if (toolRound > 0) {
          nextAssistantId = crypto.randomUUID();
          setChatHistory(prev => [
            ...prev,
            {
              id: nextAssistantId,
              role: 'assistant',
              content: '',
              ...(currentSources.length > 0 ? { sources: currentSources } : {}),
            },
          ]);
        }

        const { assistantMessage, activeSources: roundSources } = await streamAssistantResponse({
          assistantMessageId: nextAssistantId,
          conversationMessages: [...contextMessages, ...sessionHistory],
          chatId,
          prompt,
          responsePresentation,
          internetEnabledForTurn: toolRound === 0 ? shouldPreloadInternetContext : false,
          internetToolEnabledForTurn: draftInternetEnabled,
          initialSources: currentSources,
        });

        currentSources = roundSources;
        const { cleanedContent, request } = extractOpenClawToolRequest(assistantMessage.content);
        const inferredFilesystemRequest = request?.name === 'shell' && filesystemEnabled
          ? inferFilesystemRequestFromShellCommand(request.request.command, allowedFilesystemPaths)
          : null;
        const normalizedAssistant: OpenClawMessage = {
          ...assistantMessage,
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
                          : describeFilesystemRequest(request.request.action, request.request.path)
              : assistantMessage.content
          ),
        };

        updateChatMessage(nextAssistantId, current => ({
          ...current,
          ...normalizedAssistant,
        }));

        sessionHistory = [...sessionHistory, normalizedAssistant];
        finalAssistantMessage = normalizedAssistant;

        if (!request || toolRound === 7) {
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
            id: crypto.randomUUID(),
            role: 'user',
            content: inferredFilesystemRequest
              ? 'The previous filesystem result for this exact path was already provided. Do not repeat the same request. Use that result to answer the user or request a different path/action only if new information is needed.'
              : 'The previous tool result for this exact request was already provided. Do not repeat the same request. Use that result to answer the user or choose a different next step only if new information is needed.',
            hidden: true,
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
          const filesystemResult = await requestFilesystemAction(
            inferredFilesystemRequest,
            { messageId: nextAssistantId }
          );
          const toolResultMessage: OpenClawMessage = {
            id: crypto.randomUUID(),
            role: 'user',
            content: formatFilesystemToolResult(filesystemResult),
            hidden: true,
          };
          sessionHistory = [...sessionHistory, toolResultMessage];
          setChatHistory(prev => [...prev, toolResultMessage]);
          continue;
        }

        if (request.name === 'web') {
          if (!draftInternetEnabled) {
            break;
          }

          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          setStreamPhase('internet-lookup');
          const webResult = await requestWebContext(request.request.query, {
            description: request.request.description,
          });
          setStreamPhase(null);
          if (webResult.sources.length > 0) {
            currentSources = mergeMessageSources(currentSources, webResult.sources);
          }
          const toolResultMessage: OpenClawMessage = {
            id: crypto.randomUUID(),
            role: 'user',
            content: formatWebToolResult(webResult),
            hidden: true,
          };
          sessionHistory = [...sessionHistory, toolResultMessage];
          setChatHistory(prev => [...prev, toolResultMessage]);
          continue;
        }

        if (request.name === 'code') {
          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          const codeResult = await requestCodeExecution(request.request, {
            messageId: nextAssistantId,
            sessionId: chatId,
          });
          const toolResultMessage: OpenClawMessage = {
            id: crypto.randomUUID(),
            role: 'user',
            content: formatCodeToolResult(codeResult),
            hidden: true,
          };
          sessionHistory = [...sessionHistory, toolResultMessage];
          setChatHistory(prev => [...prev, toolResultMessage]);
          continue;
        }

        if (request.name === 'browser') {
          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          const browserResult = await requestBrowserAction(request.request, {
            messageId: nextAssistantId,
            sessionId: chatId,
          });
          const toolResultMessage: OpenClawMessage = {
            id: crypto.randomUUID(),
            role: 'user',
            content: formatBrowserToolResult(browserResult),
            hidden: true,
          };
          sessionHistory = [...sessionHistory, toolResultMessage];
          setChatHistory(prev => [...prev, toolResultMessage]);
          continue;
        }

        if (request.name === 'unified_browser') {
          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          const uwafResult = await requestUwafBrowserAction(request.request as OpenClawUwafBrowserToolRequest, {
            messageId: nextAssistantId,
            sessionId: chatId,
          });
          if (uwafResult.screenshot) {
            setUwafScreenshot(uwafResult.screenshot);
            setUwafCurrentUrl(uwafResult.currentUrl);
            setUwafCurrentTitle(uwafResult.title);
            setUwafShowPreview(true);
          }
          const toolResultMessage: OpenClawMessage = {
            id: crypto.randomUUID(),
            role: 'user',
            content: formatUwafBrowserToolResult(uwafResult),
            hidden: true,
          };
          sessionHistory = [...sessionHistory, toolResultMessage];
          setChatHistory(prev => [...prev, toolResultMessage]);
          continue;
        }

        if (request.name === 'shell') {
          if (!shellEnabled) {
            break;
          }

          lastToolRequestSignature = effectiveToolSignature;
          duplicateToolRequestCount = 0;
          const shellResult = await requestShellCommand(request.request.command, {
            description: request.request.description,
            messageId: nextAssistantId,
          });
          const toolResultMessage: OpenClawMessage = {
            id: crypto.randomUUID(),
            role: 'user',
            content: formatShellToolResult(shellResult),
            hidden: true,
          };
          sessionHistory = [...sessionHistory, toolResultMessage];
          setChatHistory(prev => [...prev, toolResultMessage]);
          continue;
        }

        lastToolRequestSignature = effectiveToolSignature;
        duplicateToolRequestCount = 0;
        const filesystemResult = await requestFilesystemAction(request.request, {
          messageId: nextAssistantId,
        });
        const toolResultMessage: OpenClawMessage = {
          id: crypto.randomUUID(),
          role: 'user',
          content: formatFilesystemToolResult(filesystemResult),
          hidden: true,
        };
        sessionHistory = [...sessionHistory, toolResultMessage];
        setChatHistory(prev => [...prev, toolResultMessage]);
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

      await fetch('/api/chat/completed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          id: finalAssistantMessage.id,
          session_id: 'openclaw',
          title: getChatTitle(baseHistory),
          message: finalAssistantMessage,
          messages: messagesBeforeFinalAssistant,
          surface: 'openclaw',
        }),
      });

      // Generate session summary in the background
      void generateSessionSummary(
        chatId,
        getChatTitle(baseHistory),
        [...messagesBeforeFinalAssistant, finalAssistantMessage],
        effectiveTaskState.objective
      );

      setSessions(prev => {
        const next = [...prev];
        const index = next.findIndex(session => session.id === sessionRecord.id);
        const updatedSession: OpenClawSession = {
          ...sessionRecord,
          title: getChatTitle(baseHistory),
          messages: [...messagesBeforeFinalAssistant, finalAssistantMessage],
          updatedAt: Date.now(),
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
      console.error('Open Claw chat error:', error);
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
      clearInterval(intervalId);
      setLiveStats(null);
      setStreamPhase(null);
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const activeModeOption = OPENCLAW_AGENT_MODE_OPTIONS.find(option => option.id === agentPreferences.mode)
    || OPENCLAW_AGENT_MODE_OPTIONS[0];
  const activeStyleOption = OPENCLAW_RESPONSE_STYLE_OPTIONS.find(option => option.id === agentPreferences.responseStyle)
    || OPENCLAW_RESPONSE_STYLE_OPTIONS[1];
  const compactModeLabel = activeModeOption.label.slice(0, 3).toUpperCase();
  const selectedModelButtonLabel = selectedModel || (modelsLoading
    ? 'Loading models...'
    : models.length > 0
      ? 'Select a model'
      : 'No models found');
  const selectedModelIsOllama = provider === 'ollama';
  const healthStatusLabel = ollamaHealthLoading
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
  const healthStatusTone = ollamaHealth?.status === 'online'
    ? 'var(--success)'
    : ollamaHealth?.status === 'degraded'
      ? 'var(--warning)'
      : 'var(--danger)';
  const runtimeMetaLabel = ollamaHealth?.online
    ? `${ollamaHealth.version || 'Ollama'} · ${ollamaHealth.installedModelCount} installed · ${ollamaHealth.loadedModelCount} loaded`
    : ollamaHealth?.error || 'Waiting for Ollama health...';
  const collapsedRailFooterLabel = provider === 'ollama' ? 'Local' : 'Cloud';
  const collapsedRailFooterTone = provider === 'ollama'
    ? healthStatusTone
    : connectionStatus === 'error'
      ? 'var(--danger)'
      : connectionStatus === 'ok'
        ? 'var(--success)'
        : 'var(--text-secondary)';
  const composerPlaceholder = internetEnabled
    ? 'Internet mode - ask Open Claw with live public web context...'
    : ragEnabled
      ? 'RAG mode - ask Open Claw with Knowledge Base context...'
      : agentPreferences.mode === 'research'
        ? 'Ask Open Claw to compare options, gather evidence, or recommend a direction...'
        : agentPreferences.mode === 'execute'
          ? 'Describe the task you want executed with concrete steps or deliverables...'
          : agentPreferences.mode === 'review'
            ? 'Paste the plan, draft, or setup you want Open Claw to audit...'
          : 'Describe the task, workflow, or action you want Open Claw to handle...';
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
  const responseStyleSummary = `${activeStyleOption.label} · ${agentPreferences.askClarifyingQuestionFirst ? 'Clarify first' : 'Assume and move'} · ${agentPreferences.autoContinue ? 'Auto-continue ON' : 'Auto-continue OFF'}`;
  const taskStateSummary = hasTaskState
    ? `${taskStateFieldCount}/4 fields set${taskState.checklist.length > 0 ? ` · ${taskState.checklist.length} checklist item${taskState.checklist.length === 1 ? '' : 's'}` : ''}`
    : 'No task state captured yet';
  const workspaceBriefSummary = `${hasWorkspaceNotes ? 'Notes set' : 'Notes empty'} · ${hasSuccessCriteria ? 'Criteria set' : 'Criteria empty'}`;
  const visibleChatHistory = useMemo(
  () => deferredChatHistory.filter(isVisibleMessage),
  [deferredChatHistory, isVisibleMessage]
);
  const showingKnowledgeBase = view === 'knowledge-base';
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
        aria-label={mobileRailOpen ? 'Close Open Claw drawer' : 'Open Open Claw navigation'}
        title={mobileRailOpen ? 'Close Open Claw drawer' : 'Open Open Claw navigation'}
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
                {models.map(model => {
                  const active = model.name === selectedModel;
                  return (
                    <button
                      key={model.name}
                      type="button"
                      className={`mobile-topbar-menu-item${active ? ' is-active' : ''}`}
                      onClick={() => void selectOpenClawModel(model.name)}
                    >
                      <span>{model.name}</span>
                      <span>{active ? 'Selected' : 'Available'}</span>
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
            setMobileModelMenuOpen(false);
          }}
          aria-label="Open Open Claw tools"
          title="Open Claw tools"
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
            aria-label="Expand Open Claw rail"
            title="Expand rail"
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
                {models.map(model => {
                  const active = model.name === selectedModel;
                  return (
                    <button
                      key={model.name}
                      type="button"
                      onClick={() => void selectOpenClawModel(model.name)}
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
                          {selectedModelIsOllama ? 'Local Ollama model' : 'External provider model'}
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
        {settings?.openClawUwafBrowserMode && settings.openClawUwafBrowserMode !== 'deny' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              className="glass-panel"
              style={{
                padding: '8px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                border: `1px solid ${uwafBrowserMode === 'stealth' ? '#a855f7' : 'var(--accent-primary)'}`,
                background: uwafBrowserMode === 'stealth' ? 'rgba(168, 85, 247, 0.1)' : 'var(--accent-soft)',
              }}
              onClick={() => setUwafBrowserMode(prev => prev === 'direct' ? 'stealth' : 'direct')}
            >
              {uwafBrowserMode === 'stealth' ? <Shield size={16} color="#a855f7" /> : <Globe size={16} color="var(--accent-primary)" />}
              <span style={{ fontSize: '0.85rem', color: uwafBrowserMode === 'stealth' ? '#a855f7' : 'var(--accent-primary)' }}>
                {uwafBrowserMode === 'stealth' ? 'Stealth' : 'UWAF'}
              </span>
            </button>
            <HelpHint text="UWAF browser: Direct mode uses standard web access. Stealth mode routes traffic through Tor for anonymous research and .onion sites." />
          </div>
        )}
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
          aria-label="Close Open Claw drawer"
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
                  {ollamaHealth?.online
                    ? (ollamaHealth.version || 'Ollama') + ' ' + String.fromCharCode(183) + ' ' + ollamaHealth.installedModelCount + ' installed ' + String.fromCharCode(183) + ' ' + ollamaHealth.loadedModelCount + ' loaded'
                    : ollamaHealth?.error || 'Waiting for Ollama health...'}
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

        {showingKnowledgeBase ? (
          <div className="chat-scroll-shell">
            {knowledgeBaseContent || (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
                Knowledge Base content is unavailable.
              </div>
            )}
          </div>
        ) : (
          <>

        <div className="chat-scroll-shell">
          <div ref={chatAreaRef} className="chat-area openclaw-chat-area" onScroll={handleChatScroll}>
            {visibleChatHistory.length === 0 ? (
              <div className="openclaw-empty-state">
                <div style={{ textAlign: 'center', maxWidth: '720px', margin: '0 auto' }}>
                  <div style={{
                    width: '88px',
                    height: '88px',
                    margin: '0 auto 20px',
                    borderRadius: '26px',
                    background: 'var(--accent-gradient)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 14px 36px var(--accent-glow)',
                  }}>
                    <Wand2 size={40} color="white" />
                  </div>
                  <h1 style={{ margin: '0 0 12px', fontSize: '2rem', color: 'var(--text-primary)' }}>
                    What should Open Claw drive next?
                  </h1>
                  <p style={{ margin: 0, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
                    Treat this like an agent workspace instead of a plain chat. Pick a mode, attach workspace notes or success
                    criteria in the rail, and keep separate task threads for planning, research, execution, and review.
                  </p>

                  <div className="openclaw-context-pills" style={{ justifyContent: 'center', marginTop: '16px' }}>
                    {persona.name && <span className="openclaw-pill accent">{persona.name}</span>}
                    <span className="openclaw-pill accent">{activeModeOption.label} mode</span>
                    <span className="openclaw-pill">{activeStyleOption.label} responses</span>
                    <span className="openclaw-pill">{provider === 'ollama' ? 'Local Ollama' : 'External provider'}</span>
                    {hasMemory && <span className="openclaw-pill accent">Memory loaded</span>}
                    {internetEnabled && <span className="openclaw-pill accent">Internet on</span>}
                    {ragEnabled && <span className="openclaw-pill accent">Knowledge Base on</span>}
                  </div>
                </div>

                <div className="openclaw-quick-grid">
                  {OPENCLAW_QUICK_PROMPTS.map(prompt => (
                    <button
                      key={prompt.title}
                      type="button"
                      className="openclaw-quick-card"
                      onClick={() => applyQuickPrompt(prompt.prompt, prompt.mode)}
                    >
                      <div className="openclaw-section-label" style={{ marginBottom: '8px' }}>{prompt.mode}</div>
                      <div style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-primary)' }}>{prompt.title}</div>
                      <div style={{ marginTop: '8px', fontSize: '0.84rem', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                        {prompt.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              visibleChatHistory.map((msg, index) => {
                const outputsForMessage = msg.id
                  ? shellOutput.filter(output => output.messageId === msg.id)
                  : [];
                const isToolBridgeMessage = msg.role === 'assistant' && (Boolean(msg.toolRequest) || outputsForMessage.length > 0);

                return (
                  <div
                    key={msg.id || index}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
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
                      <div className="message-content" style={{ maxWidth: '100%' }}>
                        {msg.thinking && (
                          <ThinkingBlock content={msg.thinking} isStreaming={isStreaming && index === visibleChatHistory.length - 1 && !msg.content} />
                        )}
                        <ChatMessageContent
                          content={msg.content}
                          isStreaming={isStreaming}
                          isLast={index === visibleChatHistory.length - 1}
                          presentation={msg.presentation}
                          sources={msg.sources}
                        />
                        {msg.role === 'assistant' && !isToolBridgeMessage && msg.sources && msg.sources.length > 0 && (
                          <SourceChips sources={msg.sources} />
                        )}
                        {msg.role === 'assistant' && !isToolBridgeMessage && msg.content.trim() && (
                          <AssistantDownloads content={msg.content} index={index} presentation={msg.presentation} sessionId={currentSessionId ?? undefined} messageId={msg.id} />
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
                          gap: '12px',
                        }}
                      >
                        <span><Activity size={12} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />{msg.meta.tps.toFixed(1)} tok/s</span>
                        <span>{msg.meta.tokens} tokens</span>
                        <span>{msg.meta.duration.toFixed(2)}s</span>
                      </div>
                    )}
                    {isStreaming && index === visibleChatHistory.length - 1 && liveStats && !msg.meta && (
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
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {showScrollToBottom && (
            <button
              type="button"
              className="scroll-to-bottom-button"
              onClick={() => scrollToBottom('smooth')}
              aria-label="Scroll to latest Open Claw message"
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
            {persona.name && <span className="openclaw-pill">{persona.name}</span>}
            {userProfile.name && <span className="openclaw-pill">User: {userProfile.name}</span>}
            {taskState.objective.trim() && <span className="openclaw-pill">Objective set</span>}
            {taskState.nextStep.trim() && <span className="openclaw-pill">Next step pinned</span>}
            {taskState.checklist.length > 0 && <span className="openclaw-pill">Checklist: {taskState.checklist.length}</span>}
            {hasWorkspaceNotes && <span className="openclaw-pill">Notes attached</span>}
            {hasSuccessCriteria && <span className="openclaw-pill">Success criteria attached</span>}
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleNewSession}
              style={{ padding: '11px 12px', borderRadius: '12px', flexShrink: 0 }}
              title="New Open Claw task thread"
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
                    <div key={`img-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '20px', background: 'var(--accent-soft)', fontSize: '0.78rem' }}>
                      <img src={img.dataUrl} alt={img.name} style={{ width: '24px', height: '24px', objectFit: 'cover', borderRadius: '4px' }} />
                      <span style={{ maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{img.name}</span>
                      <button onClick={() => removePendingImage(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 0 }}><X size={12} /></button>
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
                <span>Internet mode adds read-only public web research with citations and lets Open Claw run follow-up searches during the task.</span>
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
                  onNavigateToChat?.();
                }}
                title="Go to Chat"
                aria-label="Go to Chat"
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
                <div style={{ background: 'var(--accent-gradient)', padding: '8px', borderRadius: '12px' }}>
                  <Cpu size={24} color="white" />
                </div>
                <div>
                  <h2 style={{ fontSize: '1.2rem', margin: 0 }}>ViewLlama</h2>
                  <div style={{ fontSize: '0.8rem', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                    <div className="status-indicator"></div> Engine Online
                  </div>
                </div>
              </button>
              <button
                type="button"
                className="btn-icon"
                onClick={toggleRightRail}
                aria-label="Collapse Open Claw workspace rail"
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
              <div className={`nav-item${!showingKnowledgeBase ? ' active' : ''}`} onClick={() => {
                closeMobileChrome();
                onNavigateToWorkspace?.();
              }} title="Go to Open Claw">
                <Wand2 size={18} /> <span className="sidebar-label">Open Claw</span>
              </div>
              <div className="nav-item" onClick={() => {
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
              aria-label="Expand Open Claw workspace rail"
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
              title="New Open Claw task thread"
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
            <div className="openclaw-rail-scroll" onClick={() => sessionMenuOpen && setSessionMenuOpen(null)}>
              <div className="openclaw-card">
                <div className="openclaw-card-header">
                  <div>
                    <div className="openclaw-section-label">Sessions</div>
                    <div style={{ marginTop: '4px', fontSize: '0.9rem', fontWeight: 700 }}>{sessions.length} task threads</div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleNewSession}
                    disabled={isStreaming}
                    style={{ padding: '8px 10px', borderRadius: '10px' }}
                  >
                    <Plus size={14} /> New
                  </button>
                </div>

                <div className="openclaw-list-scroll">
                  {sessions.length === 0 ? (
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', padding: '8px 4px' }}>
                      No saved Open Claw sessions yet.
                    </div>
                  ) : sessions.map(session => {
                    const active = session.id === currentSessionId;
                    return (
                      <div
                        key={session.id}
                        style={{
                          position: 'relative',
                          borderRadius: '12px',
                          border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                          background: active ? 'var(--accent-soft)' : 'rgba(255,255,255,0.02)',
                        }}
                      >
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
                            padding: '10px 12px',
                            cursor: isStreaming ? 'not-allowed' : 'pointer',
                            opacity: isStreaming ? 0.7 : 1,
                            textAlign: 'left',
                            fontFamily: 'inherit',
                          }}
                        >
                          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.84rem', fontWeight: 700, color: active ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                            {session.title}
                          </span>
                          <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                            Updated {formatTimestamp(session.updatedAt)}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setSessionMenuOpen(session.id === sessionMenuOpen ? null : session.id)}
                          style={{
                            position: 'absolute',
                            top: '10px',
                            right: '10px',
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            padding: '2px 4px',
                          }}
                          aria-label="Session options"
                        >
                          ···
                        </button>
                        {sessionMenuOpen === session.id && (
                          <div style={{
                            position: 'absolute',
                            right: '10px',
                            top: '34px',
                            zIndex: 20,
                            background: 'var(--sidebar-bg)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '10px',
                            padding: '4px',
                            minWidth: '130px',
                            boxShadow: '0 12px 24px rgba(0,0,0,0.35)',
                          }}>
                            <div
                              onClick={() => void handleDeleteSession(session.id)}
                              style={{
                                padding: '7px 10px',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontSize: '0.82rem',
                                color: 'var(--danger)',
                              }}
                            >
                              Delete
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
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
                      <button
                        type="button"
                        className={`openclaw-toggle${agentPreferences.autoContinue ? ' active' : ''}`}
                        onClick={() => updateAgentPreferences({
                          autoContinue: !agentPreferences.autoContinue,
                        })}
                        title="Automatically continue when the assistant finishes a response"
                      >
                        {agentPreferences.autoContinue ? 'Auto-continue ON' : 'Auto-continue OFF'}
                      </button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                      {agentPreferences.autoContinue && (
                        <>
                          <Wand2 size={12} />
                          <span>Agent will keep working until objective is complete</span>
                        </>
                      )}
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
                      Injected into every Open Claw request
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
                      {persona.templateId === 'custom'
                        ? (persona.name || 'Default persona')
                        : `${persona.name} · ${persona.templateId}`}
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
                      {userProfile.name || 'Not set'} · {userProfile.role || 'No role'}
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
                      {shellEnabled ? 'Enabled' : 'Disabled'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="openclaw-inline-button"
                    onClick={() => setShellSettingsOpen(true)}
                  >
                    <Settings size={14} /> Configure
                  </button>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {shellEnabled
                    ? 'Agent can request shell command execution. Commands require approval in ask-first mode.'
                    : 'Shell execution is disabled. Enable in settings to allow command execution.'}
                </div>
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
                        Modeled after Open Claw’s task-first workspace flow
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
                        {filesystemEnabled
                          ? allowedFilesystemPaths.length > 0
                            ? `Agent can inspect approved host paths in read-only mode: ${allowedFilesystemPaths.join(', ')}`
                            : 'Read-only mode is enabled, but no host paths are approved yet. Add paths in Settings to let the agent inspect files.'
                          : 'Filesystem access is disabled. Enable it in Settings to allow read-only host file inspection.'}
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
                        {filesystemWriteEnabled
                          ? allowedWritablePaths.length > 0
                            ? `Agent can create folders and write text files inside approved writable roots: ${allowedWritablePaths.join(', ')}`
                            : 'Write mode is enabled, but no writable roots are configured yet in Settings.'
                          : 'Filesystem writes are disabled. Enable them in Settings if you want Open Claw to create or edit files.'}
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
                        {codeExecutionEnabled
                          ? 'Agent can run short Python or Node scripts in the managed Open Claw workspace with sandbox guardrails.'
                          : 'Code execution sandbox is disabled. Enable it in Settings to let Open Claw run short scripts.'}
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
                        {browserEnabled
                          ? browserMode === 'read-only'
                            ? 'Agent can navigate and inspect public web pages, but form fill and submit actions are blocked.'
                            : 'Agent can navigate public pages and request approval before submitting forms or other state-changing browser actions.'
                          : 'Browser control is disabled. Enable it in Settings to allow page navigation, scraping, and controlled form workflows.'}
                      </div>
                    </div>

                    <div className="openclaw-card">
                      <div className="openclaw-card-header">
                        <div className="openclaw-section-label">Workspace capabilities</div>
                        <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>Modeled after Open Claw’s task-first workspace flow</span>
                      </div>
                      <div style={{ display: 'grid', gap: '8px' }}>
                        <div className="openclaw-capability-row">
                          <Bot size={15} />
                          <span>Persistent task modes, response styles, and task criteria.</span>
                        </div>
                        <div className="openclaw-capability-row">
                          <Globe size={15} />
                          <span>Optional live web research with citations and follow-up searches when Internet mode is on.</span>
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
            <div className="openclaw-card">
                <div className="openclaw-card-header">
                  <div className="openclaw-section-label">Canvas</div>
                  <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>{canvasArtifacts.length} artifact{canvasArtifacts.length !== 1 ? 's' : ''}</span>
                </div>
                <CanvasPanel
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
                        setCanvasArtifacts(prev => prev.map(a => a.id === id ? { ...a, content, name, version: data.artifact.version } : a));
                      }
                    } catch (error) {
                      console.error("Failed to update artifact:", error);
                      throw error;
                    }
                  }}
                  onDelete={async (id) => {
                    await deleteArtifactById(id);
                  }}
                  onDownload={(artifact) => {
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
                />
            </div>

            {/* UWAF Network Hub Panel */}
            {settings?.openClawUwafBrowserMode && settings.openClawUwafBrowserMode !== 'deny' && (
              <UwafNetworkPanel
                currentMode={uwafBrowserMode}
                onModeChange={setUwafBrowserMode}
              />
            )}

            {/* UWAF Browser Preview */}
            {uwafShowPreview && uwafScreenshot && (
              <UwafBrowserPreview
                screenshot={uwafScreenshot}
                currentUrl={uwafCurrentUrl}
                title={uwafCurrentTitle}
                mode={uwafBrowserMode}
                onClose={() => setUwafShowPreview(false)}
              />
            )}

            <div className="openclaw-rail-footer">
              {configSaving ? 'Saving settings...' : configError || connectionSummary || modelControlNote || selectedSessionInfo}
            </div>
          </>
        )}
      </aside>

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
      />

      {/* Shell settings panel */}
      {shellSettingsOpen && (
        <ShellSettingsPanel onClose={() => {
          setShellSettingsOpen(false);
          void loadShellSettings();
        }} />
      )}
    </div>
  );
}
