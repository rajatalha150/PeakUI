import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceVisionPrompt,
  extractWorkspaceVisionText,
  normalizeVisionImageData,
  normalizeVisionMimeType,
} from './workspace-vision'

describe('WorkSpaces vision handoff', () => {
  it('normalizes data URLs without losing their MIME type', () => {
    expect(normalizeVisionImageData('data:image/png;base64,abc123')).toEqual({
      data: 'abc123',
      mimeType: 'image/png',
    })
    expect(normalizeVisionImageData('abc123')).toEqual({ data: 'abc123' })
  })

  it('uses the attachment extension when a provider omits a usable image MIME type', () => {
    expect(normalizeVisionMimeType('application/octet-stream', 'receipt.jpg')).toBe('image/jpeg')
    expect(normalizeVisionMimeType('', 'screen.png')).toBe('image/png')
  })

  it('anchors the visual analyst to filenames and the user request', () => {
    const prompt = buildWorkspaceVisionPrompt([
      { name: 'receipt.png', type: 'image/png', data: 'abc' },
    ], 'Find the total and date.')
    expect(prompt).toContain('receipt.png')
    expect(prompt).toContain('Find the total and date.')
    expect(prompt).toContain('Mark uncertain or unreadable content instead of guessing.')
  })

  it('extracts both Ollama and OpenAI-compatible response shapes', () => {
    expect(extractWorkspaceVisionText({ message: { content: 'Receipt total: $12.00' } })).toBe('Receipt total: $12.00')
    expect(extractWorkspaceVisionText({ choices: [{ message: { content: 'Receipt total: $12.00' } }] })).toBe('Receipt total: $12.00')
    expect(extractWorkspaceVisionText({ choices: [{ message: { content: [{ type: 'text', text: 'A chart is visible.' }] } }] })).toBe('A chart is visible.')
  })
})
