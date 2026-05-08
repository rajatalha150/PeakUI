export const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text'

export interface EmbeddingModelRecommendation {
  name: string
  size: string
  note: string
}

export const RECOMMENDED_EMBEDDING_MODELS: readonly EmbeddingModelRecommendation[] = [
  { name: 'all-minilm', size: '46MB', note: 'Tiny, lowest resource use' },
  { name: 'nomic-embed-text', size: '274MB', note: 'Fast, balanced default' },
  { name: 'embeddinggemma', size: '622MB', note: 'Small Google model, strong multilingual retrieval' },
  { name: 'snowflake-arctic-embed', size: '669MB', note: 'Performance-optimized balanced retrieval' },
  { name: 'mxbai-embed-large', size: '670MB', note: 'High-quality English retrieval, slower' },
  { name: 'nomic-embed-text-v2-moe', size: '958MB', note: 'Multilingual, strong recall, storage-efficient' },
  { name: 'bge-m3', size: '1.2GB', note: 'Multilingual, long-doc, dense + sparse retrieval' },
  { name: 'qwen3-embedding:0.6b', size: '639MB', note: 'Small Qwen3 option with strong multilingual support' },
]

export function normalizeOllamaModelName(value: unknown, fallback = ''): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return fallback
  return raw.endsWith(':latest') ? raw.slice(0, -':latest'.length) : raw
}

export function ollamaModelKey(value: unknown): string {
  return normalizeOllamaModelName(value).toLowerCase()
}

export function isSameOllamaModel(a: unknown, b: unknown): boolean {
  const left = ollamaModelKey(a)
  const right = ollamaModelKey(b)
  return Boolean(left && right && left === right)
}
