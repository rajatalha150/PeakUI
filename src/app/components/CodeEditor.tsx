'use client'

import React from 'react'
import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

// Bundle Monaco locally instead of loading from its CDN loader, so the container
// stays self-contained (no internet dependency at runtime — §15 of the coding
// docs). Running in the main thread (no web worker) keeps the setup robust in the
// standalone Next.js build; syntax highlighting + basic editing work, while
// IntelliSense / go-to-definition would need a worker + language-service setup
// (which is exactly the LSP gap documented for the editor).
loader.config({ monaco })

interface CodeEditorProps {
  /** Model path; Monaco infers the language from the file extension. */
  path: string
  value: string
  onChange: (value: string) => void
  height?: number
}

export default function CodeEditor({ path, value, onChange, height = 260 }: CodeEditorProps) {
  return (
    <Editor
      height={height}
      path={path}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      theme="vs-dark"
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: 'off',
      }}
    />
  )
}
