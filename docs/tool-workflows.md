# WorkSpaces Tool Workflows

PeakUI exposes several app-native tools so the AI can generate real deliverables instead of falling back to shell, filesystem, or the code sandbox. Each section below covers what the tool produces, when to use it, and the JSON/XML contract the model should emit inside an `<openclaw_tool>` wrapper.

## PDF Document Workflow

PeakUI can create downloadable PDF artifacts from WorkSpaces through the generic `pdf_document` tool. This is the default path for ordinary PDF requests and is intentionally separate from domain-specific tools such as `tax_return`.

## What It Does

- Accepts a title, filename, and either markdown-like content or structured sections, fields, tables, and callouts from the assistant.
- Renders a polished server-side PDF with pagination, headings, bullets, tables, label/value fields, callouts, and footer text.
- When the model supplies the full structure, the renderer styles it per-template: each template (report / memo / letter / invoice / checklist / form) gets its own accent palette, with accent-colored eyebrow + header rule, section headings with an accent bar, zebra-striped tables with tinted headers, tone-labeled callouts (NOTE / WARNING / SUCCESS) with colored left borders, and field grids with a tinted label column.
- Stores the generated PDF as a Canvas artifact tied to the current WorkSpaces session.
- Stores a sibling `.source.json` Canvas artifact in the same bundle so the source contract can be inspected or regenerated later.
- Returns a secure `/api/canvas/artifacts/<id>/download` URL that appears in chat as a download button.

## When To Use It

Use `pdf_document` when the user asks the AI to create, generate, produce, or return a downloadable PDF for a general-purpose document, report, summary, checklist, sample form, letter, or draft.

Do not use shell, filesystem, or the code sandbox for normal PDF generation unless the user explicitly asks to write source code or save files in a workspace path.

## Professional Document Rules

- Treat PDFs as designed documents, not markdown transcripts.
- Prefer `fields` for label/value facts, `tables` for line items or comparisons, `callouts` for notes and warnings, and short `sections` for narrative prose.
- Avoid markdown tables, horizontal rules, decorative markdown, and duplicated facts inside section bodies.
- After generation succeeds, present the download link first and keep the chat response concise unless the user asks for an inline summary.

## Tool Contract

```xml
<openclaw_tool name="pdf_document">
{"title":"Project Report","filename":"project-report.pdf","template":"report","subtitle":"Prepared by PeakUI","sections":[{"heading":"Executive Summary","body":"This PDF uses structured sections instead of plain markdown."},{"heading":"Next Steps","bullets":["Review the draft","Download the PDF","Request revisions if needed"]}],"tables":[{"title":"Budget","columns":["Item","Amount"],"rows":[{"Item":"Hosting","Amount":"$299"},{"Item":"Support","Amount":"$500"}]}],"description":"Create a polished downloadable project report PDF"}
</openclaw_tool>
```

Required fields:

- `title`: Display title rendered at the top of the PDF.

The full structure is a **strong recommendation, not a requirement**: a title alone (optionally with a `description`) is enough to generate a valid PDF. If only a `description` is supplied, it is promoted to the body content. For the most beautiful result, model the document with `sections`, `fields`, `tables`, and `callouts` — each element is styled with color, spacing, and layout, so structured documents render as polished, professional PDFs.

Optional fields:

- `filename`: Download filename. `.pdf` is added when omitted.
- `description`: Human-readable approval text.
- `template`: One of `report`, `memo`, `letter`, `invoice`, `checklist`, or `form`.
- `subtitle`: Secondary heading text.
- `content`: Markdown-like fallback body text.
- `sections`: Structured sections with `heading`, `body`, `bullets`, `fields`, `tables`, and `callouts`.
- `fields`: Top-level label/value pairs.
- `tables`: Top-level tables with `columns` and `rows`.
- `callouts`: Top-level note, warning, or success blocks.
- `metadata`: Optional `author`, `subject`, and `footer`.

## Relationship To Specialized Services

Specialized workflows can use their own tools when they need structured extraction, validation, or form filling. For example, `tax_return` reads Knowledge Base tax documents, extracts a review draft, and can fill uploaded AcroForm PDFs.

