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

  it('adds answers (answerKey -> label) as a TOP-LEVEL sibling for user questions', () => {
    const body = buildPermissionVoteBody('proceed_once', { '0': 'Open-Meteo — no API key (Recommended)' })
    expect(body).toEqual({
      outcome: { outcome: 'selected', optionId: 'proceed_once' },
      answers: { '0': 'Open-Meteo — no API key (Recommended)' },
    })
    // `answers` must be a sibling of `outcome`, never a child of it.
    expect(body.outcome).not.toHaveProperty('answers')
  })

  it('omits answers for a plain permission ask (no answers / empty map)', () => {
    expect(buildPermissionVoteBody('proceed_once')).not.toHaveProperty('answers')
    expect(buildPermissionVoteBody('proceed_once', null)).not.toHaveProperty('answers')
    expect(buildPermissionVoteBody('proceed_once', {})).not.toHaveProperty('answers')
  })
})
