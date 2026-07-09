import { describe, expect, it } from 'vitest'
import { isWindowsHostPath, isKnownOpenClawHostPath } from './openclaw-path-check'

describe('openclaw-path-check', () => {
  describe('isWindowsHostPath', () => {
    it('detects Windows drive-letter paths', () => {
      expect(isWindowsHostPath('C:\\Users\\John\\project')).toBe(true)
      expect(isWindowsHostPath('C:/Users/John/project')).toBe(true)
    })

    it('rejects POSIX paths', () => {
      expect(isWindowsHostPath('/home/john/project')).toBe(false)
      expect(isWindowsHostPath('/mnt/openclaw/projects')).toBe(false)
    })
  })

  describe('isKnownOpenClawHostPath', () => {
    it('matches mounted host prefixes', () => {
      const prefixes = ['C:/Users/John/peakui-workspace', 'C:/Users/John/Desktop']
      expect(isKnownOpenClawHostPath('C:/Users/John/peakui-workspace/file.txt', prefixes)).toBe(true)
      expect(isKnownOpenClawHostPath('C:/Users/John/Desktop/project/src/main.ts', prefixes)).toBe(true)
      expect(isKnownOpenClawHostPath('D:/Other/project', prefixes)).toBe(false)
    })

    it('matches POSIX mounted prefixes', () => {
      const prefixes = ['/home/raza/peakui-workspace']
      expect(isKnownOpenClawHostPath('/home/raza/peakui-workspace/file.txt', prefixes)).toBe(true)
      expect(isKnownOpenClawHostPath('/tmp/file.txt', prefixes)).toBe(false)
    })
  })
})
