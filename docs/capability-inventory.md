# WorkSpaces Capability Inventory

PeakUI uses a local WorkSpaces capability inventory to describe which tools the AI can use, when to use them, and what safety boundaries apply.

## Why It Exists

Tool guidance used to be written directly into the WorkSpaces prompt. As PeakUI adds more services, that becomes hard to maintain and easy for the AI to miss. The capability inventory defines reusable abilities such as PDF generation, Excel workbook generation, Word document generation, and tax PDF generation in one place, then renders the relevant guidance into the prompt.

This makes it easier for the AI to choose the right tool for day-to-day requests without falling back to shell, filesystem, or code sandbox when a safer app-native tool exists.

## Current Native Capabilities

- `pdf_document`: Creates downloadable PDF Canvas artifacts for reports, memos, letters, checklists, invoices, forms, and general document drafts.
- `workbook_document`: Creates downloadable Excel XLSX Canvas artifacts for spreadsheets, budgets, invoice workbooks, timesheets, ledgers, trackers, inventories, schedules, and multi-sheet analysis.
- `word_document`: Creates downloadable Word DOCX Canvas artifacts for proposals, contracts, resumes, letters, memos, reports, policies, checklists, and form-style business documents.
- `tax_return`: Creates tax review PDFs and can fill uploaded AcroForm PDF templates from Knowledge Base tax documents.

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