Both generic and specialized PDF tools store their output through the same Canvas artifact pipeline so chat downloads behave consistently.

## Canvas Behavior

Generated PDFs are stored as PDF Canvas artifacts with a paired JSON source artifact in the same bundle. The PDF is the user-facing downloadable file, while the source artifact preserves the structured document request for review, regeneration, or future editing workflows.

---

## Word Document Workflow

PeakUI can create downloadable Microsoft Word `.docx` artifacts from WorkSpaces through the `word_document` tool.

## What It Does

- Accepts a title, filename, template, metadata, and structured document content.
- Renders a real DOCX file with title page styling, headings, paragraphs, bullets, numbered lists, label/value fields, tables, callouts, and footer text.
- Stores the generated Word document as a Canvas artifact tied to the current WorkSpaces session.
- Stores a sibling `.source.json` artifact in the same bundle so the source contract can be inspected or regenerated later.
- Returns a secure `/api/canvas/artifacts/<id>/download` URL that appears in chat as a download button.

## When To Use It

Use `word_document` when the user asks for a Word file, DOCX, proposal, contract, resume, letter, memo, report, policy, checklist, form-style document, or business document draft.

Do not use markdown, shell, filesystem, or the code sandbox for normal Word document generation unless the user explicitly asks to write source code or save files in a workspace path.

## Professional Document Rules

- Treat Word files as designed business deliverables, not markdown transcripts.
- Use `fields` for document metadata and label/value facts.
- Use `sections` for prose, `bullets` and `numbered` lists for steps or terms, `tables` for structured comparisons or pricing, and `callouts` for notes, warnings, and next steps.
- Avoid dumping the full document into chat after generation. Present the download link first and keep the response concise unless the user asks for an inline summary.

## Tool Contract

```xml
<openclaw_tool name="word_document">
{"title":"Professional Services Proposal","filename":"professional-services-proposal.docx","template":"proposal","subtitle":"Prepared by PeakUI","fields":[{"label":"Client","value":"Acme Corp"},{"label":"Prepared by","value":"JLJ IV Enterprises"}],"sections":[{"heading":"Executive Summary","body":"This proposal outlines the recommended scope, timeline, and deliverables for the engagement."},{"heading":"Scope of Work","bullets":["Discovery and requirements review","Implementation plan","Delivery and handoff"]},{"heading":"Commercial Terms","tables":[{"title":"Pricing","columns":["Item","Amount"],"rows":[{"Item":"Implementation","Amount":"$4,500"},{"Item":"Support","Amount":"$750"}]}],"callouts":[{"tone":"note","title":"Next Step","text":"Review and approve the proposed scope before kickoff."}]}],"metadata":{"author":"PeakUI","footer":"Generated by PeakUI"},"description":"Create a polished Word proposal document"}
</openclaw_tool>
```

Required fields:

- `title`: Document title.

The full structure is a **strong recommendation, not a requirement**: a title alone (optionally with a `description`) is enough to generate a valid DOCX. If only a `description` is supplied, it is promoted to the body content.

Common optional fields:

- `filename`: Download filename. `.docx` is added when omitted.
- `template`: One of `report`, `memo`, `letter`, `proposal`, `contract`, `resume`, `checklist`, or `form`.
- `subtitle`: Secondary title text.
- `metadata`: Optional `author`, `subject`, `company`, and `footer`.
- `sections`: Structured content with `heading`, `body`, `bullets`, `numbered`, `fields`, `tables`, `callouts`, and `pageBreakBefore`.

## Canvas Behavior

Generated Word documents are stored as binary DOCX Canvas artifacts with a paired JSON source artifact in the same bundle. Canvas previews treat DOCX files as downloadable files, while the source artifact preserves the structured document request for review, regeneration, or future editing workflows.

---

## Excel Workbook Workflow

PeakUI can create downloadable Excel workbook artifacts from WorkSpaces through the `workbook_document` tool.

## What It Does

