export type ServerStreamStatus =
  | 'connecting'
  | 'internet-lookup'
  | 'stopping-other-models'
  | 'starting-model'
  | 'streaming'
  | 'knowledge-base'

export type UiStreamPhase = 'preparing-context' | ServerStreamStatus

const SERVER_STREAM_STATUSES: readonly ServerStreamStatus[] = [
  'connecting',
  'internet-lookup',
  'stopping-other-models',
  'starting-model',
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
    case 'stopping-other-models':
      return 'Unloading other models...'
    case 'starting-model':
      return 'Starting model...'
    case 'streaming':
      return 'Generating...'
    case 'knowledge-base':
      return 'Searching knowledge base...'
    case 'connecting':
      return 'Connecting to model...'
    default:
      return 'Preparing response...'
  }
}
