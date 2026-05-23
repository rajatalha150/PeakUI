"use client"

import React from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

export default function LazySyntaxHighlighter({
  code,
  language,
}: {
  code: string
  language: string
}) {
  return (
    <SyntaxHighlighter
      language={language}
      style={oneDark}
      customStyle={{
        margin: 0,
        borderRadius: '8px',
        fontSize: '0.75rem',
      }}
      wrapLongLines
    >
      {code}
    </SyntaxHighlighter>
  )
}
