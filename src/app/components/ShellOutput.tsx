/**
 * Shell Command Output Display
 */

import React, { useState } from 'react'
import { Terminal, Copy, Check, ChevronDown, ChevronRight } from 'lucide-react'

interface ShellOutputProps {
  command: string
  target?: 'container' | 'host'
  stdout?: string
  stderr?: string
  exitCode: number | null
  duration: number
  success: boolean
}

export default function ShellOutput({
  command,
  target,
  stdout,
  stderr,
  exitCode,
  duration,
  success,
}: ShellOutputProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    const output = [
      `$ ${command}`,
      stdout && `STDOUT:\n${stdout}`,
      stderr && `STDERR:\n${stderr}`,
      `Exit code: ${exitCode}`,
    ].filter(Boolean).join('\n\n')

    navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const stripAnsi = (str: string) => {
    return str.replace(/[][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
  }

  const hasOutput = Boolean(stdout?.trim() || stderr?.trim())

  return (
    <div style={{
      background: 'var(--input-shell-bg)',
      borderRadius: '8px',
      border: '1px solid var(--border-color)',
      margin: '8px 0',
      overflow: 'hidden',
    }}>
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          padding: '10px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          cursor: 'pointer',
          backgroundColor: success ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          borderBottom: isExpanded ? '1px solid var(--border-color)' : 'none',
        }}
      >
        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <Terminal size={16} style={{ color: success ? 'var(--success)' : 'var(--danger)' }} />
        <code style={{
          flex: 1,
          fontSize: '13px',
          fontFamily: 'monospace',
          color: 'var(--text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          $ {command}
        </code>
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
          {(target === 'host' ? 'host' : 'container')} · {duration}ms
        </span>
        <span style={{
          fontSize: '12px',
          padding: '2px 8px',
          borderRadius: '4px',
          backgroundColor: success ? 'var(--success)' : 'var(--danger)',
          color: 'white',
        }}>
          exit {exitCode}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); handleCopy(); }}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            color: 'var(--text-secondary)',
          }}
          title="Copy output"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>

      {isExpanded && hasOutput && (
        <pre style={{
          margin: 0,
          padding: '12px',
          fontSize: '12px',
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: '400px',
          overflow: 'auto',
          color: 'var(--text-primary)',
        }}>
          {stdout && stripAnsi(stdout)}
          {stderr && <span style={{ color: 'var(--danger)' }}>{stripAnsi(stderr)}</span>}
        </pre>
      )}
    </div>
  )
}
