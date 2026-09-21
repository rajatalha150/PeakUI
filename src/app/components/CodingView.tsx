"use client";

import React from 'react';
import { AlertCircle, Bot, CheckCircle2, ChevronRight, Circle, ClipboardCopy, FileText, Folder, Globe, History, Loader2, MessageSquare, PanelLeftClose, PanelLeftOpen, Pencil, Plus, RotateCcw, Save, Search, Send, ShieldAlert, Square, Terminal, Trash2, Wrench, X } from 'lucide-react';
import { buildPermissionVoteBody } from '@/lib/coder-permission-vote';
import { buildConversation, fetchFullTranscript, serializeConversation, trailingBackgroundNotification, type CoderTranscriptEvent } from '@/lib/coder-transcript';
import { streamSessionEvents } from '@/lib/coder-sse';
import { parsePreviewUrl } from '@/lib/coder-preview';
import { parseRewindResult, parseRewindSnapshots, type RewindResult, type RewindSnapshot } from '@/lib/coder-rewind';
import { parseFileContent, parseFileList, parseFileWriteResult, type FileEntry } from '@/lib/coder-files';
import { buildDefaultTasks, detectPackageManager, parseShellResult, type PackageManager, type Task } from '@/lib/coder-tasks';
import { absoluteWorkspacePath, parseGlobResult, searchLines, type SearchHit } from '@/lib/coder-search';
import { buildWriterSubagentCreateBody, buildWriterSubagentUpdateBody, CODER_WRITER_AGENT_NAME, CODER_WRITER_AGENT_SCOPE, toDaemonModelSelector } from '@/lib/coder-orchestration';
import { copyToClipboard } from '@/lib/clipboard';
import AssistantContent from './AssistantContent';
import { ThinkingBlock } from './ChatMessageContent';

/** A message in the coding chat, projected from the daemon transcript. */
interface CoderChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  ack?: 'sending' | 'accepted' | 'error';
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** A tool activity event (WriteFile, shell, etc.) from the transcript. */
interface ToolActivity {
  id: string;
  title: string;
  status: string;
  detail: string;
  toolName?: string;
  rawInput?: unknown;
}

/** An open file in the project explorer, with its own buffer + save state. */
interface EditorTab {
  path: string;
  content: string;
  hash: string | null;
  dirty: boolean;
  saving: boolean;
  error: string;
}

/** A single question inside an `ask_user_question` interaction. */
interface PendingQuestion {
  answerKey: string;
  header: string;
  question: string;
  multiSelect?: boolean;
  options: Array<{ label: string; description: string }>;
}

/** A pending permission ask or user question the agent is blocked on. */
interface PendingInteraction {
  requestId: string;
  kind: 'permission' | 'user_question';
  title: string;
  detail: string;
  options: Array<{ optionId: string; label: string }>;
  answerKey?: string;
  /** The agent's questions (ask_user_question). Empty for a plain permission ask. */
  questions?: PendingQuestion[];
}

interface CoderSessionStatus {
  hasActivePrompt?: boolean;
  activeWorkState?: string;
  isWaitingForPermission?: boolean;
  isWaitingForUserQuestion?: boolean;
  pendingInteractionCount?: number;
  pendingInteractions?: PendingInteraction[];
  hasTurnError?: boolean;
}

/** A persistent coding session (stored in the Hermes ChatSession table). */
interface CoderSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** Stored message shape from the Hermes ChatSession table. */
interface StoredMsg {
  id?: string;
  role: string;
  content: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  meta?: { thinking?: string; toolActivity?: ToolActivity[] };
}

/** Settings persisted server-side (`/api/settings`). */
interface CoderSettings {
  coderModel: string;
  coderApprovalMode: string;
  coderContextLength: number;
  coderToolSearchThreshold: number;
  coderWorkspace: string;
  coderToolsEnabled: boolean;
  coderVisionModel: string;
  coderWriterModel: string;
}

const APPROVAL_MODES: Array<{ id: string; label: string; hint: string }> = [
  { id: 'yolo', label: 'YOLO', hint: 'No tool confirmations — edits and runs commands freely (still asks when it needs your opinion)' },
  { id: 'auto', label: 'Auto', hint: 'Classifier gates the risky tools (shell/edit/write) automatically' },
];

/** Pull readable text out of the daemon's content-block shapes. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        // tool_call_update wraps text one level deeper.
        if (part && typeof part === 'object' && 'content' in part) {
          return contentText((part as { content?: unknown }).content);
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object' && 'text' in content && typeof (content as { text?: unknown }).text === 'string') {
    return (content as { text: string }).text;
  }
  return '';
}

/** Render an object (e.g. a tool call's `rawInput`) as readable text. */
function inputText(input: unknown): string {
  if (input === null || input === undefined) return '';
  if (typeof input === 'string') return input;
  if (typeof input === 'object') {
    const rec = input as Record<string, unknown>;
    // Prefer the fields that actually describe the action.
    for (const key of ['command', 'file_path', 'path', 'pattern', 'query', 'description']) {
      const value = rec[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    try {
      return JSON.stringify(input);
    } catch {
      return '';
    }
  }
  return '';
}

/** Normalise one `options` entry from either the SSE frame or the status payload. */
function normalizeOptions(raw: unknown): Array<{ optionId: string; label: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.map(entry => {
    const rec = (entry || {}) as Record<string, unknown>;
    const optionId = typeof rec.optionId === 'string' ? rec.optionId : (typeof rec.id === 'string' ? rec.id : '');
    // The daemon labels options `name` ("Allow", "Reject", "Always Allow in
    // project: rm *"); `label` only appears on some other surfaces.
    const label = typeof rec.name === 'string' && rec.name
      ? rec.name
      : typeof rec.label === 'string' && rec.label
        ? rec.label
        : optionId;
    return { optionId, label };
  }).filter(o => o.optionId);
}

/**
 * Normalise an `ask_user_question` interaction's `questions` array.
 *
 * The daemon serialises each question as `{ answerKey, header, question,
 * options: [{label, description}] }` where `answerKey` is a "0", "1", …
 * index string. The answer vote maps `answerKey -> chosen option label`.
 */
function normalizeQuestions(raw: unknown): PendingQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, index) => {
    const rec = (entry || {}) as unknown as Record<string, unknown>;
    const answerKey = typeof rec.answerKey === 'string' ? rec.answerKey : String(index);
    const header = typeof rec.header === 'string' ? rec.header : (typeof rec.title === 'string' ? rec.title : '');
    const question = typeof rec.question === 'string' ? rec.question : '';
    const rawOptions = Array.isArray(rec.options) ? rec.options : [];
    const options = rawOptions.map((opt) => {
      const o = (opt || {}) as unknown as Record<string, unknown>;
      const label = typeof o.label === 'string' ? o.label : '';
      const description = typeof o.description === 'string' ? o.description : '';
      return { label, description };
    }).filter(o => o.label);
    return {
      answerKey,
      header,
      question,
      ...(rec.multiSelect === true ? { multiSelect: true } : {}),
      options,
    };
  }).filter(q => q.question || q.options.length);
}

/**
 * Fold the daemon's authoritative `pendingInteractions` into the local prompt
 * list.
 *
 * The SSE stream is the fast path, but it can miss a `permission_request` while
 * reconnecting — and a page reload loses the frame entirely. The status poll
 * carries the same asks in a slightly different shape (the action is nested
 * under `action`, not `toolCall`), so both need to converge on the same cards.
 *
 * Asks the daemon no longer lists are dropped: that is how a resolution made
 * from another client (or an expiry) clears the card here.
 */
function reconcilePending(
  current: PendingInteraction[],
  incoming: PendingInteraction[] | undefined,
): PendingInteraction[] {
  // An absent/undefined list means "the daemon didn't tell us" — keep what the
  // SSE stream already surfaced rather than wiping live cards.
  if (!Array.isArray(incoming)) return current;

  const next: PendingInteraction[] = incoming.map(raw => {
    const rec = (raw || {}) as unknown as Record<string, unknown>;
    const requestId = typeof rec.requestId === 'string' ? rec.requestId : '';
    const kind: PendingInteraction['kind'] = rec.kind === 'user_question' ? 'user_question' : 'permission';
    // The status payload nests the ask under `action`; the SSE frame under
    // `toolCall`. user_question asks carry `title`/`question` directly.
    const action = (rec.action || rec.toolCall || {}) as Record<string, unknown>;
    const detail = contentText(action.content)
      || (typeof action.title === 'string' ? action.title : '')
      || inputText(action.input)
      || (typeof rec.title === 'string' ? rec.title : '')
      || contentText(rec.question)
      || (typeof rec.question === 'string' ? rec.question : '');
    // `ask_user_question` carries the real content in `questions[]`, not in a
    // flat `question`/`options` — parse it so the card actually shows what the
    // agent is asking.
    const questions = kind === 'user_question' ? normalizeQuestions(rec.questions) : undefined;
    const firstQ = questions?.[0];
    return {
      requestId,
      kind,
      title: kind === 'permission' ? 'Permission needed' : (firstQ?.header || 'The agent has a question'),
      detail: detail || (firstQ?.question ? firstQ.question : ''),
      options: normalizeOptions(rec.options),
      ...(questions && questions.length ? { questions } : {}),
      ...(typeof rec.answerKey === 'string' ? { answerKey: rec.answerKey } : {}),
    };
  }).filter(p => p.requestId);

  // Preserve any card the SSE stream surfaced that the daemon hasn't caught up
  // to yet, so a just-arrived ask can't flicker away on the next poll.
  const incomingIds = new Set(next.map(p => p.requestId));
  const stillLive = current.filter(p => !incomingIds.has(p.requestId) && !next.length);
  return [...next, ...stillLive];
}

/**
 * CodingView — the futuristic coding environment.
 *
 * Session persistence copies the Hermes pattern: coding history lives in the
 * `ChatSession` table (surface `'coder'`) via `/api/chats`, so sessions survive
 * restarts and old transcripts reopen. The Qwen Code daemon session is a
 * transient runtime handle; its transcript is mirrored into that store.
 *
 * Live updates come from the daemon's SSE stream (`/session/:id/events`)
 * relayed by the gateway — status, tool activity and pending permission asks
 * all render inline on the chat surface, so the agent's work is visible while
 * it happens instead of only after a refresh.
 */
