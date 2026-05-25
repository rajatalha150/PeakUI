import { describe, expect, it } from 'vitest'
import { buildEffectiveOpenClawToolAccess } from './openclaw-tool-access'
import { DEFAULT_SETTINGS, normalizeAppSettings } from './settings'

describe('OpenClaw settings normalization', () => {
  it('falls back to default tool modes when optional tool settings are missing', () => {
    const normalized = normalizeAppSettings({
      openClawFileAccessMode: undefined,
      openClawFileWriteMode: undefined,
      openClawCodeExecutionMode: undefined,
      openClawBrowserMode: undefined,
      openClawUwafBrowserMode: undefined,
    } as never)

    expect(normalized.openClawFileAccessMode).toBe(DEFAULT_SETTINGS.openClawFileAccessMode)
    expect(normalized.openClawFileWriteMode).toBe(DEFAULT_SETTINGS.openClawFileWriteMode)
    expect(normalized.openClawCodeExecutionMode).toBe(DEFAULT_SETTINGS.openClawCodeExecutionMode)
    expect(normalized.openClawBrowserMode).toBe(DEFAULT_SETTINGS.openClawBrowserMode)
    expect(normalized.openClawUwafBrowserMode).toBe(DEFAULT_SETTINGS.openClawUwafBrowserMode)
  })
})

describe('OpenClaw effective tool access', () => {
  it('disables tools that personal settings enable when the account lacks permission', () => {
    const access = buildEffectiveOpenClawToolAccess(
      {
        shellExecutionMode: 'ask-first',
        openClawFileAccessMode: 'read-only',
        openClawFileWriteMode: 'auto-approve',
        openClawCodeExecutionMode: 'auto-approve',
        openClawBrowserMode: 'ask-first',
        openClawUwafBrowserMode: 'stealth',
      },
      ['openclaw.use']
    )

    expect(access.shellEnabled).toBe(false)
    expect(access.filesystemEnabled).toBe(false)
    expect(access.filesystemWriteEnabled).toBe(false)
    expect(access.codeExecutionEnabled).toBe(false)
    expect(access.browserMode).toBe('deny')
    expect(access.uwafBrowserMode).toBe('deny')
  })

  it('preserves enabled tool modes when both permission and personal settings allow them', () => {
    const access = buildEffectiveOpenClawToolAccess(
      {
        shellExecutionMode: 'ask-first',
        openClawFileAccessMode: 'read-only',
        openClawFileWriteMode: 'ask-first',
        openClawCodeExecutionMode: 'ask-first',
        openClawBrowserMode: 'read-only',
        openClawUwafBrowserMode: 'direct',
      },
      ['openclaw.use', 'openclaw.shell', 'openclaw.filesystem', 'openclaw.code', 'openclaw.browser', 'openclaw.uwaf']
    )

    expect(access.shellEnabled).toBe(true)
    expect(access.filesystemEnabled).toBe(true)
    expect(access.filesystemWriteEnabled).toBe(true)
    expect(access.codeExecutionEnabled).toBe(true)
    expect(access.browserMode).toBe('read-only')
    expect(access.uwafBrowserMode).toBe('direct')
  })
})
