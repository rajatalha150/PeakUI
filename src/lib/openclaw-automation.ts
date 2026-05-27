import { createHash } from 'node:crypto'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { prisma } from './prisma'
import { getUserSettings } from './settings'
import { buildEffectiveOpenClawToolAccess } from './openclaw-tool-access'
import { resolvePermissions } from './permissions'
import { assertPublicHttpUrl } from './openclaw-browser'
import { getMountedOpenClawHostRoots, parseAllowedOpenClawPaths } from './openclaw-filesystem'
import type { AuthenticatedUser } from './request-auth'
import { queueAutomationExecution, processQueuedAutomationRuns } from './openclaw-automation-execution'

const DEFAULT_AUTOMATION_TIMEZONE = 'America/New_York'
const DEFAULT_HEARTBEAT_INTERVAL_MINUTES = 240
const DEFAULT_STALE_AFTER_MINUTES = 180
const DEFAULT_MONITOR_INTERVAL_SECONDS = 300
const NOTIFICATION_DEDUPE_WINDOW_MS = 30 * 60 * 1000

export type AutomationMonitorKind = 'url' | 'file'
export type AutomationTriggerMode = 'changed' | 'contains' | 'missing'
export type AutomationDeliveryMode = 'nudge' | 'background-run'

export interface AutomationWorkerSnapshot {
  running: boolean
  startedAt: string | null
  lastTickAt: string | null
  loopCount: number
  lastError: string | null
}

export interface AutomationHeartbeatDto {
  id: string
  enabled: boolean
  intervalMinutes: number
  staleAfterMinutes: number
  promptTemplate: string
  deliveryMode: AutomationDeliveryMode
  targetSessionId: string | null
  targetWorkspaceId: string | null
  nextRunAt: string | null
  lastRunAt: string | null
  lastStatus: string
  lastError: string | null
}

export interface AutomationScheduleDto {
  id: string
  name: string
  prompt: string
  deliveryMode: AutomationDeliveryMode
  targetSessionId: string | null
  targetWorkspaceId: string | null
  cronExpression: string
  timezone: string
  enabled: boolean
  nextRunAt: string
  lastRunAt: string | null
  lastStatus: string
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface AutomationMonitorDto {
  id: string
  name: string
  kind: AutomationMonitorKind
  deliveryMode: AutomationDeliveryMode
  targetSessionId: string | null
  targetWorkspaceId: string | null
  target: string
  enabled: boolean
  checkIntervalSeconds: number
  triggerMode: AutomationTriggerMode
  expectedPattern: string | null
  nextCheckAt: string | null
  lastCheckedAt: string | null
  lastStatus: string
  lastError: string | null
  lastSummary: string | null
  lastTriggeredAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AutomationNotificationDto {
  id: string
  kind: string
  sourceKind: string | null
  sourceId: string | null
  sessionId: string | null
  title: string
  message: string
  createdAt: string
  seenAt: string | null
  dismissedAt: string | null
}

export interface AutomationExecutionRunDto {
  id: string
  sourceKind: string
  sourceId: string | null
  deliveryMode: string
  sessionId: string | null
  workspaceId: string | null
  title: string
  prompt: string
  provider: string
  model: string
  status: string
  resultPreview: string | null
  error: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

export interface AutomationStateDto {
  worker: AutomationWorkerSnapshot
  heartbeat: AutomationHeartbeatDto
  schedules: AutomationScheduleDto[]
  monitors: AutomationMonitorDto[]
  nudges: AutomationNotificationDto[]
  runs: AutomationExecutionRunDto[]
}

const workerState: AutomationWorkerSnapshot = {
  running: false,
  startedAt: null,
  lastTickAt: null,
  loopCount: 0,
  lastError: null,
}

function isoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeDeliveryMode(value: unknown): AutomationDeliveryMode {
  return value === 'background-run' ? 'background-run' : 'nudge'
}

function isWithinPath(targetPath: string, rootPath: string): boolean {
  return targetPath === rootPath || targetPath.startsWith(`${rootPath}${path.sep}`)
}

async function getAutomationToolAccess(userId: string) {
  const [user, settings] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        role: true,
        isActive: true,
        tokenVersion: true,
        permissionOverrides: true,
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true,
      },
    }),
    getUserSettings(userId),
  ])

  if (!user) {
    throw new Error('Automation user not found')
  }

  const permissions = resolvePermissions(user as AuthenticatedUser)
  return {
    settings,
    effectiveToolAccess: buildEffectiveOpenClawToolAccess(settings, permissions),
  }
}