- Accepts a title, filename, template, metadata, and one or more structured sheets.
- Renders a real `.xlsx` workbook with styled titles, typed columns, formatted values, filters, frozen headers, notes, and total formulas.
- Stores the generated workbook as a Canvas artifact tied to the current WorkSpaces session.
- Stores a sibling `.source.json` artifact in the same bundle so the source contract can be inspected or regenerated later.
- Returns a secure `/api/canvas/artifacts/<id>/download` URL that appears in chat as a download button.

## When To Use It

Use `workbook_document` when the user asks for an Excel file, XLSX, spreadsheet, workbook, budget, invoice workbook, timesheet, ledger, inventory, tracker, schedule, or multi-sheet analysis.

Do not use markdown tables, shell, filesystem, or the code sandbox for normal workbook generation unless the user explicitly asks to write source code or save files in a workspace path.

## Professional Workbook Rules

- Treat workbooks as structured spreadsheet deliverables, not markdown transcripts.
- Use separate `sheets` for separate subjects.
- Use typed `columns` for dates, numbers, currency, percentages, booleans, and text.
- Put records in `rows`, summaries in additional `tables`, assumptions in `notes`, and calculations in `totals`.
- After generation succeeds, present the download link first and keep the chat response concise unless the user asks for an inline summary.

## Tool Contract

```xml
<openclaw_tool name="workbook_document">
{"title":"Project Budget","filename":"project-budget.xlsx","template":"budget","sheets":[{"name":"Budget","title":"Project Budget","columns":[{"header":"Category","type":"text"},{"header":"Planned","type":"currency"},{"header":"Actual","type":"currency"},{"header":"Variance","type":"currency"}],"rows":[{"Category":"Hosting","Planned":500,"Actual":425,"Variance":75},{"Category":"Support","Planned":1200,"Actual":1100,"Variance":100}],"tables":[{"title":"Summary","columns":[{"header":"Metric","type":"text"},{"header":"Amount","type":"currency"}],"rows":[{"Metric":"Total Planned","Amount":1700},{"Metric":"Total Actual","Amount":1525}]}],"notes":["Currency: USD"],"freezeHeader":true,"autoFilter":true}],"metadata":{"creator":"PeakUI","currency":"USD"},"description":"Create a downloadable project budget workbook"}
</openclaw_tool>
```

Required fields:

- `title`: Workbook title.
- `sheets`: At least one sheet with rows.

Common optional fields:

- `filename`: Download filename. `.xlsx` is added when omitted.
- `template`: One of `workbook`, `report`, `invoice`, `budget`, `timesheet`, `ledger`, `inventory`, `schedule`, or `tracker`.
- `metadata`: Optional `creator`, `subject`, `company`, and `currency`.
- `sheet.columns`: Column headers and types.
- `sheet.rows`: Row records or arrays.
- `sheet.tables`: Additional tables on the same sheet.
- `table.totals`: Formula rows such as `sum`, `average`, `count`, `min`, or `max`.

## Canvas Behavior

Generated workbooks are stored as binary XLSX Canvas artifacts with a paired JSON source artifact in the same bundle. Canvas previews treat workbooks as downloadable files, while the source artifact preserves the structured workbook request for review, regeneration, or future editing workflows.

---

## CSV Document Workflow

PeakUI's `csv_document` tool turns structured row data into a downloadable `.csv` Canvas artifact.

## When to use it

- The user asks for a CSV export, spreadsheet extract, or structured dataset.
- You have rows/columns to return and want a real file instead of a markdown table.
- You need a quick interchange format for Excel, Sheets, or data pipelines.

## Tool shape

```json
{
  "name": "csv_document",
  "title": "Q2 Sales Export",
  "filename": "q2-sales.csv",
  "headers": ["Product", "Units", "Revenue"],
  "rows": [
    ["Widget A", 12, 1200],
    ["Widget B", 8, 800]
  ]
}
```

## Output

- A Canvas artifact with `kind: "data"` and `extension: "csv"`.
- MIME type `text/csv` for direct download.
- Rendered with proper CSV escaping and UTF-8 byte-order mark for Excel compatibility.
- Stored as UTF-8 text in the DB; downloads via `/api/canvas/artifacts/<id>/download` serve the CSV bytes verbatim. A backward-compat path detects older rows that were stored as base64 and decodes them on read.

## Safety notes

