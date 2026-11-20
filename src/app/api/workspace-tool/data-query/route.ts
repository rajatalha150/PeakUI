/**
 * POST /api/workspace-tool/data-query
 * Read a spreadsheet (.csv/.xlsx) or calendar (.ics) file from the workspace
 * and return a structured summary (headers + rows, or events). Backs the
 * `spreadsheet_query` and `calendar_query` tools (Phase 3).
 *
 * Body:
 *   { action: 'spreadsheet' | 'calendar', path: string, maxRows?: number }
 *
 * Reuses the filesystem read path (same access settings + path validation as
 * the filesystem tool), then parses the text with exceljs (xlsx) or a simple
 * CSV/ICS parser.
 */

import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { hasRagUpload, ragSpoolPath, stageRagUpload } from '@/lib/rag-spool'
import { getCurrentAuth } from '@/lib/request-auth'
import type { PermissionKey } from '@/lib/permissions'
import {
  runWorkspaceToolFilesystemRequest,
  type WorkspaceToolFilesystemAccessSettings,
} from '@/lib/workspace-tool-filesystem'
import {
  DEFAULT_SETTINGS,
  normalizeWorkspaceToolAllowedPaths,
  normalizeWorkspaceToolFileAccessMode,
  normalizeWorkspaceToolFileWriteMode,
  normalizeWorkspaceToolHostAccessMode,
} from '@/lib/settings'

export const runtime = 'nodejs'
export const maxDuration = 900
const execFileAsync = promisify(execFile)

const REQUIRED_PERMISSIONS: PermissionKey[] = ['workspace-tool.use', 'workspace-tool.filesystem']
const DEFAULT_MAX_ROWS = 50
const MAX_ROWS = 200

async function loadAccessSettings(userId: string): Promise<WorkspaceToolFilesystemAccessSettings> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: {
      workspaceToolFileAccessMode: true,
      workspaceToolAllowedPaths: true,
      workspaceToolFileWriteMode: true,
      workspaceToolWritablePaths: true,
      workspaceToolHostAccessMode: true,
    },
  })
  return {
    workspaceToolFileAccessMode: normalizeWorkspaceToolFileAccessMode(settings?.workspaceToolFileAccessMode ?? DEFAULT_SETTINGS.workspaceToolFileAccessMode),
    workspaceToolAllowedPaths: normalizeWorkspaceToolAllowedPaths(settings?.workspaceToolAllowedPaths ?? DEFAULT_SETTINGS.workspaceToolAllowedPaths),
    workspaceToolFileWriteMode: normalizeWorkspaceToolFileWriteMode(settings?.workspaceToolFileWriteMode ?? DEFAULT_SETTINGS.workspaceToolFileWriteMode),
    workspaceToolWritablePaths: normalizeWorkspaceToolAllowedPaths(settings?.workspaceToolWritablePaths ?? DEFAULT_SETTINGS.workspaceToolWritablePaths),
    workspaceToolHostAccessMode: normalizeWorkspaceToolHostAccessMode(settings?.workspaceToolHostAccessMode ?? DEFAULT_SETTINGS.workspaceToolHostAccessMode),
  }
}

function parseCsv(text: string, maxRows: number): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0)
  if (lines.length === 0) return { headers: [], rows: [] }
  const headers = lines[0].split(',').map(cell => cell.trim())
  const rows = lines.slice(1, maxRows + 1).map(line => line.split(',').map(cell => cell.trim()))
  return { headers, rows }
}

function parseIcs(text: string, maxRows: number): Array<Record<string, string>> {
  const events: Array<Record<string, string>> = []
  const blocks = text.split(/BEGIN:VEVENT/i).slice(1)
  for (const block of blocks.slice(0, maxRows)) {
    const end = block.indexOf('END:VEVENT')
    const body = end >= 0 ? block.slice(0, end) : block
    const event: Record<string, string> = {}
    for (const line of body.split(/\r?\n/)) {
      const idx = line.indexOf(':')
      if (idx < 0) continue
      const key = line.slice(0, idx).trim().toUpperCase()
      const value = line.slice(idx + 1).trim()
      if (key === 'SUMMARY' || key === 'DTSTART' || key === 'DTEND' || key === 'LOCATION' || key === 'DESCRIPTION' || key === 'UID') {
        event[key] = value
      }
    }
    if (Object.keys(event).length > 0) events.push(event)
  }
  return events
}

