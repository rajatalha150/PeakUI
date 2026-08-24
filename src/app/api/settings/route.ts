import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentAuth } from '@/lib/request-auth';
import {
  DEFAULT_SETTINGS,
  normalizeAppSettings,
  normalizeBoolean,
  normalizeChatModelProvider,
  normalizeChatPlatform,
  normalizeContextLength,
  normalizeHuggingFaceBaseUrl,
  normalizeOllamaHost,
  normalizeOllamaKeepAlive,
  normalizeOllamaUseModelDefaultContext,
  normalizeOllamaUseModelDefaultTemperature,
  normalizeWorkspaceToolBaseUrl,
  normalizeWorkspaceToolAllowedPaths,
  normalizeWorkspaceToolFileAccessMode,
  normalizeWorkspaceToolFileWriteMode,
  normalizeWorkspaceToolProvider,
  normalizeWorkspaceToolPromptTier,
  normalizeWorkspaceToolCodeExecutionMode,
  normalizeWorkspaceToolBrowserMode,
  normalizeWorkspaceToolAutomationExecutionMaxRunsPerHour,
  normalizeWorkspaceToolAutomationExecutionModel,
  normalizeWorkspaceToolFavoriteModels,
  normalizeWorkspaceToolUwafBrowserMode,
  normalizeWorkspaceToolUwafDefaultMode,
  normalizeWorkspaceToolHostAccessMode,
  normalizeRagMode,
  normalizeRagModel,
  normalizeShellExecutionMode,
  normalizeShellExecutionTarget,
  normalizeShellHostAllowedRoots,
  normalizeShellHostAllowedEnvVars,
  normalizeShellHostMaxTimeoutMs,
  normalizeShellHostMaxOutputBytes,
  normalizeTemperature,
  normalizeString,
  LEGACY_DEFAULT_SYSTEM_PROMPT,
} from '@/lib/settings';
import {
  normalizeMaxToolRoundsPerTurn,
  normalizeSessionAutoContinueMaxSteps,
  normalizeSessionAutoContinueMode,
  normalizeSessionPreserveTurns,
  normalizeSessionSummaryTargetTokens,
} from '@/lib/session-intelligence';
import { buildEffectiveWorkspaceToolAccess } from '@/lib/workspace-tool-tool-access';
import { normalizeTheme } from '@/lib/theme-options';
import { reindexDocumentsIfModelChanged } from '@/lib/rag-queue';

interface SettingsBody {
  chatPlatform?: unknown;
  chatModel?: unknown;
  chatModelProvider?: unknown;
  huggingFaceBaseUrl?: unknown;
  modelKeepAlive?: unknown;
  ollamaKeepAlive?: unknown;
  exclusiveOllamaModels?: unknown;
  workspaceToolProvider?: unknown;
  workspaceToolModel?: unknown;
  workspaceToolPromptTier?: unknown;
  workspaceToolBaseUrl?: unknown;
  shellExecutionTarget?: unknown;
  shellExecutionMode?: unknown;
  shellAllowedCommands?: unknown;
  shellHostAllowedRoots?: unknown;
  shellHostAllowedEnvVars?: unknown;
  shellHostMaxTimeoutMs?: unknown;
  shellHostMaxOutputBytes?: unknown;
  ragModel?: unknown;
  ragMode?: unknown;
  ollamaHost?: unknown;
  systemPrompt?: unknown;
  temperature?: unknown;
  ollamaUseModelDefaultTemperature?: unknown;
  contextLength?: unknown;
  ollamaUseModelDefaultContext?: unknown;
  theme?: unknown;
  workspaceToolPersonaTemplate?: unknown;
  workspaceToolPersonaName?: unknown;
  workspaceToolPersonaTone?: unknown;
  workspaceToolPersonaExpertise?: unknown;
  workspaceToolPersonaBoundaries?: unknown;
  workspaceToolPersonaOperatingInstructions?: unknown;
  workspaceToolUserProfileName?: unknown;
  workspaceToolUserProfileRole?: unknown;
  workspaceToolUserProfilePreferences?: unknown;
  workspaceToolUserProfileContext?: unknown;
  workspaceToolFileAccessMode?: unknown;
  workspaceToolAllowedPaths?: unknown;
  workspaceToolFileWriteMode?: unknown;
  workspaceToolWritablePaths?: unknown;
  workspaceToolHostAccessMode?: unknown;
  workspaceToolCodeExecutionMode?: unknown;
  workspaceToolBrowserMode?: unknown;
  workspaceToolUwafBrowserMode?: unknown;
  workspaceToolUwafScreenshots?: unknown;
  workspaceToolUwafDefaultMode?: unknown;
  workspaceToolUwafLiveBrowser?: unknown;
  workspaceToolAutomationExecutionEnabled?: unknown;
  workspaceToolAutomationExecutionModel?: unknown;
  workspaceToolAutomationExecutionMaxRunsPerHour?: unknown;
  workspaceToolAutomationExecutionAttachWorkspace?: unknown;
  workspaceToolAutomationExecutionAttachMemory?: unknown;
  workspaceToolSessionAutoContinueDefault?: unknown;
  workspaceToolSessionAutoContinueMaxSteps?: unknown;
  workspaceToolMaxToolRoundsPerTurn?: unknown;
  workspaceToolSessionSummariesEnabled?: unknown;
  workspaceToolSessionSummaryTargetTokens?: unknown;
  workspaceToolSessionPreserveTurns?: unknown;
  workspaceToolSessionAnalyticsEnabled?: unknown;
  workspaceToolSessionBranchingEnabled?: unknown;
  ragEnabled?: unknown;
  ragTopK?: unknown;
  ollamaUseCloudApi?: unknown;
  ollamaApiKey?: unknown;
  workspaceToolFavoriteModels?: unknown;
}

