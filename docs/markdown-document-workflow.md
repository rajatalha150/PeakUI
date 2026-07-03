# Markdown Document Workflow

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