async function authorizeFileMonitorTarget(userId: string, rawTarget: string) {
  const normalizedTarget = path.resolve(rawTarget.trim())
  const { settings, effectiveToolAccess } = await getAutomationToolAccess(userId)

  if (!effectiveToolAccess.filesystemEnabled) {
    throw new Error('File monitors require OpenClaw filesystem read access to be enabled for this user.')
  }

  const approvedRoots = parseAllowedOpenClawPaths(settings.openClawAllowedPaths)
  if (approvedRoots.length === 0) {
    throw new Error('File monitors require at least one approved OpenClaw filesystem root.')
  }

  const mountedRoots = getMountedOpenClawHostRoots()
  if (!mountedRoots.some(root => isWithinPath(normalizedTarget, root))) {
    throw new Error(`File monitor target is outside the Docker-mounted host roots. Mounted roots: ${mountedRoots.join(', ')}`)
  }

  if (!approvedRoots.some(root => isWithinPath(normalizedTarget, root))) {
    throw new Error(`File monitor target is outside the approved OpenClaw filesystem roots. Approved roots: ${approvedRoots.join(', ')}`)
  }

  return normalizedTarget
}

function normalizeTimezone(value: string | null | undefined): string {
  const trimmed = value?.trim()
  if (!trimmed) return DEFAULT_AUTOMATION_TIMEZONE

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(new Date())
    return trimmed
  } catch {
    return DEFAULT_AUTOMATION_TIMEZONE
  }
}

function getTimezoneParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false,
  })
  const entries = formatter.formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => entries.find(entry => entry.type === type)?.value || ''
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }

  return {
    minute: Number(get('minute')),
    hour: Number(get('hour')),
    dayOfMonth: Number(get('day')),
    month: Number(get('month')),
    dayOfWeek: weekdayMap[get('weekday')] ?? 0,
  }
}

function parseCronField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>()
  const parts = field.split(',').map(part => part.trim()).filter(Boolean)
  if (parts.length === 0) {
    throw new Error(`Invalid cron field: "${field}"`)
  }

  for (const part of parts) {
    const [base, stepPart] = part.split('/')
    const step = stepPart ? Number(stepPart) : 1
    if (!Number.isFinite(step) || step < 1) {
      throw new Error(`Invalid cron step: "${part}"`)
    }

    if (base === '*') {
      for (let value = min; value <= max; value += step) values.add(value)
      continue
    }

    const rangeMatch = base.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const start = Number(rangeMatch[1])
      const end = Number(rangeMatch[2])
      if (start > end || start < min || end > max) {
        throw new Error(`Invalid cron range: "${part}"`)
      }
      for (let value = start; value <= end; value += step) values.add(value)
      continue
    }

    const single = Number(base)
    if (!Number.isFinite(single) || single < min || single > max) {
      throw new Error(`Invalid cron value: "${part}"`)
    }
    values.add(single)
  }

  return values
}

export function validateCronExpression(expression: string) {
  const trimmed = expression.trim()
  const fields = trimmed.split(/\s+/)
  if (fields.length !== 5) {
    throw new Error('Cron expression must have exactly 5 fields: minute hour day-of-month month day-of-week')
  }

  parseCronField(fields[0], 0, 59)
  parseCronField(fields[1], 0, 23)
  parseCronField(fields[2], 1, 31)
  parseCronField(fields[3], 1, 12)
  parseCronField(fields[4], 0, 6)
}

export function getNextCronRun(expression: string, timezone: string, fromDate = new Date()): Date {
  validateCronExpression(expression)
  const [minuteField, hourField, dayField, monthField, weekdayField] = expression.trim().split(/\s+/)
  const minutes = parseCronField(minuteField, 0, 59)
  const hours = parseCronField(hourField, 0, 23)
  const days = parseCronField(dayField, 1, 31)
  const months = parseCronField(monthField, 1, 12)
  const weekdays = parseCronField(weekdayField, 0, 6)
  const zone = normalizeTimezone(timezone)
  const candidate = new Date(fromDate)
  candidate.setSeconds(0, 0)
  candidate.setMinutes(candidate.getMinutes() + 1)

  for (let step = 0; step < 60 * 24 * 366; step += 1) {
    const parts = getTimezoneParts(candidate, zone)
    if (
      minutes.has(parts.minute)
      && hours.has(parts.hour)
      && days.has(parts.dayOfMonth)
      && months.has(parts.month)
      && weekdays.has(parts.dayOfWeek)
    ) {
      return new Date(candidate)
    }
    candidate.setMinutes(candidate.getMinutes() + 1)
  }

  throw new Error(`Could not find a matching run time for cron expression "${expression}" within one year`)
}

function formatMinutesAgo(value: Date): string {
  const deltaMs = Date.now() - value.getTime()
  const minutes = Math.max(1, Math.round(deltaMs / 60000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function getAutomationWorkerSnapshot(): AutomationWorkerSnapshot {
  return { ...workerState }
}

export function updateAutomationWorkerSnapshot(patch: Partial<AutomationWorkerSnapshot>) {
  Object.assign(workerState, patch)
}

export async function ensureAutomationHeartbeat(userId: string) {
  const now = new Date()
  return prisma.automationHeartbeatConfig.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      enabled: false,
      intervalMinutes: DEFAULT_HEARTBEAT_INTERVAL_MINUTES,
      staleAfterMinutes: DEFAULT_STALE_AFTER_MINUTES,
      promptTemplate: 'Review stale WorkSpaces tasks and suggest the single best next action.',
      deliveryMode: 'nudge',
      nextRunAt: new Date(now.getTime() + DEFAULT_HEARTBEAT_INTERVAL_MINUTES * 60 * 1000),
    },
  })
}

