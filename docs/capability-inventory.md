# WorkSpaces Capability Inventory

PeakUI uses a local WorkSpaces capability inventory to describe which tools the AI can use, when to use them, and what safety boundaries apply.

## Why It Exists

Tool guidance used to be written directly into the WorkSpaces prompt. As PeakUI adds more services, that becomes hard to maintain and easy for the AI to miss. The capability inventory defines reusable abilities such as PDF generation, Excel workbook generation, Word document generation, and tax PDF generation in one place, then renders the relevant guidance into the prompt.

This makes it easier for the AI to choose the right tool for day-to-day requests without falling back to shell, filesystem, or code sandbox when a safer app-native tool exists.

## Current Native Capabilities

- `pdf_document`: Creates downloadable PDF Canvas artifacts for reports, memos, letters, checklists, invoices, forms, and general document drafts. Source-editable.
- `workbook_document`: Creates downloadable Excel XLSX Canvas artifacts for spreadsheets, budgets, invoice workbooks, timesheets, ledgers, trackers, inventories, schedules, and multi-sheet analysis. Source-editable.
- `word_document`: Creates downloadable Word DOCX Canvas artifacts for proposals, contracts, resumes, letters, memos, reports, policies, checklists, meeting notes, and form-style business documents. Source-editable.
- `csv_document`: Creates downloadable CSV Canvas artifacts from structured row data for exports, reports, datasets, and quick spreadsheet interchange.
- `email_document`: Creates downloadable `.eml` email draft Canvas artifacts with a subject, body, HTML styling, and optional attachments. Source-editable.
- `markdown_document`: Creates downloadable Markdown `.md` Canvas artifacts from a full markdown body. Returns a clickable `/api/canvas/artifacts/<id>/download` link instead of a filesystem path. Source-editable.
- `slides_document`: Creates downloadable PowerPoint `.pptx` Canvas artifacts via `pptxgenjs`. Layouts include `title`, `section`, `content`, `bullets`, `two-column`, `quote`, and `closing`. Source-editable.
- `archive_document`: Creates downloadable `.zip` Canvas artifacts via `archiver`. Each entry can be raw text or a base64-encoded binary payload.
- `calendar_document`: Creates downloadable `.ics` Canvas artifacts via the `ics` package. Each event carries `uid`, `title`, `description`, `location`, `start`, `end`, `organizer`, and `attendees`; opens in macOS Calendar, Outlook, and Google Calendar.
- `mermaid_document`: Renders a Mermaid diagram to `.svg` (default) or `.png` via `@mermaid-js/mermaid-cli` using the system Chromium bundled in the container. The artifact also carries the `.mmd` source so it remains re-editable and re-renderable.
- `fetch_summarize`: Fetches a public web page and returns a concise summary with title, bullets, and a representative quote. Returns HTTP 502 on upstream failure (instead of HTTP 200 with `success: false`).
- `tax_return`: Creates tax review PDFs and can fill uploaded AcroForm PDF templates from Knowledge Base tax documents. The filled artifact records the template `Document` as its source for lineage.

## Tool Payload Validation

Each document-generation tool runs its parsed payload through a normalization step that drops malformed entries before rendering. Common rules:

- `workbook_document`: `template` is validated against the renderer-supported union; invalid values are stripped rather than passed through.
- `archive_document`: entries without a `name` or `content` are filtered out.
- `calendar_document`: events without a `start` are filtered out.
- `mermaid_document`: an empty `diagram` rejects the request.

## Tool Dispatch

All registered tool names are enumerated in a single `OPENCLAW_TOOL_NAMES` constant in `src/lib/openclaw-tools.ts`. The tool-block parser regex, the `stripAllToolTags` regex, and the client-side `normalizeExtractedToolRequestName` helper are derived from that list, so adding a new tool is a one-line change in the array plus a parser branch. The system prompt also opens with an explicit tool-call format primer so the model always emits the `<openclaw_tool name="...">...</openclaw_tool>` wrapper.

## Tool-Call Recovery Loop

When the model fails to emit a valid `<openclaw_tool>` wrapper (malformed JSON, incomplete wrapper, or narration like "I'll rebuild the deck..." without a wrapper), the chat runtime nudges the model up to **2 times** to retry. If both nudges fail, the runtime surfaces a visible pause notice naming the inferred tool (e.g. "It looked like you wanted to run slide deck generator (slides_document)"), the last artifact filename, the last description, and a short snippet of the model's last attempt — so the user can reply "continue" or rephrase without confusion. The narration-case nudge includes a short, tool-aware placeholder example (using `<placeholder>` markers, never real content) so the model has a concrete shape to mirror; the malformed-wrapper case intentionally does NOT include a wrapper example to prevent the model from pattern-matching on the example and repeating the failure. See `OpenClawWorkspace.tsx` for the loop (`missingToolNudgeCount`, `lastSuccessfulDocumentTool`, `buildRecoveryWrapperExample`) and `src/lib/openclaw-tools.ts` for the parser.

## MCP Direction

MCP will be implemented as a curated extension path to help the AI learn and use new skills over time. The intended role is an inventory of approved day-to-day services, not arbitrary unreviewed tool execution.

Examples of future MCP-backed skills:

- Document conversion and template rendering for PDF, Word, and spreadsheet files.
- PDF manipulation such as merge, split, watermark, encrypt, and form inspection.
- Spreadsheet and invoice workflows.
- Business document templates such as contracts, receipts, certificates, and letters.

PeakUI should only expose MCP-backed capabilities after they have an approval model, privacy notes, clear tool descriptions, and auditability consistent with native WorkSpaces tools.

## Adapter Types

- `native`: Built into PeakUI and executed through app-owned API routes.
- `http`: Controlled internal or trusted service APIs.
- `mcp`: Curated MCP server/tool mappings that can be enabled after review.

The current implementation advertises native capabilities and documents MCP as future inventory-backed functionality.
