import type { NormalizedEmailDocument } from './email-schema'

function rfc5322Date(date = new Date()): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const pad = (n: number) => String(n).padStart(2, '0')
  const tz = -date.getTimezoneOffset()
  const tzSign = tz >= 0 ? '+' : '-'
  const tzHours = pad(Math.floor(Math.abs(tz) / 60))
  const tzMinutes = pad(Math.abs(tz) % 60)

  return `${days[date.getDay()]}, ${pad(date.getDate())} ${months[date.getMonth()]} ${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${tzSign}${tzHours}${tzMinutes}`
}

function encodeHeader(name: string, value: string): string {
  // Simple ASCII-safe encoding; fold long lines with encoded-word would be better but overkill here.
  const ascii = value.replace(/[^\x00-\x7F]/g, '?')
  return `${name}: ${ascii}`
}

function generateBoundary(): string {
  return `----=_PeakUI_${Math.random().toString(36).slice(2)}_${Date.now()}`
}

export function renderEmailDocument(input: NormalizedEmailDocument): Buffer {
  const hasHtml = Boolean(input.htmlBody?.trim())
  const hasAttachments = input.attachments.length > 0
  const needsMultipart = hasHtml || hasAttachments
  const boundary = needsMultipart ? generateBoundary() : undefined
  const mixedBoundary = hasAttachments ? generateBoundary() : boundary

  const lines: string[] = []
  lines.push('MIME-Version: 1.0')
  if (input.from) lines.push(encodeHeader('From', input.from))
  if (input.to) lines.push(encodeHeader('To', input.to))
  if (input.cc.length > 0) lines.push(encodeHeader('Cc', input.cc.join(', ')))
  lines.push(encodeHeader('Subject', input.subject))
  lines.push(encodeHeader('Date', rfc5322Date()))
  lines.push('X-Mailer: PeakUI Email Writer')

  if (mixedBoundary) {
    lines.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`)
  } else if (hasHtml) {
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)
  } else {
    lines.push('Content-Type: text/plain; charset="UTF-8"')
    lines.push('Content-Transfer-Encoding: 7bit')
  }

  lines.push('')

  if (mixedBoundary) {
    lines.push(`--${mixedBoundary}`)

    if (hasHtml && !hasAttachments) {
      lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)
      lines.push('')
    } else {
      lines.push('Content-Type: text/plain; charset="UTF-8"')
      lines.push('Content-Transfer-Encoding: base64')
      lines.push('')
      lines.push(Buffer.from(input.body, 'utf8').toString('base64'))
    }

    if (hasHtml && boundary) {
      lines.push('')
      lines.push(`--${boundary}`)
      lines.push('Content-Type: text/plain; charset="UTF-8"')
      lines.push('Content-Transfer-Encoding: base64')
      lines.push('')
      lines.push(Buffer.from(input.body, 'utf8').toString('base64'))

      lines.push('')
      lines.push(`--${boundary}`)
      lines.push('Content-Type: text/html; charset="UTF-8"')
      lines.push('Content-Transfer-Encoding: base64')
      lines.push('')
      lines.push(Buffer.from(input.htmlBody || '', 'utf8').toString('base64'))
      lines.push(`--${boundary}--`)
    }

    for (const attachment of input.attachments) {
      lines.push('')
      lines.push(`--${mixedBoundary}`)
      lines.push(`Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`)
      lines.push('Content-Transfer-Encoding: base64')
      lines.push(`Content-Disposition: attachment; filename="${attachment.filename}"`)
      lines.push('')
      lines.push(Buffer.from(attachment.content, 'utf8').toString('base64'))
    }

    lines.push('')
    lines.push(`--${mixedBoundary}--`)
  } else {
    lines.push(input.body)
  }

  lines.push('')
  return Buffer.from(lines.join('\r\n'), 'utf8')
}
