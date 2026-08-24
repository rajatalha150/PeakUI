import { prisma } from './prisma'
import { DEFAULT_EMBEDDING_MODEL, normalizeOllamaModelName } from './embedding-models'
import { normalizeTheme, type ThemeId } from './theme-options'
import { getWorkspaceToolWorkspaceHostRoot } from './workspace-tool-workspace'
import {
  DEFAULT_HUGGING_FACE_BASE_URL,
  normalizeChatModelProvider,
  normalizeChatPlatform,
  normalizeHuggingFaceBaseUrl,
  type ChatModelProvider,
  type ChatPlatform,
} from './chat-platforms'
import {
  normalizeMaxToolRoundsPerTurn,
  normalizeSessionAutoContinueMaxSteps,
  normalizeSessionAutoContinueMode,
  normalizeSessionPreserveTurns,
  normalizeSessionSummaryTargetTokens,
  type SessionAutoContinueMode,
} from './session-intelligence'

export {
  DEFAULT_HUGGING_FACE_BASE_URL,
  normalizeChatModelProvider,
  normalizeChatPlatform,
  normalizeHuggingFaceBaseUrl,
}

export type RagMode = 'semantic' | 'keyword'
export type WorkspaceToolProvider = 'ollama' | 'openai-compatible'
export type ShellExecutionTarget = 'container' | 'host'
export type ShellExecutionMode = 'auto-approve' | 'ask-first' | 'deny'
export type WorkspaceToolFileAccessMode = 'deny' | 'read-only'
export type WorkspaceToolFileWriteMode = 'deny' | 'ask-first' | 'auto-approve'
export type WorkspaceToolHostAccessMode = 'deny' | 'ask-first' | 'auto-approve'
export type WorkspaceToolCodeExecutionMode = 'deny' | 'ask-first' | 'auto-approve'
export type WorkspaceToolBrowserMode = 'deny' | 'read-only' | 'ask-first'

export function normalizeWorkspaceToolHostAccessMode(value: unknown): WorkspaceToolHostAccessMode {
  const valid: WorkspaceToolHostAccessMode[] = ['auto-approve', 'ask-first', 'deny']
  return valid.includes(value as WorkspaceToolHostAccessMode) ? (value as WorkspaceToolHostAccessMode) : 'deny'
}

export function normalizeWorkspaceToolWorkspaceHostRoot(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim().split('\\').join('/')
  }
  return ''
}

export function getEffectiveWorkspaceToolWorkspaceHostRoot(
  settings: Pick<AppSettings, 'workspaceToolWorkspaceHostRoot'>
): string {
  const override = normalizeWorkspaceToolWorkspaceHostRoot(settings.workspaceToolWorkspaceHostRoot)
  if (override) return override
  return getWorkspaceToolWorkspaceHostRoot()
}

export type WorkspaceToolUwafBrowserMode = 'deny' | 'direct' | 'stealth'
export type WorkspaceToolUwafDefaultMode = 'direct' | 'stealth'
export type WorkspaceToolAutomationExecutionProvider = 'ollama'
/**
 * Prompt detail tier for the WorkspaceTool system prompt. 'auto' detects the tier
 * from the model's parameter size and native context; a manual value overrides
 * detection.
 */
export type WorkspaceToolPromptTier = 'auto' | 'minimal' | 'compact' | 'standard' | 'full'

export const MIN_CONTEXT_LENGTH = 512
export const MAX_CONTEXT_LENGTH = 131072
export const CONTEXT_STEP = 512
export const LEGACY_DEFAULT_SYSTEM_PROMPT = "Include images with markdown syntax ![alt](https://...) only when you have a real, verified HTTPS URL. If you don't know the actual URL, describe the image in text instead."

