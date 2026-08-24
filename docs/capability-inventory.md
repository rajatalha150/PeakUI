# WorkSpaces Capability Inventory

PeakUI uses a local WorkSpaces capability inventory to describe which tools the AI can use, when to use them, and what safety boundaries apply.

## Why It Exists

Tool guidance used to be written directly into the WorkSpaces prompt. As PeakUI adds more services, that becomes hard to maintain and easy for the AI to miss. The capability inventory defines reusable abilities in one place, then renders the relevant guidance into the prompt.

## Current Native Capabilities

- `pdf_document`: Creates downloadable PDF Canvas artifacts. Source-editable. A title alone (optionally with a `description`) is sufficient; the full structure (sections, fields, tables, callouts) is a strong recommendation, not a requirement — and when provided, renders as a themed, per-template professional PDF.
- `word_document`: Creates downloadable Word DOCX Canvas artifacts. Source-editable. A title alone (optionally with a `description`) is sufficient; the full structure (content, sections, fields, tables, callouts) is a strong recommendation, not a requirement.
- `workbook_document`: Creates downloadable Excel XLSX Canvas artifacts. Source-editable. A title alone (optionally with a `description`) is sufficient; the full structure (sheets, typed columns, totals) is a strong recommendation, not a requirement — a Notes sheet is synthesized when no sheet has rows.
- `csv_document`: Creates downloadable CSV Canvas artifacts. A title alone (optionally with a `description`) is sufficient; the full structure (headers, rows, raw content) is a strong recommendation, not a requirement — the description becomes the body when no data is supplied.
- `email_document`: Creates downloadable `.eml` email draft Canvas artifacts. A title alone (optionally with a `description`) is sufficient; the full structure (to, from, subject, body) is a strong recommendation, not a requirement — the subject and body are derived from the title/description when missing.
- `markdown_document`: Creates downloadable Markdown `.md` Canvas artifacts. Source-editable. A title alone (optionally with a `description`) is sufficient; the full structure is a strong recommendation, not a requirement — the description becomes the body (or a title heading is used) when no content is supplied.
- `slides_document`: Creates downloadable PowerPoint `.pptx` Canvas artifacts.
- `archive_document`: Creates downloadable `.zip` Canvas artifacts.
- `calendar_document`: Creates downloadable `.ics` calendar artifacts.
- `mermaid_document`: Renders Mermaid diagrams to `.svg` or `.png`.
- `fetch_summarize`: Fetches a public web page and returns a concise summary.
- `tax_return`: Creates tax review PDFs from Knowledge Base documents.

For full tool contracts, payloads, and examples, see [WorkSpaces Tool Workflows](tool-workflows.md).

## Tool Payload Validation

Each document-generation tool runs its parsed payload through a normalization step that drops malformed entries before rendering:

- `workbook_document`: unsupported `template` values are stripped.
- `archive_document`: entries without a `name` or `content` are filtered out.
- `calendar_document`: events without a `start` are filtered out.
- `mermaid_document`: an empty `diagram` rejects the request.

## Tool Dispatch

All registered tool names are enumerated in `WORKSPACE_TOOL_NAMES` in `src/lib/workspace-tool-tools.ts`. The parser regex, tag stripper, and client-side name normalizer are derived from that list, so adding a new tool is a one-line array change plus a parser branch.

## Adapter Types

- `native`: Built into PeakUI and executed through app-owned API routes.
- `http`: Controlled internal or trusted service APIs.
- `mcp`: Curated MCP server/tool mappings that can be enabled after review.

## MCP Direction

MCP will be implemented as a curated extension path to help the AI learn and use new skills over time. PeakUI should only expose MCP-backed capabilities after they have an approval model, privacy notes, clear tool descriptions, and auditability consistent with native WorkSpaces tools.
