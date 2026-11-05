/**
 * Workspace delivery for document tools.
 *
 * Document tools (pdf/word/workbook/csv/…) historically produced ONLY a
 * Canvas artifact — a DB row with the bytes inline. The chat then said "the
 * file is in your workspace", but nothing was ever written to disk: the user's
 * file tree stayed empty. This module copies the generated file into the
 * user's SELECTED workspace directory so it shows up in the Files panel, while
 * the Canvas artifact (inline preview + download) keeps working unchanged.
 *
 * Delivery is best-effort: a filesystem failure must never fail the document
 * tool itself — the artifact is still the source of truth. The result carries
 * the host path so the tool response can point the model (and the user) at a
 * real, visible file.
 */

import path from 'path'
import { promises as fs } from 'fs'
import { getWorkspaceToolWorkspaceContext } from './workspace-tool-project-workspaces'

export interface WorkspaceDeliveryTarget {
  ok: boolean
  /** Absolute host path of the delivered file (what the file tree shows), when ok. */
  hostPath?: string
  error?: string
}

function sanitizeWorkspaceFilename(name: string): string {
  const cleaned = name.trim().replace(/[/\\:*?"<>|\x00-\x1f]/g, '-').replace(/\s+/g, ' ')
  return cleaned.slice(0, 120) || 'generated-document'
}

/**
 * Write `bytes` (or utf8 `text`) into the selected workspace as `filename`.
 * Returns the delivery result; never throws.
 */
export async function deliverDocumentToWorkspace(options: {
  userId: string
  sessionId: string
  workspaceId?: string | null
  filename: string
  bytes?: Buffer
  text?: string
}): Promise<WorkspaceDeliveryTarget> {
  try {
    const context = await getWorkspaceToolWorkspaceContext(
      options.userId,
      options.workspaceId ?? undefined,
    ).catch(() => null)
    if (!context?.workspace) {
      return { ok: false, error: 'No workspace is available to deliver the file into.' }
    }
    const containerRoot = context.workspace.containerPath
    const hostRoot = context.workspace.hostPath
    const target = path.join(containerRoot, sanitizeWorkspaceFilename(options.filename))

    await fs.mkdir(path.dirname(target), { recursive: true })
    if (options.bytes !== undefined) {
      await fs.writeFile(target, options.bytes)
    } else if (options.text !== undefined) {
      await fs.writeFile(target, options.text, 'utf8')
    } else {
      return { ok: false, error: 'Nothing to deliver: no file bytes or text.' }
    }

    const relative = path.relative(containerRoot, target)
    return { ok: true, hostPath: path.join(hostRoot, relative) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
