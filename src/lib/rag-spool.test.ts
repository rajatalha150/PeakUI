import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hasRagUpload, ragSpoolPath, readRagUpload, removeRagUpload, stageRagUpload } from './rag-spool'

let root: string
let previous: string | undefined
beforeEach(async () => {
  previous = process.env.PEAKUI_DATA_DIR
  root = await mkdtemp(join(tmpdir(), 'peakui-rag-spool-test-'))
  process.env.PEAKUI_DATA_DIR = root
})
afterEach(async () => {
  if (previous === undefined) delete process.env.PEAKUI_DATA_DIR
  else process.env.PEAKUI_DATA_DIR = previous
  await rm(root, { recursive: true, force: true })
})

describe('durable RAG upload spool', () => {
  const id = '12345678-1234-1234-1234-123456789abc'
  it('stores and reads bytes without base64 or a process-local queue', async () => {
    const data = Buffer.from([0, 1, 2, 255])
    await stageRagUpload(id, data)
    expect(await hasRagUpload(id)).toBe(true)
    expect(await readRagUpload(id)).toEqual(data)
    await removeRagUpload(id)
    expect(await readRagUpload(id)).toBeNull()
    expect(await hasRagUpload(id)).toBe(false)
  })
  it('rejects traversal in document ids', () => {
    expect(() => ragSpoolPath('../other')).toThrow('Invalid Knowledge Base document ID')
  })
})
