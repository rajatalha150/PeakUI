import { describe, expect, it } from 'vitest'
import { getShellCommandDecision } from './shell-execution'

describe('getShellCommandDecision', () => {
  it('auto-approves simple allowlisted commands in auto-approve mode', () => {
    const decision = getShellCommandDecision('pwd', 'auto-approve', [])
    expect(decision.allowed).toBe(true)
    expect(decision.autoApproved).toBe(true)
    expect(decision.requiresApproval).toBeFalsy()
  })

  it('requires approval for shell operators in auto-approve mode', () => {
    const decision = getShellCommandDecision('pwd && ls', 'auto-approve', [])
    expect(decision.allowed).toBe(true)
    expect(decision.autoApproved).toBeFalsy()
    expect(decision.requiresApproval).toBe(true)
  })

  it('requires approval for non-allowlisted commands in auto-approve mode', () => {
    const decision = getShellCommandDecision('make build', 'auto-approve', [])
    expect(decision.allowed).toBe(true)
    expect(decision.autoApproved).toBeFalsy()
    expect(decision.requiresApproval).toBe(true)
  })

  it('blocks dangerous commands in any mode', () => {
    const decision = getShellCommandDecision('sudo ls', 'ask-first', [])
    expect(decision.allowed).toBe(false)
    expect(decision.blocked).toBe(true)
  })

  it('requires approval for safe commands in ask-first mode', () => {
    const decision = getShellCommandDecision('pwd', 'ask-first', [])
    expect(decision.allowed).toBe(true)
    expect(decision.requiresApproval).toBe(true)
    expect(decision.autoApproved).toBeFalsy()
  })
})
