/**
 * POST /api/workspace-tool/notes
 * Per-user note search/save backing the `notes_search` and `notes_save`
 * workspace tools. Pull-based memory: the model searches notes when it needs
 * prior context instead of the runtime injecting every past-session summary.
 *
 * Body:
 *   { action: 'search', query: string }
 *   { action: 'save', title: string, content: string }
 *
 * Notes are stored in the user's memory dir (memory/users/<userId>/notes.md)
 * via the same scoping as daily memory.
 */

import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import { join } from 'path'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { ensureUserMemoryDir, getUserMemoryDir } from '@/lib/memory'

const NOTES_FILE = 'notes.md'
const MAX_NOTES_BYTES = 512 * 1024
const MAX_SEARCH_RESULTS = 8

type NoteEntry = { id: string; title: string; content: string; createdAt: string }

function parseNotes(raw: string): NoteEntry[] {
  const entries: NoteEntry[] = []
  const blocks = raw.split(/^## /gm).slice(1)
  for (const block of blocks) {
    const idMatch = block.match(/<!-- note:([A-Za-z0-9_-]+) -->/)
    const createdMatch = block.match(/<!-- created:(\d{4}-\d{2}-\d{2}T[^>]+) -->/)
    const titleMatch = block.match(/^(.+)$/m)
    entries.push({
      id: idMatch?.[1] || `note-${entries.length}`,
      title: (titleMatch?.[1] || 'Untitled').replace(/<!--[\s\S]*?-->/g, '').trim(),
      content: block.split('\n').slice(1).join('\n').replace(/<!--[\s\S]*?-->/g, '').trim(),
      createdAt: createdMatch?.[1] || '',
    })
  }
  return entries
}

function serializeNotes(entries: NoteEntry[]): string {
  return [
    '# User Notes',
    '',
    ...entries.map(e => [
      `## ${e.title} <!-- note:${e.id} created:${e.createdAt} -->`,
      e.content,
      '',
    ].join('\n')),
  ].join('\n')
}

export async function POST(req: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use'], {
    forbiddenMessage: 'WorkSpaces access is not granted for this account.',
    actionRequired: 'Grant the WorkSpaces permission in Settings -> User Management before using WorkSpaces notes.',
  })
  if ('response' in access) return access.response
  const userId = access.userId

  try {
    const body = await req.json() as { action?: string; query?: string; title?: string; content?: string }

    await ensureUserMemoryDir(userId)
    const filePath = join(getUserMemoryDir(userId), NOTES_FILE)

    if (body.action === 'save') {
      const title = (body.title || '').trim().slice(0, 180)
      const content = (body.content || '').trim().slice(0, 4000)
      if (!title || !content) {
        return NextResponse.json({ error: 'Both title and content are required.' }, { status: 400 })
      }

      let raw = ''
      try {
        raw = await fs.readFile(filePath, 'utf-8')
      } catch {
        raw = ''
      }
      const entries = parseNotes(raw)
      entries.unshift({
        id: `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        title,
        content,
        createdAt: new Date().toISOString(),
      })
      // Cap stored notes so the file cannot grow unbounded.
      const serialized = serializeNotes(entries.slice(0, 200))
      if (Buffer.byteLength(serialized, 'utf-8') > MAX_NOTES_BYTES) {
        return NextResponse.json({ error: 'Notes storage is full. Delete old notes first.' }, { status: 507 })
      }
      await fs.writeFile(filePath, serialized, 'utf-8')
      return NextResponse.json({ success: true, saved: title })
    }

    if (body.action === 'search') {
      const query = (body.query || '').trim().toLowerCase().slice(0, 300)
      if (!query) {
        return NextResponse.json({ error: 'A search query is required.' }, { status: 400 })
      }
      let raw = ''
      try {
        raw = await fs.readFile(filePath, 'utf-8')
      } catch {
        return NextResponse.json({ results: [], query })
      }
      const terms = query.split(/\s+/).filter(t => t.length >= 3)
      const entries = parseNotes(raw)
      const scored = entries
        .map(entry => {
          const haystack = `${entry.title}\n${entry.content}`.toLowerCase()
          const hits = terms.filter(term => haystack.includes(term)).length
          return { entry, hits }
        })
        .filter(item => item.hits > 0)
        .sort((a, b) => b.hits - a.hits)
        .slice(0, MAX_SEARCH_RESULTS)

      return NextResponse.json({
        query,
        results: scored.map(item => ({
          id: item.entry.id,
          title: item.entry.title,
          excerpt: item.entry.content.slice(0, 600),
          createdAt: item.entry.createdAt,
          matchedTerms: item.hits,
        })),
      })
    }

    return NextResponse.json({ error: 'Unknown action. Use "search" or "save".' }, { status: 400 })
  } catch (error) {
    console.error('[notes] Error:', error)
    return NextResponse.json({ error: 'Failed to access notes' }, { status: 500 })
  }
}