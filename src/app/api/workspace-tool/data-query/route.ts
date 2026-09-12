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
import { prisma } from '@/lib/prisma'
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
  const missing = REQUIRED_PERMISSIONS.filter(p => !auth.permissions.includes(p))
  if (missing.length > 0) {
    return NextResponse.json({ error: 'Filesystem access is not granted for this account.' }, { status: 403 })
  }

  try {
    const body = await req.json() as { action?: string; path?: string; maxRows?: number }
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