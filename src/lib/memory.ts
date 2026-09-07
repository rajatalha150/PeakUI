/**
 * Multi-Layer Memory System for WorkSpaces
 *
 * Memory is scoped per-user and per-session:
 * 1. Daily memory logs - auto-generated summaries in memory/users/<userId>/YYYY-MM-DD.md
 * 2. Curated long-term memory - user-maintained MEMORY.md (per user)
 * 3. Session summaries - auto-generated TL;DR when sessions end (per user)
 *
 * Memory is injected into NEW sessions with a clear boundary marker so the
 * model knows prior context is background, not part of the current task.
 * Within a session, memory is never re-injected after the first turn.
 */

import { promises as fs } from 'fs'
import { join } from 'path'

export interface DailyMemory {
  date: string
  sessions: DailyMemorySession[]
  keyFindings: string[]
  decisions: string[]
  openQuestions: string[]
}

export interface DailyMemorySession {
  sessionId: string
  title: string
  mode: string
  summary: string
  timestamp: string
}

export interface SessionSummary {
  sessionId: string
  title: string
  objective: string
  outcome: string
  keyFindings: string[]
  nextSteps: string[]
  createdAt: string
}

const MEMORY_ROOT = process.env.PEAKUI_DATA_DIR
  ? join(process.env.PEAKUI_DATA_DIR, 'memory')
  : join(/*turbopackIgnore: true*/ process.cwd(), 'memory')

/**
 * Per-user memory directory. Memory is strictly scoped to the owning user:
 * memory/users/<userId>/. Cross-user reads are impossible because every
 * path is derived from an authenticated userId.
 */
export function getUserMemoryDir(userId: string): string {
  // userId is a UUID from the authenticated session; still validate defensively.
  if (!/^[A-Za-z0-9_-]+$/.test(userId)) {
    throw new Error(`Invalid memory user id: ${userId.slice(0, 8)}…`)
  }
  return join(MEMORY_ROOT, 'users', userId)
}

export async function ensureMemoryDir(): Promise<void> {
  await ensureUserMemoryDir('__shared__')
}

export async function ensureUserMemoryDir(userId: string): Promise<void> {
  const dir = getUserMemoryDir(userId)
  try {
    await fs.access(dir)
  } catch {
    await fs.mkdir(dir, { recursive: true })
  }
}

/** @deprecated Use getUserMemoryDir(userId) — the global dir leaks across users. */
export function getMemoryDir(): string {
  return MEMORY_ROOT
}

export function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0]
}

export function getYesterdayDateString(): string {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return yesterday.toISOString().split('T')[0]
}

export async function loadDailyMemory(date: string): Promise<DailyMemory | null> {
  return loadDailyMemoryForUser('__shared__', date)
}

export async function loadDailyMemoryForUser(userId: string, date: string): Promise<DailyMemory | null> {
  const filePath = join(getUserMemoryDir(userId), `${date}.md`)
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return parseDailyMemory(date, content)
  } catch {
    return null
  }
}

export async function saveDailyMemory(memory: DailyMemory): Promise<void> {
  return saveDailyMemoryForUser('__shared__', memory)
}

export async function saveDailyMemoryForUser(userId: string, memory: DailyMemory): Promise<void> {
  await ensureUserMemoryDir(userId)
  const filePath = join(getUserMemoryDir(userId), `${memory.date}.md`)
  const content = formatDailyMemory(memory)
  await fs.writeFile(filePath, content, 'utf-8')
}

export async function appendToDailyMemory(
  date: string,
  session: DailyMemorySession
): Promise<void> {
  return appendToDailyMemoryForUser('__shared__', date, session)
}

export async function appendToDailyMemoryForUser(
  userId: string,
  date: string,
  session: DailyMemorySession
): Promise<void> {
  const existing = await loadDailyMemoryForUser(userId, date)
  const memory: DailyMemory = existing || {
    date,
    sessions: [],
    keyFindings: [],
    decisions: [],
    openQuestions: [],
  }

  const existingIndex = memory.sessions.findIndex(existing =>
    (existing.sessionId && existing.sessionId === session.sessionId)
    || (!existing.sessionId && existing.title === session.title)
  )

  if (existingIndex === -1) {
    memory.sessions.push(session)
  } else {
    memory.sessions[existingIndex] = session
  }

  await saveDailyMemoryForUser(userId, memory)
}

