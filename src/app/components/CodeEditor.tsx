'use client'

import React from 'react'
import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

// Bundle Monaco locally instead of loading from its CDN loader, and provide an
// explicit fallback so standalone Next builds do not try to resolve a
// browser-relative worker module at runtime. Monaco catches this and runs its
// basic editor service on the main thread; language-service workers are a later
// enhancement for this intentionally self-contained editor.
if (typeof window !== 'undefined') {
  (globalThis as typeof globalThis & {
    MonacoEnvironment?: { getWorker: () => Worker }
  }).MonacoEnvironment = {
    getWorker: () => { throw new Error('Monaco language workers are unavailable in the standalone bundle'); },
  };
}
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
