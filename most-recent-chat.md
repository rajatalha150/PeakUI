# Most Recent Chat — PeakUI Document Generation Issue

> Transcript showing the current behavior when requesting a document from PeakUI WorkSpaces.

---

## Turn 1 — User asks for the chat as a document

**User:**

> this is the most recent chat : turn this into word doc or .md file and return it

---

## Turn 2 — Assistant generates a Word document (correct behavior)

**Assistant:**

The Word document has been generated successfully.

- **File:** `activity-blueprint.docx` (17.7 KB)
- **Download:** `/api/canvas/artifacts/315a3c70-f7dc-4e15-a4cb-fd1df28e672b/download`

The document contains all 54 sections organized into logical parts — product vision, user stories, architecture, Firestore data model, security rules, Cloud Functions, CI/CD, testing strategy, roadmap, cost estimates, and risk assessment. Ready for handoff to senior engineers.

*Metadata:* `response.txt`, 88.9 tok/s, 166 tokens, 1.87s  
*Actions:* Copy message · Branch from here

---

## Turn 3 — User reports only seeing data files in Canvas

**User:**

> i only see data files

---

## Turn 4 — Assistant writes Markdown to workspace path (problematic behavior)

**Assistant:**

The full blueprint has been written to your workspace as a Markdown file.

- **File:** `activity-blueprint.md`
- **Path:** `/tmp/peakui-openclaw-workspace/users/e01b70cf-32ee-4b2f-9fcc-5566f3e670c6/workspaces/default/activity-blueprint.md`
- **Size:** 33,176 bytes — all 54 sections included.

You can open it directly in any text editor or Markdown viewer. If you need it in a different format (PDF, another Word attempt, etc.), let me know.

*Metadata:* `response.txt`, 87.2 tok/s, 165 tokens, 1.89s  
*Timings:* Prep 0.03s · Headers 1.04s · First text 1.24s  
*Actions:* Copy message · Branch from here

---

## Problem Summary

When the user asked for a Markdown version of the document, the assistant wrote the file to the managed workspace path instead of creating a Canvas artifact. The returned filesystem path is **not clickable** in the chat UI, unlike the Word document download link (`/api/canvas/artifacts/<id>/download`) which is a proper artifact URL.

## Expected Behavior

Markdown files requested through WorkSpaces should be created as Canvas artifacts and returned with a clickable download link, just like PDF, Word, Excel, CSV, and Email artifacts.

## Proposed Fix

Add a `markdown_document` native tool that:

1. Accepts a title, filename, and markdown body.
2. Creates a Canvas artifact with `mimeType: 'text/markdown'` and `extension: 'md'`.
3. Returns the artifact download URL `/api/canvas/artifacts/<id>/download`.
4. Registers the capability in the WorkSpaces capability inventory and prompt so the model chooses it instead of writing to the filesystem.