// GET: Return user settings (create defaults if none exist)
export async function GET() {
  try {
    const auth = await getCurrentAuth();
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let settings = await prisma.userSettings.findUnique({ where: { userId: auth.user.id } });

    if (!settings) {
      settings = await prisma.userSettings.create({
        data: { userId: auth.user.id, ...DEFAULT_SETTINGS }
      });
    }

    const normalized = normalizeAppSettings(settings)
    return NextResponse.json({
      ...normalized,
      ollamaApiKey: '',
      permissions: auth.permissions,
      effectiveToolAccess: buildEffectiveWorkspaceToolAccess(normalized, auth.permissions),
    });
  } catch (error) {
    console.error('Settings GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST: Save user settings
export async function POST(req: Request) {
  try {
    const auth = await getCurrentAuth();
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json() as SettingsBody;

    // Whitelist only known fields
    const data: Partial<typeof DEFAULT_SETTINGS> = {};
    if (body.chatPlatform !== undefined) data.chatPlatform = normalizeChatPlatform(body.chatPlatform);
    if (body.chatModel !== undefined) data.chatModel = String(body.chatModel);
    if (body.chatModelProvider !== undefined) data.chatModelProvider = normalizeChatModelProvider(body.chatModelProvider);
    if (body.huggingFaceBaseUrl !== undefined) data.huggingFaceBaseUrl = normalizeHuggingFaceBaseUrl(body.huggingFaceBaseUrl);
    if (Object.prototype.hasOwnProperty.call(body, 'modelKeepAlive')) {
      const enabled = normalizeBoolean(body.modelKeepAlive, DEFAULT_SETTINGS.modelKeepAlive);
      data.modelKeepAlive = enabled;
      if (!enabled) data.ollamaKeepAlive = '0';
    }
    if (Object.prototype.hasOwnProperty.call(body, 'ollamaKeepAlive') && data.modelKeepAlive !== false) {
      const keepAlive = normalizeOllamaKeepAlive(body.ollamaKeepAlive);
      data.ollamaKeepAlive = keepAlive === '0' ? DEFAULT_SETTINGS.ollamaKeepAlive : keepAlive;
    }
    if (body.exclusiveOllamaModels !== undefined) data.exclusiveOllamaModels = normalizeBoolean(body.exclusiveOllamaModels);
    if (body.workspaceToolProvider !== undefined) data.workspaceToolProvider = normalizeWorkspaceToolProvider(body.workspaceToolProvider);
    if (body.workspaceToolModel !== undefined) data.workspaceToolModel = String(body.workspaceToolModel);
    if (body.workspaceToolPromptTier !== undefined) data.workspaceToolPromptTier = normalizeWorkspaceToolPromptTier(body.workspaceToolPromptTier);
    if (body.workspaceToolBaseUrl !== undefined) data.workspaceToolBaseUrl = normalizeWorkspaceToolBaseUrl(body.workspaceToolBaseUrl);
    if (body.shellExecutionTarget !== undefined) data.shellExecutionTarget = normalizeShellExecutionTarget(body.shellExecutionTarget);
    if (body.ragModel !== undefined) data.ragModel = normalizeRagModel(body.ragModel);
    if (body.ragMode !== undefined) data.ragMode = normalizeRagMode(body.ragMode);
    if (body.ollamaHost !== undefined) data.ollamaHost = normalizeOllamaHost(body.ollamaHost);
    if (body.systemPrompt !== undefined) {
      const systemPrompt = String(body.systemPrompt);
      data.systemPrompt = systemPrompt.trim() === LEGACY_DEFAULT_SYSTEM_PROMPT ? '' : systemPrompt;
    }
    if (body.temperature !== undefined) data.temperature = normalizeTemperature(body.temperature);
    if (Object.prototype.hasOwnProperty.call(body, 'ollamaUseModelDefaultTemperature')) {
      data.ollamaUseModelDefaultTemperature = normalizeOllamaUseModelDefaultTemperature(body.ollamaUseModelDefaultTemperature);
    }
    if (body.contextLength !== undefined) data.contextLength = normalizeContextLength(body.contextLength);
    if (Object.prototype.hasOwnProperty.call(body, 'ollamaUseModelDefaultContext')) {
      data.ollamaUseModelDefaultContext = normalizeOllamaUseModelDefaultContext(
        body.ollamaUseModelDefaultContext,
        body.contextLength !== undefined
          ? normalizeContextLength(body.contextLength)
          : DEFAULT_SETTINGS.contextLength,
      );
    }
    if (body.theme !== undefined) data.theme = normalizeTheme(body.theme);
    if (body.workspaceToolPersonaTemplate !== undefined) data.workspaceToolPersonaTemplate = normalizeString(body.workspaceToolPersonaTemplate);
    if (body.workspaceToolPersonaName !== undefined) data.workspaceToolPersonaName = normalizeString(body.workspaceToolPersonaName);
    if (body.workspaceToolPersonaTone !== undefined) data.workspaceToolPersonaTone = normalizeString(body.workspaceToolPersonaTone);
    if (body.workspaceToolPersonaExpertise !== undefined) data.workspaceToolPersonaExpertise = normalizeString(body.workspaceToolPersonaExpertise);
    if (body.workspaceToolPersonaBoundaries !== undefined) data.workspaceToolPersonaBoundaries = normalizeString(body.workspaceToolPersonaBoundaries);
    if (body.workspaceToolPersonaOperatingInstructions !== undefined) data.workspaceToolPersonaOperatingInstructions = normalizeString(body.workspaceToolPersonaOperatingInstructions);
    if (body.workspaceToolUserProfileName !== undefined) data.workspaceToolUserProfileName = normalizeString(body.workspaceToolUserProfileName);
    if (body.workspaceToolUserProfileRole !== undefined) data.workspaceToolUserProfileRole = normalizeString(body.workspaceToolUserProfileRole);
    if (body.workspaceToolUserProfilePreferences !== undefined) data.workspaceToolUserProfilePreferences = normalizeString(body.workspaceToolUserProfilePreferences);
    if (body.workspaceToolUserProfileContext !== undefined) data.workspaceToolUserProfileContext = normalizeString(body.workspaceToolUserProfileContext);
    if (body.shellExecutionMode !== undefined) data.shellExecutionMode = normalizeShellExecutionMode(body.shellExecutionMode);
    if (body.shellAllowedCommands !== undefined) data.shellAllowedCommands = normalizeString(body.shellAllowedCommands);
    if (body.shellHostAllowedRoots !== undefined) data.shellHostAllowedRoots = normalizeShellHostAllowedRoots(body.shellHostAllowedRoots);
    if (body.shellHostAllowedEnvVars !== undefined) data.shellHostAllowedEnvVars = normalizeShellHostAllowedEnvVars(body.shellHostAllowedEnvVars);
    if (body.shellHostMaxTimeoutMs !== undefined) data.shellHostMaxTimeoutMs = normalizeShellHostMaxTimeoutMs(body.shellHostMaxTimeoutMs);
    if (body.shellHostMaxOutputBytes !== undefined) data.shellHostMaxOutputBytes = normalizeShellHostMaxOutputBytes(body.shellHostMaxOutputBytes);
    if (body.workspaceToolFileAccessMode !== undefined) data.workspaceToolFileAccessMode = normalizeWorkspaceToolFileAccessMode(body.workspaceToolFileAccessMode);
    if (body.workspaceToolAllowedPaths !== undefined) data.workspaceToolAllowedPaths = normalizeWorkspaceToolAllowedPaths(body.workspaceToolAllowedPaths);
    if (body.workspaceToolFileWriteMode !== undefined) data.workspaceToolFileWriteMode = normalizeWorkspaceToolFileWriteMode(body.workspaceToolFileWriteMode);
    if (body.workspaceToolWritablePaths !== undefined) data.workspaceToolWritablePaths = normalizeWorkspaceToolAllowedPaths(body.workspaceToolWritablePaths);
    if (body.workspaceToolHostAccessMode !== undefined) data.workspaceToolHostAccessMode = normalizeWorkspaceToolHostAccessMode(body.workspaceToolHostAccessMode);
    if (body.workspaceToolCodeExecutionMode !== undefined) data.workspaceToolCodeExecutionMode = normalizeWorkspaceToolCodeExecutionMode(body.workspaceToolCodeExecutionMode);
    if (body.workspaceToolBrowserMode !== undefined) data.workspaceToolBrowserMode = normalizeWorkspaceToolBrowserMode(body.workspaceToolBrowserMode);
    if (body.workspaceToolUwafBrowserMode !== undefined) data.workspaceToolUwafBrowserMode = normalizeWorkspaceToolUwafBrowserMode(body.workspaceToolUwafBrowserMode);
    if (Object.prototype.hasOwnProperty.call(body, 'workspaceToolUwafScreenshots')) data.workspaceToolUwafScreenshots = false;
    if (body.workspaceToolUwafDefaultMode !== undefined) data.workspaceToolUwafDefaultMode = normalizeWorkspaceToolUwafDefaultMode(body.workspaceToolUwafDefaultMode);
    if (Object.prototype.hasOwnProperty.call(body, 'workspaceToolUwafLiveBrowser')) data.workspaceToolUwafLiveBrowser = normalizeBoolean(body.workspaceToolUwafLiveBrowser);
    if (Object.prototype.hasOwnProperty.call(body, 'workspaceToolAutomationExecutionEnabled')) {
      data.workspaceToolAutomationExecutionEnabled = normalizeBoolean(body.workspaceToolAutomationExecutionEnabled);
    }
    if (body.workspaceToolAutomationExecutionModel !== undefined) {
      data.workspaceToolAutomationExecutionModel = normalizeWorkspaceToolAutomationExecutionModel(body.workspaceToolAutomationExecutionModel);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'workspaceToolAutomationExecutionMaxRunsPerHour')) {
      data.workspaceToolAutomationExecutionMaxRunsPerHour = normalizeWorkspaceToolAutomationExecutionMaxRunsPerHour(
        body.workspaceToolAutomationExecutionMaxRunsPerHour
      );
    }
    if (Object.prototype.hasOwnProperty.call(body, 'workspaceToolAutomationExecutionAttachWorkspace')) {
      data.workspaceToolAutomationExecutionAttachWorkspace = normalizeBoolean(body.workspaceToolAutomationExecutionAttachWorkspace);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'workspaceToolAutomationExecutionAttachMemory')) {
      data.workspaceToolAutomationExecutionAttachMemory = normalizeBoolean(body.workspaceToolAutomationExecutionAttachMemory);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'workspaceToolSessionAutoContinueDefault')) {
      data.workspaceToolSessionAutoContinueDefault = normalizeSessionAutoContinueMode(body.workspaceToolSessionAutoContinueDefault);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'workspaceToolSessionAutoContinueMaxSteps')) {
      data.workspaceToolSessionAutoContinueMaxSteps = normalizeSessionAutoContinueMaxSteps(
        body.workspaceToolSessionAutoContinueMaxSteps,
        DEFAULT_SETTINGS.workspaceToolSessionAutoContinueMaxSteps,
      );
    }
    if (Object.prototype.hasOwnProperty.call(body, 'workspaceToolMaxToolRoundsPerTurn')) {
      data.workspaceToolMaxToolRoundsPerTurn = normalizeMaxToolRoundsPerTurn(
        body.workspaceToolMaxToolRoundsPerTurn,
        DEFAULT_SETTINGS.workspaceToolMaxToolRoundsPerTurn,
      );
    }
    if (Object.prototype.hasOwnProperty.call(body, 'workspaceToolSessionSummariesEnabled')) {
      data.workspaceToolSessionSummariesEnabled = normalizeBoolean(body.workspaceToolSessionSummariesEnabled);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'workspaceToolSessionSummaryTargetTokens')) {
      data.workspaceToolSessionSummaryTargetTokens = normalizeSessionSummaryTargetTokens(
        body.workspaceToolSessionSummaryTargetTokens,
        DEFAULT_SETTINGS.workspaceToolSessionSummaryTargetTokens,
      );
    }
    if (Object.prototype.hasOwnProperty.call(body, 'workspaceToolSessionPreserveTurns')) {
      data.workspaceToolSessionPreserveTurns = normalizeSessionPreserveTurns(
        body.workspaceToolSessionPreserveTurns,
        DEFAULT_SETTINGS.workspaceToolSessionPreserveTurns,
      );
    }
    if (Object.prototype.hasOwnProperty.call(body, 'workspaceToolSessionAnalyticsEnabled')) {
      data.workspaceToolSessionAnalyticsEnabled = normalizeBoolean(body.workspaceToolSessionAnalyticsEnabled);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'workspaceToolSessionBranchingEnabled')) {
      data.workspaceToolSessionBranchingEnabled = normalizeBoolean(body.workspaceToolSessionBranchingEnabled);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'ragEnabled')) data.ragEnabled = normalizeBoolean(body.ragEnabled);
    if (Object.prototype.hasOwnProperty.call(body, 'ollamaUseCloudApi')) data.ollamaUseCloudApi = normalizeBoolean(body.ollamaUseCloudApi);
    if (body.ollamaApiKey !== undefined) data.ollamaApiKey = String(body.ollamaApiKey);
    if (Object.prototype.hasOwnProperty.call(body, 'ragTopK')) {
      const parsed = Number(body.ragTopK);
      // -1 means full access mode
      if (parsed === -1) {
        data.ragTopK = -1;
      } else if (Number.isFinite(parsed) && parsed >= 1) {
        data.ragTopK = Math.round(parsed);
      } else {
        data.ragTopK = 8;
      }
    }
    if (body.workspaceToolFavoriteModels !== undefined) {
      // Stored as a JSON-encoded string in the column; normalized (deduped,
      // capped, control-char-stripped) on the way in and out.
      data.workspaceToolFavoriteModels = JSON.stringify(normalizeWorkspaceToolFavoriteModels(body.workspaceToolFavoriteModels));
    }

    const settings = await prisma.userSettings.upsert({
      where: { userId: auth.user.id },
      update: data,
      create: { userId: auth.user.id, ...DEFAULT_SETTINGS, ...data }
    });

    const normalized = normalizeAppSettings(settings)

    // Trigger re-indexing if the RAG model changed or if we switched back to semantic.
    const reindexResult = await reindexDocumentsIfModelChanged(auth.user.id, normalized.ragModel, {
      ragMode: normalized.ragMode as 'semantic' | 'keyword',
      ollamaHost: normalized.ollamaHost,
      ollamaApiKey: normalized.ollamaApiKey ?? '',
    })
    if (reindexResult.triggered > 0) {
      console.info(`Marked ${reindexResult.triggered} documents for re-indexing after RAG model change.`)
    }

    return NextResponse.json({
      ...normalized,
      ollamaApiKey: '', // scrubbed
      permissions: auth.permissions,
      effectiveToolAccess: buildEffectiveWorkspaceToolAccess(normalized, auth.permissions),
      reindexTriggered: reindexResult.triggered,
      reindexSkipped: reindexResult.skipped,
    });
  } catch (error) {
    console.error('Settings POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
