import { prisma } from "./prisma";
import type { AppSettings } from "./settings";
import { getUserSettings } from "./settings";
import { upsertChatSession } from "./chat-sessions";
import * as archiver from "archiver";
import { randomUUID } from "node:crypto";

export type BackupScope = "chats" | "settings" | "knowledgeBase" | "canvas" | "automation" | "connectionSecrets";
export const BACKUP_VERSION = 2;
export const BACKUP_SETTINGS_FIELDS = [
  "chatPlatform", "chatModel", "chatModelProvider", "huggingFaceBaseUrl", "modelKeepAlive",
  "ollamaKeepAlive", "exclusiveOllamaModels", "workspaceToolProvider", "workspaceToolModel",
  "workspaceToolVisionModel", "workspaceToolPromptTier", "workspaceToolBaseUrl", "workspaceToolFavoriteModels",
  "ragModel", "ragMode", "ollamaHost", "systemPrompt", "temperature",
  "ollamaUseModelDefaultTemperature", "contextLength", "ollamaUseModelDefaultContext",
  "theme", "workspaceToolPersonaTemplate", "workspaceToolPersonaName", "workspaceToolPersonaTone",
  "workspaceToolPersonaExpertise", "workspaceToolPersonaBoundaries", "workspaceToolPersonaOperatingInstructions",
  "workspaceToolUserProfileName", "workspaceToolUserProfileRole", "workspaceToolUserProfilePreferences",
  "workspaceToolUserProfileContext", "shellExecutionTarget", "shellExecutionMode",
  "shellAllowedCommands", "shellHostAllowedRoots", "shellHostAllowedEnvVars",
  "shellHostMaxTimeoutMs", "shellHostMaxOutputBytes", "workspaceToolFileAccessMode",
  "workspaceToolAllowedPaths", "workspaceToolFileWriteMode", "workspaceToolWritablePaths",
  "workspaceToolHostAccessMode", "workspaceToolWorkspaceHostRoot", "workspaceToolCodeExecutionMode",
  "workspaceToolBrowserMode", "workspaceToolUwafBrowserMode", "workspaceToolUwafScreenshots",
  "workspaceToolUwafDefaultMode", "workspaceToolUwafLiveBrowser", "workspaceToolAutomationExecutionEnabled",
  "workspaceToolAutomationExecutionModel", "workspaceToolAutomationExecutionMaxRunsPerHour",
  "workspaceToolAutomationExecutionAttachWorkspace", "workspaceToolAutomationExecutionAttachMemory",
  "workspaceToolSessionAutoContinueDefault", "workspaceToolSessionAutoContinueMaxSteps",
  "workspaceToolMaxToolRoundsPerTurn", "workspaceToolSessionSummariesEnabled",
  "workspaceToolSessionSummaryTargetTokens", "workspaceToolSessionPreserveTurns",
  "workspaceToolSessionAnalyticsEnabled", "workspaceToolSessionBranchingEnabled", "workspaceToolNativeToolCalls",
  "ragEnabled", "ragTopK", "ollamaUseCloudApi",
  "imageGenProvider", "imageGenBaseUrl", "imageGenModel", "imageGenClipType", "imageGenClipName", "imageGenVaeName",
  "coderModel", "coderBaseUrl", "coderApprovalMode", "coderContextLength", "coderToolSearchThreshold",
  "coderWorkspace", "coderToolsEnabled", "coderVisionModel", "coderWriterModel", "coderTheme", "coderThemeAccent",
] as const;

export const BACKUP_SECRET_SETTINGS_FIELDS = [
  "ollamaApiKey", "firecrawlApiKey", "hfToken", "coderApiKey",
] as const;

export interface BackupManifest {
  version: number;
  createdAt: string;
  exportedBy: string;
  scopes: BackupScope[];
  userId: string;
}

export type BackupSettings = Partial<AppSettings>;

export interface BackupSessionTag {
  id: string;
  name: string;
  color: string;
}

export interface BackupSession {
  id: string;
  title: string;
  messages: string;
  summary?: string | null;
  contextSummary?: string | null;
  contextSummaryUpdatedAt?: string | null;
  analyticsJson?: string;
  autoContinueMode?: string;
  autoContinueMaxSteps?: number;
  lastAutoContinueAt?: string | null;
  parentSessionId?: string | null;
  branchFromMessageId?: string | null;
  branchLabel?: string | null;
  pinned: boolean;
  surface: string;
  coderWorkspace?: string | null;
  ragEnabled?: boolean;
  ragQuery?: string | null;
  ragSourcesJson?: string | null;
  createdAt: string;
  updatedAt: string;
  userId: string;
  folderId?: string | null;
  folder?: BackupFolder | null;
  tags: BackupSessionTag[];
}

export interface BackupFolder {
  id: string;
  name: string;
  color: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  userId: string;
}

export interface BackupTag {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  userId: string;
}

