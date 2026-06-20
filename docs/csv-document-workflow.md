# CSV Document Workflow

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

## Safety notes

- The tool only produces data files; it never executes shell commands or writes to arbitrary filesystem paths.
- Large rows are still bounded by the request/response size limits enforced by the API.