function toHeartbeatDto(value: Awaited<ReturnType<typeof ensureAutomationHeartbeat>>): AutomationHeartbeatDto {
  return {
    id: value.id,
    enabled: value.enabled,
    intervalMinutes: value.intervalMinutes,
    staleAfterMinutes: value.staleAfterMinutes,
    promptTemplate: value.promptTemplate,
    deliveryMode: normalizeDeliveryMode(value.deliveryMode),
    targetSessionId: value.targetSessionId,
    targetWorkspaceId: value.targetWorkspaceId,
    nextRunAt: isoOrNull(value.nextRunAt),
    lastRunAt: isoOrNull(value.lastRunAt),
    lastStatus: value.lastStatus,
    lastError: value.lastError,
  }
}

function toScheduleDto(value: {
  id: string
  name: string
  prompt: string
  deliveryMode: string
  targetSessionId: string | null
  targetWorkspaceId: string | null
  cronExpression: string
  timezone: string
  enabled: boolean
  nextRunAt: Date
  lastRunAt: Date | null
  lastStatus: string
  lastError: string | null
  createdAt: Date
  updatedAt: Date
}): AutomationScheduleDto {
  return {
    id: value.id,
    name: value.name,
    prompt: value.prompt,
    deliveryMode: normalizeDeliveryMode(value.deliveryMode),
    targetSessionId: value.targetSessionId,
    targetWorkspaceId: value.targetWorkspaceId,
    cronExpression: value.cronExpression,
    timezone: value.timezone,
    enabled: value.enabled,
    nextRunAt: value.nextRunAt.toISOString(),
    lastRunAt: isoOrNull(value.lastRunAt),
    lastStatus: value.lastStatus,
    lastError: value.lastError,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  }
}

function toMonitorDto(value: {
  id: string
  name: string
  kind: string
  deliveryMode: string
  targetSessionId: string | null
  targetWorkspaceId: string | null
  target: string
  enabled: boolean
  checkIntervalSeconds: number
  triggerMode: string
  expectedPattern: string | null
  nextCheckAt: Date | null
  lastCheckedAt: Date | null
  lastStatus: string
  lastError: string | null
  lastSummary: string | null
  lastTriggeredAt: Date | null
  createdAt: Date
  updatedAt: Date
}): AutomationMonitorDto {
  return {
    id: value.id,
    name: value.name,
    kind: value.kind === 'file' ? 'file' : 'url',
    deliveryMode: normalizeDeliveryMode(value.deliveryMode),
    targetSessionId: value.targetSessionId,
    targetWorkspaceId: value.targetWorkspaceId,
    target: value.target,
    enabled: value.enabled,
    checkIntervalSeconds: value.checkIntervalSeconds,
    triggerMode: value.triggerMode === 'contains' || value.triggerMode === 'missing' ? value.triggerMode : 'changed',
    expectedPattern: value.expectedPattern,
    nextCheckAt: isoOrNull(value.nextCheckAt),
    lastCheckedAt: isoOrNull(value.lastCheckedAt),
    lastStatus: value.lastStatus,
    lastError: value.lastError,
    lastSummary: value.lastSummary,
    lastTriggeredAt: isoOrNull(value.lastTriggeredAt),
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  }
}

function toNotificationDto(value: {
  id: string
  kind: string
  sourceKind: string | null
  sourceId: string | null
  sessionId: string | null
  title: string
  message: string
  createdAt: Date
  seenAt: Date | null
  dismissedAt: Date | null
}): AutomationNotificationDto {
  return {
    id: value.id,
    kind: value.kind,
    sourceKind: value.sourceKind,
    sourceId: value.sourceId,
    sessionId: value.sessionId,
    title: value.title,
    message: value.message,
    createdAt: value.createdAt.toISOString(),
    seenAt: isoOrNull(value.seenAt),
    dismissedAt: isoOrNull(value.dismissedAt),
  }
}

function toExecutionRunDto(value: {
  id: string
  sourceKind: string
  sourceId: string | null
  deliveryMode: string
  sessionId: string | null
  workspaceId: string | null
  title: string
  prompt: string
  provider: string
  model: string
  status: string
  resultPreview: string | null
  error: string | null
  createdAt: Date
  startedAt: Date | null
  completedAt: Date | null
}): AutomationExecutionRunDto {
  return {
    id: value.id,
    sourceKind: value.sourceKind,
    sourceId: value.sourceId,
    deliveryMode: value.deliveryMode,
    sessionId: value.sessionId,
    workspaceId: value.workspaceId,
    title: value.title,
    prompt: value.prompt,
    provider: value.provider,
    model: value.model,
    status: value.status,
    resultPreview: value.resultPreview,
    error: value.error,
    createdAt: value.createdAt.toISOString(),
    startedAt: isoOrNull(value.startedAt),
    completedAt: isoOrNull(value.completedAt),
  }
}