export interface AppSettings {
  chatPlatform: ChatPlatform
  chatModel: string
  chatModelProvider: ChatModelProvider
  huggingFaceBaseUrl: string
  modelKeepAlive: boolean
  ollamaKeepAlive: string
  exclusiveOllamaModels: boolean
  workspaceToolProvider: WorkspaceToolProvider
  workspaceToolModel: string
  workspaceToolPromptTier: WorkspaceToolPromptTier
  workspaceToolBaseUrl: string
  ragModel: string
  ragMode: RagMode
  ollamaHost: string
  systemPrompt: string
  temperature: number
  ollamaUseModelDefaultTemperature: boolean
  contextLength: number
  ollamaUseModelDefaultContext: boolean
  theme: ThemeId
  workspaceToolPersonaTemplate: string
  workspaceToolPersonaName: string
  workspaceToolPersonaTone: string
  workspaceToolPersonaExpertise: string
  workspaceToolPersonaBoundaries: string
  workspaceToolPersonaOperatingInstructions: string
  workspaceToolUserProfileName: string
  workspaceToolUserProfileRole: string
  workspaceToolUserProfilePreferences: string
  workspaceToolUserProfileContext: string
  shellExecutionTarget: ShellExecutionTarget
  shellExecutionMode: ShellExecutionMode
  shellAllowedCommands: string
  shellHostAllowedRoots: string
  shellHostAllowedEnvVars: string
  shellHostMaxTimeoutMs: number
  shellHostMaxOutputBytes: number
  workspaceToolFileAccessMode: WorkspaceToolFileAccessMode
  workspaceToolAllowedPaths: string
  workspaceToolFileWriteMode: WorkspaceToolFileWriteMode
  workspaceToolWritablePaths: string
  workspaceToolHostAccessMode: WorkspaceToolHostAccessMode
  workspaceToolWorkspaceHostRoot: string
  workspaceToolCodeExecutionMode: WorkspaceToolCodeExecutionMode
  workspaceToolBrowserMode: WorkspaceToolBrowserMode
  workspaceToolUwafBrowserMode: WorkspaceToolUwafBrowserMode
  workspaceToolUwafScreenshots: boolean
  workspaceToolUwafDefaultMode: WorkspaceToolUwafDefaultMode
  workspaceToolUwafLiveBrowser: boolean
  workspaceToolAutomationExecutionEnabled: boolean
  workspaceToolAutomationExecutionModel: string
  workspaceToolAutomationExecutionMaxRunsPerHour: number
  workspaceToolAutomationExecutionAttachWorkspace: boolean
  workspaceToolAutomationExecutionAttachMemory: boolean
  workspaceToolSessionAutoContinueDefault: SessionAutoContinueMode
  workspaceToolSessionAutoContinueMaxSteps: number
  workspaceToolMaxToolRoundsPerTurn: number
  workspaceToolSessionSummariesEnabled: boolean
  workspaceToolSessionSummaryTargetTokens: number
  workspaceToolSessionPreserveTurns: number
  workspaceToolSessionAnalyticsEnabled: boolean
  workspaceToolSessionBranchingEnabled: boolean
  ragEnabled: boolean
  ragTopK: number
  ollamaUseCloudApi: boolean
  ollamaApiKey: string
  /**
   * Starred / favorite models, persisted server-side so they follow the user
   * across browsers/devices (not just localStorage). Stored in the DB (and
   * in AppSettings) as a JSON-encoded string array of `provider:modelName`
   * keys; the client parses it into its `favoriteModels: string[]` state.
   */
  workspaceToolFavoriteModels: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  chatPlatform: 'ollama',
  chatModel: '',
  chatModelProvider: 'ollama',
  huggingFaceBaseUrl: DEFAULT_HUGGING_FACE_BASE_URL,
  modelKeepAlive: false,
  ollamaKeepAlive: '0',
  exclusiveOllamaModels: false,
  workspaceToolProvider: 'ollama',
  workspaceToolModel: '',
  workspaceToolPromptTier: 'auto',
  workspaceToolBaseUrl: '',
  ragModel: DEFAULT_EMBEDDING_MODEL,
  ragMode: 'semantic',
  ollamaHost: process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434',
  systemPrompt: '',
  temperature: 0.7,
  ollamaUseModelDefaultTemperature: false,
  contextLength: 8192,
  ollamaUseModelDefaultContext: true,
  theme: 'aurora',
  workspaceToolPersonaTemplate: 'custom',
  workspaceToolPersonaName: '',
  workspaceToolPersonaTone: '',
  workspaceToolPersonaExpertise: '',
  workspaceToolPersonaBoundaries: '',
  workspaceToolPersonaOperatingInstructions: '',
  workspaceToolUserProfileName: '',
  workspaceToolUserProfileRole: '',
  workspaceToolUserProfilePreferences: '',
  workspaceToolUserProfileContext: '',
  shellExecutionTarget: 'container',
  shellExecutionMode: 'ask-first',
  shellAllowedCommands: '',
  shellHostAllowedRoots: getWorkspaceToolWorkspaceHostRoot(),
  shellHostAllowedEnvVars: 'PATH\nHOME\nUSER\nSHELL\nLANG\nTERM',
  shellHostMaxTimeoutMs: 60000,
  shellHostMaxOutputBytes: 262144,
  workspaceToolFileAccessMode: 'read-only',
  workspaceToolAllowedPaths: '',
  workspaceToolFileWriteMode: 'ask-first',
  workspaceToolWritablePaths: getWorkspaceToolWorkspaceHostRoot(),
  workspaceToolHostAccessMode: 'deny',
  workspaceToolWorkspaceHostRoot: '',
  workspaceToolCodeExecutionMode: 'ask-first',
  workspaceToolBrowserMode: 'deny',
  workspaceToolUwafBrowserMode: 'deny',
  workspaceToolUwafScreenshots: false,
  workspaceToolUwafDefaultMode: 'direct',
  workspaceToolUwafLiveBrowser: true,
  workspaceToolAutomationExecutionEnabled: false,
  workspaceToolAutomationExecutionModel: '',
  workspaceToolAutomationExecutionMaxRunsPerHour: 6,
  workspaceToolAutomationExecutionAttachWorkspace: true,
  workspaceToolAutomationExecutionAttachMemory: true,
  workspaceToolSessionAutoContinueDefault: 'manual',
  workspaceToolSessionAutoContinueMaxSteps: 3,
  workspaceToolMaxToolRoundsPerTurn: 100,
  workspaceToolSessionSummariesEnabled: true,
  workspaceToolSessionSummaryTargetTokens: 6000,
  workspaceToolSessionPreserveTurns: 6,
  workspaceToolSessionAnalyticsEnabled: true,
  workspaceToolSessionBranchingEnabled: true,
  ragEnabled: false,
  ragTopK: 8,
  ollamaUseCloudApi: false,
  ollamaApiKey: '',
  workspaceToolFavoriteModels: '[]',
}

