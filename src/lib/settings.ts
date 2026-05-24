import { prisma } from './prisma'
import { DEFAULT_EMBEDDING_MODEL, normalizeOllamaModelName } from './embedding-models'
import { normalizeTheme, type ThemeId } from './theme-options'
import { getOpenClawWorkspaceHostRoot } from './openclaw-workspace'
import {
  DEFAULT_HUGGING_FACE_BASE_URL,
  normalizeChatModelProvider,
  normalizeChatPlatform,
  normalizeHuggingFaceBaseUrl,
  type ChatModelProvider,
  type ChatPlatform,
} from './chat-platforms'

export {
  DEFAULT_HUGGING_FACE_BASE_URL,
  normalizeChatModelProvider,
  normalizeChatPlatform,
  normalizeHuggingFaceBaseUrl,
}

export type RagMode = 'semantic' | 'keyword'
export type OpenClawProvider = 'ollama' | 'openai-compatible'
export type ShellExecutionTarget = 'container' | 'host'
export type ShellExecutionMode = 'auto-approve' | 'ask-first' | 'deny'
export type OpenClawFileAccessMode = 'deny' | 'read-only'
export type OpenClawFileWriteMode = 'deny' | 'ask-first' | 'auto-approve'
export type OpenClawCodeExecutionMode = 'deny' | 'ask-first' | 'auto-approve'
export type OpenClawBrowserMode = 'deny' | 'read-only' | 'ask-first'
export type OpenClawUwafBrowserMode = 'deny' | 'direct' | 'stealth'
export type OpenClawUwafDefaultMode = 'direct' | 'stealth'

export const MIN_CONTEXT_LENGTH = 512
export const MAX_CONTEXT_LENGTH = 131072
export const CONTEXT_STEP = 512
export const LEGACY_DEFAULT_SYSTEM_PROMPT = "Include images with markdown syntax ![alt](https://...) only when you have a real, verified HTTPS URL. If you don't know the actual URL, describe the image in text instead."

