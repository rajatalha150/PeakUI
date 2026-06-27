import { describe, expect, it } from 'vitest'
import { isBinaryArtifact } from '@/lib/canvas-rendering'

describe('isBinaryArtifact', () => {
  it.each([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/zip',
    'application/x-tar',
    'application/gzip',
    'image/png',
    'image/jpeg',
    'audio/mpeg',
    'video/mp4',
    'message/rfc822',
    'text/calendar',
  ])('treats %s as binary', (mimeType) => {
    expect(isBinaryArtifact({ mimeType })).toBe(true)
  })

  it.each([
    'text/plain',
    'text/markdown',
    'application/json',
    'text/csv',
  ])('treats %s as text', (mimeType) => {
    expect(isBinaryArtifact({ mimeType })).toBe(false)
  })
})