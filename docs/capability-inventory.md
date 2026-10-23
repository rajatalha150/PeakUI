# WorkSpaces Capability Inventory

PeakUI uses a local WorkSpaces capability inventory to describe which tools the AI can use, when to use them, and what safety boundaries apply.

## Why It Exists

Tool guidance used to be written directly into the WorkSpaces prompt. As PeakUI adds more services, that becomes hard to maintain and easy for the AI to miss. The capability inventory defines reusable abilities in one place, then renders the relevant guidance into the prompt.

## Current Native Capabilities

- `pdf_document`: Creates downloadable PDF Canvas artifacts. Source-editable. The request must contain meaningful prose or structured sections, fields, tables, or callouts; title-only and recovery-placeholder payloads are rejected. Structured input renders as a themed, per-template professional PDF.
- `word_document`: Creates downloadable Word DOCX Canvas artifacts. Source-editable. The request must contain meaningful content or structured sections, fields, tables, or callouts; title-only and recovery-placeholder payloads are rejected.
- `workbook_document`: Creates downloadable Excel XLSX Canvas artifacts. Source-editable. The request must contain real sheet rows and columns; title-only and recovery-placeholder payloads are rejected.
- `csv_document`: Creates downloadable CSV Canvas artifacts. The request must contain real headers and rows or raw CSV content; title-only and recovery-placeholder payloads are rejected.
- `email_document`: Creates downloadable `.eml` email draft Canvas artifacts. A real subject and body are required; title-only and recovery-placeholder drafts are rejected.
- `markdown_document`: Creates downloadable Markdown `.md` Canvas artifacts. Source-editable. A full Markdown body is required; title-only and recovery-placeholder requests are rejected.
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

The parser accepts the custom `<workspace_tool>` wrapper **and** the native tool-call syntax of Qwen, Gemma, Llama, Mistral, GLM, and Anthropic-style models, normalizing them all to the same request shape. See [Tool-Call Formats](tool-call-formats.md) for the full reference.

## Adapter Types

- `native`: Built into PeakUI and executed through app-owned API routes.
- `http`: Controlled internal or trusted service APIs.
- `mcp`: Curated MCP server/tool mappings that can be enabled after review.

## MCP Direction

MCP will be implemented as a curated extension path to help the AI learn and use new skills over time. PeakUI should only expose MCP-backed capabilities after they have an approval model, privacy notes, clear tool descriptions, and auditability consistent with native WorkSpaces tools.