export interface BackupKnowledgeDocument {
  id: string;
  filename: string;
  sourcePath?: string | null;
  kind?: string | null;
  size: number;
  contentHash?: string | null;
  originalContent?: string | null;
  originalMimeType?: string | null;
  status: string;
  ragMode?: string;
  embeddingModel?: string | null;
  ollamaHost?: string | null;
  errorMessage?: string | null;
  indexedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  embeddingDimensions?: number | null;
  indexingProgress?: number | null;
  indexingAttempts?: number | null;
  chunkCount: number;
  fileEntry?: string;
}

export interface BackupCanvasArtifactRevision {
  version: number;
  name: string;
  content: string;
  mimeType: string;
  kind: string;
  extension?: string | null;
  size: number;
  previewKind: string;
  previewSummary?: string | null;
  previewWidth?: number | null;
  previewHeight?: number | null;
  contentHash?: string | null;
  presentationType: string;
  bundleId?: string | null;
  bundleName?: string | null;
  bundleRole?: string | null;
  exportTargets: string;
  sourceArtifactId?: string | null;
  messageId?: string | null;
  createdAt: string;
}

export interface BackupCanvasArtifact extends Omit<BackupCanvasArtifactRevision, "createdAt"> {
  id: string;
  sessionId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  revisions: BackupCanvasArtifactRevision[];
}

export interface BackupAutomationConfig {
  heartbeat?: {
    enabled: boolean;
    intervalMinutes: number;
    staleAfterMinutes: number;
    promptTemplate: string;
    deliveryMode: string;
    targetSessionId?: string | null;
    targetWorkspaceId?: string | null;
    nextRunAt?: string | null;
  } | null;
  schedules: Array<{
    id: string;
    name: string;
    prompt: string;
    deliveryMode: string;
    targetSessionId?: string | null;
    targetWorkspaceId?: string | null;
    cronExpression: string;
    timezone: string;
    enabled: boolean;
    nextRunAt: string;
  }>;
  monitors: Array<{
    id: string;
    name: string;
    deliveryMode: string;
    targetSessionId?: string | null;
    targetWorkspaceId?: string | null;
    kind: string;
    target: string;
    enabled: boolean;
    checkIntervalSeconds: number;
    triggerMode: string;
    expectedPattern?: string | null;
    nextCheckAt?: string | null;
  }>;
}

export interface BackupData {
  manifest: BackupManifest;
  settings?: BackupSettings | null;
  folders?: BackupFolder[];
  tags?: BackupTag[];
  sessions?: BackupSession[];
  knowledgeBase?: {
    documents: BackupKnowledgeDocument[];
  };
  canvas?: {
    artifacts: BackupCanvasArtifact[];
  };
  automation?: BackupAutomationConfig;
}

export interface BackupProgress {
  id: string;
  startedAt: number;
  phase: "prepare" | "chats" | "settings" | "knowledgeBase" | "canvas" | "automation" | "zip" | "download" | "restore" | "done" | "error";
  message: string;
  percent: number;
  scopes: BackupScope[];
  direction: "export" | "import";
  error?: string;
}

const progressStore = new Map<string, BackupProgress>();
const PROGRESS_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
let progressUpdateCounter = 0;

function maybeCleanupOldProgress() {
  progressUpdateCounter++;
  if (progressUpdateCounter % 50 === 0) {
    cleanupOldBackupProgress();
  }
}

export function filterBackupSettings(
  input: unknown,
  options: { includeStandard?: boolean; includeSecrets?: boolean } = {},
): Partial<AppSettings> {
  if (!input || typeof input !== "object") return {};
  const source = input as Record<string, unknown>;
  const allowed = new Set<string>([
    ...(options.includeStandard === false ? [] : BACKUP_SETTINGS_FIELDS),
    ...(options.includeSecrets ? BACKUP_SECRET_SETTINGS_FIELDS : []),
  ]);
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in source) {
      out[key] = source[key];
    }
  }
  return out as Partial<AppSettings>;
}

function updateProgress(
  id: string,
  partial: Partial<BackupProgress>,
  direction: "export" | "import",
  scopes: BackupScope[]
) {
  const existing = progressStore.get(id);
  const now = Date.now();
  const next: BackupProgress = {
    id,
    startedAt: existing?.startedAt ?? now,
    direction,
    scopes,
    phase: partial.phase ?? existing?.phase ?? "prepare",
    message: partial.message ?? existing?.message ?? "Starting...",
    percent: Math.min(100, Math.max(0, partial.percent ?? existing?.percent ?? 0)),
    error: partial.error ?? existing?.error,
  };
  progressStore.set(id, next);
  maybeCleanupOldProgress();
  return next;
}

export function getBackupProgress(id: string): BackupProgress | null {
  return progressStore.get(id) ?? null;
}

export function createBackupProgress(id: string, direction: "export" | "import", scopes: BackupScope[]): BackupProgress {
  return updateProgress(id, { phase: "prepare", message: "Preparing...", percent: 0 }, direction, scopes);
}

export function cleanupOldBackupProgress() {
  const now = Date.now();
  progressStore.forEach((entry, id) => {
    if (now - entry.startedAt > PROGRESS_MAX_AGE_MS) {
      progressStore.delete(id);
    }
  });
}

