import { describe, expect, it, vi } from 'vitest'
import {
  coderRecallQuery,
  enrichCoderPromptWithRecall,
  CODER_RECALL_NOTE_PREFIX,
  type CoderPromptBlock,
} from './coder-context-recall'

describe('coderRecallQuery', () => {
  it('joins only text blocks and ignores images', () => {
    const prompt = [
      { type: 'text', text: 'fix the ' },
      { type: 'image', data: 'abc', mimeType: 'image/png' },
      { type: 'text', text: 'login bug' },
    ]
    expect(coderRecallQuery(prompt)).toBe('fix the  login bug')
  })

  it('returns empty for image-only and empty prompts', () => {
    expect(coderRecallQuery([{ type: 'image', data: 'x', mimeType: 'image/png' }])).toBe('')
    expect(coderRecallQuery([])).toBe('')
    expect(coderRecallQuery('nonsense' as never)).toBe('')
  })
})

describe('enrichCoderPromptWithRecall', () => {
  const prompt: CoderPromptBlock[] = [{ type: 'text', text: 'fix the login bug' }]

  it('prepends a clearly-marked background note when episodes match', async () => {
    const recall = vi.fn(async () => ({ content: '[Context episode 1] summary', episodeIds: ['e1'] }))
    const result = await enrichCoderPromptWithRecall('sess', prompt, recall as never)
    expect(result).not.toBeNull()
    expect(result!.episodeIds).toEqual(['e1'])
    expect(result!.prompt).toHaveLength(2)
    const head = result!.prompt[0]
    expect(head.type).toBe('text')
    expect(String(head.text)).toContain(CODER_RECALL_NOTE_PREFIX)
    expect(String(head.text)).toContain('summary')
    // The original prompt is preserved after the note.
    expect(result!.prompt[1]).toBe(prompt[0])
  })

  it('returns null when no episodes match, leaving the prompt unchanged', async () => {
    const recall = vi.fn(async () => ({ content: '', episodeIds: [] }))
    expect(await enrichCoderPromptWithRecall('sess', prompt, recall as never)).toBeNull()
  })

  it('returns null (and does not throw) when recall errors', async () => {
    const recall = vi.fn(async () => { throw new Error('db down') })
    expect(await enrichCoderPromptWithRecall('sess', prompt, recall as never)).toBeNull()
  })

  it('returns null for a non-array prompt', async () => {
    const recall = vi.fn()
    expect(await enrichCoderPromptWithRecall('sess', 'x' as never, recall as never)).toBeNull()
    expect(recall).not.toHaveBeenCalled()
  })
})
