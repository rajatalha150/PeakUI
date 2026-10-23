/**
 * Server-side sync that folds the uncensored directive into the daemon's
 * always-loaded workspace context (`QWEN.md`), so it reaches the model as
 * system context — never as a visible chat message.
 *
 * The daemon's file routes are workspace-scoped, so this targets the primary
 * workspace context `/workspace/QWEN.md` (where PeakUI seeds the brain). It is
 * idempotent and self-healing: it reads the file, and only writes when the
 * delimited section does not already match the desired toggle state.
 */

import { proxyToCoderDaemon } from '@/lib/coder-gateway'
import { applyUncensoredContext, hasUncensoredSection } from './coder-uncensored'

/** The primary workspace where PeakUI seeds the Coder brain context. */
const CODER_CONTEXT_WORKSPACE = '/workspace'

export interface UncensoredSyncResult {
  ok: boolean
  /** True when the context file was actually rewritten (state changed). */
  changed: boolean
  error?: string
}

/**
 * Ensure the daemon's QWEN.md carries (or omits) the uncensored section to match
 * `enabled`. Never throws — returns a typed result the caller can surface.
 */
export async function syncCoderUncensoredContext(enabled: boolean): Promise<UncensoredSyncResult> {
  const path = `${CODER_CONTEXT_WORKSPACE}/QWEN.md`

  const read = await proxyToCoderDaemon(`/file?path=${encodeURIComponent(path)}`)
  if (read.status < 200 || read.status >= 300) {
    return { ok: false, changed: false, error: `Could not read the Coder workspace context (${path}) to apply uncensored mode.` }
  }

  let parsed: { content?: unknown; hash?: unknown }
  try {
    parsed = JSON.parse(read.body)
  } catch {
    return { ok: false, changed: false, error: 'The Coder workspace context response was malformed.' }
  }

  const content = parsed.content
  if (typeof content !== 'string') {
    return { ok: false, changed: false, error: 'The Coder workspace context did not include its content.' }
  }

  // Already in the desired state — nothing to do (avoids a needless rewrite).
  if (hasUncensoredSection(content) === enabled) {
    return { ok: true, changed: false }
  }

  const next = applyUncensoredContext(content, enabled)
  const write = await proxyToCoderDaemon('/file/write', {
    method: 'POST',
    body: {
      path,
      content: next,
      mode: 'replace',
      ...(typeof parsed.hash === 'string' && parsed.hash.length > 0 ? { expectedHash: parsed.hash } : {}),
    },
  })

  if (write.status < 200 || write.status >= 300) {
    return { ok: false, changed: false, error: 'Could not write the Coder workspace context to apply uncensored mode.' }
  }
  return { ok: true, changed: true }
}