export function normalizeRagMode(value: unknown): RagMode {
  return value === 'keyword' ? 'keyword' : 'semantic'
}

export function normalizeRagTopK(value: unknown): number {
  const parsed = Number(value)
  if (parsed === -1) return -1  // Full access mode
  if (!Number.isFinite(parsed) || parsed < 1) return 8
  return Math.min(200, Math.max(1, Math.round(parsed)))
}

export function normalizeWorkspaceToolProvider(value: unknown): WorkspaceToolProvider {
  return value === 'openai-compatible' ? 'openai-compatible' : 'ollama'
}

export function normalizeWorkspaceToolPromptTier(value: unknown): WorkspaceToolPromptTier {
  const valid: WorkspaceToolPromptTier[] = ['auto', 'minimal', 'compact', 'standard', 'full']
  return valid.includes(value as WorkspaceToolPromptTier) ? (value as WorkspaceToolPromptTier) : 'auto'
}

export function normalizeBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true
    if (['false', '0', 'no', 'off'].includes(normalized)) return false
  }

  return fallback
}

export function normalizeWorkspaceToolBaseUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return DEFAULT_SETTINGS.workspaceToolBaseUrl

  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return url.origin + url.pathname.replace(/\/$/, '')
  } catch {
    return raw.replace(/\/$/, '')
  }
}