export interface AppSettings {
  chatPlatform: ChatPlatform
  chatModel: string
  chatModelProvider: ChatModelProvider
  huggingFaceBaseUrl: string
  exclusiveOllamaModels: boolean
  openClawProvider: OpenClawProvider
  openClawModel: string
  openClawBaseUrl: string
  ragModel: string
  ragMode: RagMode
  ollamaHost: string
  systemPrompt: string
  temperature: number
  contextLength: number
  theme: ThemeId
  openClawPersonaTemplate: string
  openClawPersonaName: string
  openClawPersonaTone: string
  openClawPersonaExpertise: string
  openClawPersonaBoundaries: string
  openClawPersonaOperatingInstructions: string
  openClawUserProfileName: string
  openClawUserProfileRole: string
  openClawUserProfilePreferences: string
  openClawUserProfileContext: string
  shellExecutionTarget: ShellExecutionTarget
  shellExecutionMode: ShellExecutionMode
  shellAllowedCommands: string
  shellHostAllowedRoots: string
  shellHostAllowedEnvVars: string
  shellHostMaxTimeoutMs: number
  shellHostMaxOutputBytes: number
  openClawFileAccessMode: OpenClawFileAccessMode
  openClawAllowedPaths: string
  openClawFileWriteMode: OpenClawFileWriteMode
  openClawWritablePaths: string
  openClawCodeExecutionMode: OpenClawCodeExecutionMode
  openClawBrowserMode: OpenClawBrowserMode
  openClawUwafBrowserMode: OpenClawUwafBrowserMode
  openClawUwafScreenshots: boolean
  openClawUwafDefaultMode: OpenClawUwafDefaultMode
  openClawUwafLiveBrowser: boolean
  ragEnabled: boolean
  ragTopK: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  chatPlatform: 'ollama',
  chatModel: '',
  chatModelProvider: 'ollama',
  huggingFaceBaseUrl: DEFAULT_HUGGING_FACE_BASE_URL,
  exclusiveOllamaModels: false,
  openClawProvider: 'ollama',
  openClawModel: '',
  openClawBaseUrl: '',
  ragModel: DEFAULT_EMBEDDING_MODEL,
  ragMode: 'semantic',
  ollamaHost: 'http://127.0.0.1:11434',
  systemPrompt: '',
  temperature: 0.7,
  contextLength: 16384,
  theme: 'aurora',
  openClawPersonaTemplate: 'custom',
  openClawPersonaName: '',
  openClawPersonaTone: '',
  openClawPersonaExpertise: '',
  openClawPersonaBoundaries: '',
  openClawPersonaOperatingInstructions: '',
  openClawUserProfileName: '',
  openClawUserProfileRole: '',
  openClawUserProfilePreferences: '',
  openClawUserProfileContext: '',
  shellExecutionTarget: 'container',
  shellExecutionMode: 'auto-approve',
  shellAllowedCommands: '',
  shellHostAllowedRoots: getOpenClawWorkspaceHostRoot(),
  shellHostAllowedEnvVars: 'PATH\nHOME\nUSER\nSHELL\nLANG\nTERM',
  shellHostMaxTimeoutMs: 60000,
  shellHostMaxOutputBytes: 262144,
  openClawFileAccessMode: 'read-only',
  openClawAllowedPaths: '',
  openClawFileWriteMode: 'ask-first',
  openClawWritablePaths: getOpenClawWorkspaceHostRoot(),
  openClawCodeExecutionMode: 'ask-first',
  openClawBrowserMode: 'deny',
  openClawUwafBrowserMode: 'deny',
  openClawUwafScreenshots: false,
  openClawUwafDefaultMode: 'direct',
  openClawUwafLiveBrowser: true,
  ragEnabled: false,
  ragTopK: 8,
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

export function normalizeOpenClawProvider(value: unknown): OpenClawProvider {
  return value === 'openai-compatible' ? 'openai-compatible' : 'ollama'
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

export function normalizeOpenClawBaseUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return DEFAULT_SETTINGS.openClawBaseUrl

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

export function normalizeContextLength(value: unknown): number {
  const clamped = clampNumber(value, MIN_CONTEXT_LENGTH, MAX_CONTEXT_LENGTH, DEFAULT_SETTINGS.contextLength)
  return Math.round(clamped / CONTEXT_STEP) * CONTEXT_STEP
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
  const normalized = normalizeOpenClawAllowedPaths(value)
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

export function normalizeOpenClawFileAccessMode(value: unknown): OpenClawFileAccessMode {
  return value === 'read-only' ? 'read-only' : 'deny'
}

export function normalizeOpenClawFileWriteMode(value: unknown): OpenClawFileWriteMode {
  const valid: OpenClawFileWriteMode[] = ['auto-approve', 'ask-first', 'deny']
  return valid.includes(value as OpenClawFileWriteMode) ? (value as OpenClawFileWriteMode) : 'deny'
}

export function normalizeOpenClawCodeExecutionMode(value: unknown): OpenClawCodeExecutionMode {
  const valid: OpenClawCodeExecutionMode[] = ['auto-approve', 'ask-first', 'deny']
  return valid.includes(value as OpenClawCodeExecutionMode) ? (value as OpenClawCodeExecutionMode) : 'deny'
}

export function normalizeOpenClawBrowserMode(value: unknown): OpenClawBrowserMode {
  const valid: OpenClawBrowserMode[] = ['ask-first', 'deny', 'read-only']
  return valid.includes(value as OpenClawBrowserMode) ? (value as OpenClawBrowserMode) : 'deny'
}

export function normalizeOpenClawUwafBrowserMode(value: unknown): OpenClawUwafBrowserMode {
  const valid: OpenClawUwafBrowserMode[] = ['deny', 'direct', 'stealth']
  return valid.includes(value as OpenClawUwafBrowserMode) ? (value as OpenClawUwafBrowserMode) : 'deny'
}

export function normalizeOpenClawUwafDefaultMode(value: unknown): OpenClawUwafDefaultMode {
  return value === 'stealth' ? 'stealth' : 'direct'
}

export function normalizeOpenClawAllowedPaths(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_SETTINGS.openClawAllowedPaths

  const normalized = value
    .split(/\r?\n|,/)
    .map(entry => entry.trim())
    .filter(Boolean)
    .filter((entry, index, all) => all.indexOf(entry) === index)

  return normalized.join('\n')
}

export function normalizeAppSettings(settings: Partial<Record<keyof AppSettings, unknown>> | null | undefined): AppSettings {
  const rawSystemPrompt = typeof settings?.systemPrompt === 'string' ? settings.systemPrompt : DEFAULT_SETTINGS.systemPrompt
  const systemPrompt = rawSystemPrompt.trim() === LEGACY_DEFAULT_SYSTEM_PROMPT ? '' : rawSystemPrompt

  return {
    chatPlatform: normalizeChatPlatform(settings?.chatPlatform),
    chatModel: typeof settings?.chatModel === 'string' ? settings.chatModel.trim() : DEFAULT_SETTINGS.chatModel,
    chatModelProvider: normalizeChatModelProvider(settings?.chatModelProvider),
    huggingFaceBaseUrl: normalizeHuggingFaceBaseUrl(settings?.huggingFaceBaseUrl),
    exclusiveOllamaModels: normalizeBoolean(settings?.exclusiveOllamaModels, DEFAULT_SETTINGS.exclusiveOllamaModels),
    openClawProvider: normalizeOpenClawProvider(settings?.openClawProvider),
    openClawModel: typeof settings?.openClawModel === 'string' ? settings.openClawModel.trim() : DEFAULT_SETTINGS.openClawModel,
    openClawBaseUrl: normalizeOpenClawBaseUrl(settings?.openClawBaseUrl),
    ragModel: normalizeRagModel(settings?.ragModel),
    ragMode: normalizeRagMode(settings?.ragMode),
    ollamaHost: normalizeOllamaHost(settings?.ollamaHost),
    systemPrompt,
    temperature: normalizeTemperature(settings?.temperature),
    contextLength: normalizeContextLength(settings?.contextLength),
    theme: normalizeTheme(settings?.theme),
    openClawPersonaTemplate: normalizeString(settings?.openClawPersonaTemplate, DEFAULT_SETTINGS.openClawPersonaTemplate),
    openClawPersonaName: normalizeString(settings?.openClawPersonaName, DEFAULT_SETTINGS.openClawPersonaName),
    openClawPersonaTone: normalizeString(settings?.openClawPersonaTone, DEFAULT_SETTINGS.openClawPersonaTone),
    openClawPersonaExpertise: normalizeString(settings?.openClawPersonaExpertise, DEFAULT_SETTINGS.openClawPersonaExpertise),
    openClawPersonaBoundaries: normalizeString(settings?.openClawPersonaBoundaries, DEFAULT_SETTINGS.openClawPersonaBoundaries),
    openClawPersonaOperatingInstructions: normalizeString(settings?.openClawPersonaOperatingInstructions, DEFAULT_SETTINGS.openClawPersonaOperatingInstructions),
    openClawUserProfileName: normalizeString(settings?.openClawUserProfileName, DEFAULT_SETTINGS.openClawUserProfileName),
    openClawUserProfileRole: normalizeString(settings?.openClawUserProfileRole, DEFAULT_SETTINGS.openClawUserProfileRole),
    openClawUserProfilePreferences: normalizeString(settings?.openClawUserProfilePreferences, DEFAULT_SETTINGS.openClawUserProfilePreferences),
    openClawUserProfileContext: normalizeString(settings?.openClawUserProfileContext, DEFAULT_SETTINGS.openClawUserProfileContext),
    shellExecutionTarget: normalizeShellExecutionTarget(settings?.shellExecutionTarget),
    shellExecutionMode: normalizeShellExecutionMode(settings?.shellExecutionMode),
    shellAllowedCommands: normalizeString(settings?.shellAllowedCommands, DEFAULT_SETTINGS.shellAllowedCommands),
    shellHostAllowedRoots: normalizeShellHostAllowedRoots(settings?.shellHostAllowedRoots),
    shellHostAllowedEnvVars: normalizeShellHostAllowedEnvVars(settings?.shellHostAllowedEnvVars),
    shellHostMaxTimeoutMs: normalizeShellHostMaxTimeoutMs(settings?.shellHostMaxTimeoutMs),
    shellHostMaxOutputBytes: normalizeShellHostMaxOutputBytes(settings?.shellHostMaxOutputBytes),
    openClawFileAccessMode: normalizeOpenClawFileAccessMode(settings?.openClawFileAccessMode),
    openClawAllowedPaths: normalizeOpenClawAllowedPaths(settings?.openClawAllowedPaths),
    openClawFileWriteMode: normalizeOpenClawFileWriteMode(settings?.openClawFileWriteMode),
    openClawWritablePaths: normalizeOpenClawAllowedPaths(
      settings?.openClawWritablePaths !== undefined
        ? settings.openClawWritablePaths
        : DEFAULT_SETTINGS.openClawWritablePaths
    ),
    openClawCodeExecutionMode: normalizeOpenClawCodeExecutionMode(settings?.openClawCodeExecutionMode),
    openClawBrowserMode: normalizeOpenClawBrowserMode(settings?.openClawBrowserMode),
    openClawUwafBrowserMode: normalizeOpenClawUwafBrowserMode(settings?.openClawUwafBrowserMode),
    openClawUwafScreenshots: false,
    openClawUwafDefaultMode: normalizeOpenClawUwafDefaultMode(settings?.openClawUwafDefaultMode),
    openClawUwafLiveBrowser: normalizeBoolean(settings?.openClawUwafLiveBrowser, DEFAULT_SETTINGS.openClawUwafLiveBrowser),
    ragEnabled: normalizeBoolean(settings?.ragEnabled, DEFAULT_SETTINGS.ragEnabled),
    ragTopK: normalizeRagTopK(settings?.ragTopK),
  }
}

export async function getUserSettings(userId: string): Promise<AppSettings> {
  const settings = await prisma.userSettings.findUnique({ where: { userId } })
  if (!settings) return DEFAULT_SETTINGS

  return normalizeAppSettings(settings)
}
