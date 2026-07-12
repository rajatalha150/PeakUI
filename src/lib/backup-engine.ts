import { prisma } from "./prisma";
import type { AppSettings } from "./settings";
import { getUserSettings } from "./settings";
import { upsertChatSession } from "./chat-sessions";
import * as archiver from "archiver";
import { enqueueDocumentIndexing } from "./rag-queue";
import { randomUUID } from "node:crypto";

export type BackupScope = "chats" | "settings" | "knowledgeBase";
export const BACKUP_VERSION = 1;
export const BACKUP_SETTINGS_FIELDS = [
  "chatPlatform", "chatModel", "chatModelProvider", "huggingFaceBaseUrl", "modelKeepAlive",
  "ollamaKeepAlive", "exclusiveOllamaModels", "openClawProvider", "openClawModel",
  "openClawBaseUrl", "ragModel", "ragMode", "ollamaHost", "systemPrompt", "temperature",
  "ollamaUseModelDefaultTemperature", "contextLength", "ollamaUseModelDefaultContext",
  "theme", "openClawPersonaTemplate", "openClawPersonaName", "openClawPersonaTone",
  "openClawPersonaExpertise", "openClawPersonaBoundaries", "openClawPersonaOperatingInstructions",
  "openClawUserProfileName", "openClawUserProfileRole", "openClawUserProfilePreferences",
  "openClawUserProfileContext", "shellExecutionTarget", "shellExecutionMode",
  "shellAllowedCommands", "shellHostAllowedRoots", "shellHostAllowedEnvVars",
  "shellHostMaxTimeoutMs", "shellHostMaxOutputBytes", "openClawFileAccessMode",
  "openClawAllowedPaths", "openClawFileWriteMode", "openClawWritablePaths",
  "openClawHostAccessMode", "openClawWorkspaceHostRoot", "openClawCodeExecutionMode",
  "openClawBrowserMode", "openClawUwafBrowserMode", "openClawUwafScreenshots",
  "openClawUwafDefaultMode", "openClawUwafLiveBrowser", "openClawAutomationExecutionEnabled",
  "openClawAutomationExecutionModel", "openClawAutomationExecutionMaxRunsPerHour",
  "openClawAutomationExecutionAttachWorkspace", "openClawAutomationExecutionAttachMemory",
  "openClawSessionAutoContinueDefault", "openClawSessionAutoContinueMaxSteps",
  "openClawMaxToolRoundsPerTurn", "openClawSessionSummariesEnabled",
  "openClawSessionSummaryTargetTokens", "openClawSessionPreserveTurns",
  "openClawSessionAnalyticsEnabled", "openClawSessionBranchingEnabled",
  "ragEnabled", "ragTopK", "ollamaUseCloudApi", "ollamaApiKey",
] as const;

export interface BackupManifest {
  version: number;
  createdAt: string;
  exportedBy: string;
  scopes: BackupScope[];
  userId: string;
}

export interface BackupSettings extends AppSettings {}

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

export interface BackupData {
  manifest: BackupManifest;
  settings?: BackupSettings | null;
  folders?: BackupFolder[];
  tags?: BackupTag[];
  sessions?: BackupSession[];
  knowledgeBase?: {
    documents: BackupKnowledgeDocument[];
  };
}

export interface BackupProgress {
  id: string;
  startedAt: number;
  phase: "prepare" | "chats" | "settings" | "knowledgeBase" | "zip" | "download" | "restore" | "done" | "error";
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

export function filterBackupSettings(input: unknown): Partial<AppSettings> {
  if (!input || typeof input !== "object") return {};
  const source = input as Record<string, unknown>;
  const allowed = new Set<string>(BACKUP_SETTINGS_FIELDS);
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

  if (includeSettings) {
    const settings = await prisma.userSettings.findUnique({ where: { userId } });
    if (settings) {
      const { id, userId: _uid, updatedAt, ...rest } = settings;
      data.settings = filterBackupSettings(rest) as BackupSettings;
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
    const includeSettings = scopes.includes("settings");
    const includeKb = scopes.includes("knowledgeBase");

    let completed = 10;
    const stepSize = includeKb ? 25 : includeChats ? 40 : 45;

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
    errors: [],
  };

  const scopes = data.manifest.scopes;
  createBackupProgress(progressId, "import", scopes);
  updateProgress(progressId, { phase: "prepare", message: "Reading backup manifest...", percent: 2 }, "import", scopes);

  try {
    if (scopes.includes("settings") && data.settings) {
      updateProgress(progressId, { phase: "settings", message: "Restoring settings...", percent: 5 }, "import", scopes);
      const filtered = filterBackupSettings(data.settings);
      await prisma.userSettings.update({
        where: { userId },
        data: { ...filtered, updatedAt: new Date() },
      });
      result.restoredSettings = true;
      updateProgress(progressId, { phase: "settings", message: "Settings restored.", percent: 15 }, "import", scopes);
    }

    if (scopes.includes("chats") && data.sessions) {
      const sessions = data.sessions;
      const folders = data.folders ?? [];
      const tags = data.tags ?? [];
      const sameUser = isSameUserBackup(data, userId);

      // For cross-user restore we must remap IDs so we don't steal or conflict with the source user's rows.
      const folderIdMap = new Map<string, string>();
      const tagIdMap = new Map<string, string>();
      const sessionIdMap = new Map<string, string>();

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
            surface: s.surface === "openclaw" ? "openclaw" : "chat",
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
    }

    if (scopes.includes("knowledgeBase") && data.knowledgeBase?.documents) {
      const docs = data.knowledgeBase.documents;
      updateProgress(progressId, { phase: "knowledgeBase", message: `Restoring ${docs.length} documents...`, percent: 65 }, "import", scopes);

      const settings = await getUserSettings(userId);

      for (let i = 0; i < docs.length; i++) {
        const d = docs[i];
        try {
          const existing = await prisma.document.findUnique({ where: { id: d.id }, select: { id: true } });
          const payload = {
            id: d.id,
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
            await prisma.document.update({
              where: { id: d.id },
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
        for (const d of docs) {
          if (d.originalContent) {
            try {
              const fileType = d.originalMimeType ?? "text/plain";
              const reindexRagMode = (d.ragMode === 'semantic' || d.ragMode === 'keyword') ? d.ragMode : (settings.ragMode as 'semantic' | 'keyword');
              await enqueueDocumentIndexing(d.id, d.originalContent, d.filename, fileType, {
                ragModel: d.embeddingModel ?? settings.ragModel,
                ragMode: reindexRagMode,
                ollamaHost: d.ollamaHost ?? settings.ollamaHost,
                ollamaApiKey: settings.ollamaApiKey,
              });
            } catch (err) {
              result.errors.push(`Reindex ${d.filename}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }
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
