import { describe, expect, it } from 'vitest'
import { findUnmappedWorkbookFields } from './workbook-schema'

describe('workbook row validation', () => {
  it('catches values that would silently disappear from a generated workbook', () => {
    const errors = findUnmappedWorkbookFields({
      title: 'Contacts',
      sheets: [{ name: 'Contacts', columns: [{ header: 'Company' }, { header: 'Source / Notes' }],
        rows: [{ Company: 'Halmar', Notes: 'https://example.com/source' }] }],
    })
    expect(errors[0]).toContain('Notes')
    expect(errors[0]).toContain('Source / Notes')
  })

  it('accepts exact headers and explicit column keys', () => {
    expect(findUnmappedWorkbookFields({
      title: 'Contacts',
      sheets: [{ name: 'Contacts', columns: [{ header: 'Source / Notes', key: 'source' }],
        rows: [{ source: 'https://example.com/source' }, { 'Source / Notes': 'Review pending' }] }],
    })).toEqual([])
  })
})
