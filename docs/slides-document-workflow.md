# Slides Document Workflow

PeakUI's `slides_document` tool turns structured slide content into a downloadable `.pptx` Canvas artifact via `pptxgenjs`. Use it whenever the user asks for a slide deck, PowerPoint, presentation, or `.pptx` file.

## When to use it

- The user asks for a slide deck, PowerPoint, presentation, or `.pptx`.
- You have an outline (titles + bullets) you can structure as slides with explicit layouts.
- You want a downloadable file that opens in PowerPoint, Keynote, LibreOffice Impress, and Google Slides.

Do not use shell, filesystem, or the code sandbox for normal deck generation unless the user explicitly asks to write Python or save files to a workspace path.

## Tool shape

```xml
<openclaw_tool name="slides_document">
{
  "title": "Q3 Review",
  "filename": "q3-review.pptx",
  "subtitle": "Quarterly business review",
  "theme": { "primaryColor": "1E3A8A", "accentColor": "0EA5E9" },
  "slides": [
    { "layout": "title", "title": "Q3 Review", "subtitle": "Quarterly business review" },
    { "layout": "bullets", "title": "Highlights", "bullets": ["Revenue up 18%", "NPS at 47", "Three enterprise wins"] },
    { "layout": "two-column", "title": "Risks & Mitigations", "columns": [
      { "heading": "Risks", "bullets": ["Hiring lag", "Supply chain"] },
      { "heading": "Mitigations", "bullets": ["Contractor pool", "Dual sourcing"] }
    ] },
    { "layout": "closing", "title": "Thank you", "body": "Questions?" }
  ],
  "description": "Generate a polished Q3 review slide deck"
}
</openclaw_tool>
```

## Layouts

- `title` — Title slide with `title` and `subtitle`.
- `section` — Section divider with `title` and optional `body`.
- `content` — Title + `body` paragraph slide.
- `bullets` — Title + `bullets` array.
- `two-column` — Title + `columns` array of `{ heading, bullets }`.
- `quote` — Title + quoted `body`.
- `closing` — Final slide with `title` and `body`.

## Output

- A Canvas artifact with `kind: 'slides-deck'` and `extension: 'pptx'`.
- MIME type `application/vnd.openxmlformats-officedocument.presentationml.presentation`.
- A sibling `kind: 'data'` source artifact (`.source.json`) holds the full structured input so the deck can be re-rendered by editing the source.
- The Canvas modal preview uses the server-side preview endpoint to list slide titles and the first bullet of each so the user can confirm content without downloading.
- Downloads go through `/api/canvas/artifacts/<id>/download` (which decodes base64 correctly) instead of an inline Blob, so the file opens in PowerPoint without corruption.

## Safety notes

- The tool only produces a presentation file; it never executes shell commands or writes to arbitrary filesystem paths.
- Each slide supports title, subtitle, body, bullets, two columns of heading + bullets, and notes.
- Slide count is bounded by the request/response size limits enforced by the API.