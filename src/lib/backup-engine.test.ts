import { describe, expect, it } from 'vitest'

import { BACKUP_SETTINGS_FIELDS, BACKUP_SECRET_SETTINGS_FIELDS, filterBackupSettings } from './backup-engine'

describe('backup settings scopes', () => {
  const settings = {
    coderModel: 'coding-model',
    coderVisionModel: 'vision-model',
    workspaceToolVisionModel: 'workspace-vision',
    imageGenProvider: 'comfyui',
    workspaceToolNativeToolCalls: 'on',
    coderApiKey: 'coder-secret',
    ollamaApiKey: 'ollama-secret',
  }

  it('keeps current Coder, vision, and generation settings in the normal archive', () => {
    const archived = filterBackupSettings(settings)
    expect(archived).toMatchObject({
      coderModel: 'coding-model',
      coderVisionModel: 'vision-model',
      workspaceToolVisionModel: 'workspace-vision',
      imageGenProvider: 'comfyui',
      workspaceToolNativeToolCalls: 'on',
    })
    expect(archived).not.toHaveProperty('coderApiKey')
    expect(archived).not.toHaveProperty('ollamaApiKey')
  })

  it('includes credentials only when the explicit secret scope is selected', () => {
    expect(filterBackupSettings(settings, { includeStandard: false, includeSecrets: true })).toEqual({
      coderApiKey: 'coder-secret',
      ollamaApiKey: 'ollama-secret',
    })
  })

  it('keeps the two scope lists disjoint', () => {
    expect(BACKUP_SETTINGS_FIELDS).not.toContain('coderApiKey')
    expect(BACKUP_SECRET_SETTINGS_FIELDS).not.toContain('coderModel')
  })
})
