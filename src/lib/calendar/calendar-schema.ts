export interface CalendarAttendee {
  email: string
  name?: string
  rsvp?: boolean
}

export interface CalendarEvent {
  uid?: string
  title: string
  description?: string
  location?: string
  url?: string
  start: string
  end?: string
  durationMinutes?: number
  allDay?: boolean
  organizer?: string
  attendees?: CalendarAttendee[]
  status?: 'confirmed' | 'tentative' | 'cancelled'
  categories?: string[]
}

export interface CalendarDocumentInput {
  title?: string
  filename?: string
  description?: string
  events: CalendarEvent[]
  calendarName?: string
}

export interface NormalizedCalendarDocument {
  title: string
  filename?: string
  description?: string
  calendarName?: string
  events: CalendarEvent[]
}

function cleanString(value: unknown, maxLength = 4000): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.trim()
  return clean ? clean.slice(0, maxLength) : undefined
}

function normalizeAttendee(value: unknown): CalendarAttendee | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const email = cleanString(record.email, 240)
  if (!email) return null
  return {
    email,
    name: cleanString(record.name, 160),
    rsvp: record.rsvp === true,
  }
}

function normalizeEvent(value: unknown): CalendarEvent | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  // Accept common aliases for title (summary) and start (date/when/time) so
  // a model that used natural iCalendar vocabulary still produces an event.
  const title = cleanString(record.title, 240) ?? cleanString(record.summary, 240)
  const start = cleanString(record.start, 80)
    ?? cleanString(record.date, 80)
    ?? cleanString(record.when, 80)
    ?? cleanString(record.time, 80)
  if (!title || !start) return null
  const statusValue = record.status
  const status: CalendarEvent['status'] = statusValue === 'confirmed' || statusValue === 'tentative' || statusValue === 'cancelled'
    ? statusValue
    : undefined
  return {
    uid: cleanString(record.uid, 240),
    title,
    description: cleanString(record.description, 4000),
    location: cleanString(record.location, 400),
    url: cleanString(record.url, 1000),
    start,
    end: cleanString(record.end, 80),
    durationMinutes: typeof record.durationMinutes === 'number' && Number.isFinite(record.durationMinutes)
      ? Math.max(0, Math.min(record.durationMinutes, 24 * 60 * 30))
      : undefined,
    allDay: record.allDay === true,
    organizer: cleanString(record.organizer, 240),
    attendees: Array.isArray(record.attendees)
      ? record.attendees.map(normalizeAttendee).filter((a): a is CalendarAttendee => Boolean(a)).slice(0, 200)
      : undefined,
    status,
    categories: Array.isArray(record.categories)
      ? record.categories.map(item => cleanString(item, 80)).filter((c): c is string => Boolean(c)).slice(0, 12)
      : undefined,
  }
}

export function normalizeCalendarDocumentInput(input: CalendarDocumentInput): NormalizedCalendarDocument {
  const events = Array.isArray(input.events)
    ? input.events.map(normalizeEvent).filter((e): e is CalendarEvent => Boolean(e)).slice(0, 500)
    : []
  return {
    title: (typeof input.title === 'string' ? input.title.trim() : '').slice(0, 200) || 'Calendar',
    filename: cleanString(input.filename, 180),
    description: cleanString(input.description, 800),
    calendarName: cleanString(input.calendarName, 160),
    events,
  }
}

export function calendarDocumentHasRenderableContent(document: NormalizedCalendarDocument): boolean {
  return document.events.length > 0
}