import { createEvents, type EventAttributes } from 'ics'
import type { CalendarEvent, NormalizedCalendarDocument } from './calendar-schema'

interface IcsError {
  code?: string
  message?: string
  name?: string
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function toDateArray(value: string): [number, number, number, number, number] | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const hasTimezone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed)
  const normalized = hasTimezone ? trimmed : `${trimmed}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return undefined
  return [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
  ]
}

function buildEventAttributes(event: CalendarEvent, calendarName?: string): EventAttributes | null {
  const start = toDateArray(event.start)
  if (!start) return null
  const end = event.end ? toDateArray(event.end) : undefined
  const uid = event.uid || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}@peakui.local`

  const duration: { hours: number; minutes: number } | undefined =
    typeof event.durationMinutes === 'number'
      ? { hours: Math.floor(event.durationMinutes / 60), minutes: event.durationMinutes % 60 }
      : undefined

  return {
    uid,
    title: event.title,
    description: event.description ? escapeIcsText(event.description) : undefined,
    location: event.location,
    url: event.url,
    start,
    ...(end ? { end } : duration ? { duration } : {}),
    startInputType: event.allDay ? 'local' : 'utc',
    endInputType: event.allDay ? 'local' : 'utc',
    startOutputType: event.allDay ? 'local' : 'utc',
    endOutputType: event.allDay ? 'local' : 'utc',
    organizer: event.organizer ? { name: calendarName, email: event.organizer } : undefined,
    attendees: event.attendees?.map(a => ({
      name: a.name,
      email: a.email,
      rsvp: a.rsvp,
    })),
    status: event.status === 'confirmed' ? 'CONFIRMED' : event.status === 'tentative' ? 'TENTATIVE' : event.status === 'cancelled' ? 'CANCELLED' : undefined,
    categories: event.categories,
    calName: calendarName,
    productId: '-//PeakUI//Canvas//EN',
  } as EventAttributes
}

export async function renderCalendarDocument(document: NormalizedCalendarDocument): Promise<Buffer> {
  const attributes: EventAttributes[] = []
  for (const event of document.events) {
    const built = buildEventAttributes(event, document.calendarName)
    if (built) attributes.push(built)
  }
  if (attributes.length === 0) {
    return Buffer.from('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//PeakUI//Canvas//EN\r\nEND:VCALENDAR\r\n', 'utf8')
  }
  return await new Promise<Buffer>((resolve, reject) => {
    createEvents(attributes, (error: IcsError | undefined, value: string) => {
      if (error) {
        reject(new Error(error.message ?? 'Calendar generation failed'))
        return
      }
      resolve(Buffer.from(value, 'utf8'))
    })
  })
}