export function normalizeRagModel(value: unknown): string {
  return normalizeOllamaModelName(value, DEFAULT_SETTINGS.ragModel)
}

export function normalizeOllamaHost(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return DEFAULT_SETTINGS.ollamaHost

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`

  try {
    const url = new URL(withProtocol)
    return url.origin
  } catch {
    return DEFAULT_SETTINGS.ollamaHost
  }
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export function normalizeTemperature(value: unknown): number {
  return Math.round(clampNumber(value, 0, 2, DEFAULT_SETTINGS.temperature) * 10) / 10
}

export function normalizeOllamaUseModelDefaultTemperature(value: unknown): boolean {
  return normalizeBoolean(value, DEFAULT_SETTINGS.ollamaUseModelDefaultTemperature)
}

export function normalizeOllamaKeepAlive(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (raw === '0') return '0'
  if (!raw) return DEFAULT_SETTINGS.ollamaKeepAlive
  if (/^[1-9]\d*(ms|s|m|h)$/.test(raw)) return raw
  return DEFAULT_SETTINGS.ollamaKeepAlive
}

export function normalizeModelKeepAlive(value: unknown, keepAliveValue?: unknown): boolean {
  const normalizedKeepAlive = typeof keepAliveValue === 'string' ? keepAliveValue.trim().toLowerCase() : ''
  if (normalizedKeepAlive === '0') return false
  return normalizeBoolean(value, DEFAULT_SETTINGS.modelKeepAlive)
}

export function normalizeContextLength(value: unknown): number {
  const clamped = clampNumber(value, MIN_CONTEXT_LENGTH, MAX_CONTEXT_LENGTH, DEFAULT_SETTINGS.contextLength)
  return Math.round(clamped / CONTEXT_STEP) * CONTEXT_STEP
}

export function normalizeOllamaUseModelDefaultContext(
  value: unknown,
  contextLength: number = DEFAULT_SETTINGS.contextLength,
): boolean {
  if (value === undefined || value === null) {
    return contextLength === DEFAULT_SETTINGS.contextLength
  }
  return normalizeBoolean(value, DEFAULT_SETTINGS.ollamaUseModelDefaultContext)
}

export function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function normalizeShellExecutionMode(value: unknown): ShellExecutionMode {
  const valid: ShellExecutionMode[] = ['auto-approve', 'ask-first', 'deny']
  return valid.includes(value as ShellExecutionMode) ? (value as ShellExecutionMode) : 'ask-first'
}

export function normalizeShellExecutionTarget(value: unknown): ShellExecutionTarget {
  return value === 'host' ? 'host' : 'container'
}

export function normalizeShellHostAllowedRoots(value: unknown): string {
  const normalized = normalizeWorkspaceToolAllowedPaths(value)
  return normalized || DEFAULT_SETTINGS.shellHostAllowedRoots
}

export function normalizeShellHostAllowedEnvVars(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_SETTINGS.shellHostAllowedEnvVars

  const normalized = value
    .split(/\r?\n|,/)
    .map(entry => entry.trim())
    .filter(Boolean)
    .filter(entry => /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry))
    .filter((entry, index, all) => all.indexOf(entry) === index)

  return normalized.length > 0
    ? normalized.join('\n')
    : DEFAULT_SETTINGS.shellHostAllowedEnvVars
}

export function normalizeShellHostMaxTimeoutMs(value: unknown): number {
  return Math.round(clampNumber(value, 1000, 300000, DEFAULT_SETTINGS.shellHostMaxTimeoutMs))
}

export function normalizeShellHostMaxOutputBytes(value: unknown): number {
  return Math.round(clampNumber(value, 16384, 1048576, DEFAULT_SETTINGS.shellHostMaxOutputBytes))
}

export function normalizeWorkspaceToolFileAccessMode(value: unknown): WorkspaceToolFileAccessMode {
  return value === 'read-only' ? 'read-only' : 'deny'
}

export function normalizeWorkspaceToolFileWriteMode(value: unknown): WorkspaceToolFileWriteMode {
  const valid: WorkspaceToolFileWriteMode[] = ['auto-approve', 'ask-first', 'deny']
  return valid.includes(value as WorkspaceToolFileWriteMode) ? (value as WorkspaceToolFileWriteMode) : 'deny'
}

export function normalizeWorkspaceToolCodeExecutionMode(value: unknown): WorkspaceToolCodeExecutionMode {
  const valid: WorkspaceToolCodeExecutionMode[] = ['auto-approve', 'ask-first', 'deny']
  return valid.includes(value as WorkspaceToolCodeExecutionMode) ? (value as WorkspaceToolCodeExecutionMode) : 'deny'
}

export function normalizeWorkspaceToolBrowserMode(value: unknown): WorkspaceToolBrowserMode {
  const valid: WorkspaceToolBrowserMode[] = ['ask-first', 'deny', 'read-only']
  return valid.includes(value as WorkspaceToolBrowserMode) ? (value as WorkspaceToolBrowserMode) : 'deny'
}

export function normalizeWorkspaceToolUwafBrowserMode(value: unknown): WorkspaceToolUwafBrowserMode {
  const valid: WorkspaceToolUwafBrowserMode[] = ['deny', 'direct', 'stealth']
  return valid.includes(value as WorkspaceToolUwafBrowserMode) ? (value as WorkspaceToolUwafBrowserMode) : 'deny'
}

export function normalizeWorkspaceToolUwafDefaultMode(value: unknown): WorkspaceToolUwafDefaultMode {
  return value === 'stealth' ? 'stealth' : 'direct'
}

export function normalizeWorkspaceToolAllowedPaths(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_SETTINGS.workspaceToolAllowedPaths

  const normalized = value
    .split(/\r?\n|,/)
    .map(entry => entry.trim())
    .filter(Boolean)
    .filter((entry, index, all) => all.indexOf(entry) === index)

  return normalized.join('\n')
}

export function normalizeWorkspaceToolAutomationExecutionModel(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Maximum number of starred models kept per user, and the max length of a
 * single `provider:modelName` key. Caps bound the stored column and guard
 * against a runaway or malicious payload.
 */
const MAX_FAVORITE_MODELS = 256
const MAX_FAVORITE_KEY_LEN = 200

/**
 * Normalize the user's starred-model list. Accepts either a JSON-encoded
 * string (the DB column shape) or a raw array (the client POST body). Each
 * entry is trimmed, stripped of control characters, length-capped, and
 * de-duplicated; the total count is capped. Unknown / non-string entries
 * are dropped. Returns a fresh array (never the input by reference).
 */
export function normalizeWorkspaceToolFavoriteModels(value: unknown): string[] {
  let list: unknown
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    try {
      list = JSON.parse(trimmed)
    } catch {
      return []
    }
  } else {
    list = value
  }

  if (!Array.isArray(list)) return []

  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of list) {
    if (typeof entry !== 'string') continue
    const cleaned = entry.trim().replace(/[\u0000-\u001F\u007F]/g, '').slice(0, MAX_FAVORITE_KEY_LEN)
    if (!cleaned) continue
    if (seen.has(cleaned)) continue
    seen.add(cleaned)
    out.push(cleaned)
    if (out.length >= MAX_FAVORITE_MODELS) break
  }
  return out
}

export function normalizeWorkspaceToolAutomationExecutionMaxRunsPerHour(value: unknown): number {
  return Math.round(clampNumber(value, 1, 60, DEFAULT_SETTINGS.workspaceToolAutomationExecutionMaxRunsPerHour))
}

export function normalizeAppSettings(settings: Partial<Record<keyof AppSettings, unknown>> | null | undefined): AppSettings {
  const rawSystemPrompt = typeof settings?.systemPrompt === 'string' ? settings.systemPrompt : DEFAULT_SETTINGS.systemPrompt
  const systemPrompt = rawSystemPrompt.trim() === LEGACY_DEFAULT_SYSTEM_PROMPT ? '' : rawSystemPrompt

  return {
    chatPlatform: normalizeChatPlatform(settings?.chatPlatform),
    chatModel: typeof settings?.chatModel === 'string' ? settings.chatModel.trim() : DEFAULT_SETTINGS.chatModel,
    chatModelProvider: normalizeChatModelProvider(settings?.chatModelProvider),
    huggingFaceBaseUrl: normalizeHuggingFaceBaseUrl(settings?.huggingFaceBaseUrl),
    modelKeepAlive: normalizeModelKeepAlive(settings?.modelKeepAlive, settings?.ollamaKeepAlive),
    ollamaKeepAlive: normalizeOllamaKeepAlive(settings?.ollamaKeepAlive),
    exclusiveOllamaModels: normalizeBoolean(settings?.exclusiveOllamaModels, DEFAULT_SETTINGS.exclusiveOllamaModels),
    workspaceToolProvider: normalizeWorkspaceToolProvider(settings?.workspaceToolProvider),
    workspaceToolModel: typeof settings?.workspaceToolModel === 'string' ? settings.workspaceToolModel.trim() : DEFAULT_SETTINGS.workspaceToolModel,
    workspaceToolPromptTier: normalizeWorkspaceToolPromptTier(settings?.workspaceToolPromptTier),
    workspaceToolBaseUrl: normalizeWorkspaceToolBaseUrl(settings?.workspaceToolBaseUrl),
    ragModel: normalizeRagModel(settings?.ragModel),
    ragMode: normalizeRagMode(settings?.ragMode),
    ollamaHost: normalizeOllamaHost(settings?.ollamaHost),
    ollamaUseCloudApi: normalizeBoolean(settings?.ollamaUseCloudApi, DEFAULT_SETTINGS.ollamaUseCloudApi),
    ollamaApiKey: typeof settings?.ollamaApiKey === 'string' ? settings.ollamaApiKey.trim() : DEFAULT_SETTINGS.ollamaApiKey,
    systemPrompt,
    temperature: normalizeTemperature(settings?.temperature),
    ollamaUseModelDefaultTemperature: normalizeOllamaUseModelDefaultTemperature(
      settings?.ollamaUseModelDefaultTemperature,
    ),
    contextLength: normalizeContextLength(settings?.contextLength),
    ollamaUseModelDefaultContext: normalizeOllamaUseModelDefaultContext(
      settings?.ollamaUseModelDefaultContext,
      normalizeContextLength(settings?.contextLength),
    ),
    theme: normalizeTheme(settings?.theme),
    workspaceToolPersonaTemplate: normalizeString(settings?.workspaceToolPersonaTemplate, DEFAULT_SETTINGS.workspaceToolPersonaTemplate),
    workspaceToolPersonaName: normalizeString(settings?.workspaceToolPersonaName, DEFAULT_SETTINGS.workspaceToolPersonaName),
    workspaceToolPersonaTone: normalizeString(settings?.workspaceToolPersonaTone, DEFAULT_SETTINGS.workspaceToolPersonaTone),
    workspaceToolPersonaExpertise: normalizeString(settings?.workspaceToolPersonaExpertise, DEFAULT_SETTINGS.workspaceToolPersonaExpertise),
    workspaceToolPersonaBoundaries: normalizeString(settings?.workspaceToolPersonaBoundaries, DEFAULT_SETTINGS.workspaceToolPersonaBoundaries),
    workspaceToolPersonaOperatingInstructions: normalizeString(settings?.workspaceToolPersonaOperatingInstructions, DEFAULT_SETTINGS.workspaceToolPersonaOperatingInstructions),
    workspaceToolUserProfileName: normalizeString(settings?.workspaceToolUserProfileName, DEFAULT_SETTINGS.workspaceToolUserProfileName),
    workspaceToolUserProfileRole: normalizeString(settings?.workspaceToolUserProfileRole, DEFAULT_SETTINGS.workspaceToolUserProfileRole),
    workspaceToolUserProfilePreferences: normalizeString(settings?.workspaceToolUserProfilePreferences, DEFAULT_SETTINGS.workspaceToolUserProfilePreferences),
    workspaceToolUserProfileContext: normalizeString(settings?.workspaceToolUserProfileContext, DEFAULT_SETTINGS.workspaceToolUserProfileContext),
    shellExecutionTarget: normalizeShellExecutionTarget(settings?.shellExecutionTarget),
    shellExecutionMode: normalizeShellExecutionMode(settings?.shellExecutionMode),
    shellAllowedCommands: normalizeString(settings?.shellAllowedCommands, DEFAULT_SETTINGS.shellAllowedCommands),
    shellHostAllowedRoots: normalizeShellHostAllowedRoots(settings?.shellHostAllowedRoots),
    shellHostAllowedEnvVars: normalizeShellHostAllowedEnvVars(settings?.shellHostAllowedEnvVars),
    shellHostMaxTimeoutMs: normalizeShellHostMaxTimeoutMs(settings?.shellHostMaxTimeoutMs),
    shellHostMaxOutputBytes: normalizeShellHostMaxOutputBytes(settings?.shellHostMaxOutputBytes),
    workspaceToolFileAccessMode: normalizeWorkspaceToolFileAccessMode(
      settings?.workspaceToolFileAccessMode ?? DEFAULT_SETTINGS.workspaceToolFileAccessMode
    ),
    workspaceToolAllowedPaths: normalizeWorkspaceToolAllowedPaths(settings?.workspaceToolAllowedPaths),
    workspaceToolFileWriteMode: normalizeWorkspaceToolFileWriteMode(
      settings?.workspaceToolFileWriteMode ?? DEFAULT_SETTINGS.workspaceToolFileWriteMode
    ),
    workspaceToolWritablePaths: normalizeWorkspaceToolAllowedPaths(
      settings?.workspaceToolWritablePaths !== undefined
        ? settings.workspaceToolWritablePaths
        : DEFAULT_SETTINGS.workspaceToolWritablePaths
    ),
    workspaceToolHostAccessMode: normalizeWorkspaceToolHostAccessMode(
      settings?.workspaceToolHostAccessMode ?? DEFAULT_SETTINGS.workspaceToolHostAccessMode
    ),
    workspaceToolWorkspaceHostRoot: normalizeWorkspaceToolWorkspaceHostRoot(
      settings?.workspaceToolWorkspaceHostRoot ?? DEFAULT_SETTINGS.workspaceToolWorkspaceHostRoot
    ),
    workspaceToolCodeExecutionMode: normalizeWorkspaceToolCodeExecutionMode(
      settings?.workspaceToolCodeExecutionMode ?? DEFAULT_SETTINGS.workspaceToolCodeExecutionMode
    ),
    workspaceToolBrowserMode: normalizeWorkspaceToolBrowserMode(
      settings?.workspaceToolBrowserMode ?? DEFAULT_SETTINGS.workspaceToolBrowserMode
    ),
    workspaceToolUwafBrowserMode: normalizeWorkspaceToolUwafBrowserMode(
      settings?.workspaceToolUwafBrowserMode ?? DEFAULT_SETTINGS.workspaceToolUwafBrowserMode
    ),
    workspaceToolUwafScreenshots: false,
    workspaceToolUwafDefaultMode: normalizeWorkspaceToolUwafDefaultMode(settings?.workspaceToolUwafDefaultMode),
    workspaceToolUwafLiveBrowser: normalizeBoolean(settings?.workspaceToolUwafLiveBrowser, DEFAULT_SETTINGS.workspaceToolUwafLiveBrowser),
    workspaceToolAutomationExecutionEnabled: normalizeBoolean(
      settings?.workspaceToolAutomationExecutionEnabled,
      DEFAULT_SETTINGS.workspaceToolAutomationExecutionEnabled,
    ),
    workspaceToolAutomationExecutionModel: normalizeWorkspaceToolAutomationExecutionModel(
      settings?.workspaceToolAutomationExecutionModel,
    ),
    workspaceToolAutomationExecutionMaxRunsPerHour: normalizeWorkspaceToolAutomationExecutionMaxRunsPerHour(
      settings?.workspaceToolAutomationExecutionMaxRunsPerHour,
    ),
    workspaceToolAutomationExecutionAttachWorkspace: normalizeBoolean(
      settings?.workspaceToolAutomationExecutionAttachWorkspace,
      DEFAULT_SETTINGS.workspaceToolAutomationExecutionAttachWorkspace,
    ),
    workspaceToolAutomationExecutionAttachMemory: normalizeBoolean(
      settings?.workspaceToolAutomationExecutionAttachMemory,
      DEFAULT_SETTINGS.workspaceToolAutomationExecutionAttachMemory,
    ),
    workspaceToolSessionAutoContinueDefault: normalizeSessionAutoContinueMode(
      settings?.workspaceToolSessionAutoContinueDefault,
    ),
    workspaceToolSessionAutoContinueMaxSteps: normalizeSessionAutoContinueMaxSteps(
      settings?.workspaceToolSessionAutoContinueMaxSteps,
      DEFAULT_SETTINGS.workspaceToolSessionAutoContinueMaxSteps,
    ),
    workspaceToolMaxToolRoundsPerTurn: normalizeMaxToolRoundsPerTurn(
      settings?.workspaceToolMaxToolRoundsPerTurn,
      DEFAULT_SETTINGS.workspaceToolMaxToolRoundsPerTurn,
    ),
    workspaceToolSessionSummariesEnabled: normalizeBoolean(
      settings?.workspaceToolSessionSummariesEnabled,
      DEFAULT_SETTINGS.workspaceToolSessionSummariesEnabled,
    ),
    workspaceToolSessionSummaryTargetTokens: normalizeSessionSummaryTargetTokens(
      settings?.workspaceToolSessionSummaryTargetTokens,
      DEFAULT_SETTINGS.workspaceToolSessionSummaryTargetTokens,
    ),
    workspaceToolSessionPreserveTurns: normalizeSessionPreserveTurns(
      settings?.workspaceToolSessionPreserveTurns,
      DEFAULT_SETTINGS.workspaceToolSessionPreserveTurns,
    ),
    workspaceToolSessionAnalyticsEnabled: normalizeBoolean(
      settings?.workspaceToolSessionAnalyticsEnabled,
      DEFAULT_SETTINGS.workspaceToolSessionAnalyticsEnabled,
    ),
    workspaceToolSessionBranchingEnabled: normalizeBoolean(
      settings?.workspaceToolSessionBranchingEnabled,
      DEFAULT_SETTINGS.workspaceToolSessionBranchingEnabled,
    ),
    ragEnabled: normalizeBoolean(settings?.ragEnabled, DEFAULT_SETTINGS.ragEnabled),
    ragTopK: normalizeRagTopK(settings?.ragTopK),
    workspaceToolFavoriteModels: JSON.stringify(normalizeWorkspaceToolFavoriteModels(settings?.workspaceToolFavoriteModels)),
  }
}

export async function getUserSettings(userId: string): Promise<AppSettings> {
  const settings = await prisma.userSettings.findUnique({ where: { userId } })
  if (!settings) return DEFAULT_SETTINGS

  return normalizeAppSettings(settings)
}
