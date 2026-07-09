import { describe, expect, it } from 'vitest'
import { buildEffectiveOpenClawToolAccess } from './openclaw-tool-access'
import { DEFAULT_SETTINGS, normalizeAppSettings } from './settings'

describe('OpenClaw settings normalization', () => {
  it('falls back to default tool modes when optional tool settings are missing', () => {
    const normalized = normalizeAppSettings({
      openClawFileAccessMode: undefined,
      openClawFileWriteMode: undefined,
      openClawHostAccessMode: 'deny',
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

  it('normalizes unattended automation execution settings safely', () => {
    const normalized = normalizeAppSettings({
      openClawAutomationExecutionEnabled: 'yes',
      openClawAutomationExecutionModel: '  llama3.2  ',
      openClawAutomationExecutionMaxRunsPerHour: 999,
      openClawAutomationExecutionAttachWorkspace: 'false',
      openClawAutomationExecutionAttachMemory: 0,
    } as never)

    expect(normalized.openClawAutomationExecutionEnabled).toBe(true)
    expect(normalized.openClawAutomationExecutionModel).toBe('llama3.2')
    expect(normalized.openClawAutomationExecutionMaxRunsPerHour).toBe(60)
    expect(normalized.openClawAutomationExecutionAttachWorkspace).toBe(false)
    expect(normalized.openClawAutomationExecutionAttachMemory).toBe(false)
  })

  it('preserves the legacy implicit Ollama default-context behavior and normalizes new default toggles', () => {
    const normalized = normalizeAppSettings({
      contextLength: DEFAULT_SETTINGS.contextLength,
      ollamaUseModelDefaultContext: undefined,
      ollamaUseModelDefaultTemperature: 'true',
    } as never)

    expect(normalized.ollamaUseModelDefaultContext).toBe(true)
    expect(normalized.ollamaUseModelDefaultTemperature).toBe(true)
  })
})

describe('OpenClaw effective tool access', () => {
  it('disables tools that personal settings enable when the account lacks permission', () => {
    const access = buildEffectiveOpenClawToolAccess(
      {
        shellExecutionMode: 'ask-first',
        openClawFileAccessMode: 'read-only',
        openClawFileWriteMode: 'auto-approve',
        openClawHostAccessMode: 'deny',
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
        openClawHostAccessMode: 'deny',
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