function parseDailyMemory(date: string, content: string): DailyMemory {
  const memory: DailyMemory = {
    date,
    sessions: [],
    keyFindings: [],
    decisions: [],
    openQuestions: [],
  }

  const lines = content.split('\n')
  let currentSection: 'sessions' | 'keyFindings' | 'decisions' | 'openQuestions' | null = null

  for (const line of lines) {
    if (line.startsWith('## Sessions')) {
      currentSection = 'sessions'
    } else if (line.startsWith('## Key Findings')) {
      currentSection = 'keyFindings'
    } else if (line.startsWith('## Decisions')) {
      currentSection = 'decisions'
    } else if (line.startsWith('## Open Questions')) {
      currentSection = 'openQuestions'
    } else if (line.startsWith('---')) {
      currentSection = null
    } else if (currentSection && line.trim()) {
      if (currentSection === 'sessions' && line.startsWith('- **')) {
        const match = line.match(/^- \*\*(.+?)\*\* \[(.+?)\] (.+?)(?: <!-- session:(.+?) timestamp:(.+?) -->)?$/)
        if (match) {
          memory.sessions.push({
            sessionId: match[4] || '',
            title: match[1],
            mode: match[2],
            summary: match[3],
            timestamp: match[5] || '',
          })
        }
      } else if (currentSection && line.startsWith('- ')) {
        const text = line.slice(2).trim()
        if (currentSection === 'keyFindings') {
          memory.keyFindings.push(text)
        } else if (currentSection === 'decisions') {
          memory.decisions.push(text)
        } else if (currentSection === 'openQuestions') {
          memory.openQuestions.push(text)
        }
      }
    }
  }

  return memory
}

function formatDailyMemory(memory: DailyMemory): string {
  const lines: string[] = [
    `# Daily Memory - ${memory.date}`,
    '',
    '## Sessions',
    '',
  ]

  for (const session of memory.sessions) {
    const metadata = session.sessionId || session.timestamp
      ? ` <!-- session:${session.sessionId || ''} timestamp:${session.timestamp || ''} -->`
      : ''
    lines.push(`- **${session.title}** [${session.mode}] ${session.summary}${metadata}`)
  }

  if (memory.keyFindings.length > 0) {
    lines.push('', '## Key Findings', '')
    for (const finding of memory.keyFindings) {
      lines.push(`- ${finding}`)
    }
  }

  if (memory.decisions.length > 0) {
    lines.push('', '## Decisions', '')
    for (const decision of memory.decisions) {
      lines.push(`- ${decision}`)
    }
  }

  if (memory.openQuestions.length > 0) {
    lines.push('', '## Open Questions', '')
    for (const question of memory.openQuestions) {
      lines.push(`- ${question}`)
    }
  }

  return lines.join('\n')
}

export async function loadRecentMemory(days: number = 2): Promise<DailyMemory[]> {
  return loadRecentMemoryForUser('__shared__', days)
}

/**
 * Load recent daily memories for a user, EXCLUDING the session currently in
 * progress (its own transcript is already in context — re-injecting summaries
 * of it is what caused cross-session "memory leak" hallucinations).
 */
export async function loadRecentMemoryForUser(
  userId: string,
  days: number = 2,
  options: { excludeSessionId?: string } = {},
): Promise<DailyMemory[]> {
  const memories: DailyMemory[] = []
  for (let i = 1; i <= days; i++) {
    // Start at i=1 (yesterday): today's other sessions are prior sessions, but
    // the CURRENT session is excluded by sessionId below.
    const date = new Date()
    date.setDate(date.getDate() - i)
    const dateStr = date.toISOString().split('T')[0]
    const memory = await loadDailyMemoryForUser(userId, dateStr)
    if (memory) {
      memories.push(memory)
    }
  }
  // Also include today's *other* completed sessions (but not the live one).
  const today = getTodayDateString()
  const todayMemory = await loadDailyMemoryForUser(userId, today)
  if (todayMemory) {
    const filtered: DailyMemory = {
      ...todayMemory,
      sessions: todayMemory.sessions.filter(s => s.sessionId !== options.excludeSessionId),
    }
    if (filtered.sessions.length > 0) {
      memories.unshift(filtered)
    }
  }
  return memories
}

export function buildMemoryContext(
  memories: DailyMemory[],
  options: { currentSessionId?: string } = {},
): string {
  const relevant = options.currentSessionId
    ? memories
        .map(m => ({ ...m, sessions: m.sessions.filter(s => s.sessionId !== options.currentSessionId) }))
        .filter(m => m.sessions.length > 0 || m.keyFindings.length > 0 || m.decisions.length > 0)
    : memories

  if (relevant.length === 0) return ''

  const lines: string[] = ['Context from PREVIOUS sessions (background only — the current conversation starts fresh):']

  for (const memory of relevant) {
    lines.push(`\n### ${memory.date}`)
    if (memory.sessions.length > 0) {
      lines.push('Sessions:')
      for (const session of memory.sessions) {
        lines.push(`  - ${session.title}: ${session.summary}`)
      }
    }
    if (memory.keyFindings.length > 0) {
      lines.push('Key findings:', ...memory.keyFindings.map(f => `  - ${f}`))
    }
    if (memory.decisions.length > 0) {
      lines.push('Decisions:', ...memory.decisions.map(d => `  - ${d}`))
    }
  }

  return lines.join('\n')
}

