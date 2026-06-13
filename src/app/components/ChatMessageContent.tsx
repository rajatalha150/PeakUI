"use client"

import React from 'react'
import { Check, ChevronDown, Download, FileText, Globe, Loader2 } from 'lucide-react'
import {
  getResponseDownloadExtension,
  getResponseDownloadMimeType,
  type ResponsePresentation,
} from '@/lib/response-format'
import type { MessageSource } from '@/lib/message-sources'
import { base64ToBlob } from '@/lib/browser-file-utils'
import {
  getParsedAssistantArtifacts,
  type GeneratedFile,
  type ImageDisplayFile,
} from '@/lib/assistant-content-cache'
import { inferArtifactKind } from '@/lib/canvas-artifacts'
import { recordRenderMetric } from '@/lib/render-metrics'
import AssistantContent from './AssistantContent'
import ObjectUrlImage from './ObjectUrlImage'

interface ServerArtifactDownload {
  name: string
  url: string
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function downloadGeneratedFile(file: GeneratedFile) {
  if (!file.binary) {
    downloadBlob(file.name, new Blob([file.content], { type: file.mimeType }))
    return
  }

  try {
    const cleanBase64 = file.content.replace(/\s+/g, '')
    const raw = atob(cleanBase64)
    const bytes = new Uint8Array(raw.length)
    for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
    downloadBlob(file.name, new Blob([bytes], { type: file.mimeType }))
  } catch {
    downloadBlob(`${file.name}.txt`, new Blob([file.content], { type: 'text/plain' }))
  }
}

export function extractServerArtifactDownloads(content: string): ServerArtifactDownload[] {
  const downloads: ServerArtifactDownload[] = []
  const seen = new Set<string>()
  const pushDownload = (name: string, url: string) => {
    const cleanUrl = url.trim()
    if (!cleanUrl || seen.has(cleanUrl)) return
    seen.add(cleanUrl)
    const cleanName = (name.trim() || 'download.pdf').replace(/[^\w.\- ()[\]]+/g, '_')
    downloads.push({
      name: cleanName.toLowerCase().endsWith('.pdf') ? cleanName : `${cleanName}.pdf`,
      url: cleanUrl,
    })
  }

  const markdownLinkRegex = /\[([^\]]{1,180})\]\((\/api\/canvas\/artifacts\/[^)\s]+\/download)\)/g
  let match: RegExpExecArray | null
  while ((match = markdownLinkRegex.exec(content)) !== null && downloads.length < 8) {
    pushDownload(match[1], match[2])
  }

  const bareUrlRegex = /(?:^|\s)(\/api\/canvas\/artifacts\/[A-Za-z0-9_-]+\/download)(?=$|\s|[),.])/g
  while ((match = bareUrlRegex.exec(content)) !== null && downloads.length < 8) {
    pushDownload(`server-artifact-${downloads.length + 1}.pdf`, match[1])
  }

  return downloads
}

