"use client";

import type { CanvasArtifactRecord } from '@/lib/canvas-artifacts';
import { copyToClipboard } from '@/lib/clipboard';
import {
MAX_UPLOAD_BYTES,
MAX_UPLOAD_LABEL,
formatBytes,
isImageFile,
normalizeImageMimeType,
type ExtractedFilePayload,
} from '@/lib/file-shared';
import { type MessageSource } from '@/lib/message-sources';
import type { OllamaHealthSummary } from '@/lib/ollama-health';
import { parseKeepAliveMs } from '@/lib/ollama-keepalive';
import {
hasPendingContinuation,
type SessionAutoContinueMode
} from '@/lib/session-intelligence';
import { type UiStreamPhase } from '@/lib/stream-status';
import { applyTheme } from '@/lib/theme-options';
import { useStickyScroll } from '@/lib/use-sticky-scroll';
import { randomUUID } from '@/lib/uuid';
import {
DEFAULT_WORKSPACE_TOOL_AGENT_PREFERENCES,
DEFAULT_WORKSPACE_TOOL_TASK_STATE,
WORKSPACE_TOOL_AGENT_MODE_OPTIONS,
createWorkspaceToolChecklistItems,
extractWorkspaceToolChecklistSuggestions,
type WorkspaceToolAgentMode,
type WorkspaceToolAgentPreferences,
type WorkspaceToolResponseStyle,
type WorkspaceToolTaskState
} from '@/lib/workspace-tool-agent';
import {
DEFAULT_WORKSPACE_TOOL_PERSONA,
DEFAULT_WORKSPACE_TOOL_USER_PROFILE,
applyPersonaTemplate,
type WorkspaceToolPersona,
type WorkspaceToolPersonaTemplateId,
type WorkspaceToolUserProfile,
} from '@/lib/workspace-tool-persona';
import {
type EffectiveWorkspaceToolAccess
} from '@/lib/workspace-tool-tool-access';
import React,{ useCallback,useDeferredValue,useEffect,useMemo,useRef,useState } from 'react';
import { MAX_EXPANDED_PANELS,readExpandedPanels,writeExpandedPanels,type PanelId } from './panelIconButton';
import { useAgentLoop } from './workspace/useAgentLoop';
import { useWorkspaceTools } from './workspace/useWorkspaceTools';
import { AutomationExecutionRunState,AutomationHeartbeatState,AutomationMonitorState,AutomationNotificationState,AutomationScheduleState,AutomationWorkerState,DEFAULT_AUTOMATION_HEARTBEAT_STATE,DEFAULT_AUTOMATION_WORKER_STATE,ImageAttachmentMode,MOBILE_BREAKPOINT,PendingToolApproval,ShellOutputEntry,ToolApprovalResolution,WORKSPACE_TOOL_ACCOUNTANT_STORAGE,WORKSPACE_TOOL_AGENT_STORAGE,WORKSPACE_TOOL_API_KEY_STORAGE,WORKSPACE_TOOL_CURRENT_SESSION_STORAGE,WORKSPACE_TOOL_CURRENT_WORKSPACE_STORAGE,WORKSPACE_TOOL_DRAFT_TASK_ID,WORKSPACE_TOOL_IMAGE_GEN_STORAGE,WORKSPACE_TOOL_INTERNET_STORAGE,WORKSPACE_TOOL_PERSONA_STORAGE,WORKSPACE_TOOL_RAG_STORAGE,WORKSPACE_TOOL_RAIL_STORAGE,WORKSPACE_TOOL_TASK_STATE_STORAGE,WORKSPACE_TOOL_UNCENSORED_STORAGE,WORKSPACE_TOOL_UNRESTRICTED_STORAGE,WORKSPACE_TOOL_USER_PROFILE_STORAGE,WorkspaceToolFileAttachment,WorkspaceToolFolder,WorkspaceToolImageAttachment,WorkspaceToolMessage,WorkspaceToolModel,WorkspaceToolProvider,WorkspaceToolSession,WorkspaceToolSettings,WorkspaceToolTag,WorkspaceToolWorkspaceProps,WorkspaceToolWorkspaceRecord,formatTimestamp,getChatTitle,getImageAttachmentSummary,normalizeWorkspaceToolSession,parseAutomationStateResponse,parseWorkspaceToolSettingsResponse,pruneInterruptedMessages,sanitizeWorkspaceToolMessages,sanitizeWorkspaceToolSessions,splitFolderPrefix,stripAttachmentVisionData } from './workspace/workspace-support';
import { WorkspaceView } from './workspace/WorkspaceView';
export function useWorkspaceController({
  onNavigateToKnowledgeBase,
  onNavigateToWorkspace,
  onNavigateToSettings,
  onNavigateToCoding,
  view = 'workspace',
  knowledgeBaseContent,
  settingsContent,
  settingsRevision = 0,
}: WorkspaceToolWorkspaceProps) {
  const getStoredInternetEnabled = () => {
    if (typeof window === 'undefined') return false;
    try {
      return window.sessionStorage.getItem(WORKSPACE_TOOL_INTERNET_STORAGE) === 'true';
    } catch {
      return false;
    }
  };

  const getStoredRagEnabled = (): boolean | null => {
    if (typeof window === 'undefined') return null;
    try {
      const stored = window.sessionStorage.getItem(WORKSPACE_TOOL_RAG_STORAGE);
      if (stored === 'true') return true;
      if (stored === 'false') return false;
      return null;
    } catch {
      return null;
    }
  };

  const getStoredAgentPreferences = () => {
    if (typeof window === 'undefined') return DEFAULT_WORKSPACE_TOOL_AGENT_PREFERENCES;
    try {
      const storedPreferences = window.localStorage.getItem(WORKSPACE_TOOL_AGENT_STORAGE);
      if (!storedPreferences) return DEFAULT_WORKSPACE_TOOL_AGENT_PREFERENCES;

      const parsed = JSON.parse(storedPreferences) as Partial<WorkspaceToolAgentPreferences>;
      return {
        ...DEFAULT_WORKSPACE_TOOL_AGENT_PREFERENCES,
        ...parsed,
        mode: (parsed.mode as WorkspaceToolAgentMode) || DEFAULT_WORKSPACE_TOOL_AGENT_PREFERENCES.mode,
        responseStyle: (parsed.responseStyle as WorkspaceToolResponseStyle) || DEFAULT_WORKSPACE_TOOL_AGENT_PREFERENCES.responseStyle,
        workspaceNotes: typeof parsed.workspaceNotes === 'string' ? parsed.workspaceNotes : '',
        successCriteria: typeof parsed.successCriteria === 'string' ? parsed.successCriteria : '',
        askClarifyingQuestionFirst: typeof parsed.askClarifyingQuestionFirst === 'boolean'
          ? parsed.askClarifyingQuestionFirst
          : DEFAULT_WORKSPACE_TOOL_AGENT_PREFERENCES.askClarifyingQuestionFirst,
      };
    } catch {
      return DEFAULT_WORKSPACE_TOOL_AGENT_PREFERENCES;
    }
  };

  const getStoredRightRailCollapsed = () => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(WORKSPACE_TOOL_RAIL_STORAGE) === 'true';
    } catch {
      return false;
    }
  };

  const getStoredTaskStates = () => {
    if (typeof window === 'undefined') return {};
    try {
      const storedTaskStates = window.localStorage.getItem(WORKSPACE_TOOL_TASK_STATE_STORAGE);
      if (!storedTaskStates) return {};
      const parsed = JSON.parse(storedTaskStates) as Record<string, Partial<WorkspaceToolTaskState>>;
      return Object.entries(parsed).reduce<Record<string, WorkspaceToolTaskState>>((acc, [key, value]) => {
        acc[key] = {
          ...DEFAULT_WORKSPACE_TOOL_TASK_STATE,
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

  const getStoredPersona = (): WorkspaceToolPersona & { templateId: WorkspaceToolPersonaTemplateId } => {
    if (typeof window === 'undefined') return { ...DEFAULT_WORKSPACE_TOOL_PERSONA, templateId: 'custom' };
    try {
      const stored = window.localStorage.getItem(WORKSPACE_TOOL_PERSONA_STORAGE);
      if (!stored) return { ...DEFAULT_WORKSPACE_TOOL_PERSONA, templateId: 'custom' };
      const parsed = JSON.parse(stored) as Partial<WorkspaceToolPersona & { templateId: WorkspaceToolPersonaTemplateId }>;
      const templateId = (parsed.templateId as WorkspaceToolPersonaTemplateId) || 'custom';
      const base = templateId === 'custom' ? DEFAULT_WORKSPACE_TOOL_PERSONA : applyPersonaTemplate(templateId);
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
      return { ...DEFAULT_WORKSPACE_TOOL_PERSONA, templateId: 'custom' };
    }
  };

  const getStoredUserProfile = (): WorkspaceToolUserProfile => {
    if (typeof window === 'undefined') return DEFAULT_WORKSPACE_TOOL_USER_PROFILE;
    try {
      const stored = window.localStorage.getItem(WORKSPACE_TOOL_USER_PROFILE_STORAGE);
      if (!stored) return DEFAULT_WORKSPACE_TOOL_USER_PROFILE;
      const parsed = JSON.parse(stored) as Partial<WorkspaceToolUserProfile>;
      return {
        name: typeof parsed.name === 'string' ? parsed.name : '',
        role: typeof parsed.role === 'string' ? parsed.role : '',
        preferences: typeof parsed.preferences === 'string' ? parsed.preferences : '',
        context: typeof parsed.context === 'string' ? parsed.context : '',
      };
    } catch {
      return DEFAULT_WORKSPACE_TOOL_USER_PROFILE;
    }
  };

  const getStoredCurrentSessionSelection = () => {
    if (typeof window === 'undefined') return '';
    try {
      return window.sessionStorage.getItem(WORKSPACE_TOOL_CURRENT_SESSION_STORAGE) || '';
    } catch {
      return '';
    }
  };

  const getStoredCurrentWorkspaceSelection = () => {
    if (typeof window === 'undefined') return '';
    try {
      return window.localStorage.getItem(WORKSPACE_TOOL_CURRENT_WORKSPACE_STORAGE) || '';
    } catch {
      return '';
    }
  };

  const getIsMobileViewport = () => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= MOBILE_BREAKPOINT;
  };

  const [settings, setSettings] = useState<WorkspaceToolSettings | null>(null);
  const [draftSessionAutoContinueMode, setDraftSessionAutoContinueMode] = useState<SessionAutoContinueMode>('manual');
  const [draftSessionAutoContinueMaxSteps, setDraftSessionAutoContinueMaxSteps] = useState(3);
  const [effectiveToolAccess, setEffectiveToolAccess] = useState<EffectiveWorkspaceToolAccess | null>(null);
  const [models, setModels] = useState<WorkspaceToolModel[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceToolWorkspaceRecord[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string>(() => getStoredCurrentWorkspaceSelection());
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceDescription, setNewWorkspaceDescription] = useState('');
  const [sessions, setSessions] = useState<WorkspaceToolSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => {
    const storedSelection = getStoredCurrentSessionSelection();
    return storedSelection && storedSelection !== WORKSPACE_TOOL_DRAFT_TASK_ID ? storedSelection : null;
  });
  const [chatHistory, setChatHistory] = useState<WorkspaceToolMessage[]>([]);
  const [message, setMessage] = useState('');
  const deferredChatHistory = useDeferredValue(chatHistory);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamPhase, setStreamPhase] = useState<UiStreamPhase | null>(null);
  const [liveStats, setLiveStats] = useState<{ tps: number; tokens: number } | null>(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [favoriteModels, setFavoriteModels] = useState<string[]>([]);
  // Favorites are server-authoritative and per-user (UserSettings.workspaceToolFavoriteModels),
  // so they are NOT seeded from localStorage — localStorage is shared across every
  // account on a browser and would leak one user's favorites into another's. The
  // server list is adopted in loadSettings once settings resolve.
  const [provider, setProvider] = useState<WorkspaceToolProvider>('ollama');
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
  const [folders, setFolders] = useState<WorkspaceToolFolder[]>([]);
  const [tags, setTags] = useState<WorkspaceToolTag[]>([]);
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
  const [sessionMessagesLoading, setSessionMessagesLoading] = useState(false);
  // Guards the active-session transcript fetch so a slow response from a
  // previously-selected session cannot overwrite the chat history of the
  // session the user actually switched to.
  const activeSessionLoadRef = useRef<string | null>(null);
  // Cache of full session DTOs (with messages/analytics/contextSummary) loaded
  // on demand via GET /api/chats/[id]. The sidebar list is lean, so any feature
  // that needs the transcript (copy, branch-compare, re-open) hydrates the
  // in-memory row through this cache to avoid refetching.
  const [sessionDetailCache, setSessionDetailCache] = useState<Record<string, WorkspaceToolSession>>({});
  const [ragEnabled, setRagEnabled] = useState(() => getStoredRagEnabled() ?? false);
  const [ragFolderPath, setRagFolderPath] = useState<string | null>(null);
  const [ragFolderPopoverOpen, setRagFolderPopoverOpen] = useState(false);
  const ragFolderButtonRef = useRef<HTMLButtonElement>(null);
  const ragFolderPopoverRef = useRef<HTMLDivElement>(null);
  const [internetEnabled, setInternetEnabled] = useState(getStoredInternetEnabled);
  const [uwafBrowserMode, setUwafBrowserMode] = useState<'direct' | 'stealth'>('direct');
  const [unrestrictedEnabled, setUnrestrictedEnabled] = useState(() => {
    try { return window.sessionStorage.getItem(WORKSPACE_TOOL_UNRESTRICTED_STORAGE) === 'true'; } catch { return false; }
  });
  const [uncensoredEnabled, setUncensoredEnabled] = useState(() => {
    try { return window.sessionStorage.getItem(WORKSPACE_TOOL_UNCENSORED_STORAGE) === 'true'; } catch { return false; }
  });
  const [accountantEnabled, setAccountantEnabled] = useState(() => {
    try { return window.sessionStorage.getItem(WORKSPACE_TOOL_ACCOUNTANT_STORAGE) === 'true'; } catch { return false; }
  });
  const [imageGenerationEnabled, setImageGenerationEnabled] = useState(() => {
    try { return window.sessionStorage.getItem(WORKSPACE_TOOL_IMAGE_GEN_STORAGE) === 'true'; } catch { return false; }
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
  // When keep-alive is on, PeakUI re-loads the selected model if it is not
  // resident. A user-initiated "Stop model" suppresses that for one keep-alive
  // window so an explicit stop is not immediately undone.
  const keepLoadedSuppressedUntilRef = useRef(0);
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
  const [agentPreferences, setAgentPreferences] = useState<WorkspaceToolAgentPreferences>(getStoredAgentPreferences);
  const [autoContinuePending, setAutoContinuePending] = useState(false);
  const autoContinueCountRef = useRef(0);
  const autoContinueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [taskStates, setTaskStates] = useState<Record<string, WorkspaceToolTaskState>>(getStoredTaskStates);
  const [lastSubmission, setLastSubmission] = useState<{ prompt: string; internetEnabled: boolean } | null>(null);
  const [ollamaHealth, setOllamaHealth] = useState<OllamaHealthSummary | null>(null);
  const [ollamaHealthLoading, setOllamaHealthLoading] = useState(false);
  const [persona, setPersona] = useState<WorkspaceToolPersona & { templateId: WorkspaceToolPersonaTemplateId }>(getStoredPersona);
  const [userProfile, setUserProfile] = useState<WorkspaceToolUserProfile>(getStoredUserProfile);
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
  // Workspace Files panel — Phase 1 skeleton
  const [workspaceFilesPanelKey] = useState(() => `workspace-files-${Math.random().toString(36).slice(2, 10)}`);
  const [workspaceFilesError, setWorkspaceFilesError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const memoryLoadRef = useRef(0);
  useEffect(() => () => {
    abortControllerRef.current?.abort();
    if (autoContinueTimerRef.current) clearTimeout(autoContinueTimerRef.current);
    memoryLoadRef.current += 1;
  }, []);
  const pendingApprovalResolverRef = useRef<((result: ToolApprovalResolution) => void) | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const startTimeRef = useRef<number>(0);
  const tokenCountRef = useRef<number>(0);
  const [pendingImages, setPendingImages] = useState<WorkspaceToolImageAttachment[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<WorkspaceToolFileAttachment[]>([]);
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
        const res = await fetch('/api/workspace-tool/model-vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            provider,
            base_url: provider === 'openai-compatible' ? baseUrl : settings?.ollamaUseCloudApi ? 'https://ollama.com' : settings?.ollamaHost,
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
      const stored = window.localStorage.getItem(WORKSPACE_TOOL_API_KEY_STORAGE);
      if (stored) setApiKey(stored);
    } finally {
      setApiKeyLoaded(true);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(WORKSPACE_TOOL_AGENT_STORAGE, JSON.stringify(agentPreferences));
      window.localStorage.setItem(WORKSPACE_TOOL_RAIL_STORAGE, String(rightRailCollapsed));
      window.localStorage.setItem(WORKSPACE_TOOL_TASK_STATE_STORAGE, JSON.stringify(taskStates));
      window.localStorage.setItem(WORKSPACE_TOOL_PERSONA_STORAGE, JSON.stringify(persona));
      window.localStorage.setItem(WORKSPACE_TOOL_USER_PROFILE_STORAGE, JSON.stringify(userProfile));
    } catch {
      // Ignore browser storage failures.
    }
  }, [agentPreferences, rightRailCollapsed, taskStates, persona, userProfile]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        WORKSPACE_TOOL_CURRENT_SESSION_STORAGE,
        currentSessionId || WORKSPACE_TOOL_DRAFT_TASK_ID,
      );
    } catch {
      // Ignore browser storage failures.
    }
  }, [currentSessionId]);

  useEffect(() => {
    try {
      if (currentWorkspaceId) {
        window.localStorage.setItem(WORKSPACE_TOOL_CURRENT_WORKSPACE_STORAGE, currentWorkspaceId);
      } else {
        window.localStorage.removeItem(WORKSPACE_TOOL_CURRENT_WORKSPACE_STORAGE);
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

  // ---------------------------------------------------------------------
  // Side-rail panel accordion (max 2 expanded).
  //
  // The truth about which panels are expanded lives here so the cap can be
  // enforced across all four panels. `expandedPanels` is an array ordered
  // by most-recently-toggled: index 0 is the oldest (LRU), the last
  // element is the most recent. Capped at MAX_EXPANDED_PANELS.
  // ---------------------------------------------------------------------
  const [expandedPanels, setExpandedPanels] = useState<PanelId[]>(() => {
    if (typeof window === 'undefined') return [];
    // Initial read can't know the runtime mounted set yet (it depends on
    // settings, internet toggle, session id), so we read a superset and
    // trust the intersection-on-restore step inside `effectiveExpanded`.
    return readExpandedPanels(window.localStorage, [
      'canvas',
      'workspaceFiles',
      'networkHub',
      'liveBrowser',
    ]);
  });

  const liveBrowserVisible = Boolean(
    internetEnabled
    && uwafBrowserEnabled
    && settings?.workspaceToolUwafLiveBrowser
    && currentSessionId
    && browserLiveStatus !== 'failed'
    && !browserModalOpen,
  );
  const networkHubVisible = uwafBrowserEnabled;

  const mountedPanels = useMemo<PanelId[]>(() => {
    const result: PanelId[] = ['canvas', 'workspaceFiles'];
    if (networkHubVisible) result.push('networkHub');
    if (liveBrowserVisible) result.push('liveBrowser');
    return result;
  }, [networkHubVisible, liveBrowserVisible]);

  // Intersect the persisted set with what's actually mounted. A user who
  // turned off the internet toggle should not see LiveBrowser silently come
  // back expanded on the next page load.
  const effectiveExpanded = useMemo<PanelId[]>(() => {
    const mountedSet = new Set(mountedPanels)
    return expandedPanels.filter(panel => mountedSet.has(panel)).slice(0, MAX_EXPANDED_PANELS)
  }, [expandedPanels, mountedPanels])

  useEffect(() => {
    if (typeof window === 'undefined') return;
    writeExpandedPanels(window.localStorage, expandedPanels);
  }, [expandedPanels]);

  const isPanelExpanded = useCallback(
    (panel: PanelId) => effectiveExpanded.includes(panel),
    [effectiveExpanded],
  );

  const togglePanel = useCallback((panel: PanelId) => {
    setExpandedPanels(prev => {
      const idx = prev.indexOf(panel);
      if (idx >= 0) {
        // Already expanded: just collapse it.
        return prev.filter(p => p !== panel);
      }
      // Not expanded: add at the end (most recent), then trim to cap. The
      // trimmed element is the oldest = LRU auto-collapse.
      const next = [...prev, panel];
      if (next.length > MAX_EXPANDED_PANELS) {
        next.shift();
      }
      return next;
    });
  }, []);

  const allowedFilesystemPaths = useMemo(() => {
    if (!settings?.workspaceToolAllowedPaths) return [];
    return settings.workspaceToolAllowedPaths
      .split(/\r?\n/)
      .map(entry => entry.trim())
      .filter(Boolean);
  }, [settings?.workspaceToolAllowedPaths]);
  const allowedWritablePaths = useMemo(() => {
    if (!settings?.workspaceToolWritablePaths) return [];
    return settings.workspaceToolWritablePaths
      .split(/\r?\n/)
      .map(entry => entry.trim())
      .filter(Boolean);
  }, [settings?.workspaceToolWritablePaths]);
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
      ? settings?.workspaceToolFileWriteMode === 'auto-approve'
        ? 'Auto-approve'
        : settings?.workspaceToolFileWriteMode === 'ask-first'
          ? 'Ask-first'
          : 'Disabled'
      : 'Disabled';
  const filesystemWriteBadge = !filesystemGranted
    ? 'Blocked'
    : filesystemWriteEnabled
      ? settings?.workspaceToolFileWriteMode === 'auto-approve'
        ? 'Auto'
        : settings?.workspaceToolFileWriteMode === 'ask-first'
          ? 'Ask-first'
          : 'Off'
      : 'Off';
  const codeSandboxSummary = !codeGranted
    ? 'Blocked by account permission'
    : codeExecutionEnabled
      ? settings?.workspaceToolCodeExecutionMode === 'auto-approve'
        ? 'Auto-approve'
        : 'Ask-first'
      : 'Disabled';
  const codeSandboxBadge = !codeGranted
    ? 'Blocked'
    : codeExecutionEnabled
      ? settings?.workspaceToolCodeExecutionMode === 'auto-approve'
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
    return sanitizeWorkspaceToolSessions(sessions).find(session => session.id === currentSessionId) ?? null;
  }, [currentSessionId, sessions]);
  // Map of canvas artifact filename → relative download URL. Used to rewrite
  // markdown links the model emits with the wrong absolute URL (e.g. it
  // substitutes the user's deployment hostname instead of using
  // `/api/canvas/artifacts/<id>/download`). Only includes filenames that look
  // like a downloadable artifact (have an extension and a download URL).
  const canvasArtifactNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const artifact of canvasArtifacts) {
      if (!artifact.name || !artifact.id) continue
      const trimmedName = artifact.name.trim()
      if (!/\.[A-Za-z0-9]{1,6}$/.test(trimmedName)) continue
      const downloadUrl = `/api/canvas/artifacts/${artifact.id}/download`
      map.set(trimmedName, downloadUrl)
      // Also key by basename without extension so a model link like
      // "[Linux in the Enterprise.pptx]" still resolves via "Linux in the
      // Enterprise" (filename without the .pptx suffix).
      const basename = trimmedName.replace(/\.[A-Za-z0-9]{1,6}$/, '')
      if (basename && !map.has(basename)) map.set(basename, downloadUrl)
    }
    return map
  }, [canvasArtifacts])
  const effectiveSessionAutoContinueMode = currentSession?.autoContinueMode ?? draftSessionAutoContinueMode;
  const effectiveSessionAutoContinueMaxSteps = currentSession?.autoContinueMaxSteps ?? draftSessionAutoContinueMaxSteps;
  const continuationPending = useMemo(() => hasPendingContinuation(chatHistory), [chatHistory]);
  const workspaceSummary = currentWorkspace
    ? `${currentWorkspace.name} · ${currentWorkspace.skillCount} skill${currentWorkspace.skillCount === 1 ? '' : 's'} · ${currentWorkspace.autoGitBackup ? 'Git backup on' : 'Git backup off'}`
    : 'No workspace loaded';
  const activeAgentMode = WORKSPACE_TOOL_AGENT_MODE_OPTIONS.find(option => option.id === agentPreferences.mode);

  const persistApiKey = (value: string) => {
    setApiKey(value);
    try {
      window.localStorage.setItem(WORKSPACE_TOOL_API_KEY_STORAGE, value);
    } catch {
      // Ignore browser storage failures.
    }
  };

  const setRagAccess = (nextValue: boolean) => {
    try {
      window.sessionStorage.setItem(WORKSPACE_TOOL_RAG_STORAGE, String(nextValue));
    } catch {
      // Ignore browser storage failures.
    }
    setRagEnabled(nextValue);
  };

  const loadSettings = async () => {
    const res = await fetch('/api/settings', { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const parsed = parseWorkspaceToolSettingsResponse(data as Record<string, unknown>);
    const nextSettings = parsed.settings;

    setSettings(nextSettings);
    setEffectiveToolAccess(parsed.effectiveToolAccess);
    setProvider(nextSettings.workspaceToolProvider);
    setBaseUrl(nextSettings.workspaceToolBaseUrl);
    setSelectedModel(nextSettings.workspaceToolModel);
    applyTheme(nextSettings.theme);
    setDraftSessionAutoContinueMode(nextSettings.workspaceToolSessionAutoContinueDefault);
    setDraftSessionAutoContinueMaxSteps(nextSettings.workspaceToolSessionAutoContinueMaxSteps);
    if (getStoredRagEnabled() === null) {
      setRagEnabled(nextSettings.ragEnabled);
    }

    // Favorites are server-authoritative and per-user — adopt the server
    // list directly. We deliberately do NOT read localStorage here: that key
    // is shared across all accounts on a browser, so seeding from it would
    // leak another user's favorites into this account.
    setFavoriteModels(nextSettings.workspaceToolFavoriteModels);

    const templateId = (nextSettings.workspaceToolPersonaTemplate as WorkspaceToolPersonaTemplateId) || 'custom';
    const serverPersona = applyPersonaTemplate(templateId, {
      name: nextSettings.workspaceToolPersonaName,
      tone: nextSettings.workspaceToolPersonaTone,
      expertise: nextSettings.workspaceToolPersonaExpertise,
      boundaries: nextSettings.workspaceToolPersonaBoundaries,
      operatingInstructions: nextSettings.workspaceToolPersonaOperatingInstructions,
    });
    setPersona({ ...serverPersona, templateId });

    setUserProfile({
      name: nextSettings.workspaceToolUserProfileName,
      role: nextSettings.workspaceToolUserProfileRole,
      preferences: nextSettings.workspaceToolUserProfilePreferences,
      context: nextSettings.workspaceToolUserProfileContext,
    });
  };

  const loadWorkspaces = async () => {
    setWorkspaceLoading(true);
    setWorkspaceError('');
    try {
      const res = await fetch('/api/workspace-tool/workspaces');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load workspaces');
      }

      const nextWorkspaces: WorkspaceToolWorkspaceRecord[] = Array.isArray(data.workspaces)
        ? data.workspaces.filter((workspace: unknown): workspace is WorkspaceToolWorkspaceRecord => {
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

  // Fetches the full DTO (with messages/analytics/contextSummary) for a single
  // session via GET /api/chats/[id], caches it, and hydrates the in-memory
  // sidebar row so any consumer that needs the transcript sees it without a
  // refetch. Returns null on failure (never throws).
  const fetchSessionDetail = async (sessionId: string): Promise<WorkspaceToolSession | null> => {
    if (sessionDetailCache[sessionId]?.messages?.length) {
      return sessionDetailCache[sessionId];
    }
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(sessionId)}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const detail = normalizeWorkspaceToolSession(await res.json());
      if (detail) {
        setSessionDetailCache(prev => ({ ...prev, [sessionId]: detail }));
        updateSessionRecord(detail);
      }
      return detail;
    } catch (error) {
      if (!(error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError'))) {
        console.error('Failed to load WorkSpaces session detail:', error);
      }
      return null;
    }
  };

  // Loads the active session's transcript. The list endpoint returns lean rows
  // (no `messages`) for the sidebar, so the active session's messages are
  // loaded lazily on open/switch. Never throws: a failure blanks the chat area
  // but does not break init.
  const loadActiveSessionMessages = async (sessionId: string): Promise<void> => {
    activeSessionLoadRef.current = sessionId;
    setSessionMessagesLoading(true);
    try {
      const detail = await fetchSessionDetail(sessionId);
      // Stale response: the user switched to another session while this was in flight.
      if (activeSessionLoadRef.current !== sessionId) return;
      setChatHistory(detail ? sanitizeWorkspaceToolMessages(detail.messages || []) : []);
    } finally {
      if (activeSessionLoadRef.current === sessionId) {
        setSessionMessagesLoading(false);
      }
    }
  };

  const loadSessions = async (options: { restoreActive?: boolean } = {}) => {
    const res = await fetch('/api/chats?surface=workspace-tool', {
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Failed to load WorkSpaces sessions');

    const nextSessions = sanitizeWorkspaceToolSessions(data);
    setSessions(nextSessions);
    setSelectedSessionIds(current => current.filter(id => nextSessions.some(session => session?.id === id)));

    // Refresh-only callers (folder/tag ops) just need the updated list; they
    // must not wipe the active thread's chat history, which the lean list no
    // longer carries. Keep the footer info fresh from the lean row.
    if (!options.restoreActive) {
      const current = nextSessions.find(session => session?.id === currentSessionId);
      if (current) {
        setSelectedSessionInfo(`${current.title} · updated ${formatTimestamp(current.updatedAt)}`);
      }
      return;
    }

    const storedSelection = getStoredCurrentSessionSelection();

    if (storedSelection === WORKSPACE_TOOL_DRAFT_TASK_ID) {
      activeSessionLoadRef.current = null;
      setCurrentSessionId(null);
      setRagFolderPath(null);
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
      // The lean list no longer carries `messages`; hydrate the transcript via
      // the single-session endpoint so the sidebar list stays cheap to load.
      setChatHistory([]);
      // Restore the RAG draft so reopened WorkSpaces threads re-hydrate the
      // composer with the last search text. The user's current ragEnabled toggle
      // is preserved; toggling it on and sending re-runs the search. The saved
      // ragQuery may carry a `folder:<path>` prefix — split it back out so the
      // Folders button shows the scoped folder and the composer stays clean.
      const restored = splitFolderPrefix(nextSession.ragQuery);
      setRagFolderPath(restored.folder);
      setMessage(restored.query);
      setCanvasSearchQuery('');
      loadCanvasArtifacts(nextSession.id, { query: '' });
      setSelectedSessionInfo(`${nextSession.title} · updated ${formatTimestamp(nextSession.updatedAt)}`);
      void loadActiveSessionMessages(nextSession.id);
    } else {
      activeSessionLoadRef.current = null;
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
    const res = await fetch('/api/folders', { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    setFolders(Array.isArray(data) ? data : []);
  };

  const loadChatTags = async () => {
    const res = await fetch('/api/chat-tags', { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    setTags(Array.isArray(data) ? data : []);
  };

  const loadMemory = async (excludeSessionId?: string) => {
    const generation = ++memoryLoadRef.current;
    setMemoryContext('');
    setHasMemory(false);
    try {
      const query = excludeSessionId ? `?excludeSessionId=${encodeURIComponent(excludeSessionId)}` : '';
      const res = await fetch(`/api/workspace-tool/memory${query}`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`Memory load failed: ${res.status}`);
      const data = await res.json();
      if (generation !== memoryLoadRef.current) return;
      if (data.memoryContext || data.longTermMemory) {
        const combined = [data.memoryContext, data.longTermMemory].filter(Boolean).join('\n\n---\n\n');
        setMemoryContext(combined);
        setHasMemory(true);
      } else {
        setMemoryContext('');
        setHasMemory(false);
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
      const res = await fetch('/api/workspace-tool/automation');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const missingPermissions = Array.isArray(data.missingPermissions)
          ? data.missingPermissions.filter((entry: unknown): entry is string => typeof entry === 'string')
          : [];
        if (res.status === 403 && missingPermissions.includes('workspace-tool.automation')) {
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
      const res = await fetch('/api/workspace-tool/automation', {
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

  const loadModels = async (nextProvider = provider, nextBaseUrl = baseUrl, ollamaHost = settings?.ollamaUseCloudApi ? 'https://ollama.com' : (settings?.ollamaHost || 'http://127.0.0.1:11434')) => {
    setModelsLoading(true);
    try {
      const res = await fetch('/api/workspace-tool/models', {
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

      const savedModel = nextSettingsModel(nextModels, settings?.workspaceToolModel || '', selectedModel);
      if (savedModel !== selectedModel) {
        setSelectedModel(savedModel);
      }

      if (savedModel && savedModel !== (settings?.workspaceToolModel || '')) {
        void saveSettingsPatch({ workspaceToolModel: savedModel });
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
      const res = await fetch('/api/workspace-tool/verify', {
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
      // Keep-alive means "keep this model resident", so when it is on and the
      // selected local model is not currently loaded, load it now and pin it
      // for the keep-alive window. A user-initiated "Stop model" suppresses
      // this so an explicit stop is not immediately undone.
      if (
        settings?.modelKeepAlive
        && provider === 'ollama'
        && data.online
        && data.selectedModelLoaded === false
        && Date.now() >= keepLoadedSuppressedUntilRef.current
      ) {
        void keepSelectedModelLoaded(modelName, host);
      }
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

  const keepSelectedModelLoaded = async (modelName = selectedModel, host = settings?.ollamaHost || 'http://127.0.0.1:11434') => {
    if (!modelName) return;
    try {
      const res = await fetch('/api/ollama/keep-loaded', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, host }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to keep model loaded');
      }
      void refreshOllamaHealth(modelName, host);
    } catch (error) {
      console.error('Keep-loaded error:', error);
    }
  };

  function nextSettingsModel(nextModels: WorkspaceToolModel[], saved: string, fallback: string) {
    if (saved) return saved;
    if (fallback && nextModels.some(model => model.name === fallback)) return fallback;
    return nextModels[0]?.name || fallback || '';
  }

  const saveSettingsPatch = async (patch: Partial<WorkspaceToolSettings>) => {
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
      const parsed = parseWorkspaceToolSettingsResponse(data as Record<string, unknown>);
      const nextSettings = parsed.settings;

      setSettings(nextSettings);
      setEffectiveToolAccess(parsed.effectiveToolAccess);
      setProvider(nextSettings.workspaceToolProvider);
      setBaseUrl(nextSettings.workspaceToolBaseUrl);
      setSelectedModel(nextSettings.workspaceToolModel);
      applyTheme(nextSettings.theme);
      setDraftSessionAutoContinueMode(current => currentSessionId ? current : nextSettings.workspaceToolSessionAutoContinueDefault);
      setDraftSessionAutoContinueMaxSteps(current => currentSessionId ? current : nextSettings.workspaceToolSessionAutoContinueMaxSteps);
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
      const res = await fetch('/api/workspace-tool/workspaces', {
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

      const nextWorkspace = data.workspace as WorkspaceToolWorkspaceRecord | undefined;
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

  const updateCurrentWorkspace = async (patch: Partial<Pick<WorkspaceToolWorkspaceRecord, 'name' | 'description' | 'autoGitBackup'>>) => {
    if (!currentWorkspace) return;
    setWorkspaceError('');
    try {
      const res = await fetch(`/api/workspace-tool/workspaces/${currentWorkspace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to update workspace');
      }
      const nextWorkspace = data.workspace as WorkspaceToolWorkspaceRecord | undefined;
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
      const isNetworkError = (error: unknown): boolean => {
        if (error instanceof TypeError) return true
        if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) return true
        const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
        return message.includes('network')
          || message.includes('failed to fetch')
          || message.includes('timeout')
          || message.includes('aborted')
      }

      // Per-call retry with backoff: a transient failure retries only the
      // failing call, not the whole init bundle (avoids re-fetching the
      // successful endpoints on every attempt).
      const withRetry = async <T,>(fn: () => Promise<T>, attempts = 3): Promise<T> => {
        for (let attempt = 1; ; attempt += 1) {
          try {
            return await fn()
          } catch (error) {
            if (isNetworkError(error) && attempt < attempts) {
              await new Promise(resolve => window.setTimeout(resolve, 500 * attempt))
              continue
            }
            throw error
          }
        }
      }

      try {
        // Critical path: settings/folders/tags/sessions are mutually
        // independent (each only needs the auth cookie), so fan them out
        // together instead of gating the chat list behind the metadata triple.
        await Promise.all([
          withRetry(() => loadSettings()),
          withRetry(() => loadFolders()),
          withRetry(() => loadChatTags()),
          withRetry(() => loadSessions({ restoreActive: true })),
        ])
      } catch (error) {
        console.error('Failed to initialize WorkSpaces workspace:', error)
      }
      // Defer non-critical services so they cannot block the chat UI.
      window.setTimeout(() => {
        void (async () => {
          try {
            await Promise.all([
              loadMemory().catch(() => undefined),
              loadShellSettings().catch(() => undefined),
              loadWorkspaces().catch(() => undefined),
              loadAutomationState({ silent: true }).catch(() => undefined),
            ]);
          } catch (error) {
            console.error('Failed to load deferred WorkSpaces services:', error);
          }
        })();
      }, 100);
    })();
    // load only once on mount
  }, []);

  // Branch-compare reads messages/analytics/contextSummary from the selected
  // sessions, which the lean sidebar list no longer carries. Hydrate the full
  // DTO for each compared session on demand when the compare modal is open.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!branchCompareOpen) return;
    const leftId = branchCompareLeftId || currentSessionId || '';
    const rightId = branchCompareRightId;
    [leftId, rightId].forEach(id => {
      if (!id || sessionDetailCache[id]?.messages?.length) return;
      void fetchSessionDetail(id);
    });
  }, [branchCompareOpen, branchCompareLeftId, branchCompareRightId, currentSessionId, sessionDetailCache]);
  /* eslint-enable react-hooks/exhaustive-deps */

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
    if (settings?.workspaceToolUwafLiveBrowser !== false) return;
    setBrowserModalOpen(false);
    setBrowserInterrupted(false);
    browserInterruptedRef.current = false;
  }, [settings?.workspaceToolUwafLiveBrowser]);

  useEffect(() => {
    if (settings?.workspaceToolUwafLiveBrowser !== true) return;
    setBrowserLiveStatus('connecting');
  }, [settings?.workspaceToolUwafLiveBrowser, currentSessionId, uwafBrowserMode]);

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
    // Skip eager model discovery when Ollama is unreachable from inside Docker.
    const isLikelyUnreachableOllama = provider === 'ollama'
      && !settings.ollamaUseCloudApi
      && settings.ollamaHost
      && /^(http:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(settings.ollamaHost);
    if (isLikelyUnreachableOllama) {
      setModels([]);
      setModelsLoading(false);
      return;
    }
    const timer = window.setTimeout(() => {
      void loadModels(provider, baseUrl);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [settings?.workspaceToolProvider, settings?.workspaceToolBaseUrl, settings?.ollamaHost, settings?.ollamaUseCloudApi, apiKeyLoaded, apiKey]);
  /* eslint-enable react-hooks/exhaustive-deps */

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!settings || !apiKeyLoaded) return;
    if (provider === 'ollama') return;
    const timer = window.setTimeout(() => {
      void verifyConnection(provider, baseUrl, apiKey, settings.ollamaHost);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [provider, baseUrl, settings?.workspaceToolProvider, settings?.workspaceToolBaseUrl, settings?.ollamaHost, apiKeyLoaded, apiKey]);
  /* eslint-enable react-hooks/exhaustive-deps */

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    // A different model (or host) starts a fresh keep-alive residency window,
    // so any prior "Stop model" suppression no longer applies.
    keepLoadedSuppressedUntilRef.current = 0;
    if (!settings || provider !== 'ollama') {
      setOllamaHealth(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void refreshOllamaHealth(selectedModel, settings.ollamaHost);
    }, 1000);
    const interval = window.setInterval(() => {
      void refreshOllamaHealth(selectedModel, settings.ollamaHost);
    }, 30000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [provider, selectedModel, settings?.ollamaHost, settings?.ollamaUseCloudApi]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const resetComposerDraftState = () => {
    setMessage('');
    setPendingImages([]);
    setPendingAttachments([]);
    setAttachmentError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleStopStreaming = () => {
    if (autoContinueTimerRef.current) clearTimeout(autoContinueTimerRef.current);
    autoContinueTimerRef.current = null;
    autoContinueCountRef.current = 0;
    setAutoContinuePending(false);
    if (!abortControllerRef.current) return;
    abortControllerRef.current.abort();
    abortControllerRef.current = null;
    setChatHistory(prev => pruneInterruptedMessages(prev));
    setLiveStats(null);
    setStreamPhase(null);
    setIsStreaming(false);
  };

  const updateAgentPreferences = (patch: Partial<WorkspaceToolAgentPreferences>) => {
    setAgentPreferences(current => ({
      ...current,
      ...patch,
    }));
  };

  const activeTaskStateId = currentSessionId ?? WORKSPACE_TOOL_DRAFT_TASK_ID;
  const taskState = taskStates[activeTaskStateId] ?? DEFAULT_WORKSPACE_TOOL_TASK_STATE;

  const updateTaskState = (patch: Partial<WorkspaceToolTaskState> | ((current: WorkspaceToolTaskState) => WorkspaceToolTaskState)) => {
    setTaskStates(current => {
      const existing = current[activeTaskStateId] ?? DEFAULT_WORKSPACE_TOOL_TASK_STATE;
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
    return latestAssistantMessage ? extractWorkspaceToolChecklistSuggestions(latestAssistantMessage.content) : [];
  }, [chatHistory]);

  const replaceChecklistFromLatestAssistant = () => {
    if (latestAssistantChecklistSuggestion.length === 0) return;
    updateTaskState(current => ({
      ...current,
      checklist: createWorkspaceToolChecklistItems(latestAssistantChecklistSuggestion),
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

  const selectWorkspaceToolModel = async (modelName: string) => {
    setSelectedModel(modelName);
    setModelControlNote('');
    setModelMenuOpen(false);
    setMobileModelMenuOpen(false);
    try {
      await saveSettingsPatch({ workspaceToolModel: modelName });
    } catch {
      // Ignore inline selection persistence errors; footer surfaces failures.
    }
  };

  const getModelFavoriteKey = (modelName: string, modelProvider = provider) => `${modelProvider}:${modelName}`;

  // Persist the favorite-model list to the server. Lighter than
  // `saveSettingsPatch` (no theme/model/draft re-application, no
  // configSaving spinner) so a star toggle is a cheap, non-disruptive sync.
  // Server is authoritative; on success we reconcile local state to the
  // server-normalized list (deduped/capped) to stay exactly in sync.
  const saveFavoriteModels = async (next: string[]) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceToolFavoriteModels: next }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return;
      const data = await res.json();
      const parsed = parseWorkspaceToolSettingsResponse(data as Record<string, unknown>);
      const reconciled = parsed.settings.workspaceToolFavoriteModels;
      setSettings(prev => prev ? { ...prev, workspaceToolFavoriteModels: reconciled } : prev);
      setFavoriteModels(reconciled);
    } catch {
      // Best-effort: a failed sync leaves the local star in place; the
      // next successful toggle or settings load re-converges with server.
    }
  };

  const toggleFavoriteModel = (event: React.MouseEvent, modelName: string) => {
    event.preventDefault();
    event.stopPropagation();
    const key = getModelFavoriteKey(modelName);
    setFavoriteModels(current => {
      const next = current.includes(key)
        ? current.filter(entry => entry !== key)
        : [...current, key];
      void saveFavoriteModels(next);
      return next;
    });
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

  const switchSession = async (session: WorkspaceToolSession) => {
    if (isStreaming) {
      setSelectedSessionInfo('Stop the current WorkSpaces run before switching task threads.');
      return;
    }
    handleStopStreaming();
    closeMobileChrome();
    requestScrollReset();
    setCurrentSessionId(session.id);
    // Re-scope memory to this session: exclude the newly-active session so its
    // own transcript is never re-injected as cross-session "memory".
    void loadMemory(session.id);
    setCanvasSearchQuery('');
    loadCanvasArtifacts(session.id, { query: '' });
    resetComposerDraftState();
    // Restore the RAG draft after resetComposerDraftState so the saved query
    // is what the user sees, not a freshly cleared composer. Split any
    // `folder:<path>` prefix back out so the Folders button reflects the
    // folder this thread was scoped to.
    const restored = splitFolderPrefix(session.ragQuery);
    setRagFolderPath(restored.folder);
    setMessage(restored.query);
    setLastSubmission(null);
    setSelectedSessionInfo(`${session.title} · updated ${formatTimestamp(session.updatedAt)}`);
    setSessionMenuOpen(null);
    setCreateMenuOpen(false);
    setRenamingSessionId(null);
    setRenameValue('');
    if (session.messages?.length) {
      // Fast path: transcript already in memory (branched or just-created session).
      activeSessionLoadRef.current = session.id;
      setChatHistory(sanitizeWorkspaceToolMessages(session.messages));
      setSessionMessagesLoading(false);
    } else {
      // Lean list row: fetch the transcript for the selected session.
      setChatHistory([]);
      await loadActiveSessionMessages(session.id);
    }
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
    baseMessages: WorkspaceToolMessage[],
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
        surface: 'workspace-tool',
        autoContinueMode: effectiveSessionAutoContinueMode,
        autoContinueMaxSteps: effectiveSessionAutoContinueMaxSteps,
        ...(rag ?? {}),
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to create WorkSpaces session');
    }

    const session = normalizeWorkspaceToolSession(data.session);
    if (!session) {
      throw new Error('Failed to normalize created WorkSpaces session');
    }
    setSessions(prev => {
      const safePrev = sanitizeWorkspaceToolSessions(prev);
      const existingIndex = safePrev.findIndex(item => item?.id === session.id);
      if (existingIndex === -1) return [session, ...safePrev];
      const next = [...safePrev];
      next[existingIndex] = session;
      return next;
    });
    return session;
  };

  const updateSessionRecord = (nextSession: WorkspaceToolSession) => {
    setSessions(prev => {
      const safePrev = sanitizeWorkspaceToolSessions(prev);
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
        surface: 'workspace-tool',
        ...patch,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : 'Failed to update session intelligence');
    }

    const normalized = normalizeWorkspaceToolSession(data.session);
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
        surface: 'workspace-tool',
        // The sidebar row is lean (no `messages`); use the live chat history,
        // which is the authoritative transcript for the active session, so a
        // memory clear/refresh never writes an empty message array.
        messages: stripAttachmentVisionData(sanitizeWorkspaceToolMessages(chatHistory)),
        clearContextSummary: action === 'clear',
        refreshContextSummary: action === 'refresh',
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : `Failed to ${action} memory`);
    }

    const normalized = normalizeWorkspaceToolSession(data.session);
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
    handleStopStreaming();
    void loadMemory();
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
    setDraftSessionAutoContinueMode(settings?.workspaceToolSessionAutoContinueDefault || 'manual');
    setDraftSessionAutoContinueMaxSteps(settings?.workspaceToolSessionAutoContinueMaxSteps || 3);
    setTaskStates(current => ({
      ...current,
      [WORKSPACE_TOOL_DRAFT_TASK_ID]: DEFAULT_WORKSPACE_TOOL_TASK_STATE,
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

      // Keep-alive normally re-loads a missing selected model. An explicit
      // "Stop model" overrides that for one keep-alive window so the model
      // stays unloaded until the user actually uses it again.
      const keepAliveWindowMs = settings?.modelKeepAlive ? parseKeepAliveMs(settings?.ollamaKeepAlive || '') : 0;
      keepLoadedSuppressedUntilRef.current = keepAliveWindowMs > 0 ? Date.now() + keepAliveWindowMs : 0;

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
        window.sessionStorage.setItem(WORKSPACE_TOOL_INTERNET_STORAGE, String(nextValue));
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
        window.sessionStorage.setItem(WORKSPACE_TOOL_UNRESTRICTED_STORAGE, String(nextValue));
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
        window.sessionStorage.setItem(WORKSPACE_TOOL_UNCENSORED_STORAGE, String(nextValue));
      } catch {
        // Ignore browser storage failures.
      }
      return nextValue;
    });
  };

  const toggleAccountant = () => {
    setAccountantEnabled(prev => {
      const nextValue = !prev;
      try {
        window.sessionStorage.setItem(WORKSPACE_TOOL_ACCOUNTANT_STORAGE, String(nextValue));
      } catch {
        // Ignore browser storage failures.
      }
      return nextValue;
    });
  };

  const toggleImageGeneration = () => {
    setImageGenerationEnabled(prev => {
      const nextValue = !prev;
      try {
        window.sessionStorage.setItem(WORKSPACE_TOOL_IMAGE_GEN_STORAGE, String(nextValue));
      } catch {
        // Ignore browser storage failures.
      }
      return nextValue;
    });
  };

  const setInternetAccess = (nextValue: boolean) => {
    try {
      window.sessionStorage.setItem(WORKSPACE_TOOL_INTERNET_STORAGE, String(nextValue));
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

  const generateSessionSummary = async (sessionId: string, title: string, messages: WorkspaceToolMessage[], objective?: string) => {
    try {
      await fetch('/api/workspace-tool/session-summary', {
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
      const res = await fetch('/api/workspace-tool/shell/settings');
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

  const { appendShellOutput, truncateApprovalPreview, executeShellCommand, requestShellCommand, executeFilesystemAction, requestFilesystemAction, executeCodeAction, requestCodeExecution, executeBrowserAction, requestBrowserAction, requestUwafBrowserAction, waitForHumanBrowserAssistance, executeUwafBrowserAction, requestWebContext, executeTaxReturnAction, requestTaxReturnAction, executePdfDocumentAction, requestPdfDocumentAction, executeWorkbookDocumentAction, requestWorkbookDocumentAction, executeWordDocumentAction, requestWordDocumentAction, executeCsvDocumentAction, requestCsvDocumentAction, executeEmailDocumentAction, requestEmailDocumentAction, executeMarkdownDocumentAction, requestMarkdownDocumentAction, executeSlidesDocumentAction, requestSlidesDocumentAction, executeArchiveDocumentAction, requestArchiveDocumentAction, executeCalendarDocumentAction, requestCalendarDocumentAction, executeMermaidDocumentAction, requestMermaidDocumentAction, executeFetchSummarizeAction, executeImageGenerationAction, handleToolApprove, handleToolReject } = useWorkspaceTools({ setShellOutput, setExecutingCommand, currentSessionId, settings, pendingApprovalResolverRef, setPendingApproval, currentWorkspace, uwafBrowserMode, setBrowserModalOpen, setBrowserTakeoverRequestId, browserInterruptedRef, ragFolderPath, pendingApproval });


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
    setSessions(prev => sanitizeWorkspaceToolSessions(prev).filter(session => session?.id !== sessionId));
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
      body: JSON.stringify({ id: sessionId, pinned: !pinned, surface: 'workspace-tool' }),
    });
    setSessions(prev => {
      const updated = sanitizeWorkspaceToolSessions(prev).map(session => session?.id === sessionId ? { ...session, pinned: !pinned } : session);
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
      body: JSON.stringify({ id: sessionId, title: trimmed, surface: 'workspace-tool' }),
    });
    setSessions(prev => sanitizeWorkspaceToolSessions(prev).map(session => session?.id === sessionId ? { ...session, title: trimmed } : session));
    if (currentSessionId === sessionId) {
      setSelectedSessionInfo(`${trimmed} · updated ${formatTimestamp(Date.now())}`);
    }
    setRenamingSessionId(null);
    setRenameValue('');
    setSessionMenuOpen(null);
  };

  const handleCopySession = async (session: WorkspaceToolSession) => {
    // The sidebar row may be lean (no `messages`); fetch the transcript on demand.
    const sourceMessages = session.messages?.length
      ? session.messages
      : (await fetchSessionDetail(session.id))?.messages || [];
    const text = sanitizeWorkspaceToolMessages(sourceMessages)
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
      await copyToClipboard(text);
      setSelectedSessionInfo(`Copied "${session.title}" to clipboard.`);
    } catch {
      setSelectedSessionInfo(`Could not copy "${session.title}" to clipboard.`);
    }
    setSessionMenuOpen(null);
  };

  const handleCopyMessage = async (message: WorkspaceToolMessage) => {
    const text = message.content || '';
    try {
      await copyToClipboard(text);
      setSelectedSessionInfo('Copied message to clipboard.');
    } catch {
      setSelectedSessionInfo('Could not copy message to clipboard.');
    }
  };

  const handleBranchFromMessage = async (messageId?: string, branchLabel?: string, sessionIdOverride?: string) => {
    if (!settings?.workspaceToolSessionBranchingEnabled) {
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

      const branchedSession = normalizeWorkspaceToolSession(data.session);
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
    if (!settings?.workspaceToolSessionBranchingEnabled) {
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
        body: JSON.stringify({ id: sessionId, folderId, surface: 'workspace-tool' }),
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
    const safeSessions = sanitizeWorkspaceToolSessions(sessions);
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
    setSessions(prev => sanitizeWorkspaceToolSessions(prev).filter(session => !ids.includes(session.id)));
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
      body: JSON.stringify({ surface: 'workspace-tool' }),
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

  const getAttachmentContent = (attachment: WorkspaceToolFileAttachment) =>
    attachment.text ?? attachment.content ?? '';
  const getAttachmentSize = (attachment: WorkspaceToolFileAttachment) =>
    typeof attachment.size === 'number' ? attachment.size : 0;

  const extractAttachment = async (file: File): Promise<WorkspaceToolFileAttachment> => {
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

  const buildAttachmentContext = (attachments: WorkspaceToolFileAttachment[] = [], images: WorkspaceToolImageAttachment[] = [], userText = '') => {
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
      const nextImages: WorkspaceToolImageAttachment[] = [];
      const nextAttachments: WorkspaceToolFileAttachment[] = [];

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

  const { streamAssistantResponse, handleSendMessage } = useAgentLoop({ startTimeRef, tokenCountRef, setLiveStats, setStreamPhase, abortControllerRef, selectedModel, currentWorkspace, provider, baseUrl, settings, apiKey, unrestrictedEnabled, uncensoredEnabled, accountantEnabled, imageGenerationEnabled, modelSupportsVision, message, internetEnabled, pendingImages, pendingAttachments, isStreaming, autoContinueCountRef, autoContinueTimerRef, currentSessionId, taskState, buildAttachmentContext, ragFolderPath, chatHistory, pinToBottom, setMessage, setPendingImages, setPendingAttachments, setModelControlNote, setLastSubmission, setTaskStates, setChatHistory, setCurrentSessionId, setIsStreaming, ragEnabled, createSession, agentPreferences, memoryContext, filesystemEnabled, allowedFilesystemPaths, requestFilesystemAction, requestWebContext, requestCodeExecution, requestBrowserAction, requestUwafBrowserAction, setUwafCurrentUrl, setUwafCurrentTitle, executeTaxReturnAction, requestTaxReturnAction, loadCanvasArtifacts, requestPdfDocumentAction, requestWorkbookDocumentAction, requestWordDocumentAction, requestCsvDocumentAction, requestEmailDocumentAction, executeFetchSummarizeAction, requestMarkdownDocumentAction, requestSlidesDocumentAction, requestArchiveDocumentAction, requestCalendarDocumentAction, requestMermaidDocumentAction, shellEnabled, requestShellCommand, executeImageGenerationAction, effectiveSessionAutoContinueMode, effectiveSessionAutoContinueMaxSteps, currentSession, generateSessionSummary, setSessions, setSelectedSessionInfo, setAutoContinuePending, persistSessionIntelligenceSafe });


  return {
    agentPreferences,
    sessions,
    currentSession,
    branchCompareLeftId,
    currentSessionId,
    branchCompareRightId,
    setBranchCompareLeftId,
    setBranchCompareRightId,
    selectedFolderId,
    selectedTagId,
    sessionListPage,
    selectedSessionIds,
    setSessionListPage,
    selectedModel,
    modelsLoading,
    models,
    provider,
    favoriteModels,
    getModelFavoriteKey,
    ollamaHealth,
    ollamaHealthLoading,
    settings,
    connectionStatus,
    uncensoredEnabled,
    unrestrictedEnabled,
    internetEnabled,
    ragEnabled,
    taskState,
    effectiveSessionAutoContinueMode,
    effectiveSessionAutoContinueMaxSteps,
    persona,
    userProfile,
    automationNudges,
    automationRuns,
    automationPermissionGranted,
    automationHeartbeat,
    automationSchedules,
    automationMonitors,
    deferredChatHistory,
    shellOutput,
    isStreaming,
    liveStats,
    streamPhase,
    handleBranchFromMessage,
    handleCopyMessage,
    canvasArtifactNames,
    view,
    accountantEnabled,
    uwafBrowserEnabled,
    uwafBrowserMode,
    isMobileViewport,
    toggleRightRail,
    setMobileHeaderMenuOpen,
    setMobileModelMenuOpen,
    mobileRailOpen,
    mobileModelMenuOpen,
    selectWorkspaceToolModel,
    toggleFavoriteModel,
    mobileHeaderMenuOpen,
    toggleInternetAccess,
    setRagAccess,
    toggleUnrestricted,
    toggleUncensored,
    toggleAccountant,
    imageGenerationEnabled,
    toggleImageGeneration,
    stopSelectedModel,
    stoppingModel,
    railCollapsed,
    modelMenuButtonRef,
    setModelMenuOpen,
    modelMenuOpen,
    modelControlNote,
    headerModeMenuOpen,
    modesMenuButtonRef,
    setHeaderModeMenuOpen,
    setRagFolderPopoverOpen,
    ragFolderPopoverRef,
    switchUwafBrowserMode,
    ragFolderButtonRef,
    ragFolderPath,
    setRagFolderPath,
    ragFolderPopoverOpen,
    setMobileRailOpen,
    refreshOllamaHealth,
    lastSubmission,
    retryLastSubmission,
    settingsContent,
    knowledgeBaseContent,
    chatAreaRef,
    handleChatScroll,
    setWorkspaceControlsModalOpen,
    openAutomationNudgeSession,
    dismissAutomationNudge,
    automationSaving,
    hasMemory,
    messagesEndRef,
    showScrollToBottom,
    scrollToBottom,
    continuationPending,
    handleSendMessage,
    autoContinuePending,
    handleNewSession,
    fileInputRef,
    handleFileSelect,
    processingAttachments,
    pendingImages,
    pendingAttachments,
    attachmentError,
    updatePendingImageMode,
    removePendingImage,
    removePendingAttachment,
    setAttachmentError,
    composerRef,
    message,
    setMessage,
    handleStopStreaming,
    closeMobileChrome,
    onNavigateToWorkspace,
    onNavigateToKnowledgeBase,
    onNavigateToSettings,
    onNavigateToCoding,
    sessionMenuOpen,
    setSessionMenuOpen,
    createMenuOpen,
    setCreateMenuOpen,
    setSessionSelectionMode,
    setSelectedSessionIds,
    setRenamingSessionId,
    sessionSelectionMode,
    createMenuButtonRef,
    setShowNewFolderModal,
    setShowNewTagModal,
    setSelectedFolderId,
    folders,
    tags,
    setSelectedTagId,
    handleClearSelectedSessions,
    handleClearAllSessions,
    renamingSessionId,
    handleRenameSession,
    renameValue,
    setRenameValue,
    toggleSessionSelection,
    switchSession,
    sessionMenuButtonRefs,
    handlePinSession,
    openBranchCompare,
    handleCopySession,
    handleDeleteSession,
    handleAddToFolder,
    handleRemoveTagFromSession,
    handleAddTagToSession,
    workspaceControlsModalOpen,
    currentWorkspace,
    shellGranted,
    shellEnabled,
    workspaceSummary,
    loadWorkspaces,
    workspaceLoading,
    setCurrentWorkspaceId,
    workspaces,
    updateCurrentWorkspace,
    newWorkspaceName,
    setNewWorkspaceName,
    newWorkspaceDescription,
    setNewWorkspaceDescription,
    createWorkspace,
    creatingWorkspace,
    workspaceError,
    chatHistory,
    updateCurrentThreadMemorySafe,
    activeAgentMode,
    setAgentModePanelOpen,
    agentModePanelOpen,
    updateAgentPreferences,
    setResponseStylePanelOpen,
    responseStylePanelOpen,
    setDraftSessionAutoContinueMode,
    persistSessionIntelligenceSafe,
    setDraftSessionAutoContinueMaxSteps,
    setTaskStatePanelOpen,
    taskStatePanelOpen,
    latestAssistantChecklistSuggestion,
    replaceChecklistFromLatestAssistant,
    updateTaskState,
    addChecklistItem,
    toggleChecklistItem,
    updateChecklistItem,
    removeChecklistItem,
    setWorkspaceBriefPanelOpen,
    workspaceBriefPanelOpen,
    setPersonaPanelOpen,
    personaPanelOpen,
    setPersona,
    saveSettingsPatch,
    setUserProfilePanelOpen,
    userProfilePanelOpen,
    setUserProfile,
    setShellSettingsOpen,
    setAutomationPanelOpen,
    automationPanelOpen,
    loadAutomationState,
    automationLoading,
    automationWorker,
    automationActionRequired,
    automationError,
    saveHeartbeatConfig,
    setAutomationHeartbeat,
    toggleAutomationSchedule,
    deleteAutomationScheduleRecord,
    newScheduleName,
    setNewScheduleName,
    newSchedulePrompt,
    setNewSchedulePrompt,
    newScheduleCron,
    setNewScheduleCron,
    newScheduleTimezone,
    setNewScheduleTimezone,
    newScheduleDeliveryMode,
    setNewScheduleDeliveryMode,
    createAutomationScheduleRecord,
    toggleAutomationMonitor,
    deleteAutomationMonitorRecord,
    newMonitorName,
    setNewMonitorName,
    newMonitorKind,
    setNewMonitorKind,
    newMonitorTriggerMode,
    setNewMonitorTriggerMode,
    newMonitorTarget,
    setNewMonitorTarget,
    newMonitorIntervalSeconds,
    setNewMonitorIntervalSeconds,
    newMonitorExpectedPattern,
    setNewMonitorExpectedPattern,
    newMonitorDeliveryMode,
    setNewMonitorDeliveryMode,
    createAutomationMonitorRecord,
    wakeEventTitle,
    setWakeEventTitle,
    wakeEventMessage,
    setWakeEventMessage,
    wakeEventDeliveryMode,
    setWakeEventDeliveryMode,
    createAutomationWakeEventRecord,
    markAutomationNudgesSeen,
    setWorkspaceCapabilitiesOpen,
    workspaceCapabilitiesOpen,
    filesystemAccessBadge,
    filesystemWriteBadge,
    codeSandboxBadge,
    browserControlBadge,
    filesystemAccessSummary,
    filesystemGranted,
    filesystemEnabled,
    allowedFilesystemPaths,
    filesystemWriteSummary,
    filesystemWriteEnabled,
    allowedWritablePaths,
    codeSandboxSummary,
    codeGranted,
    codeExecutionEnabled,
    browserControlSummary,
    browserGranted,
    browserEnabled,
    browserMode,
    canvasArtifacts,
    togglePanel,
    isPanelExpanded,
    setCanvasArtifacts,
    deleteArtifactById,
    loadCanvasArtifacts,
    canvasSearchQuery,
    canvasNextCursor,
    setCanvasSearchQuery,
    canvasHasMore,
    canvasLoading,
    canvasError,
    canvasTotalCount,
    workspaceFilesPanelKey,
    currentWorkspaceId,
    setWorkspaceFilesError,
    workspaceFilesError,
    browserLiveStatus,
    browserModalOpen,
    uwafCurrentUrl,
    uwafCurrentTitle,
    setBrowserInterrupted,
    setBrowserLiveStatus,
    setBrowserModalOpen,
    browserTakeoverRequestId,
    configSaving,
    sessionMessagesLoading,
    configError,
    connectionSummary,
    selectedSessionInfo,
    showNewFolderModal,
    newFolderName,
    setNewFolderName,
    handleCreateFolder,
    setNewFolderColor,
    newFolderColor,
    showNewTagModal,
    newTagName,
    setNewTagName,
    handleCreateTag,
    setNewTagColor,
    newTagColor,
    branchCompareOpen,
    setBranchCompareOpen,
    pendingApproval,
    handleToolApprove,
    handleToolReject,
    shellSettingsOpen,
    loadSettings,
    loadShellSettings,
  };
}

export default function WorkspaceToolWorkspace(props: WorkspaceToolWorkspaceProps) {
  const controller = useWorkspaceController(props);
  return <WorkspaceView {...controller} />;
}