export async function getAutomationState(userId: string): Promise<AutomationStateDto> {
  const heartbeat = await ensureAutomationHeartbeat(userId)
  const [schedules, monitors, nudges, runs] = await Promise.all([
    prisma.automationSchedule.findMany({
      where: { userId },
      orderBy: [{ enabled: 'desc' }, { nextRunAt: 'asc' }],
    }),
    prisma.automationMonitor.findMany({
      where: { userId },
      orderBy: [{ enabled: 'desc' }, { nextCheckAt: 'asc' }],
    }),
    prisma.automationNotification.findMany({
      where: { userId, dismissedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.automationExecutionRun.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ])

  return {
    worker: getAutomationWorkerSnapshot(),
    heartbeat: toHeartbeatDto(heartbeat),
    schedules: schedules.map(toScheduleDto),
    monitors: monitors.map(toMonitorDto),
    nudges: nudges.map(toNotificationDto),
    runs: runs.map(toExecutionRunDto),
  }
}

export async function updateHeartbeatConfig(userId: string, input: {
  enabled?: boolean
  intervalMinutes?: number
  staleAfterMinutes?: number
  promptTemplate?: string
  deliveryMode?: AutomationDeliveryMode
  targetSessionId?: string | null
  targetWorkspaceId?: string | null
}) {
  const current = await ensureAutomationHeartbeat(userId)
  const intervalMinutes = typeof input.intervalMinutes === 'number'
    ? Math.max(15, Math.min(24 * 60, Math.round(input.intervalMinutes)))
    : current.intervalMinutes
  const staleAfterMinutes = typeof input.staleAfterMinutes === 'number'
    ? Math.max(15, Math.min(7 * 24 * 60, Math.round(input.staleAfterMinutes)))
    : current.staleAfterMinutes
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : current.enabled
  const promptTemplate = typeof input.promptTemplate === 'string' && input.promptTemplate.trim()
    ? input.promptTemplate.trim()
    : current.promptTemplate
  const deliveryMode = input.deliveryMode ? normalizeDeliveryMode(input.deliveryMode) : normalizeDeliveryMode(current.deliveryMode)

  const nextRunAt = enabled
    ? new Date(Date.now() + intervalMinutes * 60 * 1000)
    : null

  const updated = await prisma.automationHeartbeatConfig.update({
    where: { userId },
    data: {
      enabled,
      intervalMinutes,
      staleAfterMinutes,
      promptTemplate,
      deliveryMode,
      targetSessionId: typeof input.targetSessionId === 'string' && input.targetSessionId.trim()
        ? input.targetSessionId.trim()
        : input.targetSessionId === null
          ? null
          : current.targetSessionId,
      targetWorkspaceId: typeof input.targetWorkspaceId === 'string' && input.targetWorkspaceId.trim()
        ? input.targetWorkspaceId.trim()
        : input.targetWorkspaceId === null
          ? null
          : current.targetWorkspaceId,
      nextRunAt,
      ...(enabled ? { lastStatus: current.lastStatus === 'idle' ? 'scheduled' : current.lastStatus } : { lastStatus: 'paused' }),
      lastError: null,
    },
  })

  return toHeartbeatDto(updated)
}

export async function createAutomationSchedule(userId: string, input: {
  name: string
  prompt: string
  cronExpression: string
  timezone?: string
  deliveryMode?: AutomationDeliveryMode
  targetSessionId?: string | null
  targetWorkspaceId?: string | null
}) {
  const name = input.name.trim()
  const prompt = input.prompt.trim()
  const cronExpression = input.cronExpression.trim()
  if (!name) throw new Error('Schedule name is required')
  if (!prompt) throw new Error('Schedule prompt is required')
  validateCronExpression(cronExpression)
  const timezone = normalizeTimezone(input.timezone)
  const nextRunAt = getNextCronRun(cronExpression, timezone)

  const created = await prisma.automationSchedule.create({
    data: {
      userId,
      name,
      prompt,
      deliveryMode: normalizeDeliveryMode(input.deliveryMode),
      targetSessionId: typeof input.targetSessionId === 'string' && input.targetSessionId.trim() ? input.targetSessionId.trim() : null,
      targetWorkspaceId: typeof input.targetWorkspaceId === 'string' && input.targetWorkspaceId.trim() ? input.targetWorkspaceId.trim() : null,
      cronExpression,
      timezone,
      enabled: true,
      nextRunAt,
      lastStatus: 'scheduled',
    },
  })

  return toScheduleDto(created)
}

export async function updateAutomationSchedule(userId: string, input: {
  id: string
  name?: string
  prompt?: string
  cronExpression?: string
  timezone?: string
  enabled?: boolean
  deliveryMode?: AutomationDeliveryMode
  targetSessionId?: string | null
  targetWorkspaceId?: string | null
}) {
  const existing = await prisma.automationSchedule.findFirst({
    where: { id: input.id, userId },
  })
  if (!existing) throw new Error('Schedule not found')

  const cronExpression = typeof input.cronExpression === 'string' && input.cronExpression.trim()
    ? input.cronExpression.trim()
    : existing.cronExpression
  validateCronExpression(cronExpression)
  const timezone = normalizeTimezone(typeof input.timezone === 'string' ? input.timezone : existing.timezone)
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : existing.enabled

  const updated = await prisma.automationSchedule.update({
    where: { id: existing.id },
    data: {
      name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : existing.name,
      prompt: typeof input.prompt === 'string' && input.prompt.trim() ? input.prompt.trim() : existing.prompt,
      deliveryMode: input.deliveryMode ? normalizeDeliveryMode(input.deliveryMode) : normalizeDeliveryMode(existing.deliveryMode),
      targetSessionId: typeof input.targetSessionId === 'string' && input.targetSessionId.trim()
        ? input.targetSessionId.trim()
        : input.targetSessionId === null
          ? null
          : existing.targetSessionId,
      targetWorkspaceId: typeof input.targetWorkspaceId === 'string' && input.targetWorkspaceId.trim()
        ? input.targetWorkspaceId.trim()
        : input.targetWorkspaceId === null
          ? null
          : existing.targetWorkspaceId,
      cronExpression,
      timezone,
      enabled,
      nextRunAt: enabled ? getNextCronRun(cronExpression, timezone) : existing.nextRunAt,
      lastError: null,
      lastStatus: enabled ? 'scheduled' : 'paused',
    },
  })

  return toScheduleDto(updated)
}

export async function deleteAutomationSchedule(userId: string, id: string) {
  const existing = await prisma.automationSchedule.findFirst({ where: { id, userId } })
  if (!existing) throw new Error('Schedule not found')
  await prisma.automationSchedule.delete({ where: { id } })
}

export async function createAutomationMonitor(userId: string, input: {
  name: string
  kind: AutomationMonitorKind
  target: string
  checkIntervalSeconds?: number
  triggerMode?: AutomationTriggerMode
  expectedPattern?: string
  deliveryMode?: AutomationDeliveryMode
  targetSessionId?: string | null
  targetWorkspaceId?: string | null
}) {
  const name = input.name.trim()
  let target = input.target.trim()
  if (!name) throw new Error('Monitor name is required')
  if (!target) throw new Error('Monitor target is required')
  if (input.kind === 'url') {
    target = (await assertPublicHttpUrl(target)).toString()
  } else {
    target = await authorizeFileMonitorTarget(userId, target)
  }

  const created = await prisma.automationMonitor.create({
    data: {
      userId,
      name,
      deliveryMode: normalizeDeliveryMode(input.deliveryMode),
      targetSessionId: typeof input.targetSessionId === 'string' && input.targetSessionId.trim() ? input.targetSessionId.trim() : null,
      targetWorkspaceId: typeof input.targetWorkspaceId === 'string' && input.targetWorkspaceId.trim() ? input.targetWorkspaceId.trim() : null,
      kind: input.kind,
      target,
      enabled: true,
      checkIntervalSeconds: Math.max(30, Math.min(86400, Math.round(input.checkIntervalSeconds ?? DEFAULT_MONITOR_INTERVAL_SECONDS))),
      triggerMode: input.triggerMode ?? 'changed',
      expectedPattern: input.expectedPattern?.trim() || null,
      nextCheckAt: new Date(Date.now() + 3000),
      lastStatus: 'scheduled',
    },
  })

  return toMonitorDto(created)
}

export async function updateAutomationMonitor(userId: string, input: {
  id: string
  name?: string
  kind?: AutomationMonitorKind
  target?: string
  checkIntervalSeconds?: number
  triggerMode?: AutomationTriggerMode
  expectedPattern?: string
  enabled?: boolean
  deliveryMode?: AutomationDeliveryMode
  targetSessionId?: string | null
  targetWorkspaceId?: string | null
}) {
  const existing = await prisma.automationMonitor.findFirst({
    where: { id: input.id, userId },
  })
  if (!existing) throw new Error('Monitor not found')

  const nextKind = input.kind ?? (existing.kind === 'file' ? 'file' : 'url')
  let nextTarget = typeof input.target === 'string' && input.target.trim() ? input.target.trim() : existing.target
  if (nextKind === 'url') {
    nextTarget = (await assertPublicHttpUrl(nextTarget)).toString()
  } else {
    nextTarget = await authorizeFileMonitorTarget(userId, nextTarget)
  }

  const enabled = typeof input.enabled === 'boolean' ? input.enabled : existing.enabled
  const updated = await prisma.automationMonitor.update({
    where: { id: existing.id },
    data: {
      name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : existing.name,
      deliveryMode: input.deliveryMode ? normalizeDeliveryMode(input.deliveryMode) : normalizeDeliveryMode(existing.deliveryMode),
      targetSessionId: typeof input.targetSessionId === 'string' && input.targetSessionId.trim()
        ? input.targetSessionId.trim()
        : input.targetSessionId === null
          ? null
          : existing.targetSessionId,
      targetWorkspaceId: typeof input.targetWorkspaceId === 'string' && input.targetWorkspaceId.trim()
        ? input.targetWorkspaceId.trim()
        : input.targetWorkspaceId === null
          ? null
          : existing.targetWorkspaceId,
      kind: nextKind,
      target: nextTarget,
      checkIntervalSeconds: typeof input.checkIntervalSeconds === 'number'
        ? Math.max(30, Math.min(86400, Math.round(input.checkIntervalSeconds)))
        : existing.checkIntervalSeconds,
      triggerMode: input.triggerMode ?? (existing.triggerMode === 'contains' || existing.triggerMode === 'missing' ? existing.triggerMode : 'changed'),
      expectedPattern: typeof input.expectedPattern === 'string' ? input.expectedPattern.trim() || null : existing.expectedPattern,
      enabled,
      nextCheckAt: enabled ? new Date(Date.now() + 3000) : existing.nextCheckAt,
      lastStatus: enabled ? 'scheduled' : 'paused',
      lastError: null,
    },
  })

  return toMonitorDto(updated)
}

export async function deleteAutomationMonitor(userId: string, id: string) {
  const existing = await prisma.automationMonitor.findFirst({ where: { id, userId } })
  if (!existing) throw new Error('Monitor not found')
  await prisma.automationMonitor.delete({ where: { id } })
}

export async function dismissAutomationNotification(userId: string, id: string) {
  const notification = await prisma.automationNotification.findFirst({
    where: { id, userId },
  })
  if (!notification) throw new Error('Notification not found')

  const updated = await prisma.automationNotification.update({
    where: { id },
    data: { dismissedAt: new Date() },
  })

  return toNotificationDto(updated)
}

export async function markAutomationNotificationsSeen(userId: string, ids: string[]) {
  const now = new Date()
  await prisma.automationNotification.updateMany({
    where: {
      userId,
      id: { in: ids },
      seenAt: null,
    },
    data: { seenAt: now },
  })
}

async function createAutomationEvent(userId: string, input: {
  kind: string
  sourceKind?: string | null
  sourceId?: string | null
  title: string
  message: string
  details?: string | null
  status?: string
}) {
  await prisma.automationEvent.create({
    data: {
      userId,
      kind: input.kind,
      sourceKind: input.sourceKind ?? null,
      sourceId: input.sourceId ?? null,
      title: input.title,
      message: input.message,
      details: input.details ?? null,
      status: input.status ?? 'created',
    },
  })
}

async function deliverAutomationTrigger(userId: string, input: {
  kind: string
  sourceKind: string
  sourceId?: string | null
  title: string
  message: string
  sessionId?: string | null
  workspaceId?: string | null
  deliveryMode?: AutomationDeliveryMode
}) {
  const deliveryMode = normalizeDeliveryMode(input.deliveryMode)

  if (deliveryMode === 'background-run') {
    const queued = await queueAutomationExecution({
      userId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId ?? null,
      sessionId: input.sessionId ?? null,
      workspaceId: input.workspaceId ?? null,
      title: input.title,
      prompt: input.message,
    })

    await createAutomationEvent(userId, {
      kind: input.kind,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId ?? null,
      title: input.title,
      message: input.message,
      details: `Queued unattended execution run ${queued.id}.`,
      status: 'queued',
    })

    return {
      mode: 'background-run' as const,
      queuedRunId: queued.id,
    }
  }

  const notification = await createAutomationNotification(userId, {
    kind: input.kind,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId ?? null,
    title: input.title,
    message: input.message,
    sessionId: input.sessionId ?? null,
  })

  await createAutomationEvent(userId, {
    kind: input.kind,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId ?? null,
    title: input.title,
    message: input.message,
    status: 'triggered',
  })

  return {
    mode: 'nudge' as const,
    notification,
  }
}

export async function createAutomationWakeEvent(userId: string, input: {
  title: string
  message: string
  sessionId?: string
  workspaceId?: string
  deliveryMode?: AutomationDeliveryMode
}) {
  const title = input.title.trim()
  const message = input.message.trim()
  if (!title) throw new Error('Wake event title is required')
  if (!message) throw new Error('Wake event message is required')
  const result = await deliverAutomationTrigger(userId, {
    kind: 'wake_event',
    sourceKind: 'wake_event',
    title,
    message,
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    deliveryMode: input.deliveryMode,
  })
  return result.mode === 'nudge' ? result.notification : null
}

async function createAutomationNotification(userId: string, input: {
  kind: string
  title: string
  message: string
  sessionId?: string | null
  sourceKind?: string | null
  sourceId?: string | null
}) {
  const duplicateCutoff = new Date(Date.now() - NOTIFICATION_DEDUPE_WINDOW_MS)
  const duplicate = await prisma.automationNotification.findFirst({
    where: {
      userId,
      title: input.title,
      message: input.message,
      sourceKind: input.sourceKind ?? null,
      sourceId: input.sourceId ?? null,
      dismissedAt: null,
      createdAt: { gte: duplicateCutoff },
    },
  })
  if (duplicate) {
    return toNotificationDto(duplicate)
  }

  const created = await prisma.automationNotification.create({
    data: {
      userId,
      kind: input.kind,
      title: input.title,
      message: input.message,
      sessionId: input.sessionId ?? null,
      sourceKind: input.sourceKind ?? null,
      sourceId: input.sourceId ?? null,
    },
  })

  return toNotificationDto(created)
}

export async function getOpenAutomationNudges(userId: string) {
  const nudges = await prisma.automationNotification.findMany({
    where: {
      userId,
      dismissedAt: null,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
  return nudges.map(toNotificationDto)
}

async function evaluateUrlMonitor(target: string) {
  const safeUrl = await assertPublicHttpUrl(target)
  const response = await fetch(safeUrl, {
    signal: AbortSignal.timeout(15000),
    headers: {
      'User-Agent': 'PeakUI WorkSpaces Monitor/1.0',
      'Accept': 'text/html,application/json,text/plain;q=0.9,*/*;q=0.8',
    },
  })
  const text = await response.text()
  const compact = text.replace(/\s+/g, ' ').trim().slice(0, 12000)
  return {
    available: response.ok,
    fingerprint: hashText(`${response.status}:${compact}`),
    summary: `HTTP ${response.status}${compact ? ` · ${compact.slice(0, 180)}` : ''}`,
    content: compact,
  }
}

async function evaluateFileMonitor(target: string) {
  const resolved = path.resolve(target)
  try {
    const stat = await fs.stat(resolved)
    if (stat.isDirectory()) {
      return {
        available: true,
        fingerprint: hashText(`dir:${resolved}:${stat.mtimeMs}`),
        summary: `Directory changed at ${new Date(stat.mtimeMs).toISOString()}`,
        content: '',
      }
    }
    const content = await fs.readFile(resolved, 'utf8').catch(() => '')
    const compact = content.replace(/\s+/g, ' ').trim().slice(0, 12000)
    return {
      available: true,
      fingerprint: hashText(`file:${resolved}:${stat.size}:${stat.mtimeMs}:${compact}`),
      summary: `${path.basename(resolved)} · ${stat.size} bytes · modified ${new Date(stat.mtimeMs).toISOString()}`,
      content: compact,
    }
  } catch {
    return {
      available: false,
      fingerprint: 'missing',
      summary: `Missing: ${resolved}`,
      content: '',
    }
  }
}

async function processHeartbeatConfig(config: Awaited<ReturnType<typeof ensureAutomationHeartbeat>>) {
  const now = new Date()
  if (!config.enabled) return
  if (config.nextRunAt && config.nextRunAt > now) return

  try {
    const staleCutoff = new Date(now.getTime() - config.staleAfterMinutes * 60 * 1000)
    const staleSessions = await prisma.chatSession.findMany({
      where: {
        userId: config.userId,
        surface: 'openclaw',
        updatedAt: { lte: staleCutoff },
      },
      orderBy: { updatedAt: 'desc' },
      take: 3,
    })

    if (staleSessions.length > 0) {
      const message = [
        config.promptTemplate.trim(),
        '',
        'Stale WorkSpaces threads:',
        ...staleSessions.map(session => `- ${session.title} (${formatMinutesAgo(session.updatedAt)})`),
      ].join('\n')

      await deliverAutomationTrigger(config.userId, {
        kind: 'heartbeat',
        sourceKind: 'heartbeat',
        sourceId: config.id,
        title: 'Heartbeat check-in',
        message,
        sessionId: config.targetSessionId ?? staleSessions[0]?.id ?? null,
        workspaceId: config.targetWorkspaceId,
        deliveryMode: normalizeDeliveryMode(config.deliveryMode),
      })
    }

    await prisma.automationHeartbeatConfig.update({
      where: { id: config.id },
      data: {
        lastRunAt: now,
        nextRunAt: new Date(now.getTime() + config.intervalMinutes * 60 * 1000),
        lastStatus: staleSessions.length > 0 ? 'triggered' : 'idle',
        lastError: null,
      },
    })
  } catch (error) {
    await prisma.automationHeartbeatConfig.update({
      where: { id: config.id },
      data: {
        lastRunAt: now,
        nextRunAt: new Date(now.getTime() + config.intervalMinutes * 60 * 1000),
        lastStatus: 'error',
        lastError: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

async function processSchedule(schedule: {
  id: string
  userId: string
  name: string
  prompt: string
  deliveryMode: string
  targetSessionId: string | null
  targetWorkspaceId: string | null
  cronExpression: string
  timezone: string
  nextRunAt: Date
}) {
  const now = new Date()
  const title = `Scheduled task: ${schedule.name}`
  const message = [
    `Cron schedule fired for "${schedule.name}".`,
    '',
    `Prompt: ${schedule.prompt}`,
    `Cron: ${schedule.cronExpression} (${schedule.timezone})`,
  ].join('\n')

  try {
    await deliverAutomationTrigger(schedule.userId, {
      kind: 'cron',
      sourceKind: 'schedule',
      sourceId: schedule.id,
      title,
      message,
      sessionId: schedule.targetSessionId,
      workspaceId: schedule.targetWorkspaceId,
      deliveryMode: normalizeDeliveryMode(schedule.deliveryMode),
    })
    await prisma.automationSchedule.update({
      where: { id: schedule.id },
      data: {
        lastRunAt: now,
        nextRunAt: getNextCronRun(schedule.cronExpression, schedule.timezone, now),
        lastStatus: 'triggered',
        lastError: null,
      },
    })
  } catch (error) {
    await prisma.automationSchedule.update({
      where: { id: schedule.id },
      data: {
        lastRunAt: now,
        nextRunAt: getNextCronRun(schedule.cronExpression, schedule.timezone, now),
        lastStatus: 'error',
        lastError: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

async function processMonitor(monitor: {
  id: string
  userId: string
  name: string
  deliveryMode: string
  targetSessionId: string | null
  targetWorkspaceId: string | null
  kind: string
  target: string
  triggerMode: string
  expectedPattern: string | null
  checkIntervalSeconds: number
  lastFingerprint: string | null
  lastStatus: string
}) {
  const now = new Date()
  const nextCheckAt = new Date(now.getTime() + monitor.checkIntervalSeconds * 1000)

  try {
    const monitorTarget = monitor.kind === 'file'
      ? await authorizeFileMonitorTarget(monitor.userId, monitor.target)
      : (await assertPublicHttpUrl(monitor.target)).toString()
    const evaluation = monitor.kind === 'file'
      ? await evaluateFileMonitor(monitorTarget)
      : await evaluateUrlMonitor(monitorTarget)

    let triggered = false
    let status = evaluation.available ? 'ok' : 'missing'
    const summary = evaluation.summary

    if (monitor.triggerMode === 'changed') {
      triggered = Boolean(monitor.lastFingerprint && monitor.lastFingerprint !== evaluation.fingerprint)
      status = triggered ? 'changed' : status
    } else if (monitor.triggerMode === 'contains') {
      const pattern = monitor.expectedPattern?.trim()
      const matched = Boolean(pattern && evaluation.content.includes(pattern))
      triggered = matched && monitor.lastStatus !== 'match'
      status = matched ? 'match' : evaluation.available ? 'ok' : 'missing'
    } else if (monitor.triggerMode === 'missing') {
      triggered = !evaluation.available && monitor.lastStatus !== 'missing'
      status = evaluation.available ? 'ok' : 'missing'
    }

    if (triggered) {
      const title = `Monitor triggered: ${monitor.name}`
      const message = [
        `${monitor.name} matched its ${monitor.triggerMode} rule.`,
        '',
        `Target: ${monitor.target}`,
        `Summary: ${summary}`,
      ].join('\n')
      await deliverAutomationTrigger(monitor.userId, {
        kind: 'monitor',
        sourceKind: 'monitor',
        sourceId: monitor.id,
        title,
        message,
        sessionId: monitor.targetSessionId,
        workspaceId: monitor.targetWorkspaceId,
        deliveryMode: normalizeDeliveryMode(monitor.deliveryMode),
      })
    }

    await prisma.automationMonitor.update({
      where: { id: monitor.id },
      data: {
        nextCheckAt,
        lastCheckedAt: now,
        lastStatus: status,
        lastError: null,
        lastFingerprint: evaluation.fingerprint,
        lastSummary: summary,
        ...(triggered ? { lastTriggeredAt: now } : {}),
      },
    })
  } catch (error) {
    await prisma.automationMonitor.update({
      where: { id: monitor.id },
      data: {
        nextCheckAt,
        lastCheckedAt: now,
        lastStatus: 'error',
        lastError: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

export async function runAutomationTick() {
  const now = new Date()
  updateAutomationWorkerSnapshot({
    lastTickAt: now.toISOString(),
    loopCount: workerState.loopCount + 1,
  })

  const [heartbeats, schedules, monitors] = await Promise.all([
    prisma.automationHeartbeatConfig.findMany({
      where: {
        enabled: true,
        OR: [
          { nextRunAt: null },
          { nextRunAt: { lte: now } },
        ],
      },
    }),
    prisma.automationSchedule.findMany({
      where: {
        enabled: true,
        nextRunAt: { lte: now },
      },
      orderBy: { nextRunAt: 'asc' },
      take: 20,
    }),
    prisma.automationMonitor.findMany({
      where: {
        enabled: true,
        OR: [
          { nextCheckAt: null },
          { nextCheckAt: { lte: now } },
        ],
      },
      orderBy: { nextCheckAt: 'asc' },
      take: 50,
    }),
  ])

  for (const heartbeat of heartbeats) {
    await processHeartbeatConfig(heartbeat)
  }
  for (const schedule of schedules) {
    await processSchedule(schedule)
  }
  for (const monitor of monitors) {
    await processMonitor(monitor)
  }
  await processQueuedAutomationRuns()
}
