import { describe, expect, it } from 'vitest'
import { isWindowsHostPath, isKnownWorkspaceToolHostPath } from './workspace-tool-path-check'

describe('workspace-tool-path-check', () => {
  describe('isWindowsHostPath', () => {
    it('detects Windows drive-letter paths', () => {
      expect(isWindowsHostPath('C:\\Users\\John\\project')).toBe(true)
      expect(isWindowsHostPath('C:/Users/John/project')).toBe(true)
    })

    it('rejects POSIX paths', () => {
      expect(isWindowsHostPath('/home/john/project')).toBe(false)
      expect(isWindowsHostPath('/mnt/workspace-tool/projects')).toBe(false)
    })
  })

  describe('isKnownWorkspaceToolHostPath', () => {
    it('matches mounted host prefixes', () => {
      const prefixes = ['C:/Users/John/peakui-workspace', 'C:/Users/John/Desktop']
      expect(isKnownWorkspaceToolHostPath('C:/Users/John/peakui-workspace/file.txt', prefixes)).toBe(true)
      expect(isKnownWorkspaceToolHostPath('C:/Users/John/Desktop/project/src/main.ts', prefixes)).toBe(true)
      expect(isKnownWorkspaceToolHostPath('D:/Other/project', prefixes)).toBe(false)
    })

    it('matches POSIX mounted prefixes', () => {
      const prefixes = ['/home/raza/peakui-workspace']
      expect(isKnownWorkspaceToolHostPath('/home/raza/peakui-workspace/file.txt', prefixes)).toBe(true)
      expect(isKnownWorkspaceToolHostPath('/tmp/file.txt', prefixes)).toBe(false)
    })
  })
})
