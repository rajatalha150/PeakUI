/**
 * Multi-Layer Memory System for WorkSpaces
 *
 * Three layers:
 * 1. Daily memory logs - auto-generated summaries in memory/YYYY-MM-DD.md
 * 2. Curated long-term memory - user-maintained MEMORY.md
 * 3. Session summaries - auto-generated TL;DR when sessions end
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

const MEMORY_DIR = process.env.PEAKUI_DATA_DIR
  ? join(process.env.PEAKUI_DATA_DIR, 'memory')
  : join(/*turbopackIgnore: true*/ process.cwd(), 'memory')
const LONG_TERM_MEMORY_CANDIDATES = [
  join(/*turbopackIgnore: true*/ process.cwd(), 'memory.md'),
  join(/*turbopackIgnore: true*/ process.cwd(), 'MEMORY.md'),
  join(MEMORY_DIR, 'MEMORY.md'),
]

export async function ensureMemoryDir(): Promise<void> {
  try {
    await fs.access(MEMORY_DIR)
  } catch {
    await fs.mkdir(MEMORY_DIR, { recursive: true })
  }
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
  const filePath = join(MEMORY_DIR, `${date}.md`)
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return parseDailyMemory(date, content)
  } catch {
    return null
  }
}

export async function saveDailyMemory(memory: DailyMemory): Promise<void> {
  await ensureMemoryDir()
  const filePath = join(MEMORY_DIR, `${memory.date}.md`)
  const content = formatDailyMemory(memory)
  await fs.writeFile(filePath, content, 'utf-8')
}

export async function appendToDailyMemory(
  date: string,
  session: DailyMemorySession
): Promise<void> {
  const existing = await loadDailyMemory(date)
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

  await saveDailyMemory(memory)
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
  const memories: DailyMemory[] = []
  for (let i = 0; i < days; i++) {
    const date = new Date()
    date.setDate(date.getDate() - i)
    const dateStr = date.toISOString().split('T')[0]
    const memory = await loadDailyMemory(dateStr)
    if (memory) {
      memories.push(memory)
    }
  }
  return memories
}

export function buildMemoryContext(memories: DailyMemory[]): string {
  if (memories.length === 0) return ''

  const lines: string[] = ['Recent memory context:']

  for (const memory of memories) {
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
  for (const filePath of LONG_TERM_MEMORY_CANDIDATES) {
    try {
      return await fs.readFile(filePath, 'utf-8')
    } catch {
      // Try the next candidate.
    }
  }
  return ''
}

export async function saveSessionSummary(summary: SessionSummary): Promise<void> {
  await ensureMemoryDir()
  const filePath = join(MEMORY_DIR, 'session-summaries.md')

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
