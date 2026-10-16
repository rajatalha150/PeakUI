export type ServerStreamStatus =
  | 'queued'
  | 'connecting'
  | 'preparing-context'
  | 'internet-lookup'
  | 'web-search'
  | 'knowledge-base'
  | 'compacting-context'
  | 'stopping-other-models'
  | 'starting-model'
  | 'model-loading'
  | 'model-thinking'
  | 'model-reviewing'
  | 'tool-planning'
  | 'tool-running'
  | 'tool-completed'
  | 'tool-failed'
  | 'finalizing'
  | 'completed'
  | 'retrying'
  | 'waiting-approval'
  | 'failed'
  | 'streaming'
  | 'tool-shell'
  | 'tool-code'
  | 'tool-filesystem'
  | 'tool-browser'
  | 'tool-uwaf-browser'
  | 'tool-uwaf-browser-stealth'

export type UiStreamPhase = 'preparing-context' | ServerStreamStatus

const SERVER_STREAM_STATUSES: readonly ServerStreamStatus[] = [
  'queued',
  'connecting',
  'preparing-context',
  'internet-lookup',
  'web-search',
  'knowledge-base',
  'compacting-context',
  'stopping-other-models',
  'starting-model',
  'model-loading',
  'model-thinking',
  'model-reviewing',
  'tool-planning',
  'tool-running',
  'tool-completed',
  'tool-failed',
  'finalizing',
  'completed',
  'retrying',
  'waiting-approval',
  'failed',
  'streaming',
  'tool-shell',
  'tool-code',
  'tool-filesystem',
  'tool-browser',
  'tool-uwaf-browser',
  'tool-uwaf-browser-stealth',
]

export function isServerStreamStatus(value: unknown): value is ServerStreamStatus {
  return typeof value === 'string' && SERVER_STREAM_STATUSES.includes(value as ServerStreamStatus)
}

export function getStreamPhaseLabel(phase: UiStreamPhase | null): string {
  switch (phase) {
    case 'queued':
      return 'Queued on the WorkSpaces daemon...'
    case 'preparing-context':
      return 'Preparing workspace context...'
    case 'compacting-context':
      return 'Compressing older context...'
    case 'internet-lookup':
      return 'Researching web...'
    case 'web-search':
      return 'Searching web...'
    case 'knowledge-base':
      return 'Searching knowledge base...'
    case 'stopping-other-models':
      return 'Unloading other models...'
    case 'starting-model':
      return 'Starting model...'
    case 'model-loading':
      return 'Loading model into memory...'
    case 'model-thinking':
      return 'Planning the next step...'
    case 'model-reviewing':
      return 'Reviewing the latest results...'
    case 'tool-planning':
      return 'Choosing the next tool...'
    case 'tool-running':
      return 'Running a workspace tool...'
    case 'tool-completed':
      return 'Tool finished; reviewing the result...'
    case 'tool-failed':
      return 'A tool reported an error...'
    case 'finalizing':
      return 'Saving the response...'
    case 'completed':
      return 'Response complete'
    case 'retrying':
      return 'Reconnecting to the workspace runtime...'
    case 'waiting-approval':
      return 'Waiting for your approval...'
    case 'failed':
      return 'The run stopped with an error'
    case 'streaming':
      return 'Generating...'
    case 'connecting':
      return 'Connecting to model...'
    case 'tool-shell':
      return 'Running command...'
    case 'tool-code':
      return 'Running code...'
    case 'tool-filesystem':
      return 'Reading filesystem...'
    case 'tool-browser':
      return 'Browsing page...'
    case 'tool-uwaf-browser':
      return 'Browsing page...'
    case 'tool-uwaf-browser-stealth':
      return 'Routing through Tor...'
    default:
      return 'Preparing response...'
  }
}
