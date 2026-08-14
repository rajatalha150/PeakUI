import { describe, expect, it } from 'vitest'
import {
  normalizeMarkdownDocumentInput,
  ensureMarkdownRenderableContent,
} from './markdown/markdown-schema'
import {
  normalizeCsvDocumentInput,
  ensureCsvRenderableContent,
} from './csv/csv-schema'
import {
  normalizeEmailDocumentInput,
  ensureEmailRenderableContent,
} from './email/email-schema'
import {
  normalizeWorkbookDocumentInput,
  ensureWorkbookRenderableContent,
  workbookHasRenderableContent,
} from './workbook/workbook-schema'

describe('ensureMarkdownRenderableContent', () => {
  it('keeps a document that already has content', () => {
    const doc = normalizeMarkdownDocumentInput({ title: 'T', content: '# Hello' })
    ensureMarkdownRenderableContent(doc)
    expect(doc.content).toBe('# Hello')
  })

  it('falls back to the description as the body', () => {
    const doc = normalizeMarkdownDocumentInput({ title: 'T', description: 'A summary.', content: '' })
    ensureMarkdownRenderableContent(doc)
    expect(doc.content).toBe('A summary.')
  })

  it('falls back to a title heading when there is no description', () => {
    const doc = normalizeMarkdownDocumentInput({ title: 'Release Notes', content: '' })
    ensureMarkdownRenderableContent(doc)
    expect(doc.content).toBe('# Release Notes')
  })
})

describe('ensureCsvRenderableContent', () => {
  it('keeps a document that already has content', () => {
    const doc = normalizeCsvDocumentInput({ title: 'T', content: 'a,b\n1,2' })
    ensureCsvRenderableContent(doc)
    expect(doc.content).toBe('a,b\n1,2')
  })

  it('falls back to the description as the body', () => {
    const doc = normalizeCsvDocumentInput({ title: 'T', description: 'Name, Email' })
    ensureCsvRenderableContent(doc)
    expect(doc.content).toBe('Name, Email')
  })

  it('falls back to the title as a single cell', () => {
    const doc = normalizeCsvDocumentInput({ title: 'Customer List' })
    ensureCsvRenderableContent(doc)
    expect(doc.content).toBe('Customer List')
  })
})

describe('ensureEmailRenderableContent', () => {
  it('keeps a document that already has subject and body', () => {
    const doc = normalizeEmailDocumentInput({ title: 'T', subject: 'Hi', body: 'Body' })
    ensureEmailRenderableContent(doc)
    expect(doc.subject).toBe('Hi')
    expect(doc.body).toBe('Body')
  })

  it('defaults the subject from the title and the body from the description', () => {
    const doc = normalizeEmailDocumentInput({ title: 'Follow-up', description: 'Checking in.', subject: '', body: '' })
    ensureEmailRenderableContent(doc)
    expect(doc.subject).toBe('Follow-up')
    expect(doc.body).toBe('Checking in.')
  })

  it('defaults the subject from the title when there is no description', () => {
    const doc = normalizeEmailDocumentInput({ title: 'Follow-up', subject: '', body: '' })
    ensureEmailRenderableContent(doc)
    expect(doc.subject).toBe('Follow-up')
    expect(doc.body).toBe('')
  })
})

describe('ensureWorkbookRenderableContent', () => {
  it('keeps a workbook that already has rows', () => {
    const workbook = normalizeWorkbookDocumentInput({
      title: 'Budget',
      sheets: [{ name: 'Budget', columns: [{ header: 'A' }], rows: [{ A: 'x' }] }],
    })
    ensureWorkbookRenderableContent(workbook)
    expect(workbookHasRenderableContent(workbook)).toBe(true)
    expect(workbook.sheets).toHaveLength(1)
  })

  it('synthesizes a Notes sheet from description lines', () => {
    const workbook = normalizeWorkbookDocumentInput({
      title: 'Q3 Budget',
      description: 'Planned spend.\nHosting and support.',
    })
    ensureWorkbookRenderableContent(workbook)
    expect(workbookHasRenderableContent(workbook)).toBe(true)
    expect(workbook.sheets).toHaveLength(1)
    expect(workbook.sheets[0].name).toBe('Q3 Budget')
    const table = workbook.sheets[0].tables?.[0]
    expect(table?.columns[0].header).toBe('Notes')
    expect(table?.rows).toEqual([['Planned spend.'], ['Hosting and support.']])
  })

  it('synthesizes a Notes sheet from the title when there is no description', () => {
    const workbook = normalizeWorkbookDocumentInput({ title: 'Q3 Budget' })
    ensureWorkbookRenderableContent(workbook)
    expect(workbookHasRenderableContent(workbook)).toBe(true)
    expect(workbook.sheets[0].tables?.[0]?.rows).toEqual([['Q3 Budget']])
  })
})