export function ThinkingBlock({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const [open, setOpen] = React.useState(true)
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length

  React.useEffect(() => {
    const timer = setTimeout(() => setOpen(isStreaming), isStreaming ? 0 : 800)
    return () => clearTimeout(timer)
  }, [isStreaming])

  return (
    <div style={{ marginBottom: '12px', borderRadius: '10px', border: '1px solid var(--accent-border)', overflow: 'hidden', background: 'var(--accent-faint)' }}>
      <div
        onClick={() => setOpen(current => !current)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          cursor: 'pointer',
          userSelect: 'none',
          borderBottom: open ? '1px solid var(--accent-soft)' : 'none',
        }}
      >
        {isStreaming
          ? <Loader2 size={13} color="var(--accent-primary)" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
          : <ChevronDown size={13} color="var(--accent-primary)" style={{ flexShrink: 0, transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s' }} />}
        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent-primary)', letterSpacing: '0.5px' }}>
          {isStreaming ? 'Thinking…' : 'Thought process'}
        </span>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {wordCount} words {!open && !isStreaming ? '· click to expand' : ''}
        </span>
      </div>

      {open && (
        <div style={{ padding: '10px 14px', fontSize: '0.82rem', color: 'var(--text-secondary)', fontStyle: 'italic', lineHeight: 1.65, whiteSpace: 'pre-wrap', maxHeight: '260px', overflowY: 'auto' }}>
          {content}
          {isStreaming && <span style={{ opacity: 0.5 }}> ▍</span>}
        </div>
      )}
    </div>
  )
}

const MemoAssistantContent = React.memo(AssistantContent)

function parseThinkSegments(content: string, presentation?: ResponsePresentation, sources?: MessageSource[]): React.ReactNode[] {
  const elements: React.ReactNode[] = []

  if (!content.includes('<think>')) {
    elements.push(<MemoAssistantContent key="content" content={content} presentation={presentation} sources={sources} />)
    return elements
  }

  const openIdx = content.indexOf('<think>')
  const closeIdx = content.indexOf('</think>')
  if (openIdx !== -1 && closeIdx === -1) {
    const before = content.slice(0, openIdx)
    const thinkContent = content.slice(openIdx + 7)
    if (before) elements.push(<MemoAssistantContent key="before" content={before} presentation={presentation} sources={sources} />)
    if (thinkContent) elements.push(<ThinkingBlock key="thinking" content={thinkContent} isStreaming />)
    return elements
  }

  const parts = content.split(/(<think>|<\/think>)/)
  let insideThink = false
  let thinkBuffer = ''
  let partIndex = 0

  for (const part of parts) {
    if (part === '<think>') {
      insideThink = true
      thinkBuffer = ''
      continue
    }
    if (part === '</think>') {
      insideThink = false
      if (thinkBuffer.trim()) {
        elements.push(<ThinkingBlock key={`think-${partIndex++}`} content={thinkBuffer} isStreaming={false} />)
      }
      thinkBuffer = ''
      continue
    }
    if (!part) continue
    if (insideThink) {
      thinkBuffer += part
    } else {
      elements.push(<MemoAssistantContent key={`text-${partIndex++}`} content={part} presentation={presentation} sources={sources} />)
    }
  }

  return elements
}

function ImageGallery({
  images,
  sessionId,
  messageId,
  persistedImageIds,
  saveImageToCanvas,
  savingIds,
}: {
  images: ImageDisplayFile[]
  sessionId?: string | null
  messageId?: string | null
  persistedImageIds: Record<number, string>
  saveImageToCanvas: (image: ImageDisplayFile, index: number) => void
  savingIds: Record<string, boolean>
}) {
  if (images.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '8px 0' }}>
      {images.map((image, index) => (
        <div key={`${image.name}-${index}`} style={{ position: 'relative' }}>
          <ObjectUrlImage
            src={image.url}
            base64Data={image.base64Data}
            mimeType={image.mimeType}
            alt={image.name}
            maxPreviewWidth={200}
            maxPreviewHeight={200}
            style={{
              maxWidth: '200px',
              maxHeight: '200px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              objectFit: 'cover',
            }}
            onClick={() => {
              if (image.url) {
                window.open(image.url, '_blank', 'noopener,noreferrer')
                return
              }
              if (!image.base64Data) return
              const objectUrl = URL.createObjectURL(base64ToBlob(image.base64Data, image.mimeType))
              window.open(objectUrl, '_blank', 'noopener,noreferrer')
              window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
            }}
            title="Click to view full size"
          />
          <div style={{ position: 'absolute', top: '4px', right: '4px', display: 'flex', gap: '2px' }}>
            {image.url && (
              <button
                type="button"
                onClick={() => window.open(image.url, '_blank', 'noopener,noreferrer')}
                style={{ background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: '4px', padding: '4px', cursor: 'pointer', color: 'white', display: 'flex', alignItems: 'center' }}
                title="Open in new tab"
              >
                <Globe size={12} />
              </button>
            )}
            {!image.url && (
              <button
                type="button"
                onClick={() => saveImageToCanvas(image, index)}
                disabled={!sessionId || !!persistedImageIds[index] || !!savingIds[`img-${index}`]}
                style={{
                  background: persistedImageIds[index] ? 'rgba(16,185,129,0.8)' : 'rgba(0,0,0,0.7)',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px',
                  cursor: (!sessionId || persistedImageIds[index] || savingIds[`img-${index}`]) ? 'not-allowed' : 'pointer',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  opacity: (!sessionId || persistedImageIds[index] || savingIds[`img-${index}`]) ? 0.6 : 1,
                }}
                title={persistedImageIds[index] ? 'Saved to Canvas' : 'Save to Canvas'}
              >
                {savingIds[`img-${index}`] ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={12} />}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (image.url) {
                  const link = document.createElement('a')
                  link.href = image.url
                  link.download = image.name
                  link.click()
                  return
                }
                if (!image.base64Data) return
                downloadBlob(image.name, base64ToBlob(image.base64Data, image.mimeType))
              }}
              style={{ background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: '4px', padding: '4px', cursor: 'pointer', color: 'white', display: 'flex', alignItems: 'center' }}
              title="Download image"
            >
              <Download size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export const ChatMessageContent = React.memo(function ChatMessageContent({
  content,
  isStreaming,
  isLast,
  presentation,
  sources,
}: {
  content: string
  isStreaming: boolean
  isLast: boolean
  presentation?: ResponsePresentation
  sources?: MessageSource[]
}) {
  const start = React.useMemo(() => performance.now(), [content, presentation?.mode, presentation?.subject, presentation?.dataFormat])
  const normalizedContent = React.useMemo(
    () => getParsedAssistantArtifacts(content, presentation, false).normalizedContent,
    [content, presentation]
  )

  React.useEffect(() => {
    recordRenderMetric('assistant-message', performance.now() - start, {
      characters: normalizedContent.length,
      streaming: isStreaming,
    })
  }, [isStreaming, normalizedContent.length, start])

  if (!normalizedContent) {
    if (isStreaming && isLast) return <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
    return null
  }

  return <>{parseThinkSegments(normalizedContent, presentation, sources)}</>
})

export function AssistantDownloads({
  content,
  index,
  presentation,
  showImages = true,
  sessionId,
  messageId,
  onPersisted,
}: {
  content: string
  index: number
  presentation?: ResponsePresentation
  showImages?: boolean
  sessionId?: string | null
  messageId?: string | null
  onPersisted?: (artifacts: { name: string; id: string }[]) => void
}) {
  const parsed = React.useMemo(
    () => getParsedAssistantArtifacts(content, presentation, showImages),
    [content, presentation, showImages]
  )
  const { normalizedContent, generatedFiles, inlineImages } = parsed
  const serverArtifacts = React.useMemo(
    () => extractServerArtifactDownloads(normalizedContent),
    [normalizedContent]
  )
  const [persistedIds, setPersistedIds] = React.useState<Record<string, string>>({})
  const [savingIds, setSavingIds] = React.useState<Record<string, boolean>>({})
  const [persistedImageIds, setPersistedImageIds] = React.useState<Record<number, string>>({})
  const [saveError, setSaveError] = React.useState<string | null>(null)

  if (!normalizedContent.trim() && generatedFiles.length === 0 && inlineImages.length === 0 && serverArtifacts.length === 0) return null

  const downloadExtension = getResponseDownloadExtension(presentation ?? { mode: 'general' })
  const downloadMimeType = getResponseDownloadMimeType(presentation ?? { mode: 'general' })
  const bundleId = messageId || `assistant-response-${index + 1}`
  const bundleName = `Assistant response ${index + 1}`

  const saveImageToCanvas = React.useCallback(async (image: ImageDisplayFile, imageIndex: number) => {
    if (!sessionId || persistedImageIds[imageIndex] || savingIds[`img-${imageIndex}`] || !image.base64Data) return
    setSavingIds(prev => ({ ...prev, [`img-${imageIndex}`]: true }))
    setSaveError(null)
    try {
      const res = await fetch('/api/canvas/artifacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: image.name,
          content: image.base64Data,
          mimeType: image.mimeType,
          kind: 'diagram',
          extension: image.mimeType.split('/')[1] || 'png',
          sessionId,
          messageId: messageId || null,
          bundleId,
          bundleName,
          bundleRole: 'asset',
        }),
      })
      if (!res.ok) throw new Error('Failed to save image artifact')
      const data = await res.json()
      setPersistedImageIds(prev => ({ ...prev, [imageIndex]: data.artifact.id }))
      onPersisted?.([{ name: image.name, id: data.artifact.id }])
    } catch {
      setSaveError('Failed to save image to Canvas')
    } finally {
      setSavingIds(prev => {
        const next = { ...prev }
        delete next[`img-${imageIndex}`]
        return next
      })
    }
  }, [bundleId, bundleName, messageId, onPersisted, persistedImageIds, savingIds, sessionId])

  const saveToCanvas = React.useCallback(async (file: GeneratedFile) => {
    if (!sessionId || persistedIds[file.name] || savingIds[file.name]) return
    setSavingIds(prev => ({ ...prev, [file.name]: true }))
    setSaveError(null)
    try {
      const res = await fetch('/api/canvas/artifacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          content: file.content,
          mimeType: file.mimeType,
          kind: inferArtifactKind(file.name, file.mimeType),
          extension: file.name.split('.').pop() || null,
          sessionId,
          messageId: messageId || null,
          bundleId,
          bundleName,
        }),
      })
      if (!res.ok) throw new Error('Failed to save artifact')
      const data = await res.json()
      setPersistedIds(prev => ({ ...prev, [file.name]: data.artifact.id }))
      onPersisted?.([{ name: file.name, id: data.artifact.id }])
    } catch {
      setSaveError(`Failed to save ${file.name} to Canvas`)
    } finally {
      setSavingIds(prev => {
        const next = { ...prev }
        delete next[file.name]
        return next
      })
    }
  }, [bundleId, bundleName, messageId, onPersisted, persistedIds, savingIds, sessionId])

  return (
    <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {inlineImages.length > 0 && (
        <ImageGallery
          images={inlineImages}
          sessionId={sessionId}
          messageId={messageId}
          persistedImageIds={persistedImageIds}
          saveImageToCanvas={saveImageToCanvas}
          savingIds={savingIds}
        />
      )}
      {saveError && (
        <div style={{ fontSize: '0.72rem', color: 'var(--danger)' }}>
          {saveError}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        <button
          type="button"
          onClick={() => downloadBlob(`assistant-response-${index + 1}.${downloadExtension}`, new Blob([normalizedContent], { type: downloadMimeType }))}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 9px',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            background: 'rgba(255,255,255,0.04)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '0.72rem',
          }}
        >
          <Download size={12} /> response.{downloadExtension}
        </button>
        {generatedFiles.map(file => (
          <button
            key={file.name}
            type="button"
            onClick={() => {
              downloadGeneratedFile(file)
              void saveToCanvas(file)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 9px',
              borderRadius: '8px',
              border: '1px solid var(--accent-border)',
              background: persistedIds[file.name] ? 'rgba(16,185,129,0.15)' : 'var(--accent-faint)',
              color: persistedIds[file.name] ? '#10b981' : 'var(--accent-primary)',
              cursor: 'pointer',
              fontSize: '0.72rem',
            }}
            title={file.binary ? 'Download decoded base64 file' : 'Download generated file'}
          >
            {savingIds[file.name] ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : persistedIds[file.name] ? <Check size={12} /> : <FileText size={12} />}
            {file.name}{persistedIds[file.name] ? ' (saved)' : ''}
          </button>
        ))}
        {serverArtifacts.map(artifact => (
          <a
            key={artifact.url}
            href={artifact.url}
            download={artifact.name}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 9px',
              borderRadius: '8px',
              border: '1px solid var(--accent-border)',
              background: 'var(--accent-faint)',
              color: 'var(--accent-primary)',
              cursor: 'pointer',
              fontSize: '0.72rem',
              textDecoration: 'none',
            }}
            title="Download generated server artifact"
          >
            <FileText size={12} />
            {artifact.name}
          </a>
        ))}
      </div>
    </div>
  )
}