export async function POST(req: NextRequest) {
  const auth = await getCurrentAuth()
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({})) as {
    action?: string; path?: string; maxRows?: number; documentId?: string;
    operation?: string; groupBy?: string; dateBy?: string; distinctBy?: string;
    threshold?: number; offset?: number; limit?: number; startMonth?: string; endMonth?: string;
  }
  if (body.action === 'spreadsheet' && body.documentId) {
    if (!auth.permissions.includes('workspace-tool.use') || !auth.permissions.includes('knowledge.use')) {
      return NextResponse.json({ error: 'WorkSpaces and Knowledge Base access are required.' }, { status: 403 })
    }
    if (body.operation !== 'monthly_average' || !body.groupBy || !body.dateBy) {
      return NextResponse.json({ error: 'monthly_average requires groupBy and dateBy column names.' }, { status: 400 })
    }
    const document = await prisma.document.findFirst({
      where: { id: body.documentId, userId: auth.user.id, status: 'ready' },
      select: { id: true, filename: true, contentHash: true },
    })
    if (!document || !/\.(xlsx|xlsm)$/i.test(document.filename)) {
      return NextResponse.json({ error: 'Ready Knowledge Base workbook not found.' }, { status: 404 })
    }
    try {
      if (!await hasRagUpload(document.id)) {
        const stored = await prisma.document.findUnique({ where: { id: document.id }, select: { originalContent: true } })
        if (!stored?.originalContent) throw new Error('Original workbook is unavailable. Re-upload it to run full-data analysis.')
        await stageRagUpload(document.id, Buffer.from(stored.originalContent, 'base64'))
      }
      const cacheKey = createHash('sha256').update(JSON.stringify([document.id, document.contentHash,
        body.groupBy, body.dateBy, body.distinctBy, body.threshold, body.startMonth, body.endMonth])).digest('hex')
      const { stdout } = await execFileAsync('node', [
        '--max-old-space-size=6144', join(process.cwd(), 'scripts/knowledge-workbook-query.mjs'),
        ragSpoolPath(document.id), body.groupBy.slice(0, 100), body.dateBy.slice(0, 100),
        typeof body.distinctBy === 'string' ? body.distinctBy.slice(0, 100) : '',
        String(Math.max(0, Number(body.threshold) || 0)),
        String(Math.max(0, Number(body.offset) || 0)),
        String(Math.min(200, Math.max(1, Number(body.limit) || 100))),
        typeof body.startMonth === 'string' ? body.startMonth : '',
        typeof body.endMonth === 'string' ? body.endMonth : '',
        join(process.env.PEAKUI_DATA_DIR || '/var/lib/peakui', 'knowledge-analysis-cache', `${cacheKey}.json`),
      ], { timeout: 600_000, maxBuffer: 8 * 1024 * 1024 })
      return NextResponse.json({ action: 'spreadsheet', operation: body.operation, documentId: document.id, filename: document.filename, ...JSON.parse(stdout) })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Workbook analysis failed.' }, { status: 422 })
    }
  }
  const missing = REQUIRED_PERMISSIONS.filter(p => !auth.permissions.includes(p))
  if (missing.length > 0) {
    return NextResponse.json({ error: 'Filesystem access is not granted for this account.' }, { status: 403 })
  }

  try {
    const action = body.action
    const path = (body.path || '').trim()
    if ((action !== 'spreadsheet' && action !== 'calendar') || !path) {
      return NextResponse.json({ error: 'action ("spreadsheet"|"calendar") and path are required.' }, { status: 400 })
    }
    const maxRows = Math.min(MAX_ROWS, Math.max(1, typeof body.maxRows === 'number' ? body.maxRows : DEFAULT_MAX_ROWS))

    const accessSettings = await loadAccessSettings(auth.user.id)
    const readResult = await runWorkspaceToolFilesystemRequest({ action: 'read', path }, accessSettings)

    if (!readResult.content) {
      return NextResponse.json({ error: 'File is empty or unreadable.' }, { status: 400 })
    }

    const lower = path.toLowerCase()
    if (action === 'spreadsheet') {
      if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        // exceljs is heavy; for xlsx we return a clear message directing to
        // CSV export, since the filesystem read returns binary (rejected).
        return NextResponse.json({
          error: 'XLSX files are binary and cannot be read as text. Export to CSV and query that instead.',
        }, { status: 400 })
      }
      const { headers, rows } = parseCsv(readResult.content, maxRows)
      return NextResponse.json({
        action: 'spreadsheet',
        path: readResult.path,
        headers,
        rows,
        rowCount: rows.length,
        truncated: readResult.truncated,
      })
    }

    // calendar
    const events = parseIcs(readResult.content, maxRows)
    return NextResponse.json({
      action: 'calendar',
      path: readResult.path,
      events,
      eventCount: events.length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Data query failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
