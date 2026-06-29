import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  deleteWorkspacePath,
  downloadWorkspaceZip,
  listWorkspaceTree,
  readWorkspaceFile,
  renameWorkspacePath,
  subscribeWorkspaceEvents,
  uploadWorkspaceFiles,
  writeWorkspaceFile,
  type WorkspaceFilesError,
} from './workspace-files-client'

type FetchCall = { url: string; init?: RequestInit }

let calls: FetchCall[] = []
let mockResponseFactory: (url: string, init?: RequestInit) => Response = () => new Response('{}', { status: 200 })

const originalFetch = globalThis.fetch

beforeEach(() => {
  calls = []
  mockResponseFactory = () => new Response('{}', { status: 200 })
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({ url, init })
    return mockResponseFactory(url, init)
  }) as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('workspace-files-client', () => {
  it('listWorkspaceTree builds the correct URL with path + depth', async () => {
    mockResponseFactory = () =>
      new Response(
        JSON.stringify({
          workspace: { id: 'w', slug: 'default', name: 'Default', containerPath: '/p', hostPath: '/h' },
          path: 'skills',
          entries: [],
          truncated: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )

    await listWorkspaceTree('w-1', { path: 'skills', depth: 3 })

    expect(calls).toHaveLength(1)
    const url = calls[0].url
    expect(url).toContain('/api/openclaw/workspaces/w-1/files')
    expect(url).toContain('path=skills')
    expect(url).toContain('depth=3')
    expect(calls[0].init?.credentials).toBe('same-origin')
  })

  it('listWorkspaceTree omits query string for default args', async () => {
    mockResponseFactory = () => new Response('{"workspace":{"id":"w","slug":"s","name":"n","containerPath":"","hostPath":""},"path":"","entries":[],"truncated":false}', { status: 200 })
    await listWorkspaceTree('w-1')
    expect(calls[0].url).toMatch(/\/files$/)
  })

  it('listWorkspaceError surfaces the server message', async () => {
    mockResponseFactory = () =>
      new Response(JSON.stringify({ error: 'Workspace not found', code: 'not_found' }), { status: 404 })
    await expect(listWorkspaceTree('w-missing')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
      message: 'Workspace not found',
    } satisfies Partial<WorkspaceFilesError>)
  })

  it('readWorkspaceFile passes If-Match header', async () => {
    mockResponseFactory = () =>
      new Response(
        JSON.stringify({ path: 'a.txt', encoding: 'utf-8', content: 'hi', size: 2, modifiedAt: '', etag: '"2-0"' }),
        { status: 200 }
      )
    await readWorkspaceFile('w-1', 'a.txt', '"2-0"')
    const init = calls[0].init
    expect(init?.headers).toMatchObject({ 'If-Match': '"2-0"' })
  })

  it('readWorkspaceFile surfaces 412 as a conflict error', async () => {
    mockResponseFactory = () =>
      new Response(JSON.stringify({ error: 'conflict', code: 'conflict' }), { status: 412 })
    await expect(readWorkspaceFile('w-1', 'a.txt')).rejects.toMatchObject({ status: 412, code: 'conflict' })
  })

  it('readWorkspaceFile surfaces currentEtag from a 412 response', async () => {
    mockResponseFactory = () =>
      new Response(JSON.stringify({ error: 'conflict', code: 'conflict', currentEtag: '"99-1234"' }), { status: 412 })
    await expect(readWorkspaceFile('w-1', 'a.txt')).rejects.toMatchObject({
      status: 412,
      code: 'conflict',
      currentEtag: '"99-1234"',
    })
  })

  it('writeWorkspaceFile POSTs JSON body', async () => {
    mockResponseFactory = () =>
      new Response(JSON.stringify({ entry: { path: 'a.txt', kind: 'file' } }), { status: 201 })
    await writeWorkspaceFile('w-1', { action: 'write', path: 'a.txt', content: 'hi', createDirectories: true })
    expect(calls[0].init?.method).toBe('POST')
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      action: 'write',
      path: 'a.txt',
      content: 'hi',
      createDirectories: true,
    })
  })

  it('writeWorkspaceFile passes If-Match header when provided', async () => {
    mockResponseFactory = () =>
      new Response(JSON.stringify({ entry: { path: 'a.txt', kind: 'file' }, etag: '"10-1234"' }), { status: 201 })
    await writeWorkspaceFile('w-1', { action: 'write', path: 'a.txt', content: 'hi' }, '"10-1234"')
    const init = calls[0].init
    expect(init?.headers).toMatchObject({ 'If-Match': '"10-1234"' })
  })

  it('writeWorkspaceFile surfaces 412 conflicts with currentEtag', async () => {
    mockResponseFactory = () =>
      new Response(JSON.stringify({ error: 'File changed on server', code: 'conflict', currentEtag: '"99-5678"' }), { status: 412 })
    await expect(writeWorkspaceFile('w-1', { action: 'write', path: 'a.txt', content: 'hi' }, '"10-1234"'))
      .rejects.toMatchObject({
        status: 412,
        code: 'conflict',
        currentEtag: '"99-5678"',
      })
  })

  it('renameWorkspacePath PATCHes the rename payload', async () => {
    mockResponseFactory = () => new Response(JSON.stringify({ from: 'a', to: 'b' }), { status: 200 })
    await renameWorkspacePath('w-1', { action: 'rename', from: 'a', to: 'b' })
    expect(calls[0].init?.method).toBe('PATCH')
  })

  it('deleteWorkspacePath includes recursive flag when true', async () => {
    mockResponseFactory = () => new Response(JSON.stringify({ deleted: true, path: 'a' }), { status: 200 })
    await deleteWorkspacePath('w-1', 'a', true)
    expect(calls[0].url).toContain('recursive=true')
    expect(calls[0].init?.method).toBe('DELETE')
  })

  it('uploadWorkspaceFiles sends multipart with paths JSON', async () => {
    mockResponseFactory = () =>
      new Response(JSON.stringify({ uploaded: [] }), { status: 200 })
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    await uploadWorkspaceFiles('w-1', [{ path: 'hello.txt', file }])
    const init = calls[0].init
    expect(init?.method).toBe('POST')
    const form = init?.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('paths')).toBe(JSON.stringify(['hello.txt']))
    expect(form.get('files')).toBeInstanceOf(File)
  })

  it('downloadWorkspaceZip returns the response on success and throws on failure', async () => {
    mockResponseFactory = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    const ok = await downloadWorkspaceZip('w-1', ['a.txt'])
    expect(ok.status).toBe(200)
    await ok.arrayBuffer()

    mockResponseFactory = () =>
      new Response(JSON.stringify({ error: 'fail', code: 'internal' }), { status: 500 })
    await expect(downloadWorkspaceZip('w-1', ['a.txt'])).rejects.toMatchObject({ status: 500 })
  })

  it('subscribeWorkspaceEvents opens a streaming GET and is abortable', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"kind":"tree.invalidated","at":1}\n\n'))
        controller.close()
      },
    })
    mockResponseFactory = () =>
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })

    const events: string[] = []
    const controller = subscribeWorkspaceEvents('w-1', e => events.push(e.kind))
    // Allow the async reader loop to run.
    await new Promise(r => setTimeout(r, 20))
    controller.abort()
    await new Promise(r => setTimeout(r, 20))

    expect(calls[0].url).toContain('/api/openclaw/workspaces/w-1/events')
    expect(events).toContain('tree.invalidated')
  })
})