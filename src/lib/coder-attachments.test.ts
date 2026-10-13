import { describe, expect, it } from 'vitest'
import { attachmentPrompt } from './coder-attachments'

describe('attachmentPrompt', () => {
  it('keeps the user instruction and gives the agent exact file paths', () => {
    expect(attachmentPrompt('Review this', [{ name: 'report.pdf', path: '/workspace/project/.peakui-attachments/id/report.pdf' }]))
      .toContain('Review this\n\nAttached files in the current workspace:\n- "report.pdf": "/workspace/project/.peakui-attachments/id/report.pdf"')
  })

  it('supports an attachment-only turn', () => {
    expect(attachmentPrompt('', [{ name: 'sample.png', path: '/workspace/sample.png' }]))
      .toContain('Inspect the attached files and help with this project.')
  })
})
