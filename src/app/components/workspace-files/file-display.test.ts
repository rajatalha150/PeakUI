import { describe, expect, it } from 'vitest'
import {
  classifyFile,
  extensionOf,
  fileBaseName,
  humanFileSize,
  isEditableFile,
  joinPath,
  parentPath,
} from './file-display'
import type { WorkspaceFileContent } from '@/lib/workspace-files-types'

describe('file-display', () => {
  describe('extensionOf', () => {
    it('returns the lowercase extension', () => {
      expect(extensionOf('foo/bar/Baz.TSX')).toBe('tsx')
      expect(extensionOf('README')).toBe('')
      expect(extensionOf('.gitignore')).toBe('')
      expect(extensionOf('foo/.eslintrc.json')).toBe('json')
    })
  })

  describe('fileBaseName', () => {
    it('returns the final path segment', () => {
      expect(fileBaseName('a/b/c.txt')).toBe('c.txt')
      expect(fileBaseName('README.md')).toBe('README.md')
    })
  })

  describe('parentPath', () => {
    it('returns everything before the last slash', () => {
      expect(parentPath('a/b/c.txt')).toBe('a/b')
      expect(parentPath('README.md')).toBe('')
      expect(parentPath('a/file')).toBe('a')
    })
  })

  describe('joinPath', () => {
    it('joins with a single slash, omitting when parent is empty', () => {
      expect(joinPath('', 'foo')).toBe('foo')
      expect(joinPath('a', 'b')).toBe('a/b')
      expect(joinPath('a/b', 'c')).toBe('a/b/c')
    })
  })

  describe('classifyFile', () => {
    it('classifies markdown', () => {
      expect(classifyFile({ path: 'foo.md' })).toBe('markdown')
    })
    it('classifies code', () => {
      expect(classifyFile({ path: 'foo.ts' })).toBe('code')
      expect(classifyFile({ path: 'foo.py' })).toBe('code')
      expect(classifyFile({ path: 'foo.rs' })).toBe('code')
      expect(classifyFile({ path: 'foo.sh' })).toBe('code')
    })
    it('classifies json', () => {
      expect(classifyFile({ path: 'foo.json' })).toBe('json')
    })
    it('classifies csv', () => {
      expect(classifyFile({ path: 'foo.csv' })).toBe('csv')
    })
    it('classifies images', () => {
      expect(classifyFile({ path: 'foo.png' })).toBe('image')
      expect(classifyFile({ path: 'foo.JPG' })).toBe('image')
      expect(classifyFile({ path: 'foo.svg' })).toBe('image')
    })
    it('classifies pdfs', () => {
      expect(classifyFile({ path: 'foo.pdf' })).toBe('pdf')
    })
    it('honors base64 encoding for binary content', () => {
      const content = {
        path: 'unknown.bin',
        encoding: 'base64' as const,
        content: 'AAAA',
        size: 3,
        modifiedAt: '',
        etag: '',
      } satisfies WorkspaceFileContent
      expect(classifyFile({ path: 'unknown.bin', content })).toBe('binary')
    })
    it('honors base64 + image MIME', () => {
      const content = {
        path: 'photo',
        encoding: 'base64' as const,
        content: 'AAAA',
        size: 3,
        modifiedAt: '',
        etag: '',
        mimeType: 'image/png',
      } satisfies WorkspaceFileContent
      expect(classifyFile({ path: 'photo', content })).toBe('image')
    })
    it('falls back to text for unknown extensions', () => {
      expect(classifyFile({ path: 'foo.unknownext' })).toBe('text')
    })
  })

  describe('isEditableFile', () => {
    it('marks the editable kinds', () => {
      expect(isEditableFile('markdown')).toBe(true)
      expect(isEditableFile('code')).toBe(true)
      expect(isEditableFile('text')).toBe(true)
      expect(isEditableFile('json')).toBe(true)
      expect(isEditableFile('csv')).toBe(true)
    })
    it('rejects the non-editable kinds', () => {
      expect(isEditableFile('image')).toBe(false)
      expect(isEditableFile('pdf')).toBe(false)
      expect(isEditableFile('binary')).toBe(false)
    })
  })

  describe('humanFileSize', () => {
    it('formats bytes, KB, MB, GB', () => {
      expect(humanFileSize(500)).toBe('500 B')
      expect(humanFileSize(2048)).toBe('2.0 KB')
      expect(humanFileSize(5_242_880)).toBe('5.0 MB')
      expect(humanFileSize(2_147_483_648)).toBe('2.0 GB')
    })
    it('returns empty string for undefined', () => {
      expect(humanFileSize(undefined)).toBe('')
    })
  })
})