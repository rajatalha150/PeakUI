# Calendar Document Workflow

PeakUI's `calendar_document` tool produces a downloadable `.ics` Canvas artifact via the `ics` package. Use it whenever the user asks to schedule a meeting, create an event, draft an invite, or produce an `.ics` file.

## When to use it

- The user asks to schedule a meeting or event.
- The user wants a calendar invite that opens in macOS Calendar, Outlook, or Google Calendar.
- The user asks for an `.ics` / `ical` / iCalendar file.

Do not write calendar files via shell or the code sandbox when this tool is available.

## Tool shape

```xml
<openclaw_tool name="calendar_document">
{
  "title": "Project Kickoff",
  "filename": "project-kickoff.ics",
  "events": [
    {
      "uid": "kickoff-1",
      "title": "Project Kickoff",
      "description": "Discuss scope and timeline",
      "location": "Zoom",
      "start": "2026-07-01T15:00:00Z",
      "end": "2026-07-01T16:00:00Z",
      "organizer": "team@peakui.local",
      "attendees": ["client@example.com"]
    }
  ],
  "description": "Create an ICS calendar invite for the kickoff meeting"
}
</openclaw_tool>
```

## Event fields

- `uid` (recommended): Stable identifier for the event. If omitted, the renderer derives one from the event index.
- `title` (required): Event title displayed in calendar clients.
- `start` (required): ISO-8601 timestamp or date (for all-day events).
- `end` (optional): ISO-8601 timestamp. Defaults to one hour after `start` if omitted.
- `allDay` (optional): Boolean — when true, `start`/`end` are treated as all-day dates.
- `description` (optional): Long-form event notes.
- `location` (optional): Physical address, room, or video conference URL.
- `organizer` (optional): Email of the event organizer.
- `attendees` (optional): Array of attendee email addresses.
- `url` (optional): URL associated with the event (e.g. meeting link).

Events without a `start` are filtered out before rendering so the resulting `.ics` file is always valid.

## Output

- A Canvas artifact with `kind: 'calendar'` and `extension: 'ics'`.
- MIME type `text/calendar`.
- The `.ics` file opens in macOS Calendar, Microsoft Outlook, Google Calendar, Thunderbird, and any other iCalendar-compatible client.
- The Canvas modal preview shows the event title, start, end, location, and organizer.
- Stored as UTF-8 text in the DB; downloads via `/api/canvas/artifacts/<id>/download` serve the calendar bytes verbatim. A backward-compat path detects older rows that were stored as base64 and decodes them on read.

## Safety notes

- The tool only produces a calendar file; it never sends invites or interacts with calendar services.
- Event count is bounded by the request/response size limits enforced by the API.