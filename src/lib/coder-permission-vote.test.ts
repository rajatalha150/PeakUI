import { describe, expect, it } from 'vitest'
import { buildPermissionVoteBody } from './coder-permission-vote'

/**
 * The regression these lock down: the Coding UI used to send a FLAT
 * `{ outcome: 'selected', optionId }` body. The daemon's ACP contract nests
 * `outcome`, so every vote 400'd and the UI reported "That request is no
 * longer pending." while the agent stayed blocked indefinitely.
 */
describe('buildPermissionVoteBody', () => {
  it('nests the outcome for a selection (the shape the daemon accepts)', () => {
    expect(buildPermissionVoteBody('proceed_once')).toEqual({
      outcome: { outcome: 'selected', optionId: 'proceed_once' },
    })
  })

  it('never emits the flat shape that the daemon rejects with 400', () => {
    const body = buildPermissionVoteBody('proceed_once') as unknown as Record<string, unknown>
    // The old bug: a string `outcome` alongside a top-level `optionId`.
    expect(typeof body.outcome).not.toBe('string')
    expect(body).not.toHaveProperty('optionId')
  })

  it('nests outcome for a rejection', () => {
    expect(buildPermissionVoteBody()).toEqual({ outcome: { outcome: 'cancelled' } })
  })

  it('treats an empty / whitespace optionId as a rejection rather than a bad selection', () => {
    expect(buildPermissionVoteBody('')).toEqual({ outcome: { outcome: 'cancelled' } })
    expect(buildPermissionVoteBody('   ')).toEqual({ outcome: { outcome: 'cancelled' } })
    expect(buildPermissionVoteBody(null)).toEqual({ outcome: { outcome: 'cancelled' } })
  })

  it('adds answers as a TOP-LEVEL sibling (not nested inside outcome) for user questions', () => {
    const body = buildPermissionVoteBody('opt-a', 'question-1')
    expect(body).toEqual({
      outcome: { outcome: 'selected', optionId: 'opt-a' },
      answers: { 'question-1': 'opt-a' },
    })
    // `answers` must be a sibling of `outcome`, never a child of it.
    expect(body.outcome).not.toHaveProperty('answers')
  })

  it('omits answers when there is no answerKey (plain permission ask)', () => {
    expect(buildPermissionVoteBody('cancel')).not.toHaveProperty('answers')
    expect(buildPermissionVoteBody('cancel', '')).not.toHaveProperty('answers')
  })

  it('trims the optionId and answerKey it forwards', () => {
    expect(buildPermissionVoteBody('  proceed_once  ', '  q1  ')).toEqual({
      outcome: { outcome: 'selected', optionId: 'proceed_once' },
      answers: { q1: 'proceed_once' },
    })
  })
})
