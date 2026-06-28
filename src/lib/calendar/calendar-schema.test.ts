import { describe, expect, it } from 'vitest'
import { normalizeCalendarDocumentInput, calendarDocumentHasRenderableContent } from './calendar-schema'

describe('normalizeCalendarDocumentInput', () => {
  it('accepts summary as alias for title', () => {
    const result = normalizeCalendarDocumentInput({
      title: 'Calendar',
      events: [
        { summary: 'Standup', start: '2026-07-01T15:00:00Z' },
      ],
    } as never)

    expect(result.events).toHaveLength(1)
    expect(result.events[0].title).toBe('Standup')
    expect(calendarDocumentHasRenderableContent(result)).toBe(true)
  })

  it('accepts date, when, time as aliases for start', () => {
    const result = normalizeCalendarDocumentInput({
      title: 'Calendar',
      events: [
        { title: 'A', date: '2026-07-01T15:00:00Z' },
        { title: 'B', when: '2026-07-02T15:00:00Z' },
        { title: 'C', time: '2026-07-03T15:00:00Z' },
      ],
    } as never)

    expect(result.events.map(e => e.start)).toEqual([
      '2026-07-01T15:00:00Z',
      '2026-07-02T15:00:00Z',
      '2026-07-03T15:00:00Z',
    ])
  })

  it('drops events that lack both title and start aliases', () => {
    const result = normalizeCalendarDocumentInput({
      title: 'Calendar',
      events: [
        { summary: 'OK', date: '2026-07-01T15:00:00Z' },
        { summary: 'No start' },
        { start: '2026-07-02T15:00:00Z' }, // no title/summary
      ],
    } as never)

    // Only the event with both title-alias and start-alias survives.
    expect(result.events).toHaveLength(1)
    expect(result.events[0].title).toBe('OK')
  })
})