export async function exportBackupData(
  userId: string,
  username: string,
  scopes: BackupScope[]
): Promise<BackupData> {
  const includeChats = scopes.includes("chats");
  const includeSettings = scopes.includes("settings");
  const includeKb = scopes.includes("knowledgeBase");
  const includeCanvas = scopes.includes("canvas");
  const includeAutomation = scopes.includes("automation");
  const includeConnectionSecrets = scopes.includes("connectionSecrets");

  const data: BackupData = {
    manifest: {
      version: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      exportedBy: username,
      scopes,
      userId,
    },
  };

  if (includeChats) {
    const [folders, tags, sessions] = await Promise.all([
      prisma.folder.findMany({ where: { userId } }),
      prisma.tag.findMany({ where: { userId } }),
      prisma.chatSession.findMany({
        where: { userId },
        include: {
          tags: { include: { tag: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    data.folders = folders.map(f => ({
      id: f.id,
      name: f.name,
      color: f.color,
      order: f.order,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
      userId: f.userId,
    }));

    data.tags = tags.map(t => ({
      id: t.id,
      name: t.name,
      color: t.color,
      createdAt: t.createdAt.toISOString(),
      userId: t.userId,
    }));

    data.sessions = sessions.map(s => ({
      id: s.id,
      title: s.title,
      messages: s.messages,
      summary: s.summary,
      contextSummary: s.contextSummary,
      contextSummaryUpdatedAt: s.contextSummaryUpdatedAt?.toISOString() ?? null,
      analyticsJson: s.analyticsJson,
      autoContinueMode: s.autoContinueMode,
      autoContinueMaxSteps: s.autoContinueMaxSteps,
      lastAutoContinueAt: s.lastAutoContinueAt?.toISOString() ?? null,
      parentSessionId: s.parentSessionId,
      branchFromMessageId: s.branchFromMessageId,
      branchLabel: s.branchLabel,
      pinned: s.pinned,
      surface: s.surface,
      coderWorkspace: s.coderWorkspace,
      ragEnabled: s.ragEnabled,
      ragQuery: s.ragQuery,
      ragSourcesJson: s.ragSourcesJson,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      userId: s.userId,
      folderId: s.folderId ?? undefined,
      tags: s.tags.map(st => ({ id: st.tag.id, name: st.tag.name, color: st.tag.color })),
    }));
  }

  if (includeSettings || includeConnectionSecrets) {
    const settings = await prisma.userSettings.findUnique({ where: { userId } });
    if (settings) {
      data.settings = filterBackupSettings(settings, {
        includeStandard: includeSettings,
        includeSecrets: includeConnectionSecrets,
      }) as BackupSettings;
    }
  }

  if (includeKb) {
    const documents = await prisma.document.findMany({
      where: { userId },
      include: { _count: { select: { chunks: true } } },
      orderBy: { createdAt: "asc" },
    });

    data.knowledgeBase = {
      documents: documents.map(d => ({
        id: d.id,
        filename: d.filename,
        sourcePath: d.sourcePath,
        kind: d.kind,
        size: d.size,
        contentHash: d.contentHash,
        originalContent: d.originalContent,
        originalMimeType: d.originalMimeType,
        status: d.status,
        ragMode: d.ragMode,
        embeddingModel: d.embeddingModel,
        ollamaHost: d.ollamaHost,
        errorMessage: d.errorMessage,
        indexedAt: d.indexedAt?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
        embeddingDimensions: d.embeddingDimensions,
        indexingProgress: d.indexingProgress,
        indexingAttempts: d.indexingAttempts,
        chunkCount: d._count.chunks,
      })),
    };
  }

  if (includeCanvas) {
    const artifacts = await prisma.canvasArtifact.findMany({
      where: { userId },
      include: { revisions: { orderBy: { version: "asc" } } },
      orderBy: { createdAt: "asc" },
    });

    data.canvas = {
      artifacts: artifacts.map(artifact => ({
        id: artifact.id,
        name: artifact.name,
        content: artifact.content,
        mimeType: artifact.mimeType,
        kind: artifact.kind,
        extension: artifact.extension,
        size: artifact.size,
        previewKind: artifact.previewKind,
        previewSummary: artifact.previewSummary,
        previewWidth: artifact.previewWidth,
        previewHeight: artifact.previewHeight,
        contentHash: artifact.contentHash,
        presentationType: artifact.presentationType,
        bundleId: artifact.bundleId,
        bundleName: artifact.bundleName,
        bundleRole: artifact.bundleRole,
        exportTargets: artifact.exportTargets,
        sourceArtifactId: artifact.sourceArtifactId,
        sessionId: artifact.sessionId,
        messageId: artifact.messageId,
        version: artifact.version,
        createdAt: artifact.createdAt.toISOString(),
        updatedAt: artifact.updatedAt.toISOString(),
        revisions: artifact.revisions.map(revision => ({
          version: revision.version,
          name: revision.name,
          content: revision.content,
          mimeType: revision.mimeType,
          kind: revision.kind,
          extension: revision.extension,
          size: revision.size,
          previewKind: revision.previewKind,
          previewSummary: revision.previewSummary,
          previewWidth: revision.previewWidth,
          previewHeight: revision.previewHeight,
          contentHash: revision.contentHash,
          presentationType: revision.presentationType,
          bundleId: revision.bundleId,
          bundleName: revision.bundleName,
          bundleRole: revision.bundleRole,
          exportTargets: revision.exportTargets,
          sourceArtifactId: revision.sourceArtifactId,
          messageId: revision.messageId,
          createdAt: revision.createdAt.toISOString(),
        })),
      })),
    };
  }

  if (includeAutomation) {
    const [heartbeat, schedules, monitors] = await Promise.all([
      prisma.automationHeartbeatConfig.findUnique({ where: { userId } }),
      prisma.automationSchedule.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.automationMonitor.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    ]);
    data.automation = {
      heartbeat: heartbeat ? {
        enabled: heartbeat.enabled,
        intervalMinutes: heartbeat.intervalMinutes,
        staleAfterMinutes: heartbeat.staleAfterMinutes,
        promptTemplate: heartbeat.promptTemplate,
        deliveryMode: heartbeat.deliveryMode,
        targetSessionId: heartbeat.targetSessionId,
        targetWorkspaceId: heartbeat.targetWorkspaceId,
        nextRunAt: heartbeat.nextRunAt?.toISOString() ?? null,
      } : null,
      schedules: schedules.map(schedule => ({
        id: schedule.id, name: schedule.name, prompt: schedule.prompt, deliveryMode: schedule.deliveryMode,
        targetSessionId: schedule.targetSessionId, targetWorkspaceId: schedule.targetWorkspaceId,
        cronExpression: schedule.cronExpression, timezone: schedule.timezone, enabled: schedule.enabled,
        nextRunAt: schedule.nextRunAt.toISOString(),
      })),
      monitors: monitors.map(monitor => ({
        id: monitor.id, name: monitor.name, deliveryMode: monitor.deliveryMode,
        targetSessionId: monitor.targetSessionId, targetWorkspaceId: monitor.targetWorkspaceId,
        kind: monitor.kind, target: monitor.target, enabled: monitor.enabled,
        checkIntervalSeconds: monitor.checkIntervalSeconds, triggerMode: monitor.triggerMode,
        expectedPattern: monitor.expectedPattern, nextCheckAt: monitor.nextCheckAt?.toISOString() ?? null,
      })),
    };
  }

  return data;
}



export interface BackupExportStreamOptions {
  userId: string;
  username: string;
  scopes: BackupScope[];
  progressId: string;
  archive: archiver.Archiver;
  onEntry?: (data: Buffer | string, entry: { name: string }) => void;
}

export async function streamBackupToArchive(options: BackupExportStreamOptions): Promise<void> {
  const { userId, username, scopes, progressId, archive } = options;
  createBackupProgress(progressId, "export", scopes);

  try {
    updateProgress(progressId, { phase: "prepare", message: "Collecting backup data...", percent: 5 }, "export", scopes);
    const data = await exportBackupData(userId, username, scopes);

    const includeChats = scopes.includes("chats");
    const includeKb = scopes.includes("knowledgeBase");
    const includeCanvas = scopes.includes("canvas");
    const includeAutomation = scopes.includes("automation");

    let completed = 10;
    const selectedDataScopes = [includeChats, includeKb, includeCanvas, includeAutomation].filter(Boolean).length;
    const stepSize = selectedDataScopes > 0 ? Math.max(15, Math.floor(80 / selectedDataScopes)) : 80;

    // manifest + settings
    archive.append(JSON.stringify({ manifest: data.manifest, settings: data.settings }, null, 2), { name: "backup.json" });
    completed += 5;
    updateProgress(progressId, { phase: "settings", message: "Saving settings...", percent: completed }, "export", scopes);

    if (includeChats) {
      updateProgress(progressId, { phase: "chats", message: `Exporting ${data.sessions?.length ?? 0} chats...`, percent: completed }, "export", scopes);
      archive.append(JSON.stringify({ folders: data.folders, tags: data.tags, sessions: data.sessions }, null, 2), { name: "sessions.json" });
      completed += stepSize;
      updateProgress(progressId, { phase: "chats", message: `Exported ${data.sessions?.length ?? 0} chats.`, percent: completed }, "export", scopes);
    }

    if (includeKb && data.knowledgeBase) {
      updateProgress(progressId, { phase: "knowledgeBase", message: `Exporting ${data.knowledgeBase.documents.length} knowledge base documents...`, percent: completed }, "export", scopes);

      const docs = data.knowledgeBase.documents;
      for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        if (doc.originalContent) {
          const ext = doc.filename.includes(".") ? doc.filename.split(".").pop() ?? "txt" : "txt";
          const safeName = `${doc.id}.${ext}`;
          archive.append(doc.originalContent, { name: `knowledge-base/files/${safeName}` });
          doc.fileEntry = `knowledge-base/files/${safeName}`;
        }
        const pct = completed + Math.round(((i + 1) / docs.length) * stepSize * 0.9);
        updateProgress(progressId, { phase: "knowledgeBase", message: `Exported ${i + 1}/${docs.length} documents...`, percent: pct }, "export", scopes);
      }

      // Store metadata with fileEntry pointers
      archive.append(JSON.stringify({ documents: docs.map(d => ({ ...d, originalContent: undefined })) }, null, 2), { name: "knowledge-base/documents.json" });
      completed += stepSize;
      updateProgress(progressId, { phase: "knowledgeBase", message: `Exported ${docs.length} documents.`, percent: completed }, "export", scopes);
    }

    if (includeCanvas && data.canvas) {
      updateProgress(progressId, { phase: "canvas", message: `Exporting ${data.canvas.artifacts.length} canvas artifacts...`, percent: completed }, "export", scopes);
      archive.append(JSON.stringify(data.canvas, null, 2), { name: "canvas/artifacts.json" });
      completed += stepSize;
      updateProgress(progressId, { phase: "canvas", message: `Exported ${data.canvas.artifacts.length} canvas artifacts.`, percent: completed }, "export", scopes);
    }

    if (includeAutomation && data.automation) {
      const automationCount = (data.automation.heartbeat ? 1 : 0) + data.automation.schedules.length + data.automation.monitors.length;
      updateProgress(progressId, { phase: "automation", message: `Exporting ${automationCount} automation rules...`, percent: completed }, "export", scopes);
      archive.append(JSON.stringify(data.automation, null, 2), { name: "automation/config.json" });
      completed += stepSize;
      updateProgress(progressId, { phase: "automation", message: `Exported ${automationCount} automation rules.`, percent: completed }, "export", scopes);
    }

    updateProgress(progressId, { phase: "zip", message: "Finalizing backup archive...", percent: 95 }, "export", scopes);
    await new Promise<void>((resolve, reject) => {
      archive.on("finish", resolve);
      archive.on("error", reject);
      archive.finalize();
    });

    updateProgress(progressId, { phase: "done", message: "Backup ready for download.", percent: 100 }, "export", scopes);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    updateProgress(progressId, { phase: "error", message, percent: 0, error: message }, "export", scopes);
    throw error;
  }
}



export interface BackupImportResult {
  restoredSettings: boolean;
  restoredSessions: number;
  restoredFolders: number;
  restoredTags: number;
  restoredDocuments: number;
  restoredArtifacts: number;
  restoredArtifactRevisions: number;
  restoredAutomations: number;
  errors: string[];
}

function isSameUserBackup(data: BackupData, userId: string): boolean {
  return data.manifest.userId === userId;
}

export async function importBackupData(
  userId: string,
  data: BackupData,
  progressId: string,
  options: { reindexDocuments?: boolean } = {}
): Promise<BackupImportResult> {
  const result: BackupImportResult = {
    restoredSettings: false,
    restoredSessions: 0,
    restoredFolders: 0,
    restoredTags: 0,
    restoredDocuments: 0,
    restoredArtifacts: 0,
    restoredArtifactRevisions: 0,
    restoredAutomations: 0,
    errors: [],
  };

  const scopes = data.manifest.scopes;
  createBackupProgress(progressId, "import", scopes);
  updateProgress(progressId, { phase: "prepare", message: "Reading backup manifest...", percent: 2 }, "import", scopes);

  try {
    if ((scopes.includes("settings") || scopes.includes("connectionSecrets")) && data.settings) {
      updateProgress(progressId, { phase: "settings", message: "Restoring settings...", percent: 5 }, "import", scopes);
      const filtered = filterBackupSettings(data.settings, {
        includeStandard: scopes.includes("settings"),
        includeSecrets: scopes.includes("connectionSecrets"),
      });
      await prisma.userSettings.update({
        where: { userId },
        data: { ...filtered, updatedAt: new Date() },
      });
      result.restoredSettings = true;
      updateProgress(progressId, { phase: "settings", message: "Settings restored.", percent: 15 }, "import", scopes);
    }

    const sessionIdMap = new Map<string, string>();
    const sameUser = isSameUserBackup(data, userId);

    if (scopes.includes("chats") && data.sessions) {
      const sessions = data.sessions;
      const folders = data.folders ?? [];
      const tags = data.tags ?? [];

      // For cross-user restore we must remap IDs so we don't steal or conflict with the source user's rows.
      const folderIdMap = new Map<string, string>();
      const tagIdMap = new Map<string, string>();

      updateProgress(progressId, { phase: "chats", message: `Restoring ${folders.length} folders...`, percent: 18 }, "import", scopes);

      for (const folder of folders) {
        try {
          const targetId = sameUser ? folder.id : randomUUID();
          folderIdMap.set(folder.id, targetId);
          await prisma.folder.create({
            data: {
              id: targetId,
              name: folder.name,
              color: folder.color,
              order: folder.order,
              createdAt: new Date(folder.createdAt),
              updatedAt: new Date(folder.updatedAt),
              userId,
            },
          });
          result.restoredFolders++;
        } catch (err) {
          result.errors.push(`Folder ${folder.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      updateProgress(progressId, { phase: "chats", message: `Restoring ${tags.length} tags...`, percent: 22 }, "import", scopes);

      for (const tag of tags) {
        try {
          const targetId = sameUser ? tag.id : randomUUID();
          tagIdMap.set(tag.id, targetId);
          await prisma.tag.create({
            data: {
              id: targetId,
              name: tag.name,
              color: tag.color,
              userId,
            },
          });
          result.restoredTags++;
        } catch (err) {
          result.errors.push(`Tag ${tag.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      updateProgress(progressId, { phase: "chats", message: `Restoring ${sessions.length} sessions...`, percent: 25 }, "import", scopes);

      const total = sessions.length;
      for (let i = 0; i < total; i++) {
        const s = sessions[i];
        try {
          const targetSessionId = sameUser ? s.id : randomUUID();
          sessionIdMap.set(s.id, targetSessionId);
          const targetFolderId = s.folderId ? folderIdMap.get(s.folderId) ?? null : null;
          await upsertChatSession(userId, {
            id: targetSessionId,
            title: s.title,
            messages: JSON.parse(s.messages),
            pinned: s.pinned,
            surface: s.surface === "workspace-tool" || s.surface === "coder" ? s.surface : "chat",
            coderWorkspace: s.coderWorkspace,
            folderId: targetFolderId,
            autoContinueMode: s.autoContinueMode,
            autoContinueMaxSteps: s.autoContinueMaxSteps,
            branchLabel: s.branchLabel,
            lastAutoContinueAt: s.lastAutoContinueAt,
            ragEnabled: s.ragEnabled,
            ragQuery: s.ragQuery,
          });

          // Restore session-tag associations using remapped tag IDs
          if (s.tags?.length > 0) {
            const validTagIds = s.tags
              .map(t => tagIdMap.get(t.id))
              .filter((id): id is string => Boolean(id));
            if (validTagIds.length > 0) {
              await prisma.chatSessionTag.createMany({
                data: validTagIds.map(tagId => ({ sessionId: targetSessionId, tagId })),
                skipDuplicates: true,
              });
            }
          }

          result.restoredSessions++;
        } catch (err) {
          result.errors.push(`Session ${s.title}: ${err instanceof Error ? err.message : String(err)}`);
        }
        const pct = 25 + Math.round(((i + 1) / total) * 35);
        updateProgress(progressId, { phase: "chats", message: `Restored ${i + 1}/${total} sessions...`, percent: pct }, "import", scopes);
      }

      // `upsertChatSession` normalizes messages and rebuilds its ledger. Restore
      // durable session metadata afterward, once every remapped session ID exists.
      for (const s of sessions) {
        const targetSessionId = sessionIdMap.get(s.id);
        if (!targetSessionId) continue;
        try {
          await prisma.chatSession.update({
            where: { id: targetSessionId },
            data: {
              summary: s.summary ?? null,
              contextSummary: s.contextSummary ?? null,
              contextSummaryUpdatedAt: s.contextSummaryUpdatedAt ? new Date(s.contextSummaryUpdatedAt) : null,
              analyticsJson: s.analyticsJson ?? "{}",
              parentSessionId: s.parentSessionId ? sessionIdMap.get(s.parentSessionId) ?? null : null,
              branchFromMessageId: s.branchFromMessageId ?? null,
              branchLabel: s.branchLabel ?? null,
              coderWorkspace: s.coderWorkspace ?? null,
              ragSourcesJson: s.ragSourcesJson ?? null,
              createdAt: new Date(s.createdAt),
              updatedAt: new Date(s.updatedAt),
            },
          });
        } catch (err) {
          result.errors.push(`Session metadata ${s.title}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    if (scopes.includes("canvas") && data.canvas?.artifacts) {
      const artifacts = data.canvas.artifacts;
      const artifactIdMap = new Map<string, string>();
      updateProgress(progressId, { phase: "canvas", message: `Restoring ${artifacts.length} canvas artifacts...`, percent: 62 }, "import", scopes);

      for (const artifact of artifacts) {
        try {
          const targetId = sameUser ? artifact.id : randomUUID();
          artifactIdMap.set(artifact.id, targetId);
          const payload = {
            name: artifact.name,
            content: artifact.content,
            mimeType: artifact.mimeType,
            kind: artifact.kind,
            extension: artifact.extension ?? null,
            size: artifact.size,
            previewKind: artifact.previewKind,
            previewSummary: artifact.previewSummary ?? null,
            previewWidth: artifact.previewWidth ?? null,
            previewHeight: artifact.previewHeight ?? null,
            contentHash: artifact.contentHash ?? null,
            presentationType: artifact.presentationType,
            bundleId: artifact.bundleId ?? null,
            bundleName: artifact.bundleName ?? null,
            bundleRole: artifact.bundleRole ?? null,
            exportTargets: artifact.exportTargets,
            sourceArtifactId: null,
            sessionId: sameUser ? artifact.sessionId : sessionIdMap.get(artifact.sessionId) ?? `restored:${artifact.sessionId}`,
            messageId: artifact.messageId ?? null,
            version: artifact.version,
            userId,
          };
          const existing = sameUser ? await prisma.canvasArtifact.findUnique({ where: { id: targetId }, select: { id: true } }) : null;
          if (existing) {
            await prisma.canvasArtifactRevision.deleteMany({ where: { artifactId: targetId } });
            await prisma.canvasArtifact.update({
              where: { id: targetId },
              data: { ...payload, createdAt: new Date(artifact.createdAt), updatedAt: new Date(artifact.updatedAt) },
            });
          } else {
            await prisma.canvasArtifact.create({
              data: { id: targetId, ...payload, createdAt: new Date(artifact.createdAt), updatedAt: new Date(artifact.updatedAt) },
            });
          }
          result.restoredArtifacts++;
        } catch (err) {
          result.errors.push(`Canvas artifact ${artifact.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      for (const artifact of artifacts) {
        const targetId = artifactIdMap.get(artifact.id);
        if (!targetId) continue;
        try {
          await prisma.canvasArtifact.update({
            where: { id: targetId },
            data: { sourceArtifactId: artifact.sourceArtifactId ? artifactIdMap.get(artifact.sourceArtifactId) ?? null : null },
          });
          if (artifact.revisions.length > 0) {
            await prisma.canvasArtifactRevision.createMany({
              data: artifact.revisions.map(revision => ({
                artifactId: targetId,
                version: revision.version,
                name: revision.name,
                content: revision.content,
                mimeType: revision.mimeType,
                kind: revision.kind,
                extension: revision.extension ?? null,
                size: revision.size,
                previewKind: revision.previewKind,
                previewSummary: revision.previewSummary ?? null,
                previewWidth: revision.previewWidth ?? null,
                previewHeight: revision.previewHeight ?? null,
                contentHash: revision.contentHash ?? null,
                presentationType: revision.presentationType,
                bundleId: revision.bundleId ?? null,
                bundleName: revision.bundleName ?? null,
                bundleRole: revision.bundleRole ?? null,
                exportTargets: revision.exportTargets,
                sourceArtifactId: revision.sourceArtifactId ? artifactIdMap.get(revision.sourceArtifactId) ?? null : null,
                messageId: revision.messageId ?? null,
                createdAt: new Date(revision.createdAt),
              })),
            });
            result.restoredArtifactRevisions += artifact.revisions.length;
          }
        } catch (err) {
          result.errors.push(`Canvas history ${artifact.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      updateProgress(progressId, { phase: "canvas", message: `Restored ${result.restoredArtifacts} canvas artifacts.`, percent: 75 }, "import", scopes);
    }

    if (scopes.includes("automation") && data.automation) {
      const automation = data.automation;
      updateProgress(progressId, { phase: "automation", message: "Restoring automation rules...", percent: 78 }, "import", scopes);
      const restoreTargetSessionId = (sessionId: string | null | undefined) => {
        if (!sessionId) return null;
        return sameUser ? sessionId : sessionIdMap.get(sessionId) ?? null;
      };
      try {
        if (automation.heartbeat) {
          await prisma.automationHeartbeatConfig.upsert({
            where: { userId },
            create: {
              userId,
              enabled: automation.heartbeat.enabled,
              intervalMinutes: automation.heartbeat.intervalMinutes,
              staleAfterMinutes: automation.heartbeat.staleAfterMinutes,
              promptTemplate: automation.heartbeat.promptTemplate,
              deliveryMode: automation.heartbeat.deliveryMode,
              targetSessionId: restoreTargetSessionId(automation.heartbeat.targetSessionId),
              targetWorkspaceId: automation.heartbeat.targetWorkspaceId ?? null,
              nextRunAt: automation.heartbeat.nextRunAt ? new Date(automation.heartbeat.nextRunAt) : null,
            },
            update: {
              enabled: automation.heartbeat.enabled,
              intervalMinutes: automation.heartbeat.intervalMinutes,
              staleAfterMinutes: automation.heartbeat.staleAfterMinutes,
              promptTemplate: automation.heartbeat.promptTemplate,
              deliveryMode: automation.heartbeat.deliveryMode,
              targetSessionId: restoreTargetSessionId(automation.heartbeat.targetSessionId),
              targetWorkspaceId: automation.heartbeat.targetWorkspaceId ?? null,
              nextRunAt: automation.heartbeat.nextRunAt ? new Date(automation.heartbeat.nextRunAt) : null,
              lastRunAt: null,
              lastStatus: "idle",
              lastError: null,
            },
          });
          result.restoredAutomations++;
        }

        for (const schedule of automation.schedules) {
          const id = sameUser ? schedule.id : randomUUID();
          await prisma.automationSchedule.upsert({
            where: { id },
            create: {
              id, userId, name: schedule.name, prompt: schedule.prompt, deliveryMode: schedule.deliveryMode,
              targetSessionId: restoreTargetSessionId(schedule.targetSessionId), targetWorkspaceId: schedule.targetWorkspaceId ?? null,
              cronExpression: schedule.cronExpression, timezone: schedule.timezone, enabled: schedule.enabled,
              nextRunAt: new Date(schedule.nextRunAt),
            },
            update: {
              name: schedule.name, prompt: schedule.prompt, deliveryMode: schedule.deliveryMode,
              targetSessionId: restoreTargetSessionId(schedule.targetSessionId), targetWorkspaceId: schedule.targetWorkspaceId ?? null,
              cronExpression: schedule.cronExpression, timezone: schedule.timezone, enabled: schedule.enabled,
              nextRunAt: new Date(schedule.nextRunAt), lastRunAt: null, lastStatus: "idle", lastError: null,
            },
          });
          result.restoredAutomations++;
        }

        for (const monitor of automation.monitors) {
          const id = sameUser ? monitor.id : randomUUID();
          await prisma.automationMonitor.upsert({
            where: { id },
            create: {
              id, userId, name: monitor.name, deliveryMode: monitor.deliveryMode,
              targetSessionId: restoreTargetSessionId(monitor.targetSessionId), targetWorkspaceId: monitor.targetWorkspaceId ?? null,
              kind: monitor.kind, target: monitor.target, enabled: monitor.enabled,
              checkIntervalSeconds: monitor.checkIntervalSeconds, triggerMode: monitor.triggerMode,
              expectedPattern: monitor.expectedPattern ?? null,
              nextCheckAt: monitor.nextCheckAt ? new Date(monitor.nextCheckAt) : null,
            },
            update: {
              name: monitor.name, deliveryMode: monitor.deliveryMode,
              targetSessionId: restoreTargetSessionId(monitor.targetSessionId), targetWorkspaceId: monitor.targetWorkspaceId ?? null,
              kind: monitor.kind, target: monitor.target, enabled: monitor.enabled,
              checkIntervalSeconds: monitor.checkIntervalSeconds, triggerMode: monitor.triggerMode,
              expectedPattern: monitor.expectedPattern ?? null,
              nextCheckAt: monitor.nextCheckAt ? new Date(monitor.nextCheckAt) : null,
              lastCheckedAt: null, lastStatus: "idle", lastError: null, lastFingerprint: null, lastSummary: null, lastTriggeredAt: null,
            },
          });
          result.restoredAutomations++;
        }
      } catch (err) {
        result.errors.push(`Automation: ${err instanceof Error ? err.message : String(err)}`);
      }
      updateProgress(progressId, { phase: "automation", message: `Restored ${result.restoredAutomations} automation rules.`, percent: 85 }, "import", scopes);
    }

    if (scopes.includes("knowledgeBase") && data.knowledgeBase?.documents) {
      const docs = data.knowledgeBase.documents;
      updateProgress(progressId, { phase: "knowledgeBase", message: `Restoring ${docs.length} documents...`, percent: 65 }, "import", scopes);

      const settings = await getUserSettings(userId);
      const kbIdMap = new Map<string, string>();

      for (let i = 0; i < docs.length; i++) {
        const d = docs[i];
        try {
          const sameUser = isSameUserBackup(data, userId);
          const targetId = sameUser ? d.id : randomUUID();
          kbIdMap.set(d.id, targetId);
          const existing = sameUser ? await prisma.document.findUnique({ where: { id: targetId }, select: { id: true } }) : null;

          const payload = {
            id: targetId,
            filename: d.filename,
            sourcePath: d.sourcePath ?? null,
            kind: d.kind ?? null,
            size: d.size,
            contentHash: d.contentHash ?? null,
            originalContent: d.originalContent ?? null,
            originalMimeType: d.originalMimeType ?? null,
            status: (options.reindexDocuments || d.originalContent) ? "queued" : d.status,
            ragMode: d.ragMode ?? settings.ragMode,
            embeddingModel: d.embeddingModel ?? null,
            ollamaHost: d.ollamaHost ?? null,
            errorMessage: d.errorMessage ?? null,
            indexedAt: d.indexedAt ? new Date(d.indexedAt) : null,
            embeddingDimensions: d.embeddingDimensions ?? null,
            indexingProgress: d.indexingProgress ?? 0,
            indexingAttempts: d.indexingAttempts ?? 0,
            userId,
          };

          if (existing) {
            await prisma.documentChunk.deleteMany({ where: { documentId: targetId } });
            await prisma.document.update({
              where: { id: targetId },
              data: { ...payload, updatedAt: new Date(d.updatedAt) },
            });
          } else {
            await prisma.document.create({
              data: { ...payload, createdAt: new Date(d.createdAt), updatedAt: new Date(d.updatedAt) },
            });
          }

          result.restoredDocuments++;
        } catch (err) {
          result.errors.push(`Document ${d.filename}: ${err instanceof Error ? err.message : String(err)}`);
        }
        const pct = 65 + Math.round(((i + 1) / docs.length) * 30);
        updateProgress(progressId, { phase: "knowledgeBase", message: `Restored ${i + 1}/${docs.length} documents...`, percent: pct }, "import", scopes);
      }

      if (options.reindexDocuments) {
        updateProgress(progressId, { phase: "knowledgeBase", message: "Queueing documents for re-indexing...", percent: 96 }, "import", scopes);
        // The isolated RAG worker reads queued originals from the database.
        // Backup restore must not run extraction inside the web process.
      }
    }

    updateProgress(progressId, { phase: "done", message: "Restore complete.", percent: 100 }, "import", scopes);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Restore failed";
    updateProgress(progressId, { phase: "error", message, percent: 0, error: message }, "import", scopes);
    throw error;
  }
}