export default function CodingView({ onExit }: { onExit?: () => void }) {
  const [sessions, setSessions] = React.useState<CoderSession[]>([]);
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null);
  // True once the active session's bound workspace has been resolved (from the
  // persisted session row, or "none yet" for a brand-new session). Gates the
  // eager daemon reattach so it never reattaches with a stale default workspace.
  const [sessionResolved, setSessionResolved] = React.useState(false);
  const [messages, setMessages] = React.useState<CoderChatMessage[]>([]);
  const [composer, setComposer] = React.useState('');
  const [connecting, setConnecting] = React.useState(true);
  const [error, setError] = React.useState('');
  const [workspace, setWorkspace] = React.useState('/workspace');
  const [daemonOnline, setDaemonOnline] = React.useState(false);
  const [sessionStatus, setSessionStatus] = React.useState<CoderSessionStatus | null>(null);
  const [toolActivity, setToolActivity] = React.useState<ToolActivity[]>([]);
  const [pending, setPending] = React.useState<PendingInteraction[]>([]);
  // Per-interaction draft answers, keyed by requestId -> (answerKey -> label).
  // Lets the user pick an option for each question in a multi-question
  // `ask_user_question` before submitting them all at once.
  const [questionDrafts, setQuestionDrafts] = React.useState<Record<string, Record<string, string>>>({});
  const [daemonSessionId, setDaemonSessionId] = React.useState<string | null>(null);
  // The daemon MINTS its own client id on session create and returns it; every
  // per-session call (shell, permission votes) must echo THAT id, not one we
  // invented — the bridge rejects caller-supplied ids it never issued.
  const clientIdRef = React.useRef<string>('');
  // Live "what is it doing right now" line shown on the chat surface.
  const [liveStatus, setLiveStatus] = React.useState('');
  // Which tool-activity row the user expanded.
  const [expandedTool, setExpandedTool] = React.useState<string | null>(null);
  // Raw daemon transcript events — the authoritative source the chat is rebuilt
  // from (survives SSE reconnects and page reloads), and what the copy button dumps.
  const [transcriptEvents, setTranscriptEvents] = React.useState<CoderTranscriptEvent[]>([]);
  const transcriptRef = React.useRef<CoderTranscriptEvent[]>([]);
  // The trailing background-agent notification (taskId) we already nudged the
  // main model about — so we don't fire the continue prompt repeatedly while the
  // main model works through its response.
  const nudgedNotificationRef = React.useRef<string | null>(null);
  // Single-flight guard for `ensureDaemonSession`: concurrent callers (eager
  // reattach + a fast send) share one create/load promise instead of racing two
  // daemon sessions.
  const ensurePromiseRef = React.useRef<Promise<string | null> | null>(null);
  // Mirrors `activeSessionId` for the async session path, so a create/load that
  // resolves AFTER the user switched sessions cannot bind the wrong session.
  const activeSessionIdRef = React.useRef<string | null>(null);
  // Last persisted transcript signature, so an idle poll (which rebuilds
  // identical arrays every tick) does not rewrite the full history to the DB.
  const lastPersistSignatureRef = React.useRef<string>('');
  // The active session's BOUND workspace (from its persisted ChatSession row),
  // or null when the session has not yet been bound. `ensureDaemonSession`
  // prefers this over the user's current default `workspace` state, so a
  // reattach restores the ORIGINAL project even after the default changed.
  const sessionWorkspaceRef = React.useRef<string | null>(null);
  // History loaded from the persistent store (turns that happened before this
  // page's daemon session). The live daemon transcript only contains the
  // current session's turns, so the two are disjoint and merge without dedup.
  const baselineRef = React.useRef<CoderChatMessage[]>([]);
  const [copied, setCopied] = React.useState(false);
  // Model + coder settings (server-persisted).
  const [models, setModels] = React.useState<Array<{ id: string; name: string; toolsCapable: boolean; visionCapable: boolean }>>([]);
  const [modelLoading, setModelLoading] = React.useState(false);
  const [settings, setSettings] = React.useState<CoderSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [settingsSaving, setSettingsSaving] = React.useState(false);
  // Preview browser — a real, device-switchable preview the AI can drive.
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState('');
  const [previewInput, setPreviewInput] = React.useState('');
  const [previewDevice, setPreviewDevice] = React.useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [previewError, setPreviewError] = React.useState('');
  // Measured width of the preview viewport, so device frames scale to fit while
  // the iframe still renders at its true pixel dimensions (media queries fire).
  const previewStageRef = React.useRef<HTMLDivElement | null>(null);
  const [previewStageWidth, setPreviewStageWidth] = React.useState(0);
  // On-demand shell pop-up (manual terminal the user drives directly).
  const [shellOpen, setShellOpen] = React.useState(false);
  const [shellCommand, setShellCommand] = React.useState('');
  const [shellOutput, setShellOutput] = React.useState('');
  const [shellRunning, setShellRunning] = React.useState(false);
  // Inline rename state for the session sidebar.
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  // Session ids the user explicitly renamed -> new title, so the auto-persist
  // effect (which otherwise re-derives the title from the first message)
  // doesn't clobber the rename.
  const renamedRef = React.useRef<Map<string, string>>(new Map());
  // Responsive layout: sidebar retractability + resizable tool-activity pane.
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [toolActivityHeight, setToolActivityHeight] = React.useState(220);
  const [isPhone, setIsPhone] = React.useState(false);
  // Reversible-work (rewind) state.
  const [rewindOpen, setRewindOpen] = React.useState(false);
  const [rewindSnapshots, setRewindSnapshots] = React.useState<RewindSnapshot[] | null>(null);
  const [rewindLoading, setRewindLoading] = React.useState(false);
  const [rewindError, setRewindError] = React.useState('');
  const [rewindResult, setRewindResult] = React.useState<RewindResult | null>(null);
  // Project explorer (file browser + editor) state.
  const [filesOpen, setFilesOpen] = React.useState(false);
  const [fileDir, setFileDir] = React.useState('/workspace');
  const [fileEntries, setFileEntries] = React.useState<FileEntry[] | null>(null);
  const [fileLoading, setFileLoading] = React.useState(false);
  const [fileError, setFileError] = React.useState('');
  const [openTabs, setOpenTabs] = React.useState<EditorTab[]>([]);
  const [activePath, setActivePath] = React.useState<string | null>(null);
  // Named project tasks (install/build/test/run) state.
  const [tasksOpen, setTasksOpen] = React.useState(false);
  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [taskCommands, setTaskCommands] = React.useState<Record<string, string>>({});
  const [taskOutputs, setTaskOutputs] = React.useState<Record<string, string>>({});
  const [taskRunning, setTaskRunning] = React.useState<string | null>(null);
  const [taskError, setTaskError] = React.useState('');
  // Workspace text search state.
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [searchLoading, setSearchLoading] = React.useState(false);
  const [searchResults, setSearchResults] = React.useState<Array<{ file: string; hits: SearchHit[] }> | null>(null);
  const [searchError, setSearchError] = React.useState('');

  const busy = sessionStatus?.hasActivePrompt === true
    || sessionStatus?.isWaitingForPermission === true
    || sessionStatus?.isWaitingForUserQuestion === true;

  const accent = '#22d3ee';
  const magenta = '#e879f9';

  // ---- Settings load -------------------------------------------------------

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const next: CoderSettings = {
          coderModel: typeof data.coderModel === 'string' ? data.coderModel : '',
          coderApprovalMode: typeof data.coderApprovalMode === 'string' ? data.coderApprovalMode : 'yolo',
          coderContextLength: Number(data.coderContextLength) || 0,
          coderToolSearchThreshold: Number(data.coderToolSearchThreshold) || 0,
          coderWorkspace: typeof data.coderWorkspace === 'string' && data.coderWorkspace ? data.coderWorkspace : '/workspace',
          coderToolsEnabled: data.coderToolsEnabled !== false,
          coderVisionModel: typeof data.coderVisionModel === 'string' ? data.coderVisionModel : '',
          coderWriterModel: typeof data.coderWriterModel === 'string' ? data.coderWriterModel : '',
        };
        setSettings(next);
        setWorkspace(next.coderWorkspace);
      } catch {
        // Non-fatal; the surface still works with daemon defaults.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * Load selectable models from the DAEMON, not raw Ollama.
   *
   * The daemon's `/workspace/models` is the authoritative list: it reports the
   * models actually routable under the configured provider (with their real
   * context windows), whereas `/api/tags` returns every blob on the host —
   * including completion-only models that cannot drive an agent. Picking one of
   * those is what silently produced an agent that answered "I have no tools".
   */
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setModelLoading(true);
      try {
        const res = await fetch(`/api/coder/workspace/models?workspace=${encodeURIComponent(workspace)}`);
        const data = await res.json().catch(() => ({}));
        const list = Array.isArray(data.models) ? data.models : [];
        if (cancelled) return;
        // Tool + vision capability aren't reported per-model by the daemon, so
        // probe Ollama once and annotate — this lets the UI warn instead of
        // letting the user pick a completion-only or text-only model and wonder
        // why the agent can't act / can't see images.
        const caps = new Map<string, { tools: boolean; vision: boolean }>();
        try {
          const tagRes = await fetch('/api/tags');
          const tagData = await tagRes.json();
          for (const m of (Array.isArray(tagData.models) ? tagData.models : [])) {
            const name = typeof m?.name === 'string' ? m.name : '';
            const capabilities = Array.isArray(m?.capabilities) ? m.capabilities : [];
            if (name) caps.set(name, { tools: capabilities.includes('tools'), vision: capabilities.includes('vision') });
          }
        } catch {
          // Leave capability unknown; treated as capable so nothing is hidden.
        }
        setModels(list.map((m: { modelId?: string; name?: string }) => {
          const id = typeof m?.modelId === 'string' ? m.modelId.replace(/\([^)]*\)$/, '') : '';
          const label = typeof m?.name === 'string' && m.name ? m.name : id;
          const c = caps.get(id);
          return { id, name: label, toolsCapable: c?.tools ?? true, visionCapable: c?.vision ?? true };
        }).filter((m: { id: string }) => Boolean(m.id)));
      } catch {
        // Non-fatal.
      } finally {
        if (!cancelled) setModelLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [workspace]);

  // Probe the daemon on mount.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/coder/health');
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          const ok = res.ok && data.status === 'ok';
          setDaemonOnline(ok);
          setConnecting(false);
          if (!ok) setError('Coding environment (Qwen Code daemon) is offline. Start the coder container.');
        }
      } catch {
        if (!cancelled) {
          setDaemonOnline(false);
          setConnecting(false);
          setError('Coding environment is unreachable.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Responsive: detect a phone/narrow viewport so the sidebar starts collapsed
  // and the header wraps, without any per-feature special-casing.
  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px)');
    const apply = () => {
      const phone = mq.matches;
      setIsPhone(phone);
      // Collapse the sidebar by default on phones (it overlays instead of
      // squashing the chat), keep it open on desktop.
      if (phone) setSidebarOpen(false);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Drag-to-resize the tool-activity pane (pointer events work for both mouse
  // and touch, so this covers web and phone in one path).
  const beginToolActivityResize = React.useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = toolActivityHeight;
    const onMove = (ev: PointerEvent) => {
      const delta = startY - ev.clientY; // drag up = taller
      const next = Math.max(80, Math.min(560, startH + delta));
      setToolActivityHeight(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [toolActivityHeight]);

  // ---- AI-driven preview ----------------------------------------------------
  //
  // The preview is not just a manual URL box. The agent can push work to it by
  // writing a tiny JSON file into the workspace (`.peakui-preview.json`), and we
  // poll that file so the preview stays in lock-step with the agent: when the
  // agent starts a dev server and writes the URL, the preview follows
  // automatically — the AI is "fully aware of it" and can present its work.

  const PREVIEW_FILE = '.peakui-preview.json';

  const applyPreview = React.useCallback((url: string) => {
    const clean = (url || '').trim();
    setPreviewInput(clean);
    if (!clean) {
      setPreviewUrl('');
      setPreviewError('');
      return;
    }
    // Reject anything that is not a loopback dev-server URL before it can be
    // framed. The agent writes this file, so the guard is the only thing
    // standing between a crafted `.peakui-preview.json` and an internal service
    // (the app/daemon/DB/SearXNG/tor) being loaded into the preview pane.
    const parsed = parsePreviewUrl(clean);
    if ('error' in parsed) {
      setPreviewUrl('');
      setPreviewError(parsed.error);
      return;
    }
    setPreviewUrl(clean);
    setPreviewError('');
  }, []);

  // Poll the agent's preview file whenever the preview pane is open, so the
  // agent can (re)direct the preview without the user typing anything.
  React.useEffect(() => {
    if (!previewOpen || !daemonSessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        // Read the agent's preview file from the SESSION's workspace, not the
        // daemon's primary workspace. The unscoped `GET /file` resolves against
        // the primary cwd (default /workspace), so a session in /apps could never
        // see its own `.peakui-preview.json` — the agent's push silently 404'd.
        // The workspace-scoped route anchors the read to `workspace`.
        const res = await fetch(`/api/coder/workspaces/${encodeURIComponent(workspace)}/file?path=${encodeURIComponent(PREVIEW_FILE)}`);
        if (!res.ok) { timer = setTimeout(tick, 2000); return; }
        const data = await res.json().catch(() => ({}));
        const raw = typeof data.content === 'string' ? data.content : '';
        if (cancelled || !raw) { timer = setTimeout(tick, 2000); return; }
        try {
          const parsed = JSON.parse(raw);
          const url = typeof parsed.url === 'string' ? parsed.url : (typeof parsed === 'string' ? parsed : '');
          if (url && url !== previewUrl) applyPreview(url);
          if (typeof parsed.device === 'string' && ['desktop','tablet','mobile'].includes(parsed.device)) {
            setPreviewDevice(parsed.device as 'desktop' | 'tablet' | 'mobile');
          }
        } catch { /* not JSON yet; keep polling */ }
      } catch {
        // Transient; the file may not exist yet.
      } finally {
        if (!cancelled) timer = setTimeout(tick, 2000);
      }
    };
    void tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [previewOpen, daemonSessionId, previewUrl, applyPreview, workspace]);

  const openPreview = (initialUrl?: string) => {
    if (initialUrl) applyPreview(initialUrl);
    setPreviewOpen(o => !o);
  };

  // Device viewports, at their true pixel sizes. The preview iframe is rendered
  // at these exact dimensions (so the page's own media queries actually fire)
  // and the whole frame is then scaled down to fit the preview pane — this is
  // what makes switching tablet/mobile visibly change the layout.
  const PREVIEW_VIEWPORTS: Record<'desktop' | 'tablet' | 'mobile', { width: number; height: number }> = {
    desktop: { width: 1280, height: 800 },
    tablet: { width: 768, height: 1024 },
    mobile: { width: 390, height: 844 },
  };

  // Measure the preview stage so the device frame scales to fit it.
  React.useEffect(() => {
    if (!previewOpen) return;
    const el = previewStageRef.current;
    if (!el) return;
    const measure = () => setPreviewStageWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [previewOpen]);

  // ---- Persistent session CRUD (Hermes pattern, surface 'coder') ----------

  const refreshSessions = React.useCallback(async () => {
    try {
      const res = await fetch('/api/chats?surface=coder');
      const data = await res.json();
      if (Array.isArray(data)) {
        setSessions(data.map((s: { id: string; title: string; createdAt: string; updatedAt: string }) => ({
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })));
      }
    } catch {
      // Ignore.
    }
  }, []);

  React.useEffect(() => {
    const t = setTimeout(() => { void refreshSessions(); }, 0);
    return () => clearTimeout(t);
  }, [refreshSessions]);

  // Persist + restore the active session id so a refresh (or a closed-and-
  // reopened tab) reopens the SAME session instead of resetting to a blank one.
  // The id is a stable ChatSession UUID that the daemon also uses as its
  // session key, so restoring it lets the agent reattach and keep working.
  const ACTIVE_SESSION_KEY = 'peakui-coder-active-session';
  React.useEffect(() => {
    if (activeSessionId) {
      try { localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId); } catch { /* ignore */ }
    }
  }, [activeSessionId]);
  React.useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem(ACTIVE_SESSION_KEY); } catch { /* ignore */ }
    if (stored) void loadSession(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the active-session mirror in sync so the async daemon-session path can
  // tell "the session the user still has open" from "the session that was open
  // when this create/load started". A session change also resets the persist
  // signature, so the newly selected session always persists its first settle.
  React.useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
    lastPersistSignatureRef.current = '';
  }, [activeSessionId]);

  const persistMessages = React.useCallback(async (
    sessionId: string,
    title: string,
    msgs: CoderChatMessage[],
    activity: ToolActivity[],
  ) => {
    try {
      // Thinking is folded into `meta` per message. Tool activity is folded in
      // ONCE, on the last assistant message — storing the whole activity list on
      // every assistant message is what duplicated it on save and restore.
      const stored: StoredMsg[] = msgs.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.usage ? { usage: m.usage } : {}),
        ...(m.thinking ? { meta: { thinking: m.thinking } } : {}),
      }));
      if (activity.length) {
        for (let i = stored.length - 1; i >= 0; i--) {
          if (stored[i].role === 'assistant') {
            stored[i].meta = { ...(stored[i].meta || {}), toolActivity: activity };
            break;
          }
        }
      }
      await fetch('/api/chats', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, title, surface: 'coder', messages: stored }),
      });
    } catch {
      // Non-fatal; persistence is best-effort.
    }
  }, []);

  const loadSession = async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setSessionResolved(false);
    sessionWorkspaceRef.current = null;
    setError('');
    setToolActivity([]);
    setSessionStatus(null);
    setPending([]);
    setLiveStatus('');
    setMessages([]);
    // Disconnect (don't delete) the current daemon session: switching away must
    // leave the agent's in-flight work running server-side so nothing is lost.
    disconnectDaemonSession();
    transcriptRef.current = [];
    setTranscriptEvents([]);
    baselineRef.current = [];
    try {
      const res = await fetch(`/api/chats/${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        const stored = (Array.isArray(data.messages) ? data.messages : []) as StoredMsg[];
        // Restore the session's BOUND workspace (the project it was created
        // against) so a reattach uses the original directory, not the current
        // default preference — which may have moved on since this session began.
        const bound = typeof data.coderWorkspace === 'string' && data.coderWorkspace.trim()
          ? data.coderWorkspace.trim()
          : null;
        sessionWorkspaceRef.current = bound;
        if (bound) setWorkspace(bound);
        const loaded = stored
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({
            id: m.id || `${m.role}-${Math.random().toString(36).slice(2, 8)}`,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            ...(m.usage ? { usage: m.usage } : {}),
            ...(m.meta?.thinking ? { thinking: m.meta.thinking } : {}),
          }));
        baselineRef.current = loaded;
        setMessages(loaded);
        const restored = stored.flatMap(m => (m.role === 'assistant' && Array.isArray(m.meta?.toolActivity) ? m.meta.toolActivity : []));
        setToolActivity(restored);
      } else if (res.status === 404) {
        setError('Session not found.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load session');
    } finally {
      setSessionResolved(true);
    }
  };

  const newSession = async () => {
    setError('');
    try {
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surface: 'coder', title: 'New Coding Session', messages: [] }),
      });
      const data = await res.json().catch(() => ({})) as { session?: { id?: string }; error?: string };
      const id = data.session?.id;
      if (!res.ok || !id) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to create session');
      }
      setActiveSessionId(id);
      setSessionResolved(true);
      sessionWorkspaceRef.current = null;
      setWorkspace(settings?.coderWorkspace || '/workspace');
      setMessages([]);
      setToolActivity([]);
      setPending([]);
      setSessionStatus(null);
      setLiveStatus('');
      transcriptRef.current = [];
      setTranscriptEvents([]);
      baselineRef.current = [];
      // Disconnect the previous daemon session (keep it running) — the new
      // session gets its own daemon session keyed by its own id on first send.
      disconnectDaemonSession();
      await refreshSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create session');
    }
  };

  const deleteSession = async (sessionId: string) => {
    try {
      const res = await fetch('/api/chats', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, surface: 'coder' }),
      });
      if (res.ok) {
        if (activeSessionId === sessionId) {
          setActiveSessionId(null);
          setSessionResolved(false);
          sessionWorkspaceRef.current = null;
          setMessages([]);
          setToolActivity([]);
          setSessionStatus(null);
          setPending([]);
          setLiveStatus('');
          transcriptRef.current = [];
          setTranscriptEvents([]);
          baselineRef.current = [];
          // Tear down the daemon session so its conversation memory can't leak
          // into whatever session opens next.
          void closeDaemonSession();
        }
        await refreshSessions();
      } else {
        setError('Failed to delete session');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete session');
    }
  };

  /** Persist a new title for a session (PATCH /api/chats with only `title`). */
  const renameSession = async (sessionId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    // Remember the rename so the auto-persist effect doesn't overwrite it with
    // a message-derived title on the next turn.
    renamedRef.current.set(sessionId, trimmed);
    try {
      const res = await fetch('/api/chats', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, title: trimmed, surface: 'coder' }),
      });
      if (!res.ok) setError('Failed to rename session');
      else await refreshSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename session');
    }
  };

  // ---- Daemon runtime handle ----------------------------------------------

  /**
   * Close the current daemon session. The daemon session is where the agent's
   * conversation memory / working context lives; leaving it open after a delete
   * or switch means that memory lingers and can bleed into the next session,
   * and an abandoned tab keeps the ACP child alive. Best-effort: a stale 404 is
   * fine (already reaped).
   */
  const closeDaemonSession = async () => {
    const id = daemonSessionId;
    if (!id) return;
    // Null the handle first so a poll in flight can't resurrect state after
    // we've torn the session down.
    setDaemonSessionId(null);
    clientIdRef.current = '';
    try {
      await fetch(`/api/coder/session/${id}`, { method: 'DELETE' });
    } catch {
      // Best-effort; the daemon reaper will collect it eventually.
    }
  };

  /**
   * Disconnect from the current daemon session WITHOUT deleting it server-side.
   *
   * Used when switching sessions / reopening: the daemon session keeps running
   * (so the agent's in-flight work is never lost or delayed), and we simply drop
   * the local handle so the next `ensureDaemonSession` reattaches to the right
   * one by its persistent id.
   */
  const disconnectDaemonSession = () => {
    setDaemonSessionId(null);
    clientIdRef.current = '';
  };

  /**
   * Create (or reattach to) the daemon session and apply the user's saved model
   * / approval mode.
   *
   * The daemon session is keyed by the PERSISTENT session id (`activeSessionId`,
   * the same UUID stored in the ChatSession table). The daemon accepts a
   * caller-supplied UUID and `POST /session/:id/load` reattaches to an existing
   * one. So:
   *   - first send  → create the daemon session with `sessionId = activeSessionId`;
   *   - reopen      → `POST /session/:id/load` reattaches to the SAME daemon
   *                   session, restoring the agent's conversation memory and any
   *                   in-flight work — nothing is lost when a tab is closed.
   */
  const ensureDaemonSession = async (): Promise<string | null> => {
    if (daemonSessionId) return daemonSessionId;
    // Single-flight: concurrent callers (the eager reattach effect + a fast
    // send/shell) share one create/load instead of racing two daemon sessions.
    if (ensurePromiseRef.current) return ensurePromiseRef.current;
    const sessionId = activeSessionId;
    if (!sessionId) {
      setError('No active session.');
      return null;
    }

    let promise: Promise<string | null>;
    const run = async (): Promise<string | null> => {
      try {
        // A Coding session is bound to the workspace it was created against. On a
        // reopen, `sessionWorkspaceRef` carries the ORIGINAL binding (loaded from
        // the DB), so reattaching restores the original project even if the user's
        // default coder workspace preference has since changed. It only falls back
        // to the live `workspace` state for a brand-new, never-created session.
        const cwd = sessionWorkspaceRef.current || workspace;
        const mkBody = (cwd: string) => ({ sessionId, cwd });

        let res = await fetch('/api/coder/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mkBody(cwd)),
        });
        let data = await res.json().catch(() => ({})) as { sessionId?: string; clientId?: string; error?: string; code?: string };

        // The daemon is bound to a primary workspace and rejects a session for any
        // other path with `workspace_mismatch` until that path is registered.
        // Registering is idempotent (an already-registered path returns
        // `workspace_exists`, which is fine). `persist: true` writes the
        // registration to ~/.qwen/daemon/workspaces/*.json (a persistent volume),
        // so the workspace survives daemon restarts — not just this session.
        if (!res.ok && data.code === 'workspace_mismatch') {
          await fetch('/api/coder/workspaces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cwd, persist: true }),
          }).catch(() => {});
          res = await fetch('/api/coder/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mkBody(cwd)),
          });
          data = await res.json().catch(() => ({})) as { sessionId?: string; clientId?: string; error?: string; code?: string };
        }

        // The daemon session already exists (a prior tab / reopen created it).
        // Reattach instead of failing, so the conversation and any in-flight work
        // continue where they left off.
        if (!res.ok && data.code === 'session_id_conflict') {
          // The load body must carry `cwd`: a session in a NON-primary workspace
          // (e.g. /apps) is routed by `resolveRuntimeForSessionRestore` using the
          // cwd; without it the daemon 404s "No session with id" even though the
          // session exists in another runtime.
          res = await fetch(`/api/coder/session/${sessionId}/load`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cwd }),
          });
          data = await res.json().catch(() => ({})) as { sessionId?: string; clientId?: string; error?: string; code?: string };
        }

        if (!res.ok || !data.sessionId) {
          setError(typeof data.error === 'string' ? data.error : 'Failed to start daemon session');
          return null;
        }
        // A create/load that resolves AFTER the user switched sessions must not
        // bind the wrong session: abandon the stale handle instead of mutating
        // the daemonSessionId/clientId for a session the user no longer has open.
        if (activeSessionIdRef.current !== sessionId) return null;

        setDaemonSessionId(data.sessionId);
        // Echo the daemon-minted client id on every later per-session call.
        if (typeof data.clientId === 'string' && data.clientId) clientIdRef.current = data.clientId;

        // Bind the session to the workspace it was actually created against so a
        // later reopen reattaches to the SAME project. Persist it via /api/chats
        // (best-effort: a failure here never blocks the session from working; the
        // next create/load simply falls back to the current default).
        sessionWorkspaceRef.current = cwd;
        fetch('/api/chats', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: sessionId, surface: 'coder', coderWorkspace: cwd }),
        }).catch(() => {});

        // Apply the persisted model + approval mode + orchestration delegates to
        // the session. Vision and writer are daemon-global (not per-session), but
        // re-applying them here guarantees a reattached/old session still runs
        // with the user's saved orchestration — not a stale daemon default.
        if (settings?.coderModel) {
          await applyModel(data.sessionId, settings.coderModel, { quiet: true });
        }
        await applyApprovalMode(data.sessionId, settings?.coderApprovalMode || 'yolo', { quiet: true });
        if (settings?.coderVisionModel) {
          await applyVisionModel(toDaemonModelSelector(settings.coderVisionModel));
        }
        if (settings?.coderWriterModel) {
          await applyWriterModel(settings.coderWriterModel);
        }
        if (settings?.coderToolSearchThreshold) {
          await applyToolSearchThreshold(settings.coderToolSearchThreshold);
        }
        return data.sessionId;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to start daemon session');
        return null;
      } finally {
        if (ensurePromiseRef.current === promise) ensurePromiseRef.current = null;
      }
    };

    promise = run();
    ensurePromiseRef.current = promise;
    return promise;
  };

  // ---- Model + approval-mode control --------------------------------------

  const applyModel = async (sessionId: string, modelId: string, opts: { quiet?: boolean } = {}) => {
    try {
      // The daemon addresses models as `<id>(<authType>)`; the suffix picks the
      // provider route when the same id exists under more than one auth type.
      const suffixed = /\([^)]*\)$/.test(modelId) ? modelId : `${modelId}(openai)`;
      const res = await fetch(`/api/coder/session/${sessionId}/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: suffixed }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setError(`Model switch failed: ${data.error || res.status}`);
      } else if (!opts.quiet) {
        setLiveStatus(`model → ${modelId}`);
      }
    } catch (e) {
      setError(`Model switch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const applyApprovalMode = async (sessionId: string, mode: string, opts: { quiet?: boolean } = {}) => {
    try {
      const res = await fetch(`/api/coder/session/${sessionId}/approval-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        if (!opts.quiet) setError(`Approval mode failed: ${data.error || res.status}`);
      } else if (!opts.quiet) {
        setLiveStatus(`approval → ${mode}`);
      }
    } catch (e) {
      if (!opts.quiet) setError(`Approval mode failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const switchModel = async (modelId: string) => {
    setSettings(prev => (prev ? { ...prev, coderModel: modelId } : prev));
    void saveSettings({ coderModel: modelId });
    if (!daemonSessionId) return;
    await applyModel(daemonSessionId, modelId);
  };

  const switchApprovalMode = async (mode: string) => {
    setSettings(prev => (prev ? { ...prev, coderApprovalMode: mode } : prev));
    void saveSettings({ coderApprovalMode: mode });
    if (!daemonSessionId) return;
    await applyApprovalMode(daemonSessionId, mode);
  };

  // ---- Reversible work (rewind) --------------------------------------------

  /** Open the rewind panel and load the list of rewindable user turns. */
  const openRewind = async () => {
    setRewindOpen(o => !o);
    setRewindResult(null);
    if (!daemonSessionId) {
      setRewindError('Start a session first — there is nothing to rewind yet.');
      return;
    }
    await loadRewindSnapshots();
  };

  const loadRewindSnapshots = async () => {
    if (!daemonSessionId) return;
    setRewindLoading(true);
    setRewindError('');
    try {
      const res = await fetch(`/api/coder/session/${daemonSessionId}/rewind/snapshots`);
      const data = await res.json().catch(() => ({})) as unknown;
      if (!res.ok) {
        setRewindError(`Could not list rewind points: ${(data as { error?: string }).error || res.status}`);
        setRewindSnapshots(null);
        return;
      }
      const parsed = parseRewindSnapshots(data);
      if ('error' in parsed) {
        setRewindError(parsed.error);
        setRewindSnapshots(null);
        return;
      }
      setRewindSnapshots(parsed.snapshots);
    } catch (e) {
      setRewindError(e instanceof Error ? e.message : 'Failed to list rewind points');
      setRewindSnapshots(null);
    } finally {
      setRewindLoading(false);
    }
  };

  /**
   * Rewind the daemon session to a snapshot. With `rewindFiles: true` (the
   * daemon default, made explicit here) the workspace files are restored to
   * that snapshot too, so this is the "selective restore" action: pick a turn,
   * and both the conversation and the files it had changed are rolled back.
   */
  const doRewind = async (promptId: string) => {
    if (!daemonSessionId) return;
    setRewindLoading(true);
    setRewindError('');
    setRewindResult(null);
    try {
      const res = await fetch(`/api/coder/session/${daemonSessionId}/rewind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptId, rewindFiles: true }),
      });
      const data = await res.json().catch(() => ({})) as unknown;
      if (!res.ok) {
        setRewindError(`Rewind failed: ${(data as { error?: string }).error || res.status}`);
        return;
      }
      const parsed = parseRewindResult(data);
      if ('error' in parsed) {
        setRewindError(parsed.error);
        return;
      }
      setRewindResult(parsed.result);
      // The transcript poll reconciles the now-truncated conversation; refresh
      // the snapshot list so the restored point reflects the new state.
      await loadRewindSnapshots();
    } catch (e) {
      setRewindError(e instanceof Error ? e.message : 'Rewind failed');
    } finally {
      setRewindLoading(false);
    }
  };

  // ---- Project explorer (file browser + editor) ----------------------------

  const openFiles = async () => {
    const opening = !filesOpen;
    setFilesOpen(opening);
    if (!opening) return;
    if (fileDir !== workspace) setFileDir(workspace);
    await loadDir(workspace);
  };

  const loadDir = async (dir: string) => {
    setFileLoading(true);
    setFileError('');
    try {
      const res = await fetch(`/api/coder/list?path=${encodeURIComponent(dir)}`);
      const data = await res.json().catch(() => ({})) as unknown;
      if (!res.ok) {
        setFileError(`Could not list ${dir}: ${(data as { error?: string }).error || res.status}`);
        setFileEntries(null);
        return;
      }
      const parsed = parseFileList(data);
      if ('error' in parsed) {
        setFileError(parsed.error);
        setFileEntries(null);
        return;
      }
      setFileDir(dir);
      setFileEntries(parsed.list.entries);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'Failed to list directory');
      setFileEntries(null);
    } finally {
      setFileLoading(false);
    }
  };

  /** Patch one tab in place; `path` keys the tab (workspace paths are unique). */
  const updateTab = (path: string, patch: Partial<EditorTab>) => {
    setOpenTabs(prev => prev.map(t => (t.path === path ? { ...t, ...patch } : t)));
  };

  const openFile = async (path: string) => {
    // Re-activate an already-open buffer without re-reading (keeps unsaved edits).
    if (openTabs.some(t => t.path === path)) {
      setActivePath(path);
      return;
    }
    setFileLoading(true);
    setFileError('');
    try {
      const res = await fetch(`/api/coder/file?path=${encodeURIComponent(path)}&maxBytes=262144`);
      const data = await res.json().catch(() => ({})) as unknown;
      if (!res.ok) {
        setFileError(`Could not read ${path}: ${(data as { error?: string }).error || res.status}`);
        return;
      }
      const parsed = parseFileContent(data);
      if ('error' in parsed) {
        setFileError(parsed.error);
        return;
      }
      setOpenTabs(prev => [...prev, { path, content: parsed.file.content, hash: parsed.file.hash, dirty: false, saving: false, error: '' }]);
      setActivePath(path);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'Failed to read file');
    } finally {
      setFileLoading(false);
    }
  };

  const closeTab = (path: string) => {
    setOpenTabs(prev => {
      const next = prev.filter(t => t.path !== path);
      if (activePath === path) setActivePath(next.length ? next[next.length - 1].path : null);
      return next;
    });
  };

  const saveFile = async () => {
    const tab = openTabs.find(t => t.path === activePath);
    if (!tab) return;
    // The daemon's replace write is compare-and-swap on the content hash; a
    // truncated read (no hash) cannot be safely saved without clobbering a
    // concurrent agent edit, so refuse rather than guess.
    if (!tab.hash) {
      updateTab(tab.path, { error: 'File was read truncated (no hash) — reload it fully before saving.' });
      return;
    }
    updateTab(tab.path, { saving: true, error: '' });
    try {
      const res = await fetch('/api/coder/file/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: tab.path, content: tab.content, mode: 'replace', expectedHash: tab.hash }),
      });
      const data = await res.json().catch(() => ({})) as unknown;
      if (!res.ok) {
        updateTab(tab.path, { error: `Save failed: ${(data as { error?: string }).error || res.status}` });
        return;
      }
      const parsed = parseFileWriteResult(data);
      if ('error' in parsed) {
        updateTab(tab.path, { error: parsed.error });
        return;
      }
      updateTab(tab.path, { hash: parsed.result.hash, dirty: false });
    } catch (e) {
      updateTab(tab.path, { error: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      updateTab(tab.path, { saving: false });
    }
  };

  /** Join a directory and entry name into a daemon absolute path. */
  const childPath = (dir: string, name: string) => `${dir.replace(/\/+$/, '')}/${name}`;

  /** The tab currently in focus (if any). */
  const activeTab = openTabs.find(t => t.path === activePath) ?? null;

  // ---- Named project tasks ------------------------------------------------

  /** Open the tasks panel; seed the four default tasks on first open. */
  const openTasks = async () => {
    const opening = !tasksOpen;
    setTasksOpen(opening);
    if (!opening || tasks.length > 0) return;
    // Detect the package manager from the workspace-root lockfile so a pnpm
    // project is not handed `npm install`; fall back to npm on any failure.
    let pm: PackageManager = 'npm';
    try {
      const res = await fetch(`/api/coder/list?path=${encodeURIComponent(workspace)}`);
      const data = await res.json().catch(() => ({})) as unknown;
      if (res.ok) {
        const parsed = parseFileList(data);
        if (!('error' in parsed)) pm = detectPackageManager(parsed.list.entries.map(e => e.name));
      }
    } catch {
      // Fall through to npm defaults.
    }
    const defaults = buildDefaultTasks(pm);
    setTasks(defaults);
    setTaskCommands(Object.fromEntries(defaults.map(t => [t.id, t.command])));
  };

  /** Run a named task through the daemon's on-demand shell and capture output. */
  const runTask = async (task: Task) => {
    if (taskRunning) return;
    const command = (taskCommands[task.id] ?? task.command).trim();
    if (!command) return;
    const sessionId = daemonSessionId || (await ensureDaemonSession());
    if (!sessionId) {
      setTaskError('Start a session first — tasks run inside the agent session.');
      return;
    }
    setTaskRunning(task.id);
    setTaskError('');
    setTaskOutputs(prev => ({ ...prev, [task.id]: (prev[task.id] || '') + `$ ${command}\n` }));
    try {
      const res = await fetch(`/api/coder/session/${sessionId}/shell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-qwen-client-id': clientIdRef.current },
        body: JSON.stringify({ command }),
      });
      const data = await res.json().catch(() => ({})) as unknown;
      if (!res.ok) {
        setTaskOutputs(prev => ({ ...prev, [task.id]: (prev[task.id] || '') + `[error ${res.status}] ${(data as { error?: string }).error || 'command failed'}\n` }));
      } else {
        const parsed = parseShellResult(data);
        if ('error' in parsed) {
          setTaskOutputs(prev => ({ ...prev, [task.id]: (prev[task.id] || '') + `[error] ${parsed.error}\n` }));
        } else {
          const code = parsed.result.exitCode === null ? '' : `\n[exit ${parsed.result.exitCode}]`;
          setTaskOutputs(prev => ({ ...prev, [task.id]: (prev[task.id] || '') + (parsed.result.output || '(no output)') + code + '\n' }));
        }
      }
    } catch (e) {
      setTaskOutputs(prev => ({ ...prev, [task.id]: (prev[task.id] || '') + `[error] ${e instanceof Error ? e.message : String(e)}\n` }));
    } finally {
      setTaskRunning(null);
    }
  };

  // ---- Workspace text search ----------------------------------------------

  const runSearch = async () => {
    const query = searchQuery.trim();
    if (!query || searchLoading) return;
    setSearchLoading(true);
    setSearchError('');
    setSearchResults(null);
    try {
      const globRes = await fetch(`/api/coder/glob?pattern=${encodeURIComponent('**/*')}&workspace=${encodeURIComponent(workspace)}`);
      const globData = await globRes.json().catch(() => ({})) as unknown;
      if (!globRes.ok) {
        setSearchError(`Search failed: ${(globData as { error?: string }).error || globRes.status}`);
        return;
      }
      const globParsed = parseGlobResult(globData);
      if ('error' in globParsed) {
        setSearchError(globParsed.error);
        return;
      }
      // Bound the search: the workbench search is a convenience, not the agent's
      // ripgrep. Cap candidates so one huge tree cannot wedge the browser.
      const candidates = globParsed.result.matches
        .map(m => absoluteWorkspacePath(workspace, m))
        .filter((p): p is string => p !== null)
        .slice(0, 200);

      const results: Array<{ file: string; hits: SearchHit[] }> = [];
      for (const path of candidates) {
        const fileRes = await fetch(`/api/coder/file?path=${encodeURIComponent(path)}&maxBytes=262144`);
        if (!fileRes.ok) continue; // directories / unreadable files are skipped
        const fileData = await fileRes.json().catch(() => ({})) as unknown;
        const fileParsed = parseFileContent(fileData);
        if ('error' in fileParsed) continue;
        const hits = searchLines(fileParsed.file.content, query);
        if (hits.length > 0) results.push({ file: path, hits });
      }
      setSearchResults(results);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setSearchLoading(false);
    }
  };

  /**
   * Apply the vision delegate to the daemon's vision bridge. Empty clears it
   * (the daemon auto-picks a same-provider vision model); otherwise the model
   * selector is written via the daemon's `visionModel` setting (user scope,
   * no restart).
   */
  const applyVisionModel = async (selector: string) => {
    try {
      const res = await fetch(`/api/coder/workspace/settings?workspace=${encodeURIComponent(workspace)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'user', key: 'visionModel', value: selector }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(`Vision model failed: ${data.error || res.status}`);
      }
    } catch (e) {
      setError(`Vision model failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const switchVisionModel = async (modelId: string) => {
    setSettings(prev => (prev ? { ...prev, coderVisionModel: modelId } : prev));
    void saveSettings({ coderVisionModel: modelId });
    await applyVisionModel(modelId ? toDaemonModelSelector(modelId) : '');
  };

  /**
   * Materialize (create or update) the writer subagent pinned to the chosen
   * model, or delete it when the writer model is cleared (no delegation).
   */
  const applyWriterModel = async (modelId: string) => {
    try {
      let res: Response;
      if (!modelId) {
        res = await fetch(`/api/coder/workspace/agents/${CODER_WRITER_AGENT_NAME}?scope=${CODER_WRITER_AGENT_SCOPE}`, { method: 'DELETE' });
        if (res.status === 404) return; // already absent — nothing to do
      } else {
        // Try update first (idempotent, hot-reloads the daemon's agent list);
        // fall back to create if it does not exist yet.
        res = await fetch(`/api/coder/workspace/agents/${CODER_WRITER_AGENT_NAME}?scope=${CODER_WRITER_AGENT_SCOPE}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildWriterSubagentUpdateBody(modelId)),
        });
        if (res.status === 404) {
          res = await fetch('/api/coder/workspace/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildWriterSubagentCreateBody(modelId)),
          });
        }
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(`Writer model failed: ${data.error || res.status}`);
      }
    } catch (e) {
      setError(`Writer model failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const switchWriterModel = async (modelId: string) => {
    setSettings(prev => (prev ? { ...prev, coderWriterModel: modelId } : prev));
    void saveSettings({ coderWriterModel: modelId });
    await applyWriterModel(modelId);
  };

  /**
   * Push the tool-search budget to the daemon's `tools.toolSearch.threshold`
   * (user scope). It is the deferred-tool preload budget, expressed as a
   * percentage of the context window. It is `requiresRestart: true` on the
   * daemon, so the write persists to ~/.qwen config and takes effect on the
   * daemon's next restart — the app cannot restart the shared daemon process,
   * and it does not pretend the change is live.
   */
  const applyToolSearchThreshold = async (threshold: number) => {
    try {
      const res = await fetch(`/api/coder/workspace/settings?workspace=${encodeURIComponent(workspace)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'user', key: 'tools.toolSearch.threshold', value: threshold }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(`Tool-search budget failed: ${data.error || res.status}`);
      }
    } catch (e) {
      setError(`Tool-search budget failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const saveSettings = async (patch: Partial<CoderSettings>) => {
    setSettingsSaving(true);
    // Reflect the change locally so the UI (and subsequent reads) see the new
    // value immediately, not just after a reload.
    const previous = settings;
    setSettings(prev => (prev ? { ...prev, ...patch } : prev));
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        // Revert the optimistic update so the UI does not show a value the
        // server refused; a "saved" indicator over an unsaved change is a lie.
        setSettings(previous);
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(typeof data.error === 'string' ? data.error : `Failed to save coding settings (HTTP ${res.status}).`);
      }
    } catch {
      setSettings(previous);
      setError('Failed to save coding settings.');
    } finally {
      setSettingsSaving(false);
    }
  };

  /**
   * Change the workspace cwd. Persists the setting AND tears down the current
   * daemon session so the next send re-creates it against the new directory.
   * Without the teardown, the old session (bound to the previous cwd) is
   * reused and the change silently never takes effect.
   */
  const changeWorkspace = async (next: string) => {
    const clean = next.trim();
    setWorkspace(clean);
    if (clean === (settings?.coderWorkspace ?? '/workspace')) return;
    void closeDaemonSession();
    await saveSettings({ coderWorkspace: clean || '/workspace' });
  };

  // ---- Send / stop ---------------------------------------------------------

  const send = async () => {
    const prompt = composer.trim();
    if (!prompt || !activeSessionId) return;
    setError('');
    setComposer('');

    // The transcript poll is the single source of truth for messages; the user
    // message will appear there as soon as the daemon records it. We do NOT
    // optimistically append here — that produced the "hello hello" duplicate
    // when the poll (or SSE) surfaced the same message a second time.
    setLiveStatus(busy ? 'queued — will run after the current turn' : 'starting…');

    try {
      const dsid = await ensureDaemonSession();
      if (!dsid) {
        setError('Failed to start daemon session');
        return;
      }
      const res = await fetch(`/api/coder/session/${dsid}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: [{ type: 'text', text: prompt }] }),
      });
      const data = await res.json().catch(() => ({})) as { promptId?: string; error?: string };
      if (!res.ok || !data.promptId) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Prompt rejected');
      }
      setLiveStatus('thinking…');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Prompt failed');
      setLiveStatus('');
    }
  };

  const cancelTurn = async () => {
    if (!daemonSessionId) return;
    try {
      const res = await fetch(`/api/coder/session/${daemonSessionId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        // A failed cancel must not read as "cancelling…" / successful: the turn
        // is still running and the user needs to know the stop did not land.
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(typeof data.error === 'string' ? data.error : `Failed to cancel (HTTP ${res.status}).`);
        return;
      }
      setLiveStatus('cancelling…');
    } catch {
      setError('Failed to cancel the turn.');
    }
  };

  /** Select an option for one question in a multi-question ask (draft only). */
  const selectQuestionAnswer = (requestId: string, answerKey: string, label: string) => {
    setQuestionDrafts(prev => ({
      ...prev,
      [requestId]: { ...(prev[requestId] || {}), [answerKey]: label },
    }));
  };

  /** Answer a permission ask / user question that is blocking the agent. */
  const respondToInteraction = async (item: PendingInteraction, optionId?: string) => {
    if (!daemonSessionId) return;
    // Optimistically clear the prompt so the UI doesn't sit on a dead card
    // while the vote is in flight; restore it if the vote is refused.
    setPending(prev => prev.filter(p => p.requestId !== item.requestId));
    setQuestionDrafts(prev => { const next = { ...prev }; delete next[item.requestId]; return next; });
    setError('');
    try {
      // For `ask_user_question`, the answers map is the whole point: each
      // question's `answerKey` -> chosen option label. A plain permission ask
      // sends no `answers` at all.
      const answers = item.questions?.length
        ? Object.fromEntries(item.questions.map(q => [q.answerKey, questionDrafts[item.requestId]?.[q.answerKey] ?? '']))
        : undefined;
      const res = await fetch(`/api/coder/session/${daemonSessionId}/permission/${item.requestId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // ACP nests `outcome`; the daemon 400s a flat `{outcome:'selected'}`.
        body: JSON.stringify(buildPermissionVoteBody(optionId, answers)),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({})) as { error?: string };
        // 404 means another client (or an expiry) already resolved it — that is
        // benign. Anything else is a real failure worth showing verbatim.
        if (res.status === 404) {
          setLiveStatus('request already resolved');
        } else {
          setError(detail.error || `Could not answer the request (HTTP ${res.status}).`);
          setPending(prev => prev.some(p => p.requestId === item.requestId) ? prev : [...prev, item]);
        }
      } else {
        setLiveStatus('answered — agent resuming…');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to respond');
      setPending(prev => prev.some(p => p.requestId === item.requestId) ? prev : [...prev, item]);
    }
  };

  /** Copy the whole session — chat, thinking, tool input/output — to the clipboard. */
  const copySession = async () => {
    const dump = serializeConversation(transcriptRef.current, {
      sessionId: daemonSessionId ?? activeSessionId ?? undefined,
      model: settings?.coderModel || undefined,
      workspace: settings?.coderWorkspace || workspace || undefined,
      approval: settings?.coderApprovalMode || undefined,
    });
    try {
      await copyToClipboard(dump);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Clipboard write failed.');
    }
  };

  /**
   * Run a single shell command in the agent's own session and append the result
   * to the pop-up terminal. This is the user's direct, on-demand access to the
   * isolated container — independent of the agent's own tool calls — via the
   * daemon's `POST /session/:id/shell`.
   */
  const runShellCommand = async () => {
    const command = shellCommand.trim();
    if (!command || shellRunning) return;
    const sessionId = daemonSessionId || (await ensureDaemonSession());
    if (!sessionId) {
      setShellOutput(prev => prev + '\n[error] no daemon session\n');
      return;
    }
    setShellRunning(true);
    setShellOutput(prev => prev + `\n$ ${command}\n`);
    try {
      const res = await fetch(`/api/coder/session/${sessionId}/shell`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-qwen-client-id': clientIdRef.current,
        },
        body: JSON.stringify({ command }),
      });
      const data = await res.json().catch(() => ({})) as { output?: string; exitCode?: number | null; error?: string };
      if (!res.ok) {
        setShellOutput(prev => prev + `[error ${res.status}] ${data.error || 'command failed'}\n`);
      } else {
        const out = typeof data.output === 'string' ? data.output : '';
        const code = data.exitCode === null || data.exitCode === undefined ? '' : `\n[exit ${data.exitCode}]`;
        setShellOutput(prev => prev + (out || '(no output)') + code + '\n');
      }
    } catch (e) {
      setShellOutput(prev => prev + `[error] ${e instanceof Error ? e.message : String(e)}\n`);
    } finally {
      setShellRunning(false);
      setShellCommand('');
    }
  };

  // ---- Live status + tool activity (SSE, with poll fallback) --------------

  /**
   * Subscribe to the daemon's event stream for the active session. This drives
   * the live status line, the tool-activity feed, and the permission prompts —
   * everything that has to appear *while* the agent works.
   */
  React.useEffect(() => {
    if (!daemonSessionId) return;
    let cancelled = false;
    const note = (line: string) => setLiveStatus(line);

    const onFrame = (raw: string) => {
      if (cancelled || !raw) return;
      let parsed: CoderTranscriptEvent;
      try {
        parsed = JSON.parse(raw) as CoderTranscriptEvent;
      } catch {
        return;
      }
      const data = (parsed.data || {}) as Record<string, unknown>;
      const update = typeof data.sessionUpdate === 'string' ? data.sessionUpdate : (typeof parsed.type === 'string' ? parsed.type : '');

      // The chat surface is driven by the transcript poll (authoritative,
      // survives reconnects/reloads). The SSE stream is only for instant status
      // feedback and permission/question prompts — it does NOT write messages,
      // so it can't race the poll into duplicates or drop the first response.
      if (
        update === 'agent_thought_chunk' || update === 'agent_message_chunk'
        || update === 'tool_call' || update === 'tool_call_update'
        || update === 'user_message_chunk'
      ) {
        if (update === 'agent_thought_chunk') note('thinking…');
        else if (update === 'agent_message_chunk') note('responding…');
        else if (update === 'tool_call' || update === 'tool_call_update') {
          const title = typeof data.title === 'string' && data.title ? data.title : 'tool';
          const status = typeof data.status === 'string' ? data.status : 'in_progress';
          note(status === 'in_progress' ? `${title}…` : `${title} — ${status}`);
        }
        return;
      }

      if (update === 'permission_request' || update === 'user_question') {
        const requestId = typeof data.requestId === 'string' ? data.requestId : '';
        if (!requestId) return;
        const rawOptions = Array.isArray(data.options) ? data.options : [];
        const options = normalizeOptions(rawOptions);
        const title = update === 'permission_request'
          ? 'Permission needed'
          : 'The agent has a question';
        // `permission_request` nests the action under `toolCall`; a user_question
        // carries `title`/`question` at the top level. Without unwrapping, the
        // card renders with no detail and the user cannot see what they are
        // approving.
        const toolCall = (data.toolCall || {}) as Record<string, unknown>;
        const detail = contentText(toolCall.content)
          || (typeof toolCall.title === 'string' ? toolCall.title : '')
          || contentText(toolCall.rawInput)
          || (typeof data.title === 'string' ? data.title : '')
          || contentText(data.question)
          || (typeof data.question === 'string' ? data.question : '');
        setPending(prev => prev.some(p => p.requestId === requestId) ? prev : [...prev, {
          requestId,
          kind: update === 'permission_request' ? 'permission' : 'user_question',
          title,
          detail,
          options,
          ...(typeof data.answerKey === 'string' ? { answerKey: data.answerKey } : {}),
        }]);
        note('waiting for you');
      } else if (update === 'permission_resolved' || update === 'permission_already_resolved') {
        const requestId = typeof data.requestId === 'string' ? data.requestId : '';
        if (requestId) setPending(prev => prev.filter(p => p.requestId !== requestId));
      } else if (update === 'model_switched' && typeof data.modelId === 'string') {
        note(`model → ${data.modelId}`);
      } else if (update === 'approval_mode_changed' && typeof data.mode === 'string') {
        note(`approval → ${data.mode}`);
      } else if (parsed.type === 'turn_complete' || update === 'turn_complete') {
        note('idle');
        setPending([]);
      }
    };

    // Fetch-based client (not EventSource) so a reconnect can send the
    // `Last-Event-ID` / `X-Qwen-Event-Epoch` resume headers — EventSource cannot
    // set custom headers, so its auto-reconnect always started a fresh stream
    // and replayed nothing. The resume lets a drop mid-turn continue from the
    // cursor instead of only seeing frames emitted after the resubscribe.
    const close = streamSessionEvents(
      `/api/coder/session/${daemonSessionId}/events`,
      frame => onFrame(frame.data),
      { onReconnecting: () => { if (!cancelled) note('reconnecting to agent stream…'); } },
    );

    return () => {
      cancelled = true;
      close();
    };
  }, [daemonSessionId]);

  /**
   * Status poll. Kept as a low-frequency safety net behind the SSE stream:
   * it reconciles `busy`/idle and permission counts if a frame was missed.
   */
  React.useEffect(() => {
    if (!daemonSessionId) return;
    let cancelled = false;
    // Reentrancy guard (same rationale as the transcript poll): a slow /status
    // fetch must not overlap the next tick.
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const res = await fetch(`/api/coder/session/${daemonSessionId}/status`);
        if (res.ok && !cancelled) {
          const status = await res.json().catch(() => ({})) as CoderSessionStatus;
          setSessionStatus(status);
          // Reconcile the prompt cards from the authoritative status payload.
          // Without this, a permission ask raised while the SSE stream was
          // reconnecting (or before a page reload) left the status pill saying
          // "Needs approval" with no card to click — the agent blocked forever
          // with no way to answer it.
          setPending(prev => reconcilePending(prev, status.pendingInteractions));
        }
      } catch {
        // Transient.
      } finally {
        running = false;
      }
    };
    void tick();
    const timer = setInterval(tick, 4000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [daemonSessionId]);

  /**
   * Transcript poll — the authoritative source for the chat surface.
   *
   * The SSE stream only delivers frames emitted AFTER the subscription opens,
   * so the first message's response can be missed and reconnects/reloads lose
   * everything the agent already said. Polling `/transcript` and rebuilding the
   * conversation from it means the chat is always a deterministic projection of
   * the daemon's real history — nothing vanishes, and the copy button dumps the
   * same events.
   */
  React.useEffect(() => {
    if (!daemonSessionId) return;
    let cancelled = false;
    // Reentrancy guard: `setInterval` keeps firing regardless of whether the
    // previous tick finished, so a slow transcript fetch (long local model,
    // multi-page history) could overlap the next tick and reorder/duplicate
    // state writes. Skip a tick when one is already in flight instead.
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        // `qwen serve` paginates the transcript at 100 events/page by default
        // and returns `{ hasMore, nextCursor }`. A single unpaginated fetch
        // silently dropped every message after the first couple of turns.
        // Request the daemon's hard cap (500) and follow the cursor if a
        // conversation ever grows past one page.
        const events = await fetchFullTranscript(async (cursor) => {
          const qs = new URLSearchParams({ limit: '500' });
          if (cursor) qs.set('cursor', cursor);
          const res = await fetch(`/api/coder/session/${daemonSessionId}/transcript?${qs.toString()}`);
          if (!res.ok) throw new Error(`transcript ${res.status}`);
          const data = await res.json().catch(() => ({}));
          return {
            events: Array.isArray(data.events) ? (data.events as CoderTranscriptEvent[]) : [],
            hasMore: data.hasMore === true,
            nextCursor: typeof data.nextCursor === 'string' ? data.nextCursor : undefined,
          };
        });
        if (cancelled) return;
        transcriptRef.current = events;
        setTranscriptEvents(events);
        const built = buildConversation(events);
        // The daemon session is now keyed by the persistent session id and
        // reattaches on reopen, so its transcript IS the full history. Prefer it
        // verbatim; only fall back to the DB baseline when the daemon has no
        // events yet (a fresh session that has never sent a prompt).
        setMessages(built.messages.length ? built.messages : baselineRef.current);
        setToolActivity(built.activity);
      } catch {
        // Transient.
      } finally {
        running = false;
      }
    };
    void tick();
    const timer = setInterval(tick, 1500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [daemonSessionId]);

  // ---- Auto-continue on writer completion ----------------------------------
  //
  // A background writer subagent finishing normally triggers the main model's
  // next turn automatically (the daemon injects a <task-notification> and
  // drains it into a fresh turn). But that drain can be deferred by daemon
  // gates, leaving the completion notification as the trailing transcript event
  // with no assistant response — which is why the user had to type "go".
  //
  // This effect makes the continuation deterministic from the UI side: when the
  // transcript ends on an unanswered background-agent notification and the
  // session is idle, we nudge the main model with a continuation prompt so it
  // reviews the writer's result and decides the next step on its own.
  React.useEffect(() => {
    if (!daemonSessionId) return;
    const trailing = trailingBackgroundNotification(transcriptEvents);
    if (!trailing) {
      // The notification was answered (an assistant turn followed), so clear
      // the latch — the next notification is a new one to handle.
      nudgedNotificationRef.current = null;
      return;
    }
    // Only act when the session is genuinely idle (not mid-turn, not blocked on
    // a permission/question) and we haven't already nudged for THIS task.
    if (busy) return;
    if (sessionStatus?.hasActivePrompt || sessionStatus?.isWaitingForPermission || sessionStatus?.isWaitingForUserQuestion) return;
    if (nudgedNotificationRef.current === trailing.taskId) return;
    nudgedNotificationRef.current = trailing.taskId;
    setLiveStatus('writer finished — reviewing…');
    void (async () => {
      try {
        // Drive a continuation turn via the daemon's dedicated endpoint. It
        // re-arms the trusted `isContinue` flag and runs the model with an EMPTY
        // prompt — the trailing <task-notification> is already in context, so the
        // main model resumes from it without a visible user message showing up in
        // the chat as if the user had typed it.
        const res = await fetch(`/api/coder/session/${daemonSessionId}/continue`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-qwen-client-id': clientIdRef.current,
          },
        });
        if (!res.ok) {
          // `fetch` resolves on non-2xx, so an HTTP error would otherwise leave
          // the retry latch set forever and the notification would never nudge
          // again. Clear it so the next poll retries; the poll cadence bounds it.
          nudgedNotificationRef.current = null;
          setLiveStatus('writer review failed — retrying…');
        }
      } catch {
        // Transient; the transcript poll will re-observe and retry.
        nudgedNotificationRef.current = null;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcriptEvents, busy, sessionStatus, daemonSessionId]);

  // Persist the transcript + tool activity after each turn settles.
  React.useEffect(() => {
    if (!activeSessionId || busy || messages.length === 0) return;
    // Respect an explicit user rename: once renamed, the title is fixed and
    // must not be re-derived from the first message.
    const renamed = renamedRef.current.get(activeSessionId);
    const title = renamed || messages.find(m => m.role === 'user')?.content.slice(0, 30) || 'New Coding Session';
    const content = messages.filter(m => m.content.trim());
    // The transcript poll rebuilds identical arrays every tick, so this effect
    // re-runs on idle. Persist only when the actual content changed — an idle
    // session must not rewrite its full history continuously.
    const signature = JSON.stringify({ title, content, toolActivity });
    if (signature === lastPersistSignatureRef.current) return;
    lastPersistSignatureRef.current = signature;
    void persistMessages(activeSessionId, title, content, toolActivity);
  }, [busy, activeSessionId, messages, toolActivity, persistMessages]);

  // Eagerly reattach to the daemon session for the active persistent session,
  // so a reopened tab resumes streaming/status immediately (the transcript
  // poll and SSE both key off `daemonSessionId`). Runs once settings have
  // loaded and a session is active — not only on the next send.
  React.useEffect(() => {
    // Wait until the session's saved workspace binding has been resolved before
    // reattaching — otherwise a reopened session could reattach with the current
    // default workspace instead of the ORIGINAL project it was created against.
    if (!activeSessionId || !settings || !sessionResolved) return;
    let cancelled = false;
    (async () => {
      const id = await ensureDaemonSession();
      if (!cancelled && id) setDaemonSessionId(id);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, settings, sessionResolved]);

  // ---- Derived UI state ----------------------------------------------------

  const statusLabel = sessionStatus?.isWaitingForUserQuestion ? 'Awaiting your answer'
    : sessionStatus?.isWaitingForPermission ? 'Needs approval'
    : sessionStatus?.hasActivePrompt ? 'Working…'
    : sessionStatus?.hasTurnError ? 'Turn error'
    : 'Idle';
  const statusColor = sessionStatus?.isWaitingForUserQuestion || sessionStatus?.isWaitingForPermission ? '#f59e0b'
    : sessionStatus?.hasTurnError ? '#ef4444'
    : sessionStatus?.hasActivePrompt ? '#22d3ee'
    : '#34d399';

  const runningTool = toolActivity.find(t => t.status === 'in_progress' || t.status === 'running');
  const statusBanner = busy
    ? (liveStatus || runningTool?.title || 'Working…')
    : '';

  const activityGlyph = (status: string) => status === 'in_progress' || status === 'running' ? '▸'
    : status === 'failed' || status === 'error' ? '✗'
    : status === 'completed' || status === 'success' ? '✓'
    : '·';
  const activityColor = (status: string) => status === 'failed' || status === 'error' ? '#ef4444'
    : status === 'completed' || status === 'success' ? '#34d399'
    : '#22d3ee';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex', flexDirection: 'column',
      background: 'radial-gradient(1200px 700px at 70% -10%, rgba(34,211,238,0.08), transparent), radial-gradient(900px 600px at 0% 110%, rgba(232,121,249,0.08), transparent), #070a12',
      color: '#d1d5db', fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(6px)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, letterSpacing: '0.06em', color: accent }}>
          <Terminal size={18} />
          <span style={{ textTransform: 'uppercase', fontSize: '0.8rem' }}>Coding</span>
        </div>
        <span style={{
          fontSize: '0.7rem', padding: '2px 8px', borderRadius: '999px',
          border: '1px solid rgba(255,255,255,0.12)', color: daemonOnline ? '#34d399' : '#f87171',
          background: 'rgba(255,255,255,0.03)', fontFamily: 'ui-monospace, monospace',
        }}>
          {connecting ? 'probing…' : daemonOnline ? 'daemon online' : 'daemon offline'}
        </span>
        {activeSessionId && (
          <span style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            fontSize: '0.7rem', padding: '2px 8px', borderRadius: '999px',
            border: `1px solid ${statusColor}`, color: statusColor,
            background: 'rgba(255,255,255,0.03)', fontFamily: 'ui-monospace, monospace',
          }}>
            {busy ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Circle size={8} />}
            {statusLabel}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <select
          value={settings?.coderApprovalMode || 'yolo'}
          onChange={e => void switchApprovalMode(e.target.value)}
          title="How freely the agent may act"
          style={{ background: 'rgba(255,255,255,0.03)', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '5px 8px', fontSize: '0.72rem', fontFamily: 'ui-monospace, monospace', outline: 'none' }}
        >
          {APPROVAL_MODES.map(m => (<option key={m.id} value={m.id} style={{ color: '#111' }} title={m.hint}>{m.label}</option>))}
        </select>
        <select
          value={settings?.coderModel || ''}
          onChange={e => void switchModel(e.target.value)}
          disabled={modelLoading || models.length === 0}
          title="Model for the coding brain"
          style={{ maxWidth: 230, background: 'rgba(255,255,255,0.03)', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '5px 8px', fontSize: '0.72rem', fontFamily: 'ui-monospace, monospace', outline: 'none' }}
        >
          <option value="">{modelLoading ? 'loading models…' : 'select model'}</option>
          {models.map(m => (
            <option key={m.id} value={m.id} style={{ color: '#111' }}>
              {m.name}{m.toolsCapable ? '' : '  ⚠ no tools'}
            </option>
          ))}
        </select>
        <button onClick={() => void copySession()} disabled={transcriptEvents.length === 0} style={ghostBtnStyle()} title="Copy the full session (chat + thinking + tool activity) to the clipboard">
          {copied ? <CheckCircle2 size={14} /> : <ClipboardCopy size={14} />} {copied ? 'Copied' : 'Copy'}
        </button>
        <button onClick={() => setSidebarOpen(o => !o)} style={ghostBtnStyle()} title={sidebarOpen ? 'Hide the sessions sidebar' : 'Show the sessions sidebar'}>
          {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />} {isPhone ? '' : 'Sessions'}
        </button>
        <button onClick={() => setShellOpen(o => !o)} style={ghostBtnStyle()} title="Open a terminal into the isolated container"><Terminal size={14} /> Terminal</button>
        <button onClick={() => setSettingsOpen(o => !o)} style={ghostBtnStyle()}><Wrench size={14} /> Settings</button>
        <button onClick={() => openPreview()} style={ghostBtnStyle()}><Globe size={14} /> Preview</button>
        <button onClick={() => void openRewind()} disabled={!activeSessionId} style={ghostBtnStyle()} title="Rewind the session to an earlier turn (restores conversation + files)"><History size={14} /> Rewind</button>
        <button onClick={() => void openFiles()} style={ghostBtnStyle()} title="Browse and edit workspace files"><Folder size={14} /> Files</button>
        <button onClick={() => void openTasks()} style={ghostBtnStyle()} title="Run named project tasks (install/build/test/run)"><Terminal size={14} /> Tasks</button>
        <button onClick={() => setSearchOpen(o => !o)} style={ghostBtnStyle()} title="Search workspace files"><Search size={14} /> Search</button>
        <button onClick={() => void newSession()} style={btnStyle(accent)}><Plus size={14} /> New</button>
        {onExit && (<button onClick={onExit} style={ghostBtnStyle()}><X size={14} /> Exit</button>)}
      </div>

      {/* Coder settings drawer */}
      {settingsOpen && settings && (
        <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.25)', display: 'flex', flexWrap: 'wrap', gap: '18px', alignItems: 'flex-start' }}>
          <SettingField label="Workspace (session cwd)" hint="Absolute path inside the coder container">
            <input
              value={workspace}
              onChange={e => setWorkspace(e.target.value)}
              onBlur={() => { if (workspace.trim() !== (settings.coderWorkspace ?? '/workspace')) void changeWorkspace(workspace); }}
              onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); void changeWorkspace(workspace); } }}
              placeholder="/workspace"
              style={inputStyle()}
            />
          </SettingField>
          <SettingField label="Context window" hint="0 = the model's own window. Raise for long jobs.">
            <input
              type="number"
              value={settings.coderContextLength || 0}
              disabled
              title="Reported by the model; edit on the daemon side"
              style={{ ...inputStyle(), width: 110, opacity: 0.6 }}
            />
          </SettingField>
          <SettingField label="Tool-search budget (%)" hint="How much of the context window is spent declaring tool schemas upfront. Raise toward 100 for small models that never call tool_search. Takes effect after the daemon restarts.">
            <input
              type="number"
              min={0}
              max={100}
              value={settings.coderToolSearchThreshold || 0}
              onChange={e => {
                const v = Number(e.target.value) || 0;
                setSettings(prev => (prev ? { ...prev, coderToolSearchThreshold: v } : prev));
              }}
              onBlur={() => {
                void saveSettings({ coderToolSearchThreshold: settings.coderToolSearchThreshold });
                void applyToolSearchThreshold(settings.coderToolSearchThreshold);
              }}
              style={{ ...inputStyle(), width: 110 }}
            />
          </SettingField>

          {/* Multi-model orchestration — triangle: main on top, vision (left) and
              writer (right) below. */}
          <div style={{ flexBasis: '100%', marginTop: '6px' }}>
            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(209,213,219,0.55)', marginBottom: '10px' }}>
              Model orchestration
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', maxWidth: 460 }}>
              {/* Main (top) */}
              <ModelSlot
                label="Main"
                hint="Plans, executes, and reviews all work"
                value={settings.coderModel}
                models={models}
                loading={modelLoading}
                onChange={id => void switchModel(id)}
              />
              {/* Triangle connector lines */}
              <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', padding: '0 40px' }}>
                <div style={{ width: 1, height: 14, background: 'rgba(34,211,238,0.35)', transform: 'rotate(30deg)' }} />
                <div style={{ width: 1, height: 14, background: 'rgba(34,211,238,0.35)', transform: 'rotate(-30deg)' }} />
              </div>
              {/* Bottom row: vision (left), writer (right) */}
              <div style={{ display: 'flex', gap: '16px', width: '100%' }}>
                <ModelSlot
                  label="Vision"
                  hint="Sees images; transcribes for the main model"
                  value={settings.coderVisionModel}
                  models={models}
                  loading={modelLoading}
                  onChange={id => void switchVisionModel(id)}
                  requireVision
                />
                <ModelSlot
                  label="Writer"
                  hint="Writes code and files; main reviews + fixes"
                  value={settings.coderWriterModel}
                  models={models}
                  loading={modelLoading}
                  onChange={id => void switchWriterModel(id)}
                />
              </div>
            </div>
          </div>

          <div style={{ alignSelf: 'flex-end', fontSize: '0.68rem', color: 'rgba(209,213,219,0.45)', fontFamily: 'ui-monospace, monospace', paddingBottom: 6 }}>
            {settingsSaving ? 'saving…' : 'saved'}
          </div>
        </div>
      )}

      {/* Rewind panel */}
      {rewindOpen && (
        <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.25)', maxHeight: 320, overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <History size={14} color={accent} />
            <span style={{ fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#d1d5db' }}>Rewind session</span>
            <span style={{ fontSize: '0.68rem', color: 'rgba(209,213,219,0.5)' }}>roll back conversation + workspace files to an earlier turn</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setRewindOpen(false)} style={ghostBtnStyle()}><X size={13} /></button>
          </div>

          {rewindLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.72rem', color: '#9ca3af', fontFamily: 'ui-monospace, monospace' }}>
              <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> loading rewind points…
            </div>
          )}
          {!rewindLoading && rewindError && (
            <div style={{ fontSize: '0.72rem', color: '#ef4444', fontFamily: 'ui-monospace, monospace' }}>{rewindError}</div>
          )}

          {!rewindLoading && !rewindError && rewindResult && (
            <div style={{ marginBottom: '10px', padding: '10px 12px', borderRadius: '8px', border: `1px solid ${rewindResult.rewound ? 'rgba(52,211,153,0.3)' : 'rgba(245,158,11,0.35)'}`, background: 'rgba(255,255,255,0.03)', fontSize: '0.74rem' }}>
              <div style={{ fontFamily: 'ui-monospace, monospace', color: rewindResult.rewound ? '#34d399' : '#f59e0b', marginBottom: '6px' }}>
                {rewindResult.rewound ? '✓ rewound' : '⚠ rewound with file failures'} → turn {rewindResult.targetTurnIndex}
              </div>
              {rewindResult.filesChanged.length > 0 && (
                <div style={{ color: '#d1d5db' }}>
                  <span style={{ color: 'rgba(209,213,219,0.6)' }}>restored {rewindResult.filesChanged.length} file{rewindResult.filesChanged.length === 1 ? '' : 's'}:</span>
                  <ul style={{ margin: '4px 0 0 16px', fontFamily: 'ui-monospace, monospace', fontSize: '0.7rem', color: '#9ca3af', overflowWrap: 'anywhere' }}>
                    {rewindResult.filesChanged.map(f => (<li key={f}>{f}</li>))}
                  </ul>
                </div>
              )}
              {rewindResult.filesFailed.length > 0 && (
                <div style={{ color: '#f59e0b', marginTop: '4px' }}>
                  <span>failed to restore:</span>
                  <ul style={{ margin: '4px 0 0 16px', fontFamily: 'ui-monospace, monospace', fontSize: '0.7rem', overflowWrap: 'anywhere' }}>
                    {rewindResult.filesFailed.map(f => (<li key={f}>{f}</li>))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {!rewindLoading && !rewindError && rewindSnapshots !== null && rewindSnapshots.length === 0 && (
            <div style={{ fontSize: '0.72rem', color: 'rgba(209,213,219,0.5)' }}>No rewindable turns yet — send a prompt and let the agent do something first.</div>
          )}

          {!rewindLoading && !rewindError && rewindSnapshots !== null && rewindSnapshots.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {rewindSnapshots.map(s => (
                <div key={s.promptId} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
                  <span style={{ fontSize: '0.72rem', fontFamily: 'ui-monospace, monospace', color: '#d1d5db' }}>turn {s.turnIndex}</span>
                  <span style={{ fontSize: '0.68rem', color: 'rgba(209,213,219,0.55)', fontFamily: 'ui-monospace, monospace' }}>
                    {new Date(s.timestamp).toLocaleTimeString()} · {s.diffStats.filesChanged} file{s.diffStats.filesChanged === 1 ? '' : 's'} (+{s.diffStats.insertions}/-{s.diffStats.deletions})
                  </span>
                  <div style={{ flex: 1 }} />
                  <button
                    onClick={() => void doRewind(s.promptId)}
                    disabled={rewindLoading}
                    style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '8px', padding: '3px 9px', fontSize: '0.7rem', cursor: 'pointer', fontFamily: 'ui-monospace, monospace' }}
                    title="Roll the conversation and workspace files back to this turn"
                  >
                    <RotateCcw size={12} /> rewind
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Project explorer panel */}
      {filesOpen && (
        <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.25)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <Folder size={14} color={accent} />
            <span style={{ fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#d1d5db' }}>Files</span>
            <button
              onClick={() => void loadDir(fileDir === '/' ? '/' : fileDir.split('/').slice(0, -1).join('/') || '/')}
              disabled={fileDir === '/'}
              style={{ ...ghostBtnStyle(), fontSize: '0.7rem', padding: '2px 8px' }}
              title="Up one directory"
            >
              ↑ Up
            </button>
            <span style={{ fontSize: '0.7rem', fontFamily: 'ui-monospace, monospace', color: 'rgba(209,213,219,0.6)', overflowWrap: 'anywhere' }}>{fileDir}</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setFilesOpen(false)} style={ghostBtnStyle()}><X size={13} /></button>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'stretch', flexWrap: 'wrap' }}>
            {/* Directory listing */}
            <div style={{ flex: '0 0 260px', maxHeight: 280, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', background: 'rgba(255,255,255,0.02)' }}>
              {fileLoading && (
                <div style={{ padding: '10px', fontSize: '0.7rem', color: '#9ca3af', fontFamily: 'ui-monospace, monospace' }}>loading…</div>
              )}
              {!fileLoading && fileError && (
                <div style={{ padding: '10px', fontSize: '0.7rem', color: '#ef4444', fontFamily: 'ui-monospace, monospace' }}>{fileError}</div>
              )}
              {!fileLoading && !fileError && fileEntries !== null && fileEntries.length === 0 && (
                <div style={{ padding: '10px', fontSize: '0.7rem', color: 'rgba(209,213,219,0.5)' }}>empty directory</div>
              )}
              {!fileLoading && !fileError && fileEntries !== null && [...fileEntries]
                .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1))
                .map(e => (
                  <button
                    key={e.name}
                    onClick={() => { if (e.kind === 'directory') void loadDir(childPath(fileDir, e.name)); else void openFile(childPath(fileDir, e.name)); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '7px', width: '100%', textAlign: 'left',
                      background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)',
                      padding: '6px 10px', cursor: 'pointer', fontSize: '0.74rem',
                      color: e.kind === 'directory' ? '#e5e7eb' : 'rgba(209,213,219,0.8)',
                      fontFamily: 'ui-monospace, monospace', overflow: 'hidden',
                    }}
                  >
                    {e.kind === 'directory' ? <Folder size={13} color="#22d3ee" /> : <FileText size={13} color="rgba(209,213,219,0.5)" />}
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</span>
                  </button>
                ))}
            </div>

            {/* Editor */}
            <div style={{ flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {openTabs.length > 0 && (
                <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '2px' }}>
                  {openTabs.map(t => (
                    <button
                      key={t.path}
                      onClick={() => setActivePath(t.path)}
                      title={t.path}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, maxWidth: 180,
                        background: t.path === activePath ? 'rgba(34,211,238,0.12)' : 'rgba(255,255,255,0.03)',
                        color: t.path === activePath ? '#e5e7eb' : 'rgba(209,213,219,0.6)',
                        border: `1px solid ${t.path === activePath ? 'rgba(34,211,238,0.4)' : 'rgba(255,255,255,0.07)'}`,
                        borderRadius: '6px', padding: '3px 8px', cursor: 'pointer',
                        fontSize: '0.68rem', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap',
                      }}
                    >
                      <FileText size={11} color={t.path === activePath ? '#22d3ee' : 'rgba(209,213,219,0.5)'} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {t.path.split('/').pop()}{t.dirty ? ' •' : ''}
                      </span>
                      <span
                        onClick={e => { e.stopPropagation(); closeTab(t.path); }}
                        title="Close tab"
                        style={{ color: 'rgba(209,213,219,0.4)', cursor: 'pointer', display: 'inline-flex' }}
                      >
                        <X size={11} />
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {activeTab && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.7rem', fontFamily: 'ui-monospace, monospace', color: 'rgba(209,213,219,0.7)', overflowWrap: 'anywhere', flex: 1 }}>
                    {activeTab.path}{activeTab.dirty ? ' •' : ''}
                  </span>
                  <button
                    onClick={() => void saveFile()}
                    disabled={activeTab.saving || !activeTab.dirty}
                    style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(34,211,238,0.1)', color: '#22d3ee', border: '1px solid rgba(34,211,238,0.3)', borderRadius: '8px', padding: '3px 9px', fontSize: '0.7rem', cursor: activeTab.dirty && !activeTab.saving ? 'pointer' : 'default', fontFamily: 'ui-monospace, monospace', opacity: activeTab.dirty && !activeTab.saving ? 1 : 0.5 }}
                    title="Save (compare-and-swap on the file hash)"
                  >
                    <Save size={12} /> {activeTab.saving ? 'saving…' : 'Save'}
                  </button>
                </div>
              )}
              {activeTab?.error && (
                <div style={{ fontSize: '0.7rem', color: '#ef4444', fontFamily: 'ui-monospace, monospace' }}>{activeTab.error}</div>
              )}
              {activeTab ? (
                <textarea
                  value={activeTab.content}
                  onChange={e => updateTab(activeTab.path, { content: e.target.value, dirty: true })}
                  spellCheck={false}
                  style={{
                    width: '100%', height: 220, resize: 'vertical',
                    background: 'rgba(0,0,0,0.3)', color: '#d1d5db', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '8px', padding: '8px 10px', fontSize: '0.74rem', fontFamily: 'ui-monospace, monospace',
                    lineHeight: '1.6', outline: 'none', whiteSpace: 'pre',
                  }}
                />
              ) : (
                <div style={{ padding: '10px', fontSize: '0.7rem', color: 'rgba(209,213,219,0.45)', fontFamily: 'ui-monospace, monospace' }}>
                  Select a file to view/edit it. Files stay open as tabs; save is compare-and-swap on the file hash, so it won't clobber a concurrent agent edit.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Named project tasks panel */}
      {tasksOpen && (
        <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.25)', maxHeight: 340, overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <Terminal size={14} color={accent} />
            <span style={{ fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#d1d5db' }}>Project tasks</span>
            <span style={{ fontSize: '0.68rem', color: 'rgba(209,213,219,0.5)' }}>install / build / test / run — executed in the agent session</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setTasksOpen(false)} style={ghostBtnStyle()}><X size={13} /></button>
          </div>

          {taskError && <div style={{ fontSize: '0.72rem', color: '#ef4444', fontFamily: 'ui-monospace, monospace', marginBottom: '6px' }}>{taskError}</div>}

          {tasks.length === 0 ? (
            <div style={{ fontSize: '0.72rem', color: 'rgba(209,213,219,0.5)' }}>Loading default tasks…</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {tasks.map(task => (
                <div key={task.id} style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', padding: '8px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.72rem', fontFamily: 'ui-monospace, monospace', color: '#e5e7eb', width: 56, flexShrink: 0 }}>{task.label}</span>
                    <input
                      value={taskCommands[task.id] ?? task.command}
                      onChange={e => setTaskCommands(prev => ({ ...prev, [task.id]: e.target.value }))}
                      spellCheck={false}
                      style={{ flex: 1, minWidth: 0, background: 'rgba(0,0,0,0.3)', color: '#d1d5db', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '4px 8px', fontSize: '0.72rem', fontFamily: 'ui-monospace, monospace', outline: 'none' }}
                    />
                    <button
                      onClick={() => void runTask(task)}
                      disabled={taskRunning !== null}
                      style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(34,211,238,0.1)', color: '#22d3ee', border: '1px solid rgba(34,211,238,0.3)', borderRadius: '6px', padding: '3px 10px', fontSize: '0.7rem', cursor: taskRunning === null ? 'pointer' : 'default', fontFamily: 'ui-monospace, monospace', opacity: taskRunning === null ? 1 : 0.5 }}
                    >
                      {taskRunning === task.id ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Square size={10} fill="currentColor" />}
                      {taskRunning === task.id ? 'running…' : 'Run'}
                    </button>
                  </div>
                  {taskOutputs[task.id] !== undefined && (
                    <pre style={{ margin: '6px 0 0', padding: '6px 8px', background: 'rgba(0,0,0,0.3)', borderRadius: '6px', fontSize: '0.68rem', fontFamily: 'ui-monospace, monospace', color: '#9ca3af', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 140, overflowY: 'auto' }}>
                      {taskOutputs[task.id]}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: '8px', fontSize: '0.66rem', color: 'rgba(209,213,219,0.4)', fontFamily: 'ui-monospace, monospace' }}>
            Tasks run to completion in the agent session. Long-lived servers (e.g. `npm run dev`) should be started by the agent or the Preview instead.
          </div>
        </div>
      )}

      {/* Workspace text search panel */}
      {searchOpen && (
        <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.25)', maxHeight: 340, overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <Search size={14} color={accent} />
            <span style={{ fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#d1d5db' }}>Search workspace</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setSearchOpen(false)} style={ghostBtnStyle()}><X size={13} /></button>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void runSearch(); }}
              placeholder="case-insensitive substring"
              spellCheck={false}
              style={{ flex: 1, background: 'rgba(0,0,0,0.3)', color: '#d1d5db', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '5px 10px', fontSize: '0.72rem', fontFamily: 'ui-monospace, monospace', outline: 'none' }}
            />
            <button
              onClick={() => void runSearch()}
              disabled={searchLoading || !searchQuery.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(34,211,238,0.1)', color: '#22d3ee', border: '1px solid rgba(34,211,238,0.3)', borderRadius: '6px', padding: '4px 12px', fontSize: '0.7rem', cursor: searchLoading || !searchQuery.trim() ? 'default' : 'pointer', fontFamily: 'ui-monospace, monospace', opacity: searchLoading || !searchQuery.trim() ? 0.5 : 1 }}
            >
              {searchLoading ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={12} />}
              {searchLoading ? 'searching…' : 'Search'}
            </button>
          </div>

          {searchError && <div style={{ fontSize: '0.72rem', color: '#ef4444', fontFamily: 'ui-monospace, monospace', marginBottom: '6px' }}>{searchError}</div>}

          {searchResults !== null && searchResults.length === 0 && (
            <div style={{ fontSize: '0.72rem', color: 'rgba(209,213,219,0.5)' }}>No matches.</div>
          )}

          {searchResults !== null && searchResults.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {searchResults.map(r => (
                <div key={r.file} style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', padding: '6px 10px' }}>
                  <div style={{ fontSize: '0.7rem', fontFamily: 'ui-monospace, monospace', color: '#e5e7eb', marginBottom: '4px', overflowWrap: 'anywhere' }}>{r.file}</div>
                  {r.hits.map((h, i) => (
                    <div key={i} style={{ display: 'flex', gap: '8px', fontSize: '0.68rem', fontFamily: 'ui-monospace, monospace', color: '#9ca3af', lineHeight: '1.5' }}>
                      <span style={{ color: 'rgba(34,211,238,0.6)', flexShrink: 0, width: 32, textAlign: 'right' }}>{h.line}</span>
                      <span style={{ overflowWrap: 'anywhere' }}>{h.text}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Chat / main */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {messages.length === 0 && !connecting && (
              <div style={{ margin: 'auto', textAlign: 'center', color: 'rgba(209,213,219,0.4)', maxWidth: '460px' }}>
                <Bot size={36} style={{ margin: '0 auto 12px', color: accent }} />
                <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '6px' }}>Your coding agent is ready.</div>
                <div style={{ fontSize: '0.84rem' }}>
                  {daemonOnline ? 'Start a session and describe what to build.' : 'Start the coder container to bring the brain online.'}
                </div>
                {!settings?.coderModel && daemonOnline && (
                  <div style={{ marginTop: '10px', fontSize: '0.78rem', color: '#fbbf24' }}>
                    Pick a model above — agents need a tools-capable one (models marked ⚠ cannot call tools).
                  </div>
                )}
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} style={{ display: 'flex', gap: '10px', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                <div style={{ width: 28, height: 28, borderRadius: '8px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: msg.role === 'user' ? 'rgba(232,121,249,0.15)' : 'rgba(34,211,238,0.12)', color: msg.role === 'user' ? magenta : accent }}>
                  {msg.role === 'user' ? <MessageSquare size={15} /> : <Bot size={16} />}
                </div>
                <div style={{ maxWidth: '74%', minWidth: 0, padding: '10px 14px', borderRadius: '12px', background: msg.role === 'user' ? 'rgba(232,121,249,0.08)' : 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', fontSize: '0.88rem', wordBreak: 'break-word', lineHeight: '1.7', color: '#d1d5db' }}>
                  {msg.thinking !== undefined && msg.thinking.trim() && (
                    <ThinkingBlock content={msg.thinking.trim()} isStreaming={false} />
                  )}
                  {msg.role === 'assistant' ? (
                    <AssistantContent content={msg.content} />
                  ) : (
                    <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                  )}
                  {msg.role === 'user' && msg.ack === 'sending' && (
                    <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.66rem', fontFamily: 'ui-monospace, monospace' }}>
                      <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} color="#9ca3af" /> <span style={{ color: '#9ca3af' }}>sending…</span>
                    </div>
                  )}
                  {msg.role === 'user' && msg.ack === 'error' && (
                    <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.66rem', fontFamily: 'ui-monospace, monospace' }}>
                      <AlertCircle size={11} color="#ef4444" /> <span style={{ color: '#ef4444' }}>failed</span>
                    </div>
                  )}
                  {msg.usage && msg.role === 'assistant' && (
                    <div style={{ marginTop: '8px', fontSize: '0.68rem', color: 'rgba(209,213,219,0.4)' }}>↑{msg.usage.inputTokens ?? '?'} / ↓{msg.usage.outputTokens ?? '?'} tok</div>
                  )}
                </div>
              </div>
            ))}

            {/* Live status banner — what the agent is doing right now */}
            {statusBanner && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', alignSelf: 'flex-start', maxWidth: '80%', padding: '7px 12px', borderRadius: '10px', background: 'rgba(34,211,238,0.07)', border: '1px solid rgba(34,211,238,0.25)', color: '#a5f3fc', fontSize: '0.78rem', fontFamily: 'ui-monospace, monospace' }}>
                <Loader2 size={13} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{statusBanner}</span>
                <button onClick={() => void cancelTurn()} title="Stop the agent" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.35)', borderRadius: '6px', padding: '2px 8px', fontSize: '0.7rem', cursor: 'pointer', flexShrink: 0 }}>
                  <Square size={10} /> Stop
                </button>
              </div>
            )}

            {/* Permission / question prompts — the agent is blocked on you */}
            {pending.map(item => (
              <div key={item.requestId} style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px 14px', borderRadius: '10px', background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.35)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#fbbf24', fontSize: '0.82rem', fontWeight: 600 }}>
                  <ShieldAlert size={15} /> {item.title}
                </div>

                {/* ask_user_question: render each question + its options, and a
                    submit button that sends every answer at once. */}
                {item.questions?.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {item.questions.map(q => (
                      <div key={q.answerKey} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {q.header && (
                          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#e5e7eb' }}>{q.header}</div>
                        )}
                        {q.question && (
                          <div style={{ fontSize: '0.82rem', color: '#d1d5db', whiteSpace: 'pre-wrap' }}>{q.question}</div>
                        )}
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {q.options.map(opt => {
                            const selected = questionDrafts[item.requestId]?.[q.answerKey] === opt.label;
                            return (
                              <button
                                key={opt.label}
                                onClick={() => selectQuestionAnswer(item.requestId, q.answerKey, opt.label)}
                                title={opt.description || undefined}
                                style={{
                                  ...(selected ? btnStyle(accent) : ghostBtnStyle()),
                                  ...(selected ? {} : { background: 'rgba(255,255,255,0.04)' }),
                                  textAlign: 'left',
                                }}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
                      <button
                        onClick={() => void respondToInteraction(item, 'proceed_once')}
                        disabled={!item.questions.every(q => questionDrafts[item.requestId]?.[q.answerKey])}
                        style={{ ...btnStyle(accent), ...((!item.questions.every(q => questionDrafts[item.requestId]?.[q.answerKey])) ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
                      >
                        <Send size={13} /> Submit answers
                      </button>
                      <button onClick={() => void respondToInteraction(item)} style={{ ...ghostBtnStyle(), color: '#fca5a5', borderColor: 'rgba(239,68,68,0.35)' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {item.detail && (
                      <div style={{ fontSize: '0.78rem', color: 'rgba(209,213,219,0.75)', fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap', maxHeight: 320, overflowY: 'auto' }}>
                        {item.detail}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {item.options.length > 0
                        ? item.options.map(opt => (
                            <button key={opt.optionId} onClick={() => void respondToInteraction(item, opt.optionId)} style={btnStyle(accent)}>
                              {opt.label}
                            </button>
                          ))
                        : (
                          <>
                            <button onClick={() => void respondToInteraction(item, 'proceed_once')} style={btnStyle(accent)}>Allow</button>
                            <button onClick={() => void respondToInteraction(item, 'proceed_always')} style={ghostBtnStyle()}>Always allow</button>
                          </>
                        )}
                      <button onClick={() => void respondToInteraction(item)} style={{ ...ghostBtnStyle(), color: '#fca5a5', borderColor: 'rgba(239,68,68,0.35)' }}>Deny</button>
                    </div>
                  </>
                )}
              </div>
            ))}

            {error && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5', fontSize: '0.82rem' }}>
                <AlertCircle size={14} /> {error}
              </div>
            )}
          </div>

          {/* Composer */}
          <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              <textarea
                value={composer}
                onChange={e => setComposer(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                placeholder={activeSessionId ? (busy ? 'Agent is working — type to queue the next command…' : 'Tell the agent what to build…') : 'Create a session first'}
                disabled={!activeSessionId}
                rows={2}
                style={{ flex: 1, resize: 'none', background: 'rgba(255,255,255,0.03)', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: '10px 12px', fontSize: '0.88rem', fontFamily: 'ui-monospace, monospace', outline: 'none' }}
              />
              <button onClick={() => void send()} disabled={!activeSessionId || !composer.trim()} style={{ ...btnStyle(accent), alignSelf: 'flex-end' }}>
                <Send size={14} /> {busy ? 'Queue' : 'Run'}
              </button>
            </div>
          </div>

          {/* Tool activity — inline record of what the agent did. Height is
              drag-resizable (grab the divider and pull up/down). */}
          <div
            onPointerDown={beginToolActivityResize}
            style={{ height: 8, cursor: 'ns-resize', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none' }}
            title="Drag up/down to resize tool activity"
          >
            <div style={{ width: 40, height: 3, borderRadius: 2, background: 'rgba(209,213,219,0.3)' }} />
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', height: toolActivityHeight, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 20px', color: 'rgba(209,213,219,0.7)', fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              <Wrench size={13} /> tool activity
              <span style={{ color: 'rgba(209,213,219,0.35)', textTransform: 'none', letterSpacing: 0 }}>
                {toolActivity.length > 0 ? `(${toolActivity.length})` : ''}
              </span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 10px', background: 'rgba(0,0,0,0.3)', fontFamily: 'ui-monospace, monospace', fontSize: '0.76rem' }}>
              {toolActivity.length === 0 && <div style={{ color: 'rgba(209,213,219,0.3)', padding: '6px 0' }}>— no tool activity yet —</div>}
              {[...toolActivity].reverse().map(t => (
                <div key={t.id} style={{ padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <div
                    onClick={() => setExpandedTool(expandedTool === t.id ? null : t.id)}
                    style={{ display: 'flex', gap: '8px', cursor: t.detail || t.rawInput ? 'pointer' : 'default', alignItems: 'baseline' }}
                  >
                    <span style={{ color: activityColor(t.status), flexShrink: 0 }}>{activityGlyph(t.status)}</span>
                    <span style={{ color: '#e5e7eb', flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                    {t.toolName && <span style={{ color: 'rgba(209,213,219,0.35)', fontSize: '0.68rem' }}>{t.toolName}</span>}
                    <span style={{ marginLeft: 'auto', color: activityColor(t.status), fontSize: '0.68rem', flexShrink: 0 }}>{t.status}</span>
                  </div>
                  {expandedTool === t.id && (
                    <pre style={{ margin: '5px 0 8px 20px', padding: '7px 9px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6, color: 'rgba(209,213,219,0.75)', fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflowY: 'auto' }}>
                      {t.rawInput !== undefined ? `input: ${JSON.stringify(t.rawInput, null, 2)}\n\n` : ''}
                      {t.detail || '(no output yet)'}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Preview browser — device-switchable, AI-driven. */}
        {previewOpen && (
          <div style={{ width: 380, maxWidth: '92vw', borderLeft: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', minHeight: 0, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <Globe size={13} style={{ color: accent }} />
              <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(209,213,219,0.5)' }}>Preview</span>
              <div style={{ display: 'flex', gap: '2px', marginLeft: 8, background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: 2 }}>
                {(['desktop', 'tablet', 'mobile'] as const).map(d => (
                  <button
                    key={d}
                    onClick={() => setPreviewDevice(d)}
                    title={`${d} viewport`}
                    style={{
                      background: previewDevice === d ? 'rgba(34,211,238,0.15)' : 'transparent',
                      color: previewDevice === d ? accent : 'rgba(209,213,219,0.6)',
                      border: 'none', borderRadius: 4, padding: '3px 7px', fontSize: '0.66rem', cursor: 'pointer', textTransform: 'capitalize',
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <button onClick={() => setPreviewOpen(false)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'rgba(209,213,219,0.5)', cursor: 'pointer', padding: 0 }}><X size={13} /></button>
            </div>
            <div style={{ display: 'flex', gap: '6px', padding: '8px 10px' }}>
              <input
                value={previewInput}
                onChange={e => setPreviewInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') applyPreview(previewInput); }}
                placeholder="http://localhost:3000 — the agent can set this too"
                style={{ flex: 1, background: 'rgba(255,255,255,0.03)', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '5px 8px', fontSize: '0.72rem', fontFamily: 'ui-monospace, monospace', outline: 'none' }}
              />
              <button onClick={() => applyPreview(previewInput)} style={{ background: 'rgba(34,211,238,0.12)', color: accent, border: `1px solid ${accent}`, borderRadius: '6px', padding: '4px 10px', fontSize: '0.72rem', cursor: 'pointer' }}>Go</button>
            </div>
            <div ref={previewStageRef} style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflow: 'auto', background: 'rgba(0,0,0,0.2)' }}>
              {previewUrl ? (
                <div
                  style={{
                    position: 'relative',
                    margin: '12px auto',
                    flexShrink: 0,
                    transformOrigin: 'top center',
                    transform: previewStageWidth
                      ? `scale(${Math.min(1, previewStageWidth / PREVIEW_VIEWPORTS[previewDevice].width)})`
                      : 'none',
                  }}
                >
                  <iframe
                    key={previewDevice + previewUrl}
                    src={previewUrl}
                    title="App preview"
                    style={{
                      display: 'block',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: previewDevice === 'mobile' ? 22 : previewDevice === 'tablet' ? 14 : 6,
                      background: '#fff',
                      flexShrink: 0,
                      width: PREVIEW_VIEWPORTS[previewDevice].width,
                      height: PREVIEW_VIEWPORTS[previewDevice].height,
                      boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
                    }}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  />
                </div>
              ) : (
                <div style={{ margin: 'auto', textAlign: 'center', color: 'rgba(209,213,219,0.4)', fontSize: '0.8rem', padding: 20 }}>
                  <Globe size={28} style={{ margin: '0 auto 10px', color: accent, opacity: 0.5 }} />
                  No URL yet.
                  <br />
                  <span style={{ fontSize: '0.72rem' }}>Enter one, or let the agent start a dev server — it will appear here automatically.</span>
                </div>
              )}
            </div>
            {previewError && <div style={{ padding: '6px 12px', fontSize: '0.72rem', color: '#fca5a5', borderTop: '1px solid rgba(239,68,68,0.2)' }}>{previewError}</div>}
          </div>
        )}

        {/* Session sidebar — retractable. On phone it overlays the chat; on
            desktop it sits inline and collapses to nothing when hidden. */}
        {sidebarOpen && (
          <div style={isPhone
            ? { position: 'fixed', top: 0, right: 0, bottom: 0, width: 280, maxWidth: '86vw', zIndex: 70, borderLeft: '1px solid rgba(255,255,255,0.08)', background: '#0a0e17', display: 'flex', flexDirection: 'column', boxShadow: '-12px 0 40px rgba(0,0,0,0.5)' }
            : { width: 260, borderLeft: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', minHeight: 0, flexShrink: 0 }
          }>
            <div style={{ display: 'flex', alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(209,213,219,0.5)', flex: 1 }}>Sessions</span>
              <button onClick={() => setSidebarOpen(false)} title="Close sessions" style={{ background: 'transparent', border: 'none', color: 'rgba(209,213,219,0.5)', cursor: 'pointer', padding: 0 }}><X size={14} /></button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
            {sessions.length === 0 && <div style={{ padding: '14px', fontSize: '0.78rem', color: 'rgba(209,213,219,0.4)' }}>No sessions yet.</div>}
            {sessions.map(session => (
              <div key={session.id} onClick={() => { void loadSession(session.id); if (isPhone) setSidebarOpen(false); }} style={{ padding: '10px 14px', cursor: 'pointer', borderLeft: activeSessionId === session.id ? `3px solid ${accent}` : '3px solid transparent', background: activeSessionId === session.id ? 'rgba(34,211,238,0.06)' : 'transparent' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ChevronRight size={12} style={{ color: 'rgba(209,213,219,0.4)' }} />
                  {renamingId === session.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); void renameSession(session.id, renameValue); setRenamingId(null); }
                        else if (e.key === 'Escape') { setRenamingId(null); }
                      }}
                      onBlur={() => { void renameSession(session.id, renameValue); setRenamingId(null); }}
                      placeholder="Session name"
                      style={{ flex: 1, background: 'rgba(255,255,255,0.05)', color: '#e5e7eb', border: `1px solid ${accent}`, borderRadius: '6px', padding: '3px 6px', fontSize: '0.8rem', outline: 'none' }}
                    />
                  ) : (
                    <span
                      onClick={e => { e.stopPropagation(); setRenamingId(session.id); setRenameValue(session.title || ''); }}
                      title="Rename session"
                      style={{ fontSize: '0.8rem', color: '#e5e7eb', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {session.title || session.id.slice(0, 8)}
                    </span>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); setRenamingId(session.id); setRenameValue(session.title || ''); }}
                    title="Rename session"
                    style={{ background: 'transparent', border: 'none', color: 'rgba(209,213,219,0.4)', cursor: 'pointer', padding: 0 }}
                  >
                    <Pencil size={12} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); void deleteSession(session.id); }} style={{ background: 'transparent', border: 'none', color: 'rgba(239,68,68,0.6)', cursor: 'pointer', padding: 0 }}><Trash2 size={13} /></button>
                </div>
                <div style={{ fontSize: '0.68rem', color: 'rgba(209,213,219,0.4)', marginTop: '2px', fontFamily: 'ui-monospace, monospace' }}>{new Date(session.updatedAt || session.createdAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
        )}
      </div>

      {/* On-demand terminal pop-up — direct shell into the isolated container */}
      {shellOpen && (
        <div style={{
          position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(680px, 90vw)', maxHeight: '80vh', zIndex: 60,
          display: 'flex', flexDirection: 'column', borderRadius: '12px', overflow: 'hidden',
          background: '#0a0e17', border: '1px solid rgba(34,211,238,0.35)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(34,211,238,0.06)' }}>
            <Terminal size={15} style={{ color: accent }} />
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#a5f3fc', letterSpacing: '0.05em' }}>Terminal — {workspace}</span>
            <span style={{ fontSize: '0.7rem', color: 'rgba(209,213,219,0.45)', fontFamily: 'ui-monospace, monospace' }}>root@coder (isolated container)</span>
            <button onClick={() => setShellOpen(false)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'rgba(209,213,219,0.6)', cursor: 'pointer', padding: 0 }}><X size={16} /></button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#d1d5db', minHeight: 180, maxHeight: '46vh', background: 'rgba(0,0,0,0.4)' }}>
            {shellOutput || <span style={{ color: 'rgba(209,213,219,0.35)' }}>Run a command below — it executes as root inside the isolated coder container.</span>}
          </div>
          <div style={{ display: 'flex', gap: '8px', padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <input
              value={shellCommand}
              onChange={e => setShellCommand(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void runShellCommand(); }}
              placeholder="ls -la /workspace"
              style={{ flex: 1, background: 'rgba(255,255,255,0.03)', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '8px 10px', fontSize: '0.8rem', fontFamily: 'ui-monospace, monospace', outline: 'none' }}
            />
            <button onClick={() => void runShellCommand()} disabled={shellRunning || !shellCommand.trim()} style={btnStyle(accent)}>
              {shellRunning ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />} Run
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function SettingField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
      <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(209,213,219,0.55)' }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: '0.68rem', color: 'rgba(209,213,219,0.35)', maxWidth: 300 }}>{hint}</span>}
    </div>
  );
}

/** A labelled model dropdown for one orchestration role (main / vision / writer). */
function ModelSlot({
  label,
  hint,
  value,
  models,
  loading,
  onChange,
  requireVision = false,
}: {
  label: string;
  hint: string;
  value: string;
  models: Array<{ id: string; name: string; toolsCapable: boolean; visionCapable: boolean }>;
  loading: boolean;
  onChange: (id: string) => void;
  requireVision?: boolean;
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#a5f3fc', letterSpacing: '0.04em' }}>{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={loading || models.length === 0}
        title={hint}
        style={{ width: '100%', background: 'rgba(255,255,255,0.03)', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '6px 8px', fontSize: '0.74rem', fontFamily: 'ui-monospace, monospace', outline: 'none' }}
      >
        <option value="">{loading ? 'loading…' : requireVision ? 'auto (same provider)' : 'same as main'}</option>
        {models.map(m => (
          <option key={m.id} value={m.id} style={{ color: '#111' }}>
            {m.name}
            {requireVision && !m.visionCapable ? '  ⚠ no vision' : ''}
            {!requireVision && !m.toolsCapable ? '  ⚠ no tools' : ''}
          </option>
        ))}
      </select>
      <span style={{ fontSize: '0.66rem', color: 'rgba(209,213,219,0.35)' }}>{hint}</span>
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return { background: 'rgba(255,255,255,0.03)', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '6px 9px', fontSize: '0.75rem', fontFamily: 'ui-monospace, monospace', outline: 'none', width: 200 };
}

function btnStyle(accent: string): React.CSSProperties {
  return { display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(34,211,238,0.12)', color: accent, border: `1px solid ${accent}`, borderRadius: '8px', padding: '7px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' };
}

function ghostBtnStyle(): React.CSSProperties {
  return { display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', color: 'rgba(209,213,219,0.7)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '7px 12px', fontSize: '0.78rem', cursor: 'pointer' };
}
