import type { CanvasArtifactRevisionRecord } from '@/lib/canvas-artifacts';
import { isTextArtifactMimeType } from '@/lib/canvas-download';
import {
DEFAULT_WORKSPACE_TOOL_TASK_STATE,
WORKSPACE_TOOL_AGENT_MODE_OPTIONS,
WORKSPACE_TOOL_RESPONSE_STYLE_OPTIONS
} from '@/lib/workspace-tool-agent';
import {
applyPersonaTemplate,
type WorkspaceToolPersonaTemplateId
} from '@/lib/workspace-tool-persona';
import { AlertCircle,BookOpen,Bot,Calculator,Check,ChevronDown,ChevronLeft,ChevronRight,ChevronUp,Copy,Database,Folder,Globe,Image as ImageIcon,ListTodo,Loader2,Menu,MessageSquare,MoreHorizontal,Paperclip,Pin,Plus,Redo2,RefreshCw,Send,Server,Settings,Shield,Square,Star,Tag,Terminal,Trash2,Wand2,Wifi,WifiOff,X } from 'lucide-react';
import Image from 'next/image';
import React,{ useEffect,useMemo } from 'react';
import BrowserModal from '../BrowserModal';
import CanvasPanel from '../CanvasPanel';
import HelpHint from '../HelpHint';
import KnowledgeBaseTreePopover from '../KnowledgeBaseTreePopover';
import LiveBrowserView from '../LiveBrowserView';
import ObjectUrlImage from '../ObjectUrlImage';
import { panelIconButtonStyle } from '../panelIconButton';
import Popover from '../Popover';
import ShellCommandModal from '../ShellCommandModal';
import ShellSettingsPanel from '../ShellSettingsPanel';
import UwafNetworkPanel from '../UwafNetworkPanel';
import WorkspaceFilesPanel from '../WorkspaceFilesPanel';
import type { useWorkspaceController } from '../WorkspaceToolWorkspace';
import { IMAGE_ATTACHMENT_MODE_OPTIONS,ImageAttachmentMode,SESSION_PAGE_SIZE,ShellOutputEntry,VisibleChatMessageRow,WorkspaceToolMessage,WorkspaceToolSession,formatAutomationTimestamp,formatLoadedUntil,formatTimestamp,getImageAttachmentSummary,getLatestVisibleAssistantMessage,isVisibleMessage,normalizeToolSources,sanitizeWorkspaceToolMessages,sanitizeWorkspaceToolSessions } from './workspace-support';
export function WorkspaceView({agentPreferences, sessions, currentSession, branchCompareLeftId, currentSessionId, branchCompareRightId, setBranchCompareLeftId, setBranchCompareRightId, selectedFolderId, selectedTagId, sessionListPage, selectedSessionIds, setSessionListPage, selectedModel, modelsLoading, models, provider, favoriteModels, getModelFavoriteKey, ollamaHealth, ollamaHealthLoading, settings, connectionStatus, uncensoredEnabled, unrestrictedEnabled, internetEnabled, ragEnabled, taskState, effectiveSessionAutoContinueMode, effectiveSessionAutoContinueMaxSteps, persona, userProfile, automationNudges, automationRuns, automationPermissionGranted, automationHeartbeat, automationSchedules, automationMonitors, deferredChatHistory, shellOutput, isStreaming, liveStats, streamPhase, handleBranchFromMessage, handleCopyMessage, canvasArtifactNames, view, accountantEnabled, uwafBrowserEnabled, uwafBrowserMode, isMobileViewport, toggleRightRail, setMobileHeaderMenuOpen, setMobileModelMenuOpen, mobileRailOpen, mobileModelMenuOpen, selectWorkspaceToolModel, toggleFavoriteModel, mobileHeaderMenuOpen, toggleInternetAccess, setRagAccess, toggleUnrestricted, toggleUncensored, toggleAccountant, imageGenerationEnabled, toggleImageGeneration, stopSelectedModel, stoppingModel, railCollapsed, modelMenuButtonRef, setModelMenuOpen, modelMenuOpen, modelControlNote, headerModeMenuOpen, modesMenuButtonRef, setHeaderModeMenuOpen, setRagFolderPopoverOpen, ragFolderPopoverRef, switchUwafBrowserMode, ragFolderButtonRef, ragFolderPath, setRagFolderPath, ragFolderPopoverOpen, setMobileRailOpen, refreshOllamaHealth, lastSubmission, retryLastSubmission, settingsContent, knowledgeBaseContent, chatAreaRef, handleChatScroll, setWorkspaceControlsModalOpen, openAutomationNudgeSession, dismissAutomationNudge, automationSaving, hasMemory, messagesEndRef, showScrollToBottom, scrollToBottom, continuationPending, handleSendMessage, autoContinuePending, handleNewSession, fileInputRef, handleFileSelect, processingAttachments, pendingImages, pendingAttachments, attachmentError, updatePendingImageMode, removePendingImage, removePendingAttachment, setAttachmentError, composerRef, message, setMessage, handleStopStreaming, closeMobileChrome, onNavigateToWorkspace, onNavigateToKnowledgeBase, onNavigateToSettings, onNavigateToCoding, sessionMenuOpen, setSessionMenuOpen, createMenuOpen, setCreateMenuOpen, setSessionSelectionMode, setSelectedSessionIds, setRenamingSessionId, sessionSelectionMode, createMenuButtonRef, setShowNewFolderModal, setShowNewTagModal, setSelectedFolderId, folders, tags, setSelectedTagId, handleClearSelectedSessions, handleClearAllSessions, renamingSessionId, handleRenameSession, renameValue, setRenameValue, toggleSessionSelection, switchSession, sessionMenuButtonRefs, handlePinSession, openBranchCompare, handleCopySession, handleDeleteSession, handleAddToFolder, handleRemoveTagFromSession, handleAddTagToSession, workspaceControlsModalOpen, currentWorkspace, shellGranted, shellEnabled, workspaceSummary, loadWorkspaces, workspaceLoading, setCurrentWorkspaceId, workspaces, updateCurrentWorkspace, newWorkspaceName, setNewWorkspaceName, newWorkspaceDescription, setNewWorkspaceDescription, createWorkspace, creatingWorkspace, workspaceError, chatHistory, updateCurrentThreadMemorySafe, activeAgentMode, setAgentModePanelOpen, agentModePanelOpen, updateAgentPreferences, setResponseStylePanelOpen, responseStylePanelOpen, setDraftSessionAutoContinueMode, persistSessionIntelligenceSafe, setDraftSessionAutoContinueMaxSteps, setTaskStatePanelOpen, taskStatePanelOpen, latestAssistantChecklistSuggestion, replaceChecklistFromLatestAssistant, updateTaskState, addChecklistItem, toggleChecklistItem, updateChecklistItem, removeChecklistItem, setWorkspaceBriefPanelOpen, workspaceBriefPanelOpen, setPersonaPanelOpen, personaPanelOpen, setPersona, saveSettingsPatch, setUserProfilePanelOpen, userProfilePanelOpen, setUserProfile, setShellSettingsOpen, setAutomationPanelOpen, automationPanelOpen, loadAutomationState, automationLoading, automationWorker, automationActionRequired, automationError, saveHeartbeatConfig, setAutomationHeartbeat, toggleAutomationSchedule, deleteAutomationScheduleRecord, newScheduleName, setNewScheduleName, newSchedulePrompt, setNewSchedulePrompt, newScheduleCron, setNewScheduleCron, newScheduleTimezone, setNewScheduleTimezone, newScheduleDeliveryMode, setNewScheduleDeliveryMode, createAutomationScheduleRecord, toggleAutomationMonitor, deleteAutomationMonitorRecord, newMonitorName, setNewMonitorName, newMonitorKind, setNewMonitorKind, newMonitorTriggerMode, setNewMonitorTriggerMode, newMonitorTarget, setNewMonitorTarget, newMonitorIntervalSeconds, setNewMonitorIntervalSeconds, newMonitorExpectedPattern, setNewMonitorExpectedPattern, newMonitorDeliveryMode, setNewMonitorDeliveryMode, createAutomationMonitorRecord, wakeEventTitle, setWakeEventTitle, wakeEventMessage, setWakeEventMessage, wakeEventDeliveryMode, setWakeEventDeliveryMode, createAutomationWakeEventRecord, markAutomationNudgesSeen, setWorkspaceCapabilitiesOpen, workspaceCapabilitiesOpen, filesystemAccessBadge, filesystemWriteBadge, codeSandboxBadge, browserControlBadge, filesystemAccessSummary, filesystemGranted, filesystemEnabled, allowedFilesystemPaths, filesystemWriteSummary, filesystemWriteEnabled, allowedWritablePaths, codeSandboxSummary, codeGranted, codeExecutionEnabled, browserControlSummary, browserGranted, browserEnabled, browserMode, canvasArtifacts, togglePanel, isPanelExpanded, setCanvasArtifacts, deleteArtifactById, loadCanvasArtifacts, canvasSearchQuery, canvasNextCursor, setCanvasSearchQuery, canvasHasMore, canvasLoading, canvasError, canvasTotalCount, workspaceFilesPanelKey, currentWorkspaceId, setWorkspaceFilesError, workspaceFilesError, browserLiveStatus, browserModalOpen, uwafCurrentUrl, uwafCurrentTitle, setBrowserInterrupted, setBrowserLiveStatus, setBrowserModalOpen, browserTakeoverRequestId, configSaving, sessionMessagesLoading, configError, connectionSummary, selectedSessionInfo, showNewFolderModal, newFolderName, setNewFolderName, handleCreateFolder, setNewFolderColor, newFolderColor, showNewTagModal, newTagName, setNewTagName, handleCreateTag, setNewTagColor, newTagColor, branchCompareOpen, setBranchCompareOpen, pendingApproval, handleToolApprove, handleToolReject, shellSettingsOpen, loadSettings, loadShellSettings}: ReturnType<typeof useWorkspaceController>) {
const activeModeOption = WORKSPACE_TOOL_AGENT_MODE_OPTIONS.find(option => option.id === agentPreferences.mode)
    || WORKSPACE_TOOL_AGENT_MODE_OPTIONS[0];

const activeStyleOption = WORKSPACE_TOOL_RESPONSE_STYLE_OPTIONS.find(option => option.id === agentPreferences.responseStyle)
    || WORKSPACE_TOOL_RESPONSE_STYLE_OPTIONS[1];

const safeSessions = sanitizeWorkspaceToolSessions(sessions);

const sessionMap = new Map(safeSessions.map(session => [session.id, session]));

const getBranchRootId = (session: WorkspaceToolSession) => {
    let cursor: WorkspaceToolSession | undefined = session;
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
    : ollamaHealth?.status === 'offline'
      ? (ollamaHealth.error || `Ollama host unreachable · ${ollamaHealth.host || settings?.ollamaHost || 'unknown'}`)
      : (ollamaHealth?.error || 'Waiting for Ollama health...');

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
    : settings?.workspaceToolSessionSummariesEnabled
      ? 'Fresh'
      : 'Disabled';

const branchStatusSummary = currentSession
    ? currentSession.parentSessionId
      ? `Branch depth ${currentSession.branchDepth} · ${currentSession.branchChildrenCount} child branch${currentSession.branchChildrenCount === 1 ? '' : 'es'}`
      : currentSession.branchChildrenCount > 0
        ? `${currentSession.branchChildrenCount} branch${currentSession.branchChildrenCount === 1 ? '' : 'es'}`
        : 'No branches yet'
    : settings?.workspaceToolSessionBranchingEnabled
      ? 'Ready for new branches'
      : 'Branching disabled';

const openAutomationNudgeCount = automationNudges.filter(nudge => !nudge.dismissedAt).length;

const queuedAutomationRunCount = automationRuns.filter(run => run.status === 'queued' || run.status === 'running').length;

const automationSummary = !automationPermissionGranted
    ? 'Blocked by account permission'
    : `${automationHeartbeat.enabled ? `Heartbeat ${automationHeartbeat.intervalMinutes}m` : 'Heartbeat off'} · ${automationSchedules.length} schedule${automationSchedules.length === 1 ? '' : 's'} · ${automationMonitors.length} monitor${automationMonitors.length === 1 ? '' : 's'} · ${openAutomationNudgeCount} nudge${openAutomationNudgeCount === 1 ? '' : 's'} · ${queuedAutomationRunCount} active run${queuedAutomationRunCount === 1 ? '' : 's'}`;

const visibleChatHistory = useMemo(
  () => sanitizeWorkspaceToolMessages(deferredChatHistory).filter(isVisibleMessage),
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

const renderVisibleChatMessage = (msg: WorkspaceToolMessage, index: number) => {
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
        branchingEnabled={settings?.workspaceToolSessionBranchingEnabled !== false}
        onBranchFromMessage={handleBranchFromMessage}
        onCopyMessage={handleCopyMessage}
        canvasArtifactNames={canvasArtifactNames}
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
    accountantEnabled ? 'Accountant' : null,
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

const workspaceToolChrome = isMobileViewport ? (
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
                      onClick={() => void selectWorkspaceToolModel(model.name)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          void selectWorkspaceToolModel(model.name);
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
            <button
              type="button"
              className={`mobile-topbar-menu-item${accountantEnabled ? ' is-active' : ''}`}
              style={accountantEnabled ? { color: '#10b981', borderColor: '#10b981', background: 'rgba(16, 185, 129, 0.12)' } : undefined}
              onClick={() => {
                toggleAccountant();
                setMobileHeaderMenuOpen(false);
              }}
            >
              <span>Accountant</span>
              <span>{accountantEnabled ? 'On' : 'Off'}</span>
            </button>
            <button
              type="button"
              className={`mobile-topbar-menu-item${imageGenerationEnabled ? ' is-active' : ''}`}
              style={imageGenerationEnabled ? { color: '#8b5cf6', borderColor: '#8b5cf6', background: 'rgba(139, 92, 246, 0.12)' } : undefined}
              onClick={() => {
                toggleImageGeneration();
                setMobileHeaderMenuOpen(false);
              }}
            >
              <span>Image Gen</span>
              <span>{imageGenerationEnabled ? 'On' : 'Off'}</span>
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
                      onClick={() => void selectWorkspaceToolModel(model.name)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          void selectWorkspaceToolModel(model.name);
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

      <div className="workspace-tool-mode-toolbar">
        <div className={`workspace-tool-mode-dropdown is-featured${headerModeMenuOpen === 'modes' ? ' is-open' : ''}${activeModeCount > 0 ? ' is-active tone-danger' : ' tone-accent'}`}>
          <button
            type="button"
            className="workspace-tool-mode-trigger glass-panel"
            ref={modesMenuButtonRef}
            onClick={() => setHeaderModeMenuOpen(current => current === 'modes' ? null : 'modes')}
            aria-haspopup="menu"
            aria-expanded={headerModeMenuOpen === 'modes'}
          >
            <span className="workspace-tool-mode-icon">
              <Wand2 size={16} color={activeModeCount > 0 ? '#f97316' : 'var(--accent-primary)'} />
            </span>
            <span className="workspace-tool-mode-copy">
              <span className="workspace-tool-mode-label">Workspace modes</span>
              <span className="workspace-tool-mode-status">{activeModeCount > 0 ? modeButtonSummary : 'Configure modes'}</span>
            </span>
            <ChevronDown
              size={15}
              className="workspace-tool-mode-chevron"
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
              className="workspace-tool-mode-menu glass-panel"
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
              <div className="workspace-tool-mode-menu-header">
                <div className="workspace-tool-mode-menu-title-row">
                  <span className="workspace-tool-mode-menu-icon">
                    <Wand2 size={16} color="#f97316" />
                  </span>
                  <div className="workspace-tool-mode-menu-title-copy">
                    <div className="workspace-tool-mode-menu-title">Workspace modes</div>
                    <div className="workspace-tool-mode-menu-status">{activeModeCount} active</div>
                  </div>
                </div>
                <p className="workspace-tool-mode-menu-description">
                  Keep the header clean and switch internet, browser, retrieval, and answer behavior from one place.
                </p>
              </div>

              <div className="workspace-tool-mode-menu-actions">
                <button
                  type="button"
                  className={`workspace-tool-mode-action${internetEnabled ? ' is-active' : ''}`}
                  onClick={() => toggleInternetAccess()}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Globe size={15} color={internetEnabled ? 'var(--accent-primary)' : 'var(--text-secondary)'} />
                    Internet
                  </span>
                  <span>{internetEnabled ? 'On' : 'Off'}</span>
                </button>

                {uwafBrowserEnabled && (
                  <div className="workspace-tool-mode-section">
                    <div className="workspace-tool-mode-section-header">
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {uwafBrowserMode === 'stealth'
                          ? <Shield size={15} color="#a855f7" />
                          : <Globe size={15} color="var(--accent-primary)" />}
                        UWAF browser
                      </span>
                      <span>{uwafBrowserMode === 'stealth' ? 'Stealth' : 'Direct'}</span>
                    </div>
                    <div className="workspace-tool-mode-segmented">
                      <button
                        type="button"
                        className={`workspace-tool-mode-segment${uwafBrowserMode === 'direct' ? ' is-active' : ''}`}
                        onClick={() => switchUwafBrowserMode('direct')}
                      >
                        Direct
                      </button>
                      <button
                        type="button"
                        className={`workspace-tool-mode-segment${uwafBrowserMode === 'stealth' ? ' is-active is-stealth' : ''}`}
                        onClick={() => switchUwafBrowserMode('stealth')}
                      >
                        Stealth
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  className={`workspace-tool-mode-action${ragEnabled ? ' is-active' : ''}`}
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
                    className={`workspace-tool-mode-action${ragFolderPath ? ' is-active' : ''}`}
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
                  className={`workspace-tool-mode-action${unrestrictedEnabled ? ' is-active is-amber' : ''}`}
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
                  className={`workspace-tool-mode-action${uncensoredEnabled ? ' is-active is-danger' : ''}`}
                  onClick={() => toggleUncensored()}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Wand2 size={15} color={uncensoredEnabled ? '#ef4444' : 'var(--text-secondary)'} />
                    Uncensored
                  </span>
                  <span>{uncensoredEnabled ? 'On' : 'Off'}</span>
                </button>

                <button
                  type="button"
                  className={`workspace-tool-mode-action${accountantEnabled ? ' is-active' : ''}`}
                  onClick={() => toggleAccountant()}
                  title="Act as a CPA/accountant/financial advisor with access to the IRS form catalog"
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Calculator size={15} color={accountantEnabled ? '#10b981' : 'var(--text-secondary)'} />
                    Accountant
                  </span>
                  <span>{accountantEnabled ? 'On' : 'Off'}</span>
                </button>

                <button
                  type="button"
                  className={`workspace-tool-mode-action${imageGenerationEnabled ? ' is-active' : ''}`}
                  onClick={() => toggleImageGeneration()}
                  title="Generate images using the configured image engine (ComfyUI)"
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ImageIcon size={15} color={imageGenerationEnabled ? '#8b5cf6' : 'var(--text-secondary)'} />
                    Image Gen
                  </span>
                  <span>{imageGenerationEnabled ? 'On' : 'Off'}</span>
                </button>

                {onNavigateToCoding && (
                  <button
                    type="button"
                    className="workspace-tool-mode-action"
                    onClick={() => { setHeaderModeMenuOpen(null); onNavigateToCoding(); }}
                    title="Open the Coding environment (Qwen Code agent in a dedicated container)"
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Terminal size={15} color="#22d3ee" />
                      Coding
                    </span>
                    <span>Open</span>
                  </button>
                )}
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
    <div className={`workspace-tool-shell workspace-tool-rail-left${railCollapsed ? ' rail-collapsed' : ''}`}>
      {isMobileViewport && mobileRailOpen && (
        <button
          type="button"
          className="mobile-surface-overlay"
          aria-label="Close WorkSpaces drawer"
          onClick={() => setMobileRailOpen(false)}
        />
      )}

      <section className="workspace-tool-main-panel">
        <div className="workspace-tool-main-chrome">
          {workspaceToolChrome}
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
          <div ref={chatAreaRef} className="chat-area workspace-tool-chat-area" onScroll={handleChatScroll}>
            {automationPermissionGranted && automationNudges.length > 0 && (
              <div style={{ display: 'grid', gap: '10px', marginBottom: '18px' }}>
                <div className="workspace-tool-card" style={{ padding: '14px 16px' }}>
                  <div className="workspace-tool-card-header">
                    <div>
                      <div className="workspace-tool-section-label">Automation nudges</div>
                      <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Background reminders, heartbeat check-ins, schedules, and monitor triggers surfaced by the worker.
                      </div>
                    </div>
                    <button
                      type="button"
                      className="workspace-tool-inline-button"
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
                                className="workspace-tool-inline-button"
                                onClick={() => openAutomationNudgeSession(nudge)}
                              >
                                Open thread
                              </button>
                            )}
                            <button
                              type="button"
                              className="workspace-tool-inline-button"
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
              <div className="workspace-tool-empty-state">
                <div style={{ textAlign: 'center', maxWidth: '720px', margin: '0 auto' }}>
                  <p style={{ margin: '0 0 16px', fontSize: '0.95rem', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                    Agent workspace ready for your next task.
                  </p>
                  <div className="workspace-tool-context-pills" style={{ justifyContent: 'center', marginTop: '16px' }}>
                    {persona.name && <span className="workspace-tool-pill accent">{persona.name}</span>}
                    <span className="workspace-tool-pill accent">{activeModeOption.label} mode</span>
                    <span className="workspace-tool-pill">{activeStyleOption.label} responses</span>
                    <span className="workspace-tool-pill">{provider === 'ollama' ? 'Local Ollama' : 'External provider'}</span>
                    {hasMemory && <span className="workspace-tool-pill accent">Memory loaded</span>}
                    {internetEnabled && <span className="workspace-tool-pill accent">Internet on</span>}
                    {ragEnabled && <span className="workspace-tool-pill accent">Knowledge Base on</span>}
                    {unrestrictedEnabled && <span className="workspace-tool-pill" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>Unrestricted</span>}
                    {uncensoredEnabled && <span className="workspace-tool-pill" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>Uncensored</span>}
                    {accountantEnabled && <span className="workspace-tool-pill" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }}>Accountant</span>}
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

        <div className="workspace-tool-composer">
          <div className="workspace-tool-context-pills">
            <span className="workspace-tool-pill accent">Mode: {activeModeOption.label}</span>
            <span className="workspace-tool-pill">Style: {activeStyleOption.label}</span>
            <span className="workspace-tool-pill">
              {agentPreferences.askClarifyingQuestionFirst ? 'Clarify first' : 'Assume and move'}
            </span>
            <span className="workspace-tool-pill">Continue: {effectiveSessionAutoContinueMode}</span>
            <span className="workspace-tool-pill">Context: {currentContextSummaryStatus}</span>
            {settings?.workspaceToolSessionBranchingEnabled && <span className="workspace-tool-pill">Branches: {branchStatusSummary}</span>}
            {persona.name && <span className="workspace-tool-pill">{persona.name}</span>}
            {userProfile.name && <span className="workspace-tool-pill">User: {userProfile.name}</span>}
            {taskState.objective.trim() && <span className="workspace-tool-pill">Objective set</span>}
            {taskState.nextStep.trim() && <span className="workspace-tool-pill">Next step pinned</span>}
            {taskState.checklist.length > 0 && <span className="workspace-tool-pill">Checklist: {taskState.checklist.length}</span>}
            {hasWorkspaceNotes && <span className="workspace-tool-pill">Notes attached</span>}
            {hasSuccessCriteria && <span className="workspace-tool-pill">Success criteria attached</span>}
          </div>

          {!isStreaming && continuationPending && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 12px', borderRadius: '12px', border: '1px solid var(--accent-border)', background: 'var(--accent-faint)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                The last assistant turn stopped with unfinished tool work. Continue this session to let WorkSpaces pick up where it left off.
              </div>
              <button
                type="button"
                className="workspace-tool-inline-button"
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

      <aside className={`workspace-tool-rail${railCollapsed ? ' is-collapsed' : ''}${isMobileViewport ? ' is-mobile-drawer' : ''}${isMobileViewport && mobileRailOpen ? ' is-mobile-open' : ''}`}>
        {!railCollapsed && (
          <>
            <div style={{ padding: '10px 12px 8px', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
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
                  gap: '10px',
                  minWidth: 0,
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  color: 'inherit',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <div style={{ position: 'relative', width: '40px', height: '40px', flexShrink: 0 }}>
                  <Image src="/logo.png" alt="PeakUI" fill style={{ objectFit: 'contain' }} sizes="40px" />
                </div>
                <div>
                  <h2 style={{ fontSize: '1.05rem', margin: 0, lineHeight: 1.15 }}>PeakUI</h2>
                  <div style={{ fontSize: '0.75rem', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px' }}>
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

            <div style={{ padding: '0 8px 6px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div className={`nav-item${showingKnowledgeBase ? ' active' : ''}`} onClick={() => {
                closeMobileChrome();
                onNavigateToKnowledgeBase?.();
              }} title="Go to Knowledge Base" style={{ margin: '0 4px', padding: '5px 10px', gap: '8px', fontSize: '0.88rem' }}>
                <Database size={16} /> <span className="sidebar-label">Knowledge Base (RAG)</span>
              </div>
              <div className={`nav-item${!showingKnowledgeBase && !showingSettings ? ' active' : ''}`} onClick={() => {
                closeMobileChrome();
                onNavigateToWorkspace?.();
              }} title="Go to WorkSpaces" style={{ margin: '0 4px', padding: '5px 10px', gap: '8px', fontSize: '0.88rem' }}>
                <Wand2 size={16} /> <span className="sidebar-label">WorkSpaces</span>
              </div>
              <div className="nav-item" onClick={() => {
                closeMobileChrome();
                onNavigateToCoding?.();
              }} title="Open the Coding environment" style={{ margin: '0 4px', padding: '5px 10px', gap: '8px', fontSize: '0.88rem' }}>
                <Terminal size={16} /> <span className="sidebar-label">Coding</span>
              </div>
              <div className={`nav-item${showingSettings ? ' active' : ''}`} onClick={() => {
                closeMobileChrome();
                onNavigateToSettings?.();
              }} title="Settings" style={{ margin: '0 4px', padding: '5px 10px', gap: '8px', fontSize: '0.88rem' }}>
                <Settings size={16} /> <span className="sidebar-label">Settings</span>
              </div>
            </div>
          </>
        )}
        {railCollapsed ? (
          <div className="workspace-tool-rail-collapsed-shell">
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

            <div className="workspace-tool-rail-stat-cluster">
              <div className="workspace-tool-rail-stat" title={`Mode: ${activeModeOption.label}`}>
                <Wand2 size={14} />
                <span className="workspace-tool-rail-stat-label">{compactModeLabel}</span>
              </div>
              <div className="workspace-tool-rail-stat" title={`${sessions.length} task threads`}>
                <MessageSquare size={14} />
                <span className="workspace-tool-rail-stat-label">{sessions.length > 99 ? '99+' : sessions.length}</span>
              </div>
              <div className={`workspace-tool-rail-stat${internetEnabled ? ' is-active' : ''}`} title={`Internet ${internetEnabled ? 'enabled' : 'disabled'}`}>
                <Globe size={14} />
                <span className="workspace-tool-rail-stat-label">{internetEnabled ? 'ON' : 'OFF'}</span>
              </div>
            </div>

            <div
              className="workspace-tool-rail-collapsed-footer"
              title={provider === 'ollama'
                ? `${healthStatusLabel} · ${runtimeMetaLabel}`
                : connectionStatus === 'error'
                  ? 'External provider connection issue detected'
                  : connectionStatus === 'checking'
                    ? 'Checking external provider connection'
                    : 'External provider ready'}
            >
              <span className="workspace-tool-rail-status-dot" style={{ background: collapsedRailFooterTone, boxShadow: `0 0 12px ${collapsedRailFooterTone}` }} />
              <span>{collapsedRailFooterLabel}</span>
            </div>
          </div>
        ) : (
          <>
            <div className="workspace-tool-rail-scroll" onClick={() => {
              if (sessionMenuOpen) setSessionMenuOpen(null);
              if (createMenuOpen) setCreateMenuOpen(false);
            }} style={{ padding: '8px 8px 12px', gap: '8px' }}>
              <div className="workspace-tool-card workspace-tool-card-sessions" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                    <span className="workspace-tool-section-label">Sessions</span>
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
                          className="workspace-tool-choice-row"
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
                          className="workspace-tool-choice-row"
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
                          className="workspace-tool-choice-row"
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
                          className="workspace-tool-inline-button"
                          onClick={() => setSelectedSessionIds(visibleSessions.map(session => session.id).filter(Boolean))}
                          disabled={visibleSessions.length === 0}
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          className="workspace-tool-inline-button"
                          onClick={() => setSelectedSessionIds([])}
                          disabled={selectedSessionIds.length === 0}
                        >
                          Clear selection
                        </button>
                        <button
                          type="button"
                          className="workspace-tool-inline-button"
                          onClick={() => void handleClearSelectedSessions()}
                          disabled={selectedSessionIds.length === 0}
                          style={{ color: 'var(--danger)' }}
                        >
                          <Trash2 size={12} /> Delete selected
                        </button>
                        <button
                          type="button"
                          className="workspace-tool-inline-button"
                          onClick={() => void handleClearAllSessions()}
                          disabled={sessions.length === 0}
                          style={{ color: 'var(--danger)' }}
                        >
                          Clear all
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="workspace-tool-list-scroll">
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
                                ...(settings?.workspaceToolSessionBranchingEnabled
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
                              <div className="workspace-tool-section-label" style={{ padding: '8px 10px 4px', fontSize: '0.68rem' }}>Folder</div>
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
                              <div className="workspace-tool-section-label" style={{ padding: '8px 10px 4px', fontSize: '0.68rem' }}>Tags</div>
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
                          className="workspace-tool-inline-button"
                          onClick={() => setSessionListPage(page => Math.max(0, page - 1))}
                          disabled={activeSessionListPage === 0}
                        >
                          Previous
                        </button>
                        <button
                          type="button"
                          className="workspace-tool-inline-button"
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
                    <div className="workspace-tool-card" style={{ gap: '12px', position: 'sticky', top: 0, zIndex: 1, background: 'var(--sidebar-bg)' }}>
                      <div className="workspace-tool-card-header">
                        <div>
                          <div className="workspace-tool-section-label">Workspace controls</div>
                          <div style={{ marginTop: '6px', fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                            Configure how WorkSpaces works in this browser
                          </div>
                          <div style={{ marginTop: '6px', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                            {responseStyleSummary}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="workspace-tool-inline-button"
                          onClick={() => setWorkspaceControlsModalOpen(false)}
                        >
                          <X size={14} />
                          Close
                        </button>
                      </div>
                      <div className="workspace-tool-disclosure-pill-row">
                        <span className="workspace-tool-disclosure-pill">Workspace: {currentWorkspace?.name || 'None'}</span>
                        <span className="workspace-tool-disclosure-pill">Task state: {taskStateSummary}</span>
                        <span className="workspace-tool-disclosure-pill">Persona: {personaSummary}</span>
                        <span className="workspace-tool-disclosure-pill">Profile: {userProfileSummary}</span>
                        <span className="workspace-tool-disclosure-pill">Shell: {shellGranted ? (shellEnabled ? 'Enabled' : 'Disabled') : 'Blocked'}</span>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gap: '12px' }}>
              <div className="workspace-tool-card">
                <div className="workspace-tool-card-header">
                  <div>
                    <div className="workspace-tool-section-label">Workspace</div>
                    <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {workspaceSummary}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="workspace-tool-inline-button"
                    onClick={() => void loadWorkspaces()}
                    disabled={workspaceLoading}
                  >
                    {workspaceLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    Refresh
                  </button>
                </div>
                <div style={{ display: 'grid', gap: '10px' }}>
                  <div>
                    <label className="workspace-tool-field-label" htmlFor="workspace-tool-workspace-select">Selected workspace</label>
                    <select
                      id="workspace-tool-workspace-select"
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
                      <div className="workspace-tool-disclosure-pill-row">
                        <span className="workspace-tool-disclosure-pill">Root: {currentWorkspace.hostPath}</span>
                        <span className="workspace-tool-disclosure-pill">BOOT.md</span>
                        <span className="workspace-tool-disclosure-pill">TOOLS.md</span>
                        <span className="workspace-tool-disclosure-pill">skills/{currentWorkspace.skillCount}</span>
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
                    <div className="workspace-tool-section-label">Create workspace</div>
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
                        className="workspace-tool-inline-button"
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
              <div className="workspace-tool-card">
                <div className="workspace-tool-card-header">
                  <div>
                    <div className="workspace-tool-section-label">Session intelligence</div>
                    <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Context memory, continuation behavior, branching, and analytics for the active WorkSpaces thread.
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {continuationPending && (
                      <button
                        type="button"
                        className="workspace-tool-inline-button"
                        onClick={() => void handleSendMessage('continue')}
                      >
                        <Redo2 size={14} />
                        Continue
                      </button>
                    )}
                    {settings?.workspaceToolSessionBranchingEnabled && (
                      <>
                        <button
                          type="button"
                          className="workspace-tool-inline-button"
                          onClick={() => void handleBranchFromMessage(chatHistory[chatHistory.length - 1]?.id, `${currentSession?.title || 'Draft'} branch`)}
                          disabled={isStreaming || chatHistory.length === 0}
                        >
                          <Copy size={14} />
                          Branch latest
                        </button>
                        <button
                          type="button"
                          className="workspace-tool-inline-button"
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
                  <div className="workspace-tool-disclosure-pill-row">
                    <span className="workspace-tool-disclosure-pill">{autoContinueSummaryLabel}</span>
                    <span className="workspace-tool-disclosure-pill">Context: {currentContextSummaryStatus}</span>
                    <span className="workspace-tool-disclosure-pill">Analytics: {settings?.workspaceToolSessionAnalyticsEnabled ? 'On' : 'Off'}</span>
                    <span className="workspace-tool-disclosure-pill">{branchStatusSummary}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                    <div style={{ padding: '12px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--panel-bg)' }}>
                      <div className="workspace-tool-section-label">Analytics</div>
                      <div style={{ marginTop: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                        {currentSessionAnalyticsSummary}
                      </div>
                    </div>
                    <div style={{ padding: '12px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--panel-bg)' }}>
                      <div className="workspace-tool-section-label">Branch family</div>
                      <div style={{ marginTop: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                        {currentBranchFamily.length > 0
                          ? `${currentBranchFamily.length} related thread${currentBranchFamily.length === 1 ? '' : 's'} in this branch family.`
                          : 'No related branches loaded.'}
                      </div>
                    </div>
                  </div>
                  {currentSession?.summary && (
                    <div style={{ padding: '12px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--panel-bg)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                      <div className="workspace-tool-section-label" style={{ marginBottom: '8px' }}>Session summary</div>
                      {currentSession.summary}
                    </div>
                  )}
                  {currentSession?.contextSummary && (
                    <div style={{ padding: '12px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--panel-bg)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                      <div className="workspace-tool-card-header" style={{ marginBottom: '8px' }}>
                        <div>
                          <div className="workspace-tool-section-label">What I’m carrying forward</div>
                          <div style={{ marginTop: '4px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            Compact working memory for older turns in this thread.
                          </div>
                        </div>
                        <div style={{ display: 'inline-flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="workspace-tool-inline-button"
                            onClick={() => updateCurrentThreadMemorySafe('refresh')}
                            disabled={isStreaming}
                          >
                            Refresh
                          </button>
                          <button
                            type="button"
                            className="workspace-tool-inline-button"
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
                  {currentSession && !currentSession.contextSummary && settings?.workspaceToolSessionSummariesEnabled && (
                    <div style={{ padding: '12px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--panel-bg)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                      <div className="workspace-tool-card-header">
                        <div>
                          <div className="workspace-tool-section-label">What I’m carrying forward</div>
                          <div style={{ marginTop: '4px' }}>No compact working memory has been created for this thread yet.</div>
                        </div>
                        <button
                          type="button"
                          className="workspace-tool-inline-button"
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
              <div className="workspace-tool-card">
                <div className="workspace-tool-card-header">
                  <div>
                    <div className="workspace-tool-section-label">Agent mode</div>
                    <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {activeAgentMode?.label || 'Plan'} · Persistent per browser
                    </div>
                  </div>
                  <button
                    type="button"
                    className="workspace-tool-inline-button"
                    onClick={() => setAgentModePanelOpen(value => !value)}
                  >
                    {agentModePanelOpen ? 'Collapse' : 'Expand'}
                    <ChevronDown size={14} style={{ transform: agentModePanelOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
                  </button>
                </div>
                {agentModePanelOpen && (
                  <div className="workspace-tool-choice-grid">
                    {WORKSPACE_TOOL_AGENT_MODE_OPTIONS.map(option => {
                      const active = agentPreferences.mode === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={`workspace-tool-choice-card${active ? ' active' : ''}`}
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
              <div className="workspace-tool-card">
                <button
                  type="button"
                  className="workspace-tool-disclosure-toggle"
                  onClick={() => setResponseStylePanelOpen(open => !open)}
                  aria-expanded={responseStylePanelOpen}
                >
                  <div className="workspace-tool-disclosure-summary">
                    <div>
                      <div className="workspace-tool-section-label">Response style</div>
                      <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {responseStyleSummary}
                      </div>
                    </div>
                  </div>
                  <ChevronDown
                    size={16}
                    className={`workspace-tool-disclosure-chevron${responseStylePanelOpen ? ' is-open' : ''}`}
                  />
                </button>
                {responseStylePanelOpen && (
                  <div className="workspace-tool-disclosure-body">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className={`workspace-tool-toggle${agentPreferences.askClarifyingQuestionFirst ? ' active' : ''}`}
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
                              className={`workspace-tool-toggle${active ? ' active' : ''}`}
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
                        <label className="workspace-tool-field-label" htmlFor="workspace-tool-auto-continue-max-steps" style={{ marginBottom: 0 }}>
                          Auto-continue step cap
                        </label>
                        <input
                          id="workspace-tool-auto-continue-max-steps"
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
                    <div className="workspace-tool-choice-grid">
                      {WORKSPACE_TOOL_RESPONSE_STYLE_OPTIONS.map(option => {
                        const active = agentPreferences.responseStyle === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            className={`workspace-tool-choice-row${active ? ' active' : ''}`}
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
              <div className="workspace-tool-card">
                <button
                  type="button"
                  className="workspace-tool-disclosure-toggle"
                  onClick={() => setTaskStatePanelOpen(open => !open)}
                  aria-expanded={taskStatePanelOpen}
                >
                  <div className="workspace-tool-disclosure-summary">
                    <div>
                      <div className="workspace-tool-section-label">Task state</div>
                      <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {taskStateSummary}
                      </div>
                    </div>
                  </div>
                  <ChevronDown
                    size={16}
                    className={`workspace-tool-disclosure-chevron${taskStatePanelOpen ? ' is-open' : ''}`}
                  />
                </button>
                {taskStatePanelOpen && (
                  <div className="workspace-tool-disclosure-body">
                    <div className="workspace-tool-card-header">
                      <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          Keep the objective, status, next step, and done criteria separate from the transcript.
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        {latestAssistantChecklistSuggestion.length > 0 && (
                          <button
                            type="button"
                            className="workspace-tool-inline-button"
                            onClick={replaceChecklistFromLatestAssistant}
                          >
                            <ListTodo size={12} />
                            {taskState.checklist.length > 0 ? 'Replace checklist' : 'Pin checklist'}
                          </button>
                        )}
                        {hasTaskState && (
                          <button
                            type="button"
                            className="workspace-tool-inline-button"
                            onClick={() => updateTaskState(DEFAULT_WORKSPACE_TOOL_TASK_STATE)}
                          >
                            Clear
                          </button>
                        )}
                        <button
                          type="button"
                          className="workspace-tool-inline-button"
                          onClick={addChecklistItem}
                        >
                          <Plus size={12} />
                          Add item
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: '10px' }}>
                      <div>
                        <label className="workspace-tool-field-label" htmlFor="workspace-tool-objective">Objective</label>
                        <textarea
                          id="workspace-tool-objective"
                          className="input-field"
                          rows={3}
                          value={taskState.objective}
                          onChange={e => updateTaskState({ objective: e.target.value })}
                          placeholder="What is this task trying to accomplish?"
                          style={{ resize: 'vertical' }}
                        />
                      </div>
                      <div>
                        <label className="workspace-tool-field-label" htmlFor="workspace-tool-current-status">Current status</label>
                        <textarea
                          id="workspace-tool-current-status"
                          className="input-field"
                          rows={2}
                          value={taskState.currentStatus}
                          onChange={e => updateTaskState({ currentStatus: e.target.value })}
                          placeholder="What is already known, done, or blocked?"
                          style={{ resize: 'vertical' }}
                        />
                      </div>
                      <div>
                        <label className="workspace-tool-field-label" htmlFor="workspace-tool-next-step">Next step</label>
                        <textarea
                          id="workspace-tool-next-step"
                          className="input-field"
                          rows={2}
                          value={taskState.nextStep}
                          onChange={e => updateTaskState({ nextStep: e.target.value })}
                          placeholder="What should happen immediately next?"
                          style={{ resize: 'vertical' }}
                        />
                      </div>
                      <div>
                        <label className="workspace-tool-field-label" htmlFor="workspace-tool-done-criteria">Done criteria</label>
                        <textarea
                          id="workspace-tool-done-criteria"
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
                      <div className="workspace-tool-section-label">Pinned checklist</div>

                      {taskState.checklist.length === 0 ? (
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                          {latestAssistantChecklistSuggestion.length > 0
                            ? 'The latest assistant answer includes a checklist you can pin here.'
                            : 'Pin checklist steps from an assistant answer or add your own items manually.'}
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gap: '8px' }}>
                          {taskState.checklist.map(item => (
                            <div key={item.id} className="workspace-tool-checklist-row">
                              <button
                                type="button"
                                className={`workspace-tool-check-toggle${item.completed ? ' completed' : ''}`}
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
                                className="workspace-tool-inline-button"
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
              <div className="workspace-tool-card">
                <button
                  type="button"
                  className="workspace-tool-disclosure-toggle"
                  onClick={() => setWorkspaceBriefPanelOpen(open => !open)}
                  aria-expanded={workspaceBriefPanelOpen}
                >
                  <div className="workspace-tool-disclosure-summary">
                    <div>
                      <div className="workspace-tool-section-label">Workspace brief</div>
                      <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {workspaceBriefSummary}
                      </div>
                    </div>
                  </div>
                  <ChevronDown
                    size={16}
                    className={`workspace-tool-disclosure-chevron${workspaceBriefPanelOpen ? ' is-open' : ''}`}
                  />
                </button>
                {workspaceBriefPanelOpen && (
                  <div className="workspace-tool-disclosure-body">
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                      Injected into every WorkSpaces request
                    </div>
                    <div style={{ display: 'grid', gap: '10px' }}>
                      <div>
                        <label className="workspace-tool-field-label" htmlFor="workspace-tool-workspace-notes">Workspace notes</label>
                        <textarea
                          id="workspace-tool-workspace-notes"
                          className="input-field"
                          rows={4}
                          value={agentPreferences.workspaceNotes}
                          onChange={e => updateAgentPreferences({ workspaceNotes: e.target.value })}
                          placeholder="Constraints, current setup, project context, known blockers..."
                          style={{ resize: 'vertical' }}
                        />
                      </div>
                      <div>
                        <label className="workspace-tool-field-label" htmlFor="workspace-tool-success-criteria">Success criteria</label>
                        <textarea
                          id="workspace-tool-success-criteria"
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
              <div className="workspace-tool-card">
                <div className="workspace-tool-card-header">
                  <div>
                    <div className="workspace-tool-section-label">Agent persona</div>
                    <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {personaSummary}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="workspace-tool-inline-button"
                    onClick={() => setPersonaPanelOpen(v => !v)}
                  >
                    {personaPanelOpen ? 'Collapse' : 'Edit'}
                  </button>
                </div>
                {personaPanelOpen && (
                  <div style={{ display: 'grid', gap: '10px' }}>
                    <div>
                      <label className="workspace-tool-field-label">Template</label>
                      <div className="workspace-tool-choice-grid">
                        {([
                          { id: 'custom', label: 'Custom', description: 'Build your own persona from scratch.' },
                          { id: 'developer', label: 'Developer', description: 'Code-first, technical, review-oriented.' },
                          { id: 'researcher', label: 'Researcher', description: 'Evidence-driven, thorough, balanced.' },
                          { id: 'writer', label: 'Writer', description: 'Clear, engaging, audience-aware.' },
                          { id: 'analyst', label: 'Analyst', description: 'Precise, structured, metrics-first.' },
                          { id: 'product-manager', label: 'Product', description: 'User-centric, prioritization-focused.' },
                          { id: 'system-admin', label: 'Ops', description: 'Conservative, safety-first, procedural.' },
                        ] as Array<{ id: WorkspaceToolPersonaTemplateId; label: string; description: string }>).map(option => {
                          const active = persona.templateId === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              className={`workspace-tool-choice-card${active ? ' active' : ''}`}
                              onClick={() => {
                                const next = applyPersonaTemplate(option.id, persona);
                                setPersona({ ...next, templateId: option.id });
                                void saveSettingsPatch({
                                  workspaceToolPersonaTemplate: option.id,
                                  workspaceToolPersonaName: next.name,
                                  workspaceToolPersonaTone: next.tone,
                                  workspaceToolPersonaExpertise: next.expertise,
                                  workspaceToolPersonaBoundaries: next.boundaries,
                                  workspaceToolPersonaOperatingInstructions: next.operatingInstructions,
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
                      <label className="workspace-tool-field-label" htmlFor="workspace-tool-persona-name">Name</label>
                      <input
                        id="workspace-tool-persona-name"
                        className="input-field"
                        value={persona.name}
                        onChange={e => {
                          const next = { ...persona, name: e.target.value };
                          setPersona(next);
                          void saveSettingsPatch({ workspaceToolPersonaName: next.name });
                        }}
                        placeholder="Agent display name"
                      />
                    </div>
                    <div>
                      <label className="workspace-tool-field-label" htmlFor="workspace-tool-persona-tone">Tone</label>
                      <textarea
                        id="workspace-tool-persona-tone"
                        className="input-field"
                        rows={2}
                        value={persona.tone}
                        onChange={e => {
                          const next = { ...persona, tone: e.target.value };
                          setPersona(next);
                          void saveSettingsPatch({ workspaceToolPersonaTone: next.tone });
                        }}
                        placeholder="How the agent should sound (e.g., concise, formal, friendly)"
                        style={{ resize: 'vertical' }}
                      />
                    </div>
                    <div>
                      <label className="workspace-tool-field-label" htmlFor="workspace-tool-persona-expertise">Expertise</label>
                      <textarea
                        id="workspace-tool-persona-expertise"
                        className="input-field"
                        rows={2}
                        value={persona.expertise}
                        onChange={e => {
                          const next = { ...persona, expertise: e.target.value };
                          setPersona(next);
                          void saveSettingsPatch({ workspaceToolPersonaExpertise: next.expertise });
                        }}
                        placeholder="What the agent should know about"
                        style={{ resize: 'vertical' }}
                      />
                    </div>
                    <div>
                      <label className="workspace-tool-field-label" htmlFor="workspace-tool-persona-boundaries">Boundaries</label>
                      <textarea
                        id="workspace-tool-persona-boundaries"
                        className="input-field"
                        rows={2}
                        value={persona.boundaries}
                        onChange={e => {
                          const next = { ...persona, boundaries: e.target.value };
                          setPersona(next);
                          void saveSettingsPatch({ workspaceToolPersonaBoundaries: next.boundaries });
                        }}
                        placeholder="What the agent must NOT do or pretend to do"
                        style={{ resize: 'vertical' }}
                      />
                    </div>
                    <div>
                      <label className="workspace-tool-field-label" htmlFor="workspace-tool-persona-instructions">Operating instructions</label>
                      <textarea
                        id="workspace-tool-persona-instructions"
                        className="input-field"
                        rows={2}
                        value={persona.operatingInstructions}
                        onChange={e => {
                          const next = { ...persona, operatingInstructions: e.target.value };
                          setPersona(next);
                          void saveSettingsPatch({ workspaceToolPersonaOperatingInstructions: next.operatingInstructions });
                        }}
                        placeholder="Default behavior rules (e.g., ask clarifications, show task state)"
                        style={{ resize: 'vertical' }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="workspace-tool-card">
                <div className="workspace-tool-card-header">
                  <div>
                    <div className="workspace-tool-section-label">User profile</div>
                    <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {userProfileSummary}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="workspace-tool-inline-button"
                    onClick={() => setUserProfilePanelOpen(v => !v)}
                  >
                    {userProfilePanelOpen ? 'Collapse' : 'Edit'}
                  </button>
                </div>
                {userProfilePanelOpen && (
                  <div style={{ display: 'grid', gap: '10px' }}>
                    <div>
                      <label className="workspace-tool-field-label" htmlFor="workspace-tool-user-name">Name</label>
                      <input
                        id="workspace-tool-user-name"
                        className="input-field"
                        value={userProfile.name}
                        onChange={e => {
                          const next = { ...userProfile, name: e.target.value };
                          setUserProfile(next);
                          void saveSettingsPatch({ workspaceToolUserProfileName: next.name });
                        }}
                        placeholder="Your name"
                      />
                    </div>
                    <div>
                      <label className="workspace-tool-field-label" htmlFor="workspace-tool-user-role">Role</label>
                      <input
                        id="workspace-tool-user-role"
                        className="input-field"
                        value={userProfile.role}
                        onChange={e => {
                          const next = { ...userProfile, role: e.target.value };
                          setUserProfile(next);
                          void saveSettingsPatch({ workspaceToolUserProfileRole: next.role });
                        }}
                        placeholder="e.g., Software Engineer, Product Manager"
                      />
                    </div>
                    <div>
                      <label className="workspace-tool-field-label" htmlFor="workspace-tool-user-preferences">Preferences</label>
                      <textarea
                        id="workspace-tool-user-preferences"
                        className="input-field"
                        rows={2}
                        value={userProfile.preferences}
                        onChange={e => {
                          const next = { ...userProfile, preferences: e.target.value };
                          setUserProfile(next);
                          void saveSettingsPatch({ workspaceToolUserProfilePreferences: next.preferences });
                        }}
                        placeholder="How you like to receive answers (e.g., bullet points, minimal prose)"
                        style={{ resize: 'vertical' }}
                      />
                    </div>
                    <div>
                      <label className="workspace-tool-field-label" htmlFor="workspace-tool-user-context">Context</label>
                      <textarea
                        id="workspace-tool-user-context"
                        className="input-field"
                        rows={3}
                        value={userProfile.context}
                        onChange={e => {
                          const next = { ...userProfile, context: e.target.value };
                          setUserProfile(next);
                          void saveSettingsPatch({ workspaceToolUserProfileContext: next.context });
                        }}
                        placeholder="Relevant background for the agent to know (team, stack, goals)"
                        style={{ resize: 'vertical' }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="workspace-tool-card">
                <div className="workspace-tool-card-header">
                  <div>
                    <div className="workspace-tool-section-label">Shell execution</div>
                    <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {!shellGranted ? 'Blocked by account permission' : shellEnabled ? 'Enabled' : 'Disabled'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="workspace-tool-inline-button"
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

              <div className="workspace-tool-card">
                <button
                  type="button"
                  className="workspace-tool-disclosure-toggle"
                  onClick={() => {
                    setAutomationPanelOpen(open => !open);
                    if (!automationPanelOpen) {
                      void loadAutomationState();
                    }
                  }}
                  aria-expanded={automationPanelOpen}
                >
                  <div className="workspace-tool-disclosure-summary">
                    <div>
                      <div className="workspace-tool-section-label">Autonomous scheduling</div>
                      <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {automationLoading ? 'Loading automation state...' : automationSummary}
                      </div>
                    </div>
                    <div className="workspace-tool-disclosure-pill-row">
                      <span className="workspace-tool-disclosure-pill">
                        Worker: {automationWorker.running ? 'Running' : 'Stopped'}
                      </span>
                      <span className="workspace-tool-disclosure-pill">
                        Nudges: {openAutomationNudgeCount}
                      </span>
                    </div>
                  </div>
                  <ChevronDown
                    size={16}
                    className={`workspace-tool-disclosure-chevron${automationPanelOpen ? ' is-open' : ''}`}
                  />
                </button>

                {automationPanelOpen && (
                  <div className="workspace-tool-disclosure-body">
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
                        <div className="workspace-tool-card">
                          <div className="workspace-tool-card-header">
                            <div>
                              <div className="workspace-tool-section-label">Worker status</div>
                              <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                Polling background heartbeats, cron schedules, file checks, and URL checks every 30 seconds.
                              </div>
                            </div>
                            <button
                              type="button"
                              className="workspace-tool-inline-button"
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

                        <div className="workspace-tool-card">
                          <div className="workspace-tool-card-header">
                            <div>
                              <div className="workspace-tool-section-label">Heartbeat check-ins</div>
                              <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                Create proactive reminders for stale WorkSpaces threads.
                              </div>
                            </div>
                            <button
                              type="button"
                              className={`workspace-tool-toggle${automationHeartbeat.enabled ? ' active' : ''}`}
                              onClick={() => void saveHeartbeatConfig({ enabled: !automationHeartbeat.enabled })}
                              disabled={automationSaving}
                            >
                              {automationHeartbeat.enabled ? 'Enabled' : 'Disabled'}
                            </button>
                          </div>
                          <div style={{ display: 'grid', gap: '10px' }}>
                            <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                              <label style={{ display: 'grid', gap: '6px' }}>
                                <span className="workspace-tool-field-label">Interval (minutes)</span>
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
                                <span className="workspace-tool-field-label">Stale after (minutes)</span>
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
                              <span className="workspace-tool-field-label">Heartbeat prompt</span>
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
                              <span className="workspace-tool-field-label">Delivery mode</span>
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
                                className="workspace-tool-inline-button"
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

                        <div className="workspace-tool-card">
                          <div className="workspace-tool-card-header">
                            <div>
                              <div className="workspace-tool-section-label">Cron schedules</div>
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
                                          className={`workspace-tool-toggle${schedule.enabled ? ' active' : ''}`}
                                          onClick={() => void toggleAutomationSchedule(schedule)}
                                          disabled={automationSaving}
                                        >
                                          {schedule.enabled ? 'Enabled' : 'Paused'}
                                        </button>
                                        <button
                                          type="button"
                                          className="workspace-tool-inline-button"
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
                              <div className="workspace-tool-section-label">Create schedule</div>
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
                                  className="workspace-tool-inline-button"
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

                        <div className="workspace-tool-card">
                          <div className="workspace-tool-card-header">
                            <div>
                              <div className="workspace-tool-section-label">Background monitors</div>
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
                                          className={`workspace-tool-toggle${monitor.enabled ? ' active' : ''}`}
                                          onClick={() => void toggleAutomationMonitor(monitor)}
                                          disabled={automationSaving}
                                        >
                                          {monitor.enabled ? 'Enabled' : 'Paused'}
                                        </button>
                                        <button
                                          type="button"
                                          className="workspace-tool-inline-button"
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
                              <div className="workspace-tool-section-label">Create monitor</div>
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
                                className="workspace-tool-inline-button"
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

                        <div className="workspace-tool-card">
                          <div className="workspace-tool-card-header">
                            <div>
                              <div className="workspace-tool-section-label">Wake-on-event</div>
                              <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                Create a manual wake event now, or POST to `/api/workspace-tool/automation/wake-event` from an external trigger.
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
                              className="workspace-tool-inline-button"
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

                        <div className="workspace-tool-card">
                          <div className="workspace-tool-card-header">
                            <div>
                              <div className="workspace-tool-section-label">Recent unattended runs</div>
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

                        <div className="workspace-tool-card">
                          <div className="workspace-tool-card-header">
                            <div>
                              <div className="workspace-tool-section-label">Nudge inbox</div>
                              <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                Recent heartbeat check-ins, schedule fires, monitor triggers, and wake events.
                              </div>
                            </div>
                            <button
                              type="button"
                              className="workspace-tool-inline-button"
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
                                          className="workspace-tool-inline-button"
                                          onClick={() => openAutomationNudgeSession(nudge)}
                                        >
                                          Open thread
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        className="workspace-tool-inline-button"
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

              <div className="workspace-tool-card">
                <button
                  type="button"
                  className="workspace-tool-disclosure-toggle"
                  onClick={() => setWorkspaceCapabilitiesOpen(open => !open)}
                  aria-expanded={workspaceCapabilitiesOpen}
                >
                  <div className="workspace-tool-disclosure-summary">
                    <div>
                      <div className="workspace-tool-section-label">Workspace capabilities</div>
                      <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        Modeled after WorkSpaces’s task-first workspace flow
                      </div>
                    </div>
                    <div className="workspace-tool-disclosure-pill-row">
                      <span className="workspace-tool-disclosure-pill">FS: {filesystemAccessBadge}</span>
                      <span className="workspace-tool-disclosure-pill">Writes: {filesystemWriteBadge}</span>
                      <span className="workspace-tool-disclosure-pill">Code: {codeSandboxBadge}</span>
                      <span className="workspace-tool-disclosure-pill">Browser: {browserControlBadge}</span>
                    </div>
                  </div>
                  <ChevronDown
                    size={16}
                    className={`workspace-tool-disclosure-chevron${workspaceCapabilitiesOpen ? ' is-open' : ''}`}
                  />
                </button>

                {workspaceCapabilitiesOpen && (
                  <div className="workspace-tool-disclosure-body">
                    <div className="workspace-tool-card">
                      <div className="workspace-tool-card-header">
                        <div>
                          <div className="workspace-tool-section-label">Filesystem access</div>
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

                    <div className="workspace-tool-card">
                      <div className="workspace-tool-card-header">
                        <div>
                          <div className="workspace-tool-section-label">Filesystem writes</div>
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

                    <div className="workspace-tool-card">
                      <div className="workspace-tool-card-header">
                        <div>
                          <div className="workspace-tool-section-label">Code sandbox</div>
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

                    <div className="workspace-tool-card">
                      <div className="workspace-tool-card-header">
                        <div>
                          <div className="workspace-tool-section-label">Browser control</div>
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

                    <div className="workspace-tool-card">
                      <div className="workspace-tool-card-header">
                        <div className="workspace-tool-section-label">Workspace capabilities</div>
                        <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>Modeled after WorkSpaces’s task-first workspace flow</span>
                      </div>
                      <div style={{ display: 'grid', gap: '8px' }}>
                        <div className="workspace-tool-capability-row">
                          <Bot size={15} />
                          <span>Persistent task modes, response styles, and task criteria.</span>
                        </div>
                        <div className="workspace-tool-capability-row">
                          <Globe size={15} />
                          <span>When Internet mode is on, the model can search the web for current information and cite sources.</span>
                        </div>
                        <div className="workspace-tool-capability-row">
                          <BookOpen size={15} />
                          <span>Optional Knowledge Base grounding for local project and document context.</span>
                        </div>
                        <div className="workspace-tool-capability-row">
                          <MessageSquare size={15} />
                          <span>Separate task threads so planning and execution sessions do not mix.</span>
                        </div>
                        <div className="workspace-tool-capability-row">
                          <Server size={15} />
                          <span>Optional read-only host file inspection for approved paths such as your workspace or `/tmp`.</span>
                        </div>
                        <div className="workspace-tool-capability-row">
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
            <div className="workspace-tool-card">
                <div className="workspace-tool-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <div className="workspace-tool-section-label">Canvas</div>
                    <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>{canvasArtifacts.length} artifact{canvasArtifacts.length !== 1 ? 's' : ''}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => togglePanel('canvas')}
                    title={isPanelExpanded('canvas') ? 'Minimize Canvas' : 'Expand Canvas'}
                    aria-label={isPanelExpanded('canvas') ? 'Minimize Canvas' : 'Expand Canvas'}
                    style={panelIconButtonStyle('canvas')}
                  >
                    {isPanelExpanded('canvas') ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                </div>
                {isPanelExpanded('canvas') && (
                  <div style={{ maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
                      // Match the server-side classifier in `lib/canvas-download`
                      // so binary artifacts (PPTX, ZIP, PDF, DOCX, XLSX, EML, ...)
                      // always anchor to the download route — which knows how to
                      // base64-decode `content` back to bytes — and only genuinely
                      // text artifacts (markdown, JSON, XML, SVG) go through the
                      // Blob path. Using `isBinaryArtifact` here diverged from the
                      // server whitelist and silently produced corrupt downloads
                      // for tar/gz/7z/etc.
                      if (!isTextArtifactMimeType(artifact.mimeType)) {
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
                  </div>
                )}
            </div>
            </div>

            <div className="workspace-tool-rail-bottom-panels">
            {/* Workspace Files Panel — Phase 1: skeleton, list + read */}
            <WorkspaceFilesPanel
              key={workspaceFilesPanelKey}
              workspaceId={currentWorkspaceId}
              workspaceName={currentWorkspace?.name ?? 'No workspace selected'}
              isExpanded={isPanelExpanded('workspaceFiles')}
              onToggleExpand={() => togglePanel('workspaceFiles')}
              onError={(err) => setWorkspaceFilesError(err.message)}
            />
            {workspaceFilesError && (
              <div style={{ padding: '0 12px 8px', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                Files panel: {workspaceFilesError}
              </div>
            )}

            {/* UWAF Network Hub Panel */}
            {uwafBrowserEnabled && (
              <UwafNetworkPanel
                currentMode={uwafBrowserMode}
                onModeChange={switchUwafBrowserMode}
                isExpanded={isPanelExpanded('networkHub')}
                onToggleExpand={() => togglePanel('networkHub')}
              />
            )}

            {/* UWAF Browser — Live View (shown when internet is enabled) */}
            {internetEnabled && uwafBrowserEnabled && settings?.workspaceToolUwafLiveBrowser && currentSessionId && browserLiveStatus !== 'failed' && !browserModalOpen ? (
              <LiveBrowserView
                key={`${currentSessionId}:${uwafBrowserMode}:inline`}
                sessionId={currentSessionId}
                mode={uwafBrowserMode}
                currentUrl={uwafCurrentUrl}
                title={uwafCurrentTitle}
                onInterruptChange={setBrowserInterrupted}
                onStatusChange={setBrowserLiveStatus}
                enabled={true}
                isExpanded={isPanelExpanded('liveBrowser')}
                onToggleExpand={() => togglePanel('liveBrowser')}
              />
            ) : null}

            {/* Live Browser Expand Button */}
            {internetEnabled && uwafBrowserEnabled && settings?.workspaceToolUwafLiveBrowser && currentSessionId && browserLiveStatus !== 'failed' && !browserModalOpen && (
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
            </div>

            {/* Browser Modal */}
            {browserModalOpen && currentSessionId && (
              <BrowserModal
                key={`${currentSessionId}:${uwafBrowserMode}:modal`}
                sessionId={currentSessionId}
                mode={uwafBrowserMode}
                currentUrl={uwafCurrentUrl}
                title={uwafCurrentTitle}
                enabled={settings?.workspaceToolUwafLiveBrowser ?? true}
                isOpen={browserModalOpen}
                onOpenChange={setBrowserModalOpen}
                onInterruptChange={setBrowserInterrupted}
                takeoverRequestId={browserTakeoverRequestId}
              />
            )}

            <div className="workspace-tool-rail-footer">
              {configSaving ? 'Saving settings...' : sessionMessagesLoading ? 'Loading WorkSpaces thread…' : configError || connectionSummary || modelControlNote || selectedSessionInfo}
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
            <div className="workspace-tool-card" style={{ gap: '12px', position: 'sticky', top: 0, zIndex: 1, background: 'var(--sidebar-bg)' }}>
              <div className="workspace-tool-card-header">
                <div>
                  <div className="workspace-tool-section-label">Compare branches</div>
                  <div style={{ marginTop: '6px', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                    Compare summaries, analytics, and latest outcomes across related WorkSpaces session branches.
                  </div>
                </div>
                <button
                  type="button"
                  className="workspace-tool-inline-button"
                  onClick={() => setBranchCompareOpen(false)}
                >
                  <X size={14} />
                  Close
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                <div>
                  <label className="workspace-tool-field-label" htmlFor="branch-compare-left">Left branch</label>
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
                  <label className="workspace-tool-field-label" htmlFor="branch-compare-right">Right branch</label>
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
                  <div key={index === 0 ? 'left' : 'right'} className="workspace-tool-card" style={{ gap: '12px' }}>
                    <div className="workspace-tool-card-header">
                      <div>
                        <div className="workspace-tool-section-label">{index === 0 ? 'Left branch' : 'Right branch'}</div>
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
                        <div className="workspace-tool-disclosure-pill-row">
                          <span className="workspace-tool-disclosure-pill">{session.autoContinueMode} continue</span>
                          <span className="workspace-tool-disclosure-pill">{session.analytics?.assistantTokens.toLocaleString() || 0} tokens</span>
                          <span className="workspace-tool-disclosure-pill">{session.analytics?.toolCalls || 0} tools</span>
                          <span className="workspace-tool-disclosure-pill">{session.branchChildrenCount} child branches</span>
                        </div>
                        {session.summary && (
                          <div style={{ padding: '12px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--panel-bg)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                            <div className="workspace-tool-section-label" style={{ marginBottom: '8px' }}>Summary</div>
                            {session.summary}
                          </div>
                        )}
                        {session.contextSummary && (
                          <div style={{ padding: '12px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--panel-bg)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                            <div className="workspace-tool-section-label" style={{ marginBottom: '8px' }}>Working memory</div>
                            {session.contextSummary}
                          </div>
                        )}
                        <div style={{ padding: '12px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--panel-bg)' }}>
                          <div className="workspace-tool-section-label" style={{ marginBottom: '8px' }}>Latest assistant outcome</div>
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
