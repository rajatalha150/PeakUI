"use client"

import React from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

export default function LazyMarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="canvas-markdown" style={{ padding: '12px', lineHeight: 1.65, fontSize: '0.86rem' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
