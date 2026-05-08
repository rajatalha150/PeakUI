export type OpenClawAgentMode = 'plan' | 'research' | 'execute' | 'review'
export type OpenClawResponseStyle = 'concise' | 'structured' | 'deep'

export interface OpenClawAgentPreferences {
  mode: OpenClawAgentMode
  responseStyle: OpenClawResponseStyle
  askClarifyingQuestionFirst: boolean
  autoContinue: boolean
  workspaceNotes: string
  successCriteria: string
}

export interface OpenClawChecklistItem {
  id: string
  text: string
  completed: boolean
}

export interface OpenClawTaskState {
  objective: string
  currentStatus: string
  nextStep: string
  doneCriteria: string
  checklist: OpenClawChecklistItem[]
}

export const DEFAULT_OPENCLAW_AGENT_PREFERENCES: OpenClawAgentPreferences = {
  mode: 'plan',
  responseStyle: 'structured',
  askClarifyingQuestionFirst: true,
  autoContinue: false,
  workspaceNotes: '',
  successCriteria: '',
}

export const DEFAULT_OPENCLAW_TASK_STATE: OpenClawTaskState = {
  objective: '',
  currentStatus: '',
  nextStep: '',
  doneCriteria: '',
  checklist: [],
}

export const OPENCLAW_AGENT_MODE_OPTIONS: Array<{
  id: OpenClawAgentMode
  label: string
  description: string
}> = [
  {
    id: 'plan',
    label: 'Plan',
    description: 'Break work into phases, dependencies, risks, and next actions.',
  },
  {
    id: 'research',
    label: 'Research',
    description: 'Compare options, cite evidence, and surface unknowns before deciding.',
  },
  {
    id: 'execute',
    label: 'Execute',
    description: 'Produce concrete steps, commands, drafts, and ready-to-run deliverables.',
  },
  {
    id: 'review',
    label: 'Review',
    description: 'Audit the work for gaps, regressions, and safer alternatives.',
  },
]

export const OPENCLAW_RESPONSE_STYLE_OPTIONS: Array<{
  id: OpenClawResponseStyle
  label: string
  description: string
}> = [
  {
    id: 'concise',
    label: 'Concise',
    description: 'Prefer a compact answer with only the essential actions.',
  },
  {
    id: 'structured',
    label: 'Structured',
    description: 'Use clear sections, a checklist, and an explicit next step.',
  },
  {
    id: 'deep',
    label: 'Deep',
    description: 'Go broader on tradeoffs, validation, fallback paths, and edge cases.',
  },
]

export const OPENCLAW_QUICK_PROMPTS: Array<{
  title: string
  description: string
  mode: OpenClawAgentMode
  prompt: string
}> = [
  {
    title: 'Plan a workflow',
    description: 'Turn a rough goal into phases, tasks, risks, and next steps.',
    mode: 'plan',
    prompt: 'Plan this task end-to-end and turn it into a practical workflow:',
  },
  {
    title: 'Research options',
    description: 'Compare tools, approaches, or vendors before deciding.',
    mode: 'research',
    prompt: 'Research the best options for this and recommend one with tradeoffs:',
  },
  {
    title: 'Execute a task',
    description: 'Draft the exact steps, commands, or deliverable needed to move now.',
    mode: 'execute',
    prompt: 'Help me execute this task now. Give me the exact steps and deliverables:',
  },
  {
    title: 'Review and audit',
    description: 'Inspect a draft, plan, or setup for gaps and hidden risks.',
    mode: 'review',
    prompt: 'Review this critically. Call out problems, missing pieces, and safer fixes:',
  },
]

function getModeInstruction(mode: OpenClawAgentMode): string {
  switch (mode) {
    case 'research':
      return 'Approach the task like a research operator: gather evidence, compare options, highlight uncertainty, and make a recommendation only after weighing tradeoffs.'
    case 'execute':
      return 'Approach the task like an execution operator: produce concrete steps, commands, drafts, and immediately usable output instead of abstract advice.'
    case 'review':
      return 'Approach the task like a reviewer: identify flaws, regressions, missing validation, and safer alternatives before proposing the next move.'
    case 'plan':
    default:
      return 'Approach the task like a planner: break the work into stages, dependencies, checkpoints, and a clear next action.'
  }
}

function getResponseStyleInstruction(style: OpenClawResponseStyle): string {
  switch (style) {
    case 'concise':
      return 'Keep the answer compact. Prefer short paragraphs and a minimal checklist.'
    case 'deep':
      return 'Go deep where it matters. Include tradeoffs, validation, fallback paths, and edge cases when they materially affect the decision.'
    case 'structured':
    default:
      return 'Structure the answer cleanly. When useful, separate it into objective, plan, steps, risks, and next step.'
  }
}

function normalizeChecklistLine(line: string): string {
  return line
    .trim()
    .replace(/^[-*•]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^\[\s?\]\s+/, '')
    .replace(/^\[[xX]\]\s+/, '')
    .trim()
}

export function extractOpenClawChecklistSuggestions(content: string): string[] {
  const checklistPattern = /^\s*(?:[-*•]|\d+\.|\[\s?\]|\[[xX]\])\s+/
  const lines = content
    .split('\n')
    .filter(line => checklistPattern.test(line))
    .map(normalizeChecklistLine)
    .filter(line => Boolean(line) && line.length > 6)

  const uniqueLines = lines.filter((line, index, values) => values.indexOf(line) === index)
  return uniqueLines.length >= 2 ? uniqueLines.slice(0, 8) : []
}

export function createOpenClawChecklistItems(lines: string[]): OpenClawChecklistItem[] {
  return lines.map(text => ({
    id: crypto.randomUUID(),
    text,
    completed: false,
  }))
}

export function buildOpenClawWorkspaceBrief(preferences: OpenClawAgentPreferences): string {
  const lines = [
    'Open Claw workspace brief:',
    `Active mode: ${preferences.mode}.`,
    getModeInstruction(preferences.mode),
    getResponseStyleInstruction(preferences.responseStyle),
    preferences.askClarifyingQuestionFirst
      ? 'If the user intent is materially ambiguous, ask one focused clarification before committing to the plan.'
      : 'Do not stall for unnecessary clarification. Make reasonable assumptions explicit and keep moving.',
  ]

  if (preferences.workspaceNotes.trim()) {
    lines.push(`Workspace notes:\n${preferences.workspaceNotes.trim()}`)
  }

  if (preferences.successCriteria.trim()) {
    lines.push(`Success criteria:\n${preferences.successCriteria.trim()}`)
  }

  lines.push('Keep the task state visible. Surface assumptions, current progress, and the single best next action.')

  return lines.join('\n\n')
}

export function buildOpenClawTaskStateBrief(taskState: OpenClawTaskState): string {
  const lines: string[] = []

  if (taskState.objective.trim()) {
    lines.push(`Objective:\n${taskState.objective.trim()}`)
  }

  if (taskState.currentStatus.trim()) {
    lines.push(`Current status:\n${taskState.currentStatus.trim()}`)
  }

  if (taskState.nextStep.trim()) {
    lines.push(`Next step:\n${taskState.nextStep.trim()}`)
  }

  if (taskState.doneCriteria.trim()) {
    lines.push(`Done criteria:\n${taskState.doneCriteria.trim()}`)
  }

  if (taskState.checklist.length > 0) {
    lines.push(`Pinned checklist:\n${taskState.checklist.map(item => `- ${item.completed ? '[done]' : '[todo]'} ${item.text}`).join('\n')}`)
  }

  if (lines.length === 0) return ''

  return ['Open Claw task state:', ...lines].join('\n\n')
}
