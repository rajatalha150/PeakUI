# RAG TODO

This file tracks the next pass on the Knowledge Base / RAG stack.

## Done

- [x] Retrieval contract: tell models that KB context is retrieved excerpts, not full files
- [x] Source metadata: include file kind, extension, file size, and excerpt length in retrieved sources
- [x] Full-file drill-down: let the model request a broader lookup or direct file inspection when a snippet is not enough
- [x] Source filtering: let users and the model narrow by file, type, or folder
- [x] Better citations: surface which document/chunk a claim came from
- [x] File coverage: improve PDF, DOCX, PPTX, XLSX, ODT, ODS, CSV, JSON, YAML, XML, and code-file parsing
- [x] OCR: make scanned PDFs and image-based documents searchable
- [x] Archive ingestion: unpack zip/tar/7z-style bundles and index their contents
- [x] Incremental reindexing: update changed files without manual delete/reupload loops
- [x] RAG health UI: show what indexed successfully, what failed, and why
- [x] Retrieval evaluation: add regression tests for recall, grounding, and file-type coverage
- [x] Full-file mode: allow small files to be indexed or retrieved as whole-document context when safe
