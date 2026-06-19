export type ServerStreamStatus =
  | 'connecting'
  | 'internet-lookup'
  | 'web-search'
  | 'stopping-other-models'
  | 'starting-model'
  | 'model-loading'
  | 'streaming'
  | 'knowledge-base'
  | 'tool-shell'
  | 'tool-code'
  | 'tool-filesystem'
  | 'tool-browser'
  | 'tool-uwaf-browser'

export type UiStreamPhase = 'preparing-context' | ServerStreamStatus

const SERVER_STREAM_STATUSES: readonly ServerStreamStatus[] = [
  'connecting',
  'internet-lookup',
  'web-search',
  'stopping-other-models',
  'starting-model',
  'model-loading',
  'streaming',
]

export function isServerStreamStatus(value: unknown): value is ServerStreamStatus {
  return typeof value === 'string' && SERVER_STREAM_STATUSES.includes(value as ServerStreamStatus)
}

export function getStreamPhaseLabel(phase: UiStreamPhase | null): string {
  switch (phase) {
    case 'preparing-context':
      return 'Searching knowledge base...'
    case 'internet-lookup':
      return 'Researching web...'
    case 'web-search':
      return 'Searching web...'
    case 'stopping-other-models':
      return 'Unloading other models...'
    case 'starting-model':
      return 'Starting model...'
    case 'model-loading':
      return 'Loading model into memory...'
    case 'streaming':
      return 'Generating...'
    case 'knowledge-base':
      return 'Searching knowledge base...'
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
    default:
      return 'Preparing response...'
  }
}