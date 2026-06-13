# PDF Document Workflow

PeakUI can create downloadable PDF artifacts from WorkSpaces through the generic `pdf_document` tool. This is the default path for ordinary PDF requests and is intentionally separate from domain-specific tools such as `tax_return`.

## What It Does

- Accepts a title, filename, and markdown-like document content from the assistant.
- Renders a server-side PDF with pagination, headings, bullets, and footer text.
- Stores the generated PDF as a Canvas artifact tied to the current WorkSpaces session.
- Returns a secure `/api/canvas/artifacts/<id>/download` URL that appears in chat as a download button.

## When To Use It

Use `pdf_document` when the user asks the AI to create, generate, produce, or return a downloadable PDF for a general-purpose document, report, summary, checklist, sample form, letter, or draft.

Do not use shell, filesystem, or the code sandbox for normal PDF generation unless the user explicitly asks to write source code or save files in a workspace path.

## Tool Contract

```xml
<openclaw_tool name="pdf_document">
{"title":"Project Report","filename":"project-report.pdf","content":"# Project Report\n\nThis is the generated PDF content.\n\n- Item one\n- Item two","description":"Create a downloadable project report PDF"}
</openclaw_tool>
```

Required fields:

- `title`: Display title rendered at the top of the PDF.
- `content`: Markdown-like text to render into the PDF.

Optional fields:

- `filename`: Download filename. `.pdf` is added when omitted.
- `description`: Human-readable approval text.

## Relationship To Specialized Services

Specialized workflows can use their own tools when they need structured extraction, validation, or form filling. For example, `tax_return` reads Knowledge Base tax documents, extracts a review draft, and can fill uploaded AcroForm PDFs.

Both generic and specialized PDF tools store their output through the same Canvas artifact pipeline so chat downloads behave consistently.
