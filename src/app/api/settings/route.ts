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
  normalizeOpenClawBaseUrl,
  normalizeOpenClawAllowedPaths,
  normalizeOpenClawFileAccessMode,
  normalizeOpenClawFileWriteMode,
  normalizeOpenClawProvider,
  normalizeOpenClawCodeExecutionMode,
  normalizeOpenClawBrowserMode,
  normalizeOpenClawAutomationExecutionMaxRunsPerHour,
  normalizeOpenClawAutomationExecutionModel,
  normalizeOpenClawUwafBrowserMode,
  normalizeOpenClawUwafDefaultMode,
  normalizeOpenClawHostAccessMode,
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
import { buildEffectiveOpenClawToolAccess } from '@/lib/openclaw-tool-access';
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
  openClawProvider?: unknown;
  openClawModel?: unknown;
  openClawBaseUrl?: unknown;
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
  openClawPersonaTemplate?: unknown;
  openClawPersonaName?: unknown;
  openClawPersonaTone?: unknown;
  openClawPersonaExpertise?: unknown;
  openClawPersonaBoundaries?: unknown;
  openClawPersonaOperatingInstructions?: unknown;
  openClawUserProfileName?: unknown;
  openClawUserProfileRole?: unknown;
  openClawUserProfilePreferences?: unknown;
  openClawUserProfileContext?: unknown;
  openClawFileAccessMode?: unknown;
  openClawAllowedPaths?: unknown;
  openClawFileWriteMode?: unknown;
  openClawWritablePaths?: unknown;
  openClawHostAccessMode?: unknown;
  openClawCodeExecutionMode?: unknown;
  openClawBrowserMode?: unknown;
  openClawUwafBrowserMode?: unknown;
  openClawUwafScreenshots?: unknown;
  openClawUwafDefaultMode?: unknown;
  openClawUwafLiveBrowser?: unknown;
  openClawAutomationExecutionEnabled?: unknown;
  openClawAutomationExecutionModel?: unknown;
  openClawAutomationExecutionMaxRunsPerHour?: unknown;
  openClawAutomationExecutionAttachWorkspace?: unknown;
  openClawAutomationExecutionAttachMemory?: unknown;
  openClawSessionAutoContinueDefault?: unknown;
  openClawSessionAutoContinueMaxSteps?: unknown;
  openClawMaxToolRoundsPerTurn?: unknown;
  openClawSessionSummariesEnabled?: unknown;
  openClawSessionSummaryTargetTokens?: unknown;
  openClawSessionPreserveTurns?: unknown;
  openClawSessionAnalyticsEnabled?: unknown;
  openClawSessionBranchingEnabled?: unknown;
  ragEnabled?: unknown;
  ragTopK?: unknown;
  ollamaUseCloudApi?: unknown;
  ollamaApiKey?: unknown;
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
    if (settings.modelKeepAlive === true && settings.ollamaKeepAlive === '30m' && normalized.modelKeepAlive) {
      await prisma.userSettings.update({
        where: { userId: auth.user.id },
        data: {
          modelKeepAlive: false,
          ollamaKeepAlive: '0',
        },
      });
      normalized.modelKeepAlive = false;
      normalized.ollamaKeepAlive = '0';
    }
    return NextResponse.json({
      ...normalized,
      ollamaApiKey: '',
      permissions: auth.permissions,
      effectiveToolAccess: buildEffectiveOpenClawToolAccess(normalized, auth.permissions),
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
    if (body.openClawProvider !== undefined) data.openClawProvider = normalizeOpenClawProvider(body.openClawProvider);
    if (body.openClawModel !== undefined) data.openClawModel = String(body.openClawModel);
    if (body.openClawBaseUrl !== undefined) data.openClawBaseUrl = normalizeOpenClawBaseUrl(body.openClawBaseUrl);
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
    if (body.openClawPersonaTemplate !== undefined) data.openClawPersonaTemplate = normalizeString(body.openClawPersonaTemplate);
    if (body.openClawPersonaName !== undefined) data.openClawPersonaName = normalizeString(body.openClawPersonaName);
    if (body.openClawPersonaTone !== undefined) data.openClawPersonaTone = normalizeString(body.openClawPersonaTone);
    if (body.openClawPersonaExpertise !== undefined) data.openClawPersonaExpertise = normalizeString(body.openClawPersonaExpertise);
    if (body.openClawPersonaBoundaries !== undefined) data.openClawPersonaBoundaries = normalizeString(body.openClawPersonaBoundaries);
    if (body.openClawPersonaOperatingInstructions !== undefined) data.openClawPersonaOperatingInstructions = normalizeString(body.openClawPersonaOperatingInstructions);
    if (body.openClawUserProfileName !== undefined) data.openClawUserProfileName = normalizeString(body.openClawUserProfileName);
    if (body.openClawUserProfileRole !== undefined) data.openClawUserProfileRole = normalizeString(body.openClawUserProfileRole);
    if (body.openClawUserProfilePreferences !== undefined) data.openClawUserProfilePreferences = normalizeString(body.openClawUserProfilePreferences);
    if (body.openClawUserProfileContext !== undefined) data.openClawUserProfileContext = normalizeString(body.openClawUserProfileContext);
    if (body.shellExecutionMode !== undefined) data.shellExecutionMode = normalizeShellExecutionMode(body.shellExecutionMode);
    if (body.shellAllowedCommands !== undefined) data.shellAllowedCommands = normalizeString(body.shellAllowedCommands);
    if (body.shellHostAllowedRoots !== undefined) data.shellHostAllowedRoots = normalizeShellHostAllowedRoots(body.shellHostAllowedRoots);
    if (body.shellHostAllowedEnvVars !== undefined) data.shellHostAllowedEnvVars = normalizeShellHostAllowedEnvVars(body.shellHostAllowedEnvVars);
    if (body.shellHostMaxTimeoutMs !== undefined) data.shellHostMaxTimeoutMs = normalizeShellHostMaxTimeoutMs(body.shellHostMaxTimeoutMs);
    if (body.shellHostMaxOutputBytes !== undefined) data.shellHostMaxOutputBytes = normalizeShellHostMaxOutputBytes(body.shellHostMaxOutputBytes);
    if (body.openClawFileAccessMode !== undefined) data.openClawFileAccessMode = normalizeOpenClawFileAccessMode(body.openClawFileAccessMode);
    if (body.openClawAllowedPaths !== undefined) data.openClawAllowedPaths = normalizeOpenClawAllowedPaths(body.openClawAllowedPaths);
    if (body.openClawFileWriteMode !== undefined) data.openClawFileWriteMode = normalizeOpenClawFileWriteMode(body.openClawFileWriteMode);
    if (body.openClawWritablePaths !== undefined) data.openClawWritablePaths = normalizeOpenClawAllowedPaths(body.openClawWritablePaths);
    if (body.openClawHostAccessMode !== undefined) data.openClawHostAccessMode = normalizeOpenClawHostAccessMode(body.openClawHostAccessMode);
    if (body.openClawCodeExecutionMode !== undefined) data.openClawCodeExecutionMode = normalizeOpenClawCodeExecutionMode(body.openClawCodeExecutionMode);
    if (body.openClawBrowserMode !== undefined) data.openClawBrowserMode = normalizeOpenClawBrowserMode(body.openClawBrowserMode);
    if (body.openClawUwafBrowserMode !== undefined) data.openClawUwafBrowserMode = normalizeOpenClawUwafBrowserMode(body.openClawUwafBrowserMode);
    if (Object.prototype.hasOwnProperty.call(body, 'openClawUwafScreenshots')) data.openClawUwafScreenshots = false;
    if (body.openClawUwafDefaultMode !== undefined) data.openClawUwafDefaultMode = normalizeOpenClawUwafDefaultMode(body.openClawUwafDefaultMode);
    if (Object.prototype.hasOwnProperty.call(body, 'openClawUwafLiveBrowser')) data.openClawUwafLiveBrowser = normalizeBoolean(body.openClawUwafLiveBrowser);
    if (Object.prototype.hasOwnProperty.call(body, 'openClawAutomationExecutionEnabled')) {
      data.openClawAutomationExecutionEnabled = normalizeBoolean(body.openClawAutomationExecutionEnabled);
    }
    if (body.openClawAutomationExecutionModel !== undefined) {
      data.openClawAutomationExecutionModel = normalizeOpenClawAutomationExecutionModel(body.openClawAutomationExecutionModel);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'openClawAutomationExecutionMaxRunsPerHour')) {
      data.openClawAutomationExecutionMaxRunsPerHour = normalizeOpenClawAutomationExecutionMaxRunsPerHour(
        body.openClawAutomationExecutionMaxRunsPerHour
      );
    }
    if (Object.prototype.hasOwnProperty.call(body, 'openClawAutomationExecutionAttachWorkspace')) {
      data.openClawAutomationExecutionAttachWorkspace = normalizeBoolean(body.openClawAutomationExecutionAttachWorkspace);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'openClawAutomationExecutionAttachMemory')) {
      data.openClawAutomationExecutionAttachMemory = normalizeBoolean(body.openClawAutomationExecutionAttachMemory);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'openClawSessionAutoContinueDefault')) {
      data.openClawSessionAutoContinueDefault = normalizeSessionAutoContinueMode(body.openClawSessionAutoContinueDefault);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'openClawSessionAutoContinueMaxSteps')) {
      data.openClawSessionAutoContinueMaxSteps = normalizeSessionAutoContinueMaxSteps(
        body.openClawSessionAutoContinueMaxSteps,
        DEFAULT_SETTINGS.openClawSessionAutoContinueMaxSteps,
      );
    }
    if (Object.prototype.hasOwnProperty.call(body, 'openClawMaxToolRoundsPerTurn')) {
      data.openClawMaxToolRoundsPerTurn = normalizeMaxToolRoundsPerTurn(
        body.openClawMaxToolRoundsPerTurn,
        DEFAULT_SETTINGS.openClawMaxToolRoundsPerTurn,
      );
    }
    if (Object.prototype.hasOwnProperty.call(body, 'openClawSessionSummariesEnabled')) {
      data.openClawSessionSummariesEnabled = normalizeBoolean(body.openClawSessionSummariesEnabled);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'openClawSessionSummaryTargetTokens')) {
      data.openClawSessionSummaryTargetTokens = normalizeSessionSummaryTargetTokens(
        body.openClawSessionSummaryTargetTokens,
        DEFAULT_SETTINGS.openClawSessionSummaryTargetTokens,
      );
    }
    if (Object.prototype.hasOwnProperty.call(body, 'openClawSessionPreserveTurns')) {
      data.openClawSessionPreserveTurns = normalizeSessionPreserveTurns(
        body.openClawSessionPreserveTurns,
        DEFAULT_SETTINGS.openClawSessionPreserveTurns,
      );
    }
    if (Object.prototype.hasOwnProperty.call(body, 'openClawSessionAnalyticsEnabled')) {
      data.openClawSessionAnalyticsEnabled = normalizeBoolean(body.openClawSessionAnalyticsEnabled);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'openClawSessionBranchingEnabled')) {
      data.openClawSessionBranchingEnabled = normalizeBoolean(body.openClawSessionBranchingEnabled);
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
      effectiveToolAccess: buildEffectiveOpenClawToolAccess(normalized, auth.permissions),
      reindexTriggered: reindexResult.triggered,
      reindexSkipped: reindexResult.skipped,
    });
  } catch (error) {
    console.error('Settings POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
