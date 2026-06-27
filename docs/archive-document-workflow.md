# Archive Document Workflow

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