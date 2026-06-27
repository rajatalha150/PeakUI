import { describe, expect, it } from 'vitest'
import { renderCalendarDocument } from '@/lib/calendar/calendar-renderer'
import { normalizeCalendarDocumentInput } from '@/lib/calendar/calendar-schema'

describe('calendar renderer', () => {
  it('produces a valid VCALENDAR string', async () => {
    const normalized = normalizeCalendarDocumentInput({
      title: 'Meeting',
      events: [
        {
          uid: 'meeting-1',
          title: 'Project kickoff',
          start: '2026-07-01T15:00:00Z',
          end: '2026-07-01T16:00:00Z',
        },
      ],
    })
    const bytes = await renderCalendarDocument(normalized)
    const text = bytes.toString('utf8')
    expect(text.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(text.includes('BEGIN:VEVENT')).toBe(true)
    expect(text.includes('Project kickoff')).toBe(true)
    expect(text.includes('END:VCALENDAR')).toBe(true)
  })

  it('handles multi-event calendars', async () => {
    const normalized = normalizeCalendarDocumentInput({
      title: 'Multi',
      events: [
        { uid: 'a', title: 'A', start: '2026-07-01T15:00:00Z', durationMinutes: 30 },
        { uid: 'b', title: 'B', start: '2026-07-01T16:00:00Z', durationMinutes: 60 },
      ],
    })
    const bytes = await renderCalendarDocument(normalized)
    const text = bytes.toString('utf8')
    expect((text.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2)
  })

  it('falls back to an empty VCALENDAR when no events parse', async () => {
    const normalized = normalizeCalendarDocumentInput({
      title: 'Empty',
      events: [],
    })
    const bytes = await renderCalendarDocument(normalized)
    expect(bytes.toString('utf8').startsWith('BEGIN:VCALENDAR')).toBe(true)
  })
})