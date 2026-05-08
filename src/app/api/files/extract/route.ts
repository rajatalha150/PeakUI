import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/request-auth'
import { extractFilePayload } from '@/lib/file-extraction'
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from '@/lib/file-shared'

function getRequestContentLength(req: Request): number | null {
  const header = req.headers.get('content-length')
  if (!header) return null

  const value = Number(header)
  return Number.isFinite(value) ? value : null
}

export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const contentLength = getRequestContentLength(req)
    if (contentLength !== null && contentLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json({
        error: `Attachment is too large. Files are limited to ${MAX_UPLOAD_LABEL}.`
      }, { status: 413 })
    }

    let formData: FormData
    try {
      formData = await req.formData()
    } catch (error) {
      console.error('File extraction form parse error:', error)
      return NextResponse.json({
        error: `Could not read the uploaded file. If it is larger than ${MAX_UPLOAD_LABEL}, split it into smaller files and try again.`
      }, { status: 400 })
    }

    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({
        error: `Attachment is too large. Files are limited to ${MAX_UPLOAD_LABEL}.`
      }, { status: 413 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const extracted = await extractFilePayload({
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      buffer,
    })

    return NextResponse.json(extracted)
  } catch (error) {
    console.error('File extraction error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
