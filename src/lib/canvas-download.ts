/**
 * Helpers for the canvas artifact download route. Kept in their own module so
 * they can be unit-tested without spinning up Next.js route handlers.
 */

/**
 * Decide whether an artifact with the given mime type should be served as
 * raw base64-decoded bytes (binary) or as the content string verbatim (text).
 *
 * Historically this used a whitelist of binary mime types, which silently
 * produced corrupt downloads for any new binary format that was added without
 * updating the whitelist (e.g. PPTX, ZIP). The classifier now inverts that:
 * it only treats content as text when the mime type is unambiguously textual.
 * Anything else — including unknown binary types — is base64-decoded, which is
 * safe because base64 of valid base64-encoded bytes round-trips.
 */
export function isTextArtifactMimeType(mimeType: string | undefined | null): boolean {
  if (!mimeType) return false
  const normalized = mimeType.toLowerCase()
  if (normalized.startsWith('text/')) return true
  switch (normalized) {
    case 'application/json':
    case 'application/xml':
    case 'application/javascript':
    case 'application/x-javascript':
    case 'application/ld+json':
    case 'application/markdown':
    case 'image/svg+xml':
      return true
    default:
      return false
  }
}

/**
 * Decode stored artifact content into the bytes that should be sent over the
 * wire. Text mime types are passed through as UTF-8; everything else is
 * assumed to be base64.
 *
 * Backward compatibility: before this helper existed, several text-mime
 * artifacts (CSV, ICS) were stored as base64 in the DB. If we detect that the
 * stored string is valid base64 whose decoded bytes contain a printable
 * beginning — and the raw stored string does *not* — we treat it as legacy
 * base64. This lets old rows keep working while new rows are stored as UTF-8.
 */
export function decodeArtifactContent(content: string, mimeType: string): Buffer {
  if (!isTextArtifactMimeType(mimeType)) {
    return Buffer.from(content.replace(/\s+/g, ''), 'base64')
  }

  // Text mime type: prefer UTF-8 pass-through.
  const utf8 = Buffer.from(content, 'utf8')

  // Legacy detection: if the raw string looks like base64 (length multiple of
  // 4 after stripping whitespace, only base64 alphabet chars) AND its decoded
  // bytes start with printable ASCII (or look more like the file format than
  // the raw string does), return the base64-decoded bytes instead.
  const stripped = content.replace(/\s+/g, '')
  const looksLikeBase64 = stripped.length > 0
    && stripped.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(stripped)
  if (looksLikeBase64) {
    const decoded = Buffer.from(stripped, 'base64')
    if (isLikelyLegacyBase64(content, decoded)) {
      return decoded
    }
  }

  return utf8
}

/**
 * Heuristic: the stored string is legacy base64 if the raw string starts with
 * something that looks like a base64 token (e.g. "UEsDB..." for a ZIP, "JVBE"
 * for a PDF) rather than the file's expected text signature (e.g. "BEGIN:VCALENDAR",
 * a CSV header row).
 */
function isLikelyLegacyBase64(rawContent: string, decoded: Buffer): boolean {
  // Raw string starts with a non-printable byte or with a base64-character
  // burst — i.e. it's not the natural text the file would start with.
  const rawHead = rawContent.slice(0, 32)
  const decodedHead = decoded.subarray(0, Math.min(32, decoded.length)).toString('binary')

  // Heuristic 1: raw has lots of uppercase A-Z runs at the start (base64 tokens
  // like "UEsDB" or "JVBERi") while decoded looks like text.
  const rawHasBase64Run = /^[A-Za-z0-9+/]{12,}/.test(rawHead.trim())
  if (rawHasBase64Run) {
    // And the decoded bytes contain at least one printable printable char
    // beyond the first few (i.e. it's not pure binary garbage).
    let printable = 0
    for (let i = 0; i < decoded.length && i < 64; i++) {
      const b = decoded[i]
      if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e)) {
        printable++
      }
    }
    if (printable >= Math.min(16, decoded.length)) {
      return true
    }
  }

  // Heuristic 2: if the decoded bytes start with a known text-format signature
  // (CSV/ICS/JSON/XML header) and the raw string doesn't, it's legacy base64.
  const decodedStartsWith = decodedHead.replace(/^﻿/, '')
  const textSignatures = [
    'BEGIN:VCALENDAR',
    'VERSION:',
    '{',           // JSON
    '[',           // JSON array
    '<?xml',
    '<!DOCTYPE',
    '<html',
    'BEGIN:VEVENT',
    'BEGIN:VTODO',
    'BEGIN:VJOURNAL',
  ]
  for (const sig of textSignatures) {
    if (decodedStartsWith.startsWith(sig) && !rawContent.startsWith(sig)) {
      return true
    }
  }

  return false
}

/**
 * Sanitize an artifact name for use in a `Content-Disposition` filename.
 * Strips path separators and any characters that would break the header.
 */
export function sanitizeDownloadName(name: string): string {
  return (name.trim().split(/[\\/]/).pop() || 'artifact')
    .replace(/[^\w.\- ()[\]]+/g, '_')
    .slice(0, 180)
}
