# PDF Document Workflow

PeakUI can create downloadable PDF artifacts from WorkSpaces through the generic `pdf_document` tool. This is the default path for ordinary PDF requests and is intentionally separate from domain-specific tools such as `tax_return`.

## What It Does

- Accepts a title, filename, and either markdown-like content or structured sections, fields, tables, and callouts from the assistant.
- Renders a polished server-side PDF with pagination, headings, bullets, tables, label/value fields, callouts, and footer text.
- Stores the generated PDF as a Canvas artifact tied to the current WorkSpaces session.
- Stores a sibling `.source.json` Canvas artifact in the same bundle so the source contract can be inspected or regenerated later.
- Returns a secure `/api/canvas/artifacts/<id>/download` URL that appears in chat as a download button.

## When To Use It

Use `pdf_document` when the user asks the AI to create, generate, produce, or return a downloadable PDF for a general-purpose document, report, summary, checklist, sample form, letter, or draft.

Do not use shell, filesystem, or the code sandbox for normal PDF generation unless the user explicitly asks to write source code or save files in a workspace path.

## Tool Contract

```xml
<openclaw_tool name="pdf_document">
{"title":"Project Report","filename":"project-report.pdf","template":"report","subtitle":"Prepared by PeakUI","sections":[{"heading":"Executive Summary","body":"This PDF uses structured sections instead of plain markdown."},{"heading":"Next Steps","bullets":["Review the draft","Download the PDF","Request revisions if needed"]}],"tables":[{"title":"Budget","columns":["Item","Amount"],"rows":[{"Item":"Hosting","Amount":"$299"},{"Item":"Support","Amount":"$500"}]}],"description":"Create a polished downloadable project report PDF"}
</openclaw_tool>
```

Required fields:

- `title`: Display title rendered at the top of the PDF.
- At least one renderable body source: `content`, `sections`, `fields`, `tables`, or `callouts`.

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
