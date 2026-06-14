"use client"

import React from 'react'
import dynamic from 'next/dynamic'
import ObjectUrlImage from './ObjectUrlImage'
import type { CanvasArtifactRecord } from '@/lib/canvas-artifacts'
import {
  isChartArtifact,
  isCodeArtifact,
  isImageArtifact,
  isMarkdownArtifact,
  isPdfArtifact,
  isTableArtifact,
} from '@/lib/canvas-artifacts'
import {
  buildCollapsedPreview,
  IMAGE_PREVIEW_MAX_HEIGHT,
  IMAGE_PREVIEW_MAX_WIDTH,
  isLargeArtifactContent,
} from '@/lib/canvas-rendering'
import { recordRenderMetric } from '@/lib/render-metrics'

const MarkdownRenderer = dynamic(() => import('./LazyMarkdownRenderer'), {
  loading: () => <div style={{ padding: '12px', color: 'var(--text-secondary)' }}>Loading markdown preview…</div>,
})

const SyntaxHighlighter = dynamic(() => import('./LazySyntaxHighlighter'), {
  loading: () => <pre style={fallbackPreStyle}>Loading code preview…</pre>,
})

const LANGUAGE_MAP: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java', cs: 'csharp',
  cpp: 'cpp', c: 'c', h: 'c', css: 'css', scss: 'scss', html: 'html',
  xml: 'xml', json: 'json', yaml: 'yaml', yml: 'yaml', md: 'markdown',
  sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell', toml: 'toml',
}

const fallbackPreStyle: React.CSSProperties = {
  padding: '12px',
  background: 'var(--bg-secondary)',
  borderRadius: '8px',
  fontSize: '0.76rem',
  lineHeight: 1.55,
  overflow: 'hidden',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}

function getLanguage(filename: string, mimeType: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  if (LANGUAGE_MAP[ext]) return LANGUAGE_MAP[ext]
  if (mimeType.includes('json')) return 'json'
  if (mimeType.includes('xml')) return 'xml'
  if (mimeType.includes('html')) return 'html'
  if (mimeType.includes('css')) return 'css'
  if (mimeType.includes('javascript')) return 'javascript'
  if (mimeType.includes('typescript')) return 'typescript'
  return 'text'
}

function parseDelimitedTable(content: string, delimiter: string): { headers: string[]; rows: string[][] } | null {
  try {
    const lines = content.trim().split(/\r?\n/).filter(Boolean)
    if (lines.length < 2) return null
    const rows = lines.map(line => line.split(delimiter).map(cell => cell.trim()))
    const width = rows[0].length
    if (width < 2) return null
    return {
      headers: rows[0],
      rows: rows.slice(1).map(row => row.concat(Array(Math.max(0, width - row.length)).fill('')).slice(0, width)),
    }
  } catch {
    return null
  }
}

function parseJsonTable(content: string): { headers: string[]; rows: string[][] } | null {
  try {
    const parsed = JSON.parse(content)
    if (!Array.isArray(parsed) || parsed.length === 0 || typeof parsed[0] !== 'object' || !parsed[0]) return null
    const headers = Array.from(new Set(parsed.flatMap(row => Object.keys(row as Record<string, unknown>))))
    const rows = parsed.slice(0, 100).map((row) =>
      headers.map(header => {
        const value = (row as Record<string, unknown>)[header]
        return typeof value === 'string' ? value : JSON.stringify(value ?? '')
      })
    )
    return { headers, rows }
  } catch {
    return null
  }
}

function buildChartRows(content: string): Array<{ label: string; value: number }> {
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry, index) => {
          if (typeof entry === 'number') return { label: `Item ${index + 1}`, value: entry }
          if (entry && typeof entry === 'object') {
            const record = entry as Record<string, unknown>
            const label = typeof record.label === 'string'
              ? record.label
              : typeof record.name === 'string'
                ? record.name
                : `Item ${index + 1}`
            const value = typeof record.value === 'number'
              ? record.value
              : Object.values(record).find(candidate => typeof candidate === 'number')
            return typeof value === 'number' ? { label, value } : null
          }
          return null
        })
        .filter((entry): entry is { label: string; value: number } => Boolean(entry))
        .slice(0, 24)
    }

    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed as Record<string, unknown>)
        .filter(([, value]) => typeof value === 'number')
        .slice(0, 24)
        .map(([label, value]) => ({ label, value: value as number }))
    }
  } catch {
    return []
  }
  return []
}

function MetricRender({ name, detail, children }: { name: string; detail?: Record<string, unknown>; children: React.ReactNode }) {
  React.useEffect(() => {
    const start = performance.now()
    return () => {
      recordRenderMetric(name, performance.now() - start, detail)
    }
  }, [name, detail])

  return <>{children}</>
}

export default function ArtifactPreviewContent({
  artifact,
  content,
  expanded,
  renderFullContent,
  editing,
  editContent,
  onContentChange,
}: {
  artifact: CanvasArtifactRecord
  content: string
  expanded: boolean
  renderFullContent: boolean
  editing: boolean
  editContent: string
  onContentChange: (content: string) => void
}) {
  const largeContent = isLargeArtifactContent(content)
  const language = getLanguage(artifact.name, artifact.mimeType)
  const tableData = React.useMemo(() => {
    if (!expanded || editing) return null
    if (artifact.extension === 'csv' || artifact.mimeType === 'text/csv') return parseDelimitedTable(content, ',')
    if (artifact.extension === 'tsv' || artifact.mimeType === 'text/tab-separated-values') return parseDelimitedTable(content, '\t')
    if (isTableArtifact(artifact)) return parseJsonTable(content)
    return null
  }, [artifact, content, editing, expanded])
  const chartRows = React.useMemo(() => (expanded && !editing && isChartArtifact(artifact) ? buildChartRows(content) : []), [artifact, content, editing, expanded])

  if (editing) {
    return (
      <textarea
        value={editContent}
        onChange={(event) => onContentChange(event.target.value)}
        style={{
          width: '100%',
          minHeight: '180px',
          background: isCodeArtifact(artifact) ? '#161922' : 'var(--bg-secondary)',
          color: isCodeArtifact(artifact) ? '#abb2bf' : 'var(--text-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '12px',
          fontFamily: 'monospace',
          fontSize: '0.8rem',
          resize: 'vertical',
        }}
      />
    )
  }

  if (isImageArtifact(artifact)) {
    return (
      <MetricRender name="artifact-preview:image" detail={{ artifactId: artifact.id, expanded }}>
        <div style={{ display: 'flex', justifyContent: 'center', background: '#1a1a2e', borderRadius: '8px', padding: '12px' }}>
          <ObjectUrlImage
            base64Data={content}
            mimeType={artifact.mimeType}
            alt={artifact.name}
            maxPreviewWidth={IMAGE_PREVIEW_MAX_WIDTH}
            maxPreviewHeight={IMAGE_PREVIEW_MAX_HEIGHT}
            decodeFullSize={expanded}
            style={{ maxWidth: '100%', maxHeight: expanded ? 'none' : `${IMAGE_PREVIEW_MAX_HEIGHT}px`, borderRadius: '6px' }}
          />
        </div>
      </MetricRender>
    )
  }

  if (isPdfArtifact(artifact)) {
    if (!expanded || !renderFullContent) {
      return (
        <div style={{
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '12px',
          background: 'var(--bg-secondary)',
          color: 'var(--text-secondary)',
          fontSize: '0.78rem',
        }}>
          PDF document · {artifact.previewSummary || artifact.name}
          {largeContent ? '\n\n[load full preview to render the PDF]' : ''}
        </div>
      )
    }

    return (
      <MetricRender name="artifact-preview:pdf" detail={{ artifactId: artifact.id }}>
        <iframe
          title={artifact.name}
          src={`data:application/pdf;base64,${content.replace(/\s+/g, '')}`}
          style={{
            width: '100%',
            minHeight: '520px',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            background: 'var(--bg-secondary)',
          }}
        />
      </MetricRender>
    )
  }

  if (!expanded || (expanded && !renderFullContent)) {
    return (
      <pre style={fallbackPreStyle}>
        {buildCollapsedPreview(content, isCodeArtifact(artifact) ? 2200 : 1600, isCodeArtifact(artifact) ? 36 : 28)}
        {largeContent ? '\n\n[load full preview to render the rest]' : ''}
      </pre>
    )
  }

  if (isMarkdownArtifact(artifact)) {
    return (
      <MetricRender name="artifact-preview:markdown" detail={{ artifactId: artifact.id }}>
        <MarkdownRenderer content={content} />
      </MetricRender>
    )
  }

  if (tableData) {
    return (
      <MetricRender name="artifact-preview:table" detail={{ artifactId: artifact.id, rows: tableData.rows.length }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
            <thead>
              <tr>
                {tableData.headers.map(header => (
                  <th key={header} style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableData.rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`cell-${rowIndex}-${cellIndex}`} style={{ padding: '8px', borderBottom: '1px solid rgba(255,255,255,0.05)', verticalAlign: 'top' }}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </MetricRender>
    )
  }

  if (chartRows.length > 0) {
    const maxValue = Math.max(...chartRows.map(row => row.value), 1)
    return (
      <MetricRender name="artifact-preview:chart" detail={{ artifactId: artifact.id, series: chartRows.length }}>
        <div style={{ display: 'grid', gap: '10px' }}>
          {chartRows.map(row => (
            <div key={row.label} style={{ display: 'grid', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                <span>{row.label}</span>
                <span>{row.value}</span>
              </div>
              <div style={{ height: '10px', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <div style={{ width: `${(row.value / maxValue) * 100}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent-primary), #22c55e)' }} />
              </div>
            </div>
          ))}
        </div>
      </MetricRender>
    )
  }

  if (isCodeArtifact(artifact)) {
    return (
      <MetricRender name="artifact-preview:code" detail={{ artifactId: artifact.id, language }}>
        <SyntaxHighlighter code={content} language={language} />
      </MetricRender>
    )
  }

  return (
    <MetricRender name="artifact-preview:file" detail={{ artifactId: artifact.id }}>
      <pre
        style={{
          padding: '12px',
          background: 'var(--bg-secondary)',
          borderRadius: '8px',
          fontSize: '0.75rem',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowX: 'auto',
        }}
      >
        {content}
      </pre>
    </MetricRender>
  )
}
