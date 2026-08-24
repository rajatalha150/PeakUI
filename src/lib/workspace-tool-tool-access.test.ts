import { describe, expect, it } from 'vitest'
import { buildEffectiveWorkspaceToolAccess } from './workspace-tool-tool-access'
import { DEFAULT_SETTINGS, normalizeAppSettings } from './settings'

describe('WorkspaceTool settings normalization', () => {
  it('falls back to default tool modes when optional tool settings are missing', () => {
    const normalized = normalizeAppSettings({
      workspaceToolFileAccessMode: undefined,
      workspaceToolFileWriteMode: undefined,
      workspaceToolHostAccessMode: 'deny',
    workspaceToolCodeExecutionMode: undefined,
      workspaceToolBrowserMode: undefined,
      workspaceToolUwafBrowserMode: undefined,
    } as never)

    expect(normalized.workspaceToolFileAccessMode).toBe(DEFAULT_SETTINGS.workspaceToolFileAccessMode)
    expect(normalized.workspaceToolFileWriteMode).toBe(DEFAULT_SETTINGS.workspaceToolFileWriteMode)
    expect(normalized.workspaceToolCodeExecutionMode).toBe(DEFAULT_SETTINGS.workspaceToolCodeExecutionMode)
    expect(normalized.workspaceToolBrowserMode).toBe(DEFAULT_SETTINGS.workspaceToolBrowserMode)
    expect(normalized.workspaceToolUwafBrowserMode).toBe(DEFAULT_SETTINGS.workspaceToolUwafBrowserMode)
  })

  it('normalizes unattended automation execution settings safely', () => {
    const normalized = normalizeAppSettings({
      workspaceToolAutomationExecutionEnabled: 'yes',
      workspaceToolAutomationExecutionModel: '  llama3.2  ',
      workspaceToolAutomationExecutionMaxRunsPerHour: 999,
      workspaceToolAutomationExecutionAttachWorkspace: 'false',
      workspaceToolAutomationExecutionAttachMemory: 0,
    } as never)

    expect(normalized.workspaceToolAutomationExecutionEnabled).toBe(true)
    expect(normalized.workspaceToolAutomationExecutionModel).toBe('llama3.2')
    expect(normalized.workspaceToolAutomationExecutionMaxRunsPerHour).toBe(60)
    expect(normalized.workspaceToolAutomationExecutionAttachWorkspace).toBe(false)
    expect(normalized.workspaceToolAutomationExecutionAttachMemory).toBe(false)
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

describe('WorkspaceTool effective tool access', () => {
  it('disables tools that personal settings enable when the account lacks permission', () => {
    const access = buildEffectiveWorkspaceToolAccess(
      {
        shellExecutionMode: 'ask-first',
        workspaceToolFileAccessMode: 'read-only',
        workspaceToolFileWriteMode: 'auto-approve',
        shellExecutionTarget: 'container',
        workspaceToolHostAccessMode: 'deny',
        workspaceToolWorkspaceHostRoot: '',
        workspaceToolCodeExecutionMode: 'auto-approve',
        workspaceToolBrowserMode: 'ask-first',
        workspaceToolUwafBrowserMode: 'stealth',
      },
      ['workspace-tool.use']
    )

    expect(access.shellEnabled).toBe(false)
    expect(access.filesystemEnabled).toBe(false)
    expect(access.filesystemWriteEnabled).toBe(false)
    expect(access.codeExecutionEnabled).toBe(false)
    expect(access.browserMode).toBe('deny')
    expect(access.uwafBrowserMode).toBe('deny')
  })

  it('preserves enabled tool modes when both permission and personal settings allow them', () => {
    const access = buildEffectiveWorkspaceToolAccess(
      {
        shellExecutionMode: 'ask-first',
        workspaceToolFileAccessMode: 'read-only',
        workspaceToolFileWriteMode: 'ask-first',
        shellExecutionTarget: 'container',
        workspaceToolHostAccessMode: 'deny',
        workspaceToolWorkspaceHostRoot: '',
        workspaceToolCodeExecutionMode: 'ask-first',
        workspaceToolBrowserMode: 'read-only',
        workspaceToolUwafBrowserMode: 'direct',
      },
      ['workspace-tool.use', 'workspace-tool.shell', 'workspace-tool.filesystem', 'workspace-tool.code', 'workspace-tool.browser', 'workspace-tool.uwaf']
    )

    expect(access.shellEnabled).toBe(true)
    expect(access.filesystemEnabled).toBe(true)
    expect(access.filesystemWriteEnabled).toBe(true)
    expect(access.codeExecutionEnabled).toBe(true)
    expect(access.browserMode).toBe('read-only')
    expect(access.uwafBrowserMode).toBe('direct')
  })
})
