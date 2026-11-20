import { describe, expect, it } from 'vitest'
import { isUnfinishedWorkspaceProgress, shouldContinueWorkspaceTurn } from './workspace-agent-continuation'

describe('unfinished WorkSpaces progress', () => {
  it('recognizes the short promises seen in the contact research session', () => {
    expect(isUnfinishedWorkspaceProgress('Continuing with Halmar International.')).toBe(true)
    expect(isUnfinishedWorkspaceProgress('Continuing with the next 20 companies (ranks 38–57). Starting with Forte Construction.')).toBe(true)
    expect(isUnfinishedWorkspaceProgress('Forte Construction locked — Larry Pappas (President). Continuing with Economy Container.')).toBe(true)
  })

  it('accepts a completed answer', () => {
    expect(isUnfinishedWorkspaceProgress('Here are the 20 verified companies and their contact details.')).toBe(false)
    expect(isUnfinishedWorkspaceProgress('I could not verify a direct number for Halmar International.')).toBe(false)
  })

  it('keeps a short contact update going when the user explicitly asked for persistence', () => {
    expect(shouldContinueWorkspaceTurn('Halmar International locked — company phone verified.', 'dont stop until satisfied')).toBe(true)
    expect(shouldContinueWorkspaceTurn('Done. All requested contacts are in the workbook.', 'dont stop until satisfied')).toBe(false)
    expect(shouldContinueWorkspaceTurn('Halmar International locked — company phone verified.', 'what is the company phone?')).toBe(false)
  })

  it('does not treat a permission question as completion when the task already requested the work', () => {
    const response = '## Batch Complete\n\n11 of 16 contacts found. Want me to: 1. Push these into the master workbook, or 2. Dig deeper on the 5 gaps?'
    const request = 'Continue from Halmar, update the contact workbook, and finish the batch. Do not end with a status-only update.'
    expect(shouldContinueWorkspaceTurn(response, request)).toBe(true)
  })
})