export async function loadLongTermMemory(): Promise<string> {
  return loadLongTermMemoryForUser('__shared__')
}

export async function loadLongTermMemoryForUser(userId: string): Promise<string> {
  const candidates = [
    join(getUserMemoryDir(userId), 'MEMORY.md'),
    join(MEMORY_ROOT, 'MEMORY.md'),
  ]
  for (const filePath of candidates) {
    try {
      return await fs.readFile(filePath, 'utf-8')
    } catch {
      // Try the next candidate.
    }
  }
  return ''
}

export async function saveSessionSummary(summary: SessionSummary): Promise<void> {
  return saveSessionSummaryForUser('__shared__', summary)
}

export async function saveSessionSummaryForUser(userId: string, summary: SessionSummary): Promise<void> {
  await ensureUserMemoryDir(userId)
  const filePath = join(getUserMemoryDir(userId), 'session-summaries.md')

  let content = ''
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch {
    content = '# Session Summaries\n\n'
  }

  const entry = [
    `## ${summary.title}`,
    `**Session ID:** ${summary.sessionId}`,
    `**Date:** ${summary.createdAt}`,
    '',
    '### Objective',
    summary.objective || 'Not specified',
    '',
    '### Outcome',
    summary.outcome || 'Not recorded',
    '',
    '### Key Findings',
    summary.keyFindings.length > 0
      ? summary.keyFindings.map(f => `- ${f}`).join('\n')
      : '- None recorded',
    '',
    '### Next Steps',
    summary.nextSteps.length > 0
      ? summary.nextSteps.map(s => `- ${s}`).join('\n')
      : '- None',
    '',
    '---',
    '',
  ].join('\n')

  const marker = '# Session Summaries\n\n'
  const rest = content.replace(marker, '')
  const escapedSessionId = summary.sessionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const existingEntryPattern = new RegExp(
    `##[\\s\\S]*?\\*\\*Session ID:\\*\\* ${escapedSessionId}[\\s\\S]*?(?:\\n---\\n\\n|$)`,
    'g'
  )
  const dedupedRest = rest.replace(existingEntryPattern, '')
  await fs.writeFile(filePath, marker + entry + dedupedRest, 'utf-8')
}

export function generateSessionSummaryPrompt(
  title: string,
  messages: Array<{ role: string; content: string }>,
  objective?: string
): string {
  const userMessages = messages
    .filter(m => m.role === 'user')
    .slice(-3)
    .map(m => m.content)
    .join(' ')

  const assistantMessages = messages
    .filter(m => m.role === 'assistant')
    .map(m => m.content)
    .join(' ')

  return `Generate a concise TL;DR summary of this session. Include:
- The main objective
- Key outcomes or findings
- Any decisions made
- Next steps if mentioned

Session title: ${title}
Objective: ${objective || 'Not specified'}
User's last messages: ${userMessages.slice(0, 500)}
Assistant's responses: ${assistantMessages.slice(0, 1000)}

Respond with a structured summary in this format:
OBJECTIVE: <one sentence>
OUTCOME: <one sentence>
KEY_FINDINGS: <bullet list or "None">
NEXT_STEPS: <bullet list or "None">`
}

export function parseGeneratedSummary(generatedText: string): Partial<SessionSummary> {
  const result: Partial<SessionSummary> = {
    objective: '',
    outcome: '',
    keyFindings: [],
    nextSteps: [],
  }

  const objectiveMatch = generatedText.match(/OBJECTIVE:\s*(.+?)(?:\n|$)/i)
  if (objectiveMatch) {
    result.objective = objectiveMatch[1].trim()
  }

  const outcomeMatch = generatedText.match(/OUTCOME:\s*(.+?)(?:\n|$)/i)
  if (outcomeMatch) {
    result.outcome = outcomeMatch[1].trim()
  }

  const findingsMatch = generatedText.match(/KEY_FINDINGS:\s*([\s\S]*?)(?:\n\n|\nNEXT_STEPS|$)/i)
  if (findingsMatch && !findingsMatch[1].trim().toLowerCase().includes('none')) {
    result.keyFindings = findingsMatch[1]
      .split('\n')
      .map(l => l.replace(/^[-*•]\s*/, '').trim())
      .filter(l => l.length > 0)
  }

  const nextStepsMatch = generatedText.match(/NEXT_STEPS:\s*([\s\S]*?)(?:\n\n|$)/i)
  if (nextStepsMatch && !nextStepsMatch[1].trim().toLowerCase().includes('none')) {
    result.nextSteps = nextStepsMatch[1]
      .split('\n')
      .map(l => l.replace(/^[-*•]\s*/, '').trim())
      .filter(l => l.length > 0)
  }

  return result
}