- The tool only produces data files; it never executes shell commands or writes to arbitrary filesystem paths.
- Large rows are still bounded by the request/response size limits enforced by the API.

---

## Email Document Workflow

PeakUI's `email_document` tool generates a downloadable `.eml` email draft from a subject, body, and optional metadata.

## When to use it

- The user asks to draft a formal email, outreach message, or reply.
- You want a real `.eml` file the user can open in their mail client and edit/send.
- Attachments are provided as existing Canvas artifact references.

## Tool shape

```json
{
  "name": "email_document",
  "title": "Project Kickoff",
  "filename": "project-kickoff.eml",
  "to": "team@example.com",
  "subject": "Project Kickoff - Next Steps",
  "body": "Hi team,\n\nHere are the next steps for the project...",
  "html": "<p>Hi team,</p><p>Here are the next steps...</p>"
}
```

## Output

- A Canvas artifact with MIME type `message/rfc822` and extension `.eml`.
- The `.eml` file is RFC-5322 compatible and includes a multipart/alternative HTML+plain-text body when both are provided.
- Optional attachments are referenced from existing Canvas artifacts.

## Safety notes

- The tool only generates draft files; it does not send email or connect to SMTP.
- Recipients and subjects are surfaced in the WorkSpaces approval modal.

---

## Markdown Document Workflow

PeakUI's `markdown_document` tool generates a downloadable `.md` Canvas artifact from a markdown body.

## When to use it

- The user asks for a Markdown file, `.md` export, or markdown version of content.
- You want the result to show up as a clickable Canvas artifact download link instead of an opaque filesystem path.
- The user wants to download or preview the markdown in the Canvas panel.

## Tool shape

```json
{
  "name": "markdown_document",
  "title": "Activity Blueprint",
  "filename": "activity-blueprint.md",
  "content": "# Activity Blueprint\n\n## Product Vision\n...",
  "description": "Create a downloadable Markdown version of the blueprint"
}
```

## Output

- A Canvas artifact with `kind: "markdown"`, `extension: "md"`, and `mimeType: "text/markdown"`.
- Download URL: `/api/canvas/artifacts/<id>/download`.
- The artifact is previewable in the Canvas panel and stored with revision history.

## Why not write to the workspace?

Writing markdown to `~/.peakui/workspace/...` returns a filesystem path that is not clickable in chat and is not tracked by Canvas. The `markdown_document` tool keeps generated documents in Canvas so they can be downloaded, previewed, versioned, and deleted like any other artifact.

---

## Slides Document Workflow

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

---

## Archive Document Workflow

PeakUI's `archive_document` tool bundles multiple artifacts/files into a single downloadable `.zip` Canvas artifact via `archiver`. Use it when the user asks to package, zip, or bundle multiple files together.

## When to use it

- The user asks to zip or bundle multiple files into one archive.
- You need to package generated artifacts (e.g. PDF + CSV + Markdown) into a single deliverable.
- The user wants a file that can be unpacked with any standard unzip tool.

Do not write zip files to disk via shell or the code sandbox when this tool is available — the result is a tracked Canvas artifact instead of an unmanaged file.

## Tool shape

```xml
<openclaw_tool name="archive_document">
{
  "title": "Q3 Bundle",
  "filename": "q3-bundle.zip",
  "entries": [
    { "name": "summary.md", "mimeType": "text/markdown", "content": "# Q3 Summary\n\nStrong quarter." },
    { "name": "notes.txt", "mimeType": "text/plain", "content": "Meeting notes from 9/30" },
    { "name": "logo.png", "mimeType": "image/png", "content": "iVBORw0KGgo..." }
  ],
  "description": "Bundle the most recent Q3 artifacts into a single ZIP"
}
</openclaw_tool>
```

## Fields

- `title` (required): Display title for the artifact.
- `entries` (required): Array of `{ name, mimeType?, content, sourceArtifactId? }` objects.
  - `name` (required): Filename inside the archive, including any subpath (e.g. `reports/summary.md`).
  - `mimeType` (optional): Used by the renderer to choose text vs binary handling. Text payloads (`text/*`, `application/json`, etc.) are stored as UTF-8; binary payloads are decoded from base64.
  - `content` (required): Either a UTF-8 string or a base64-encoded binary payload.
  - `sourceArtifactId` (optional): Link the entry back to a Canvas artifact whose content was reused, so the archive carries the lineage forward.
- `filename` (optional): Download filename. `.zip` is added when omitted.
- `description` (optional): Human-readable approval text.

Malformed entries (missing `name` or `content`) are dropped before rendering so the ZIP archive is always valid.

## Output

- A Canvas artifact with `kind: 'archive'` and `extension: 'zip'`.
- MIME type `application/zip`.
- The Canvas modal preview shows the archive title and entry list. The user downloads via the standard `/api/canvas/artifacts/<id>/download` link, which decodes base64 correctly.
- ZIP archives open in Finder, Explorer, Nautilus, `unzip`, and any standard archive utility.

## Safety notes

- The tool only produces an archive; it never executes shell commands or writes to arbitrary filesystem paths.
- Entries that would unpack outside their parent directory (zip-slip patterns) are rejected by the renderer.
- Entry count is bounded by the request/response size limits enforced by the API.

---

## Calendar Document Workflow

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

---

## Mermaid Document Workflow

PeakUI's `mermaid_document` tool renders a Mermaid diagram to a downloadable `.svg` (or `.png`) Canvas artifact. Use it whenever the user asks for a flowchart, sequence diagram, ER diagram, class diagram, state diagram, or any other Mermaid-rendered visualization.

## When to use it

- The user asks for a flowchart, sequence diagram, ER diagram, class diagram, state diagram, or "Mermaid" diagram.
- You have a graph or process you can express in Mermaid syntax.
- You want a real diagram that renders inline in Canvas and is downloadable as SVG (or PNG).

Do not write Mermaid source to a `.md` file when this tool is available — the rendered SVG is a tracked Canvas artifact that can be re-edited and re-rendered.

## Tool shape

```xml
<openclaw_tool name="mermaid_document">
{
  "title": "User Login Flow",
  "filename": "user-login-flow.svg",
  "diagram": "graph TD; A[User] --> B[Login Form]; B --> C{Valid?}; C -- Yes --> D[Dashboard]; C -- No --> B",
  "format": "svg",
  "theme": "default",
  "backgroundColor": "FFFFFF",
  "description": "Render a Mermaid diagram of the user login flow as SVG"
}
</openclaw_tool>
```

## Fields

- `title` (required): Display title for the artifact. Defaults to `Diagram` when omitted.
- `diagram` (required): Mermaid source. The renderer passes this through to `@mermaid-js/mermaid-cli`.
- `format` (optional): `svg` (default) or `png`.
- `theme` (optional): `default`, `dark`, `forest`, or `neutral`.
- `backgroundColor` (optional): Background color hex (`RRGGBB` or `#RRGGBB`). Defaults to white.
- `filename` (optional): Download filename. `.svg` or `.png` is appended based on `format` when omitted.
- `description` (optional): Human-readable approval text.

## How It Renders

1. The renderer writes the `.mmd` source to a temp directory.
2. It shells out to `@mermaid-js/mermaid-cli` (mmdc) with the system Chromium binary that ships in the container image (`/usr/bin/chromium-browser` via a Puppeteer config), so Puppeteer does not try to download its own Chromium at runtime.
3. mmdc produces an SVG (or PNG) of the rendered diagram.
4. The bytes are stored as a Canvas artifact with `kind: 'diagram-mermaid'` and `extension: 'svg`/`png` matched to the actual format.
5. A sibling `kind: 'data'` source artifact (`.mmd`) holds the original Mermaid source so the diagram can be re-rendered by editing the source.

## Output

- A Canvas artifact with `kind: 'diagram-mermaid'`.
- The Canvas modal preview uses the server-side preview endpoint, which returns the `.mmd` source. The modal lazy-loads Mermaid from the CDN and renders the diagram as a live SVG in place.
- Downloads go through `/api/canvas/artifacts/<id>/download` (which decodes base64 correctly) so the SVG opens cleanly in any browser.

## Fallback Behavior

If `mmdc` cannot launch (Chromium missing, network blocked, etc.), the renderer falls back to a labeled placeholder SVG that:

- Shows the diagram title in the title bar.
- Renders the raw `.mmd` source in a bordered panel labeled "Mermaid diagram source" so the user can still see the diagram code.
- Includes a "Re-render" hint in the description.

The placeholder is recognizable but never silently broken — it always renders the source, so the user can copy it into another renderer.

## Safety notes

- The tool only produces a diagram; it never executes shell commands or writes to arbitrary filesystem paths.
- Diagram size is bounded by the request/response size limits enforced by the API.

---

## Fetch and Summarize Workflow

PeakUI's `fetch_summarize` tool fetches a public web page and returns a concise, sourced summary.

## When to use it

- The user pastes or mentions a URL and asks what it says.
- You want a quick summary without invoking the full browser tool.
- The page is public and does not need interaction, forms, or JavaScript navigation.

## Tool shape

```json
{
  "name": "fetch_summarize",
  "url": "https://example.com/news-article",
  "description": "Summarize the article"
}
```

## Output

- `title`: The page title when available.
- `bullets`: A short list of key takeaways.
- `quote`: A representative direct quote or excerpt from the page.
- Source chips link back to the original URL.

## Safety notes

- Only public HTTP/HTTPS URLs are fetched.
- The same SSRF guardrails and content sanitization used by the browser stack apply.
- The tool does not execute browser interactions; use `browser` or `unified_browser` for dynamic pages.

---

## Tax PDF Workflow

PeakUI can create downloadable tax PDF artifacts from Knowledge Base documents through the WorkSpaces `tax_return` tool.

## What It Does

- Loads ready Knowledge Base documents from the enabled folder or the folder named in the tool request.
- Extracts obvious W-2, 1099, SSA-1099, taxpayer name, SSN, address, and income/withholding fields into a strict structured draft.
- Carries source citations for extracted fields and reports missing/uncertain fields.
- Generates a review PDF packet and stores it as a Canvas artifact.
- Optionally fills an uploaded fillable AcroForm PDF template and returns a filled PDF artifact.

## User Flow

1. Upload a folder of tax documents into Knowledge Base.
2. Wait until the documents show as indexed/ready.
3. Enable RAG for that folder in WorkSpaces.
4. Ask the AI to prepare a tax return PDF from the folder.
5. Approve the Tax PDF Generation Approval prompt.
6. Download the generated PDF card from the chat response.

For a fillable template, upload the PDF after this feature is deployed so PeakUI retains the original PDF bytes. Then ask the AI to fill that template. The current MVP fills AcroForm fields by best-effort field-name matching. XFA-only forms are detected but are not reliably fillable.

## Tool Contract

```xml
<openclaw_tool name="tax_return">
{"action":"generate_review_pdf","folder":"2025/taxes","taxYear":"2025","description":"Create a downloadable tax review PDF from the enabled Knowledge Base folder"}
</openclaw_tool>
```

Supported actions:

- `generate_review_pdf`: Creates a review packet from extracted tax data.
- `fill_pdf_form`: Fills an uploaded template PDF. Requires `templateDocumentId`.

Optional fields:

- `folder`: Knowledge Base folder path. If omitted, WorkSpaces uses the currently enabled RAG folder when available.
- `taxYear`: Tax year. If omitted, the extractor attempts to infer it.
- `templateDocumentId`: Knowledge Base document id for a fillable PDF template.
- `flatten`: When `true`, flattens the filled AcroForm output.

## Safety, Privacy, And Limits

- The generated packet is a **review aid only**, not an official filed return.
- PeakUI does **not** e-file, sign, submit, or validate returns with any tax authority.
- The extractor is deterministic and conservative; users must verify **every** value before filing.
- Tax documents contain sensitive personal information (SSN/TIN, address, income, withholding). Protect uploaded files, database backups, and host access accordingly.
- Original bytes are retained only for uploaded PDFs so fillable templates can be processed later.
- The initial extraction focuses on common W-2, 1099-NEC, 1099-INT, 1099-DIV, SSA-1099, SSN, name, address, and federal withholding fields.
- Always consult a qualified tax professional for filing decisions.