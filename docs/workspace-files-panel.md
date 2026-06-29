# Workspace Files Panel

The Workspace Files panel is PeakUI WorkSpaces's native GUI over the same
on-disk state the model's filesystem, shell, and code tools write to. It runs
in the right rail of the active workspace, mirrors the workspace's directory
tree, supports read / write / upload / delete / rename / move, multi-select
bulk ops, ETag-aware in-place editing, and live updates whenever the model
or another browser tab mutates the workspace.

This document covers the panel's UI surface, its API, the event stream that
keeps it live, and the sandbox that keeps writes inside the workspace.

## Phase History

| Phase | What landed |
|---|---|
| 1 | Panel skeleton + sidebar entry; depth-limited listing via `GET /files`; ETag-aware raw reads via `GET /files/raw`; in-process pub/sub (`workspace-files-pubsub.ts`) wired but no consumer yet |
| 2 | Virtualized tree (`WorkspaceFileTree.tsx`); lazy-load on expand; type-dispatched preview router (`WorkspaceFilePreview.tsx`) for markdown / code (Prism via `LazySyntaxHighlighter`) / JSON (pretty-printed) / CSV / images (base64 data URL + zoom toggle) / PDF (iframe) / binaries (download-only) |
| Layout polish | Explorer-style navigation; full-size preview modal (`WorkspaceFilePreviewModal`) mirroring the Canvas `ArtifactPreviewModal` pattern; breadcrumb + `← Back` step-up |
| 3 | In-place text editor (`WorkspaceFileEditor.tsx`) with line numbers, dirty dot, `Cmd/Ctrl+S`; `If-Match: <etag>` conflict detection; 412 surfaces a non-destructive banner with **Reload**, **Overwrite**, **Save as copy** actions |
| 4 | Drag-and-drop or click-to-pick upload (`WorkspaceFileUpload.tsx`) — 50 MB per file, 100 files per request; single-file download with RFC 5987 UTF-8 filenames; `WorkspaceConfirmDialog.tsx` (Esc/Enter keybindings, click-outside-to-cancel, destructive variant) shared by every confirm flow |
| 5 | Multi-select + bulk ops; shift-range selection, `Cmd/Ctrl+click` toggle, plain-click toggle-to-deselect, document-level `Cmd/Ctrl+A`; bulk copy paths, bulk zip download (500 MB / 500 files), bulk delete (recursive when any entry is a directory) |
| 6 | Right-click context menu (Open / Rename / Copy path / Download / Move to / Delete); F2 in-place rename; `WorkspaceMoveDialog.tsx` reuses the tree in a directories-only mode to pick the destination |
| 7 | Live updates via `GET /events` SSE stream; debounced (150 ms) refetch of cwd + every expanded subdirectory on `tree.invalidated`, the parent on `file.created` / `file.modified` / `file.deleted`, and the active file so the editor's ETag stays fresh; client reconnects with jittered exponential backoff (500 ms → 5 s) |

## UI Surface

```
┌─ Workspace Files (header)  [collapse] [upload] [new folder] ─┐
│ /skills/release-checklist.md           [← Back] [breadcrumb] │
│ N folders, M files                                       [+ ↑] │
├──────────────────────────────────────────────────────────────┤
│ ▸ skills/                                                  3 │
│ ▸ docs/                                                    2 │
│ 📄 BOOT.md                                          1.2 KB  │
│ 📄 TOOLS.md                                        2.0 KB  │
│ ...                                                          │
├──────────────────────────────────────────────────────────────┤
│ N selected · [Copy paths] [Download zip] [Delete] [Clear]   │  ← selection toolbar
└──────────────────────────────────────────────────────────────┘
```

**Right-click a row** to open the context menu. **F2** on a focused row
enters rename mode (Enter commits, Esc / blur cancels). **Cmd/Ctrl+click**
toggles selection. **Shift+click** ranges from the selection anchor.
**Cmd/Ctrl+A** (while focus is in the panel) selects every visible row.

The preview modal opens in full size (`min(1100px, 96vw)` × `88vh`) with a
blurred backdrop and an Edit / Preview toggle for text-eligible files.

## API Reference

All routes are namespaced under `/api/openclaw/workspaces/[id]` and inherit
the `openclaw.use` + `openclaw.filesystem` permission gate. Paths are
**always workspace-relative** (forward slashes, no leading slash, no `..`).

### `GET /files?path=…&depth=…`

Lists a directory.

| Param | Default | Notes |
|---|---|---|
| `path` | `''` (root) | Workspace-relative directory |
| `depth` | `1` | How many levels to recurse (cap: server-defined) |

Response shape: `WorkspaceTreeResponse` (`workspace`, `path`, `entries[]`,
`truncated`).

### `GET /files/raw?path=…`  · `If-Match: <etag>`

Reads one file. Returns `WorkspaceFileContent` (`path`, `encoding`,
`content`, `size`, `modifiedAt`, `mimeType?`, `etag`). `If-Match` is optional;
when supplied, the server returns 412 if the file changed on disk.

### `POST /files`

Writes or creates a file (or creates a directory).

```jsonc
{
  "action": "write",            // or "mkdir"
  "path": "skills/release.md",
  "content": "# Release…",
  "createDirectories": true     // optional, mkdir ancestors as needed
}
```

Pass `If-Match: <etag>` for optimistic concurrency. On 412 the response body
includes `currentEtag` so the editor can rebase the buffer.

### `PATCH /files`

Rename or move one path.

```jsonc
{
  "action": "rename",   // or "move"
  "from": "release.md",
  "to":   "release-v2.md"
}
```

### `DELETE /files?path=…&recursive=true`

Delete one path. `recursive=true` is required to delete a non-empty
directory.

### `POST /files/upload`  · `multipart/form-data`

Upload one or more files.

| Field | Notes |
|---|---|
| `paths` | JSON-encoded array of workspace-relative paths, one per `files` entry (same order) |
| `files` | One or more binary parts |

Limits: **50 MB per file**, **100 files per request**.

### `POST /files/zip`

Bundle multiple paths into one zip.

```jsonc
{ "paths": ["a.md", "docs/b.md"] }
```

Returns `application/zip` streamed through `archiver`. Limits:
**500 files per archive**, **500 MB total uncompressed**.

### `GET /files/download?path=…`

Stream a single file with a RFC 5987 UTF-8 filename header.

### `GET /events`  · SSE

Server-Sent Events stream. Wire format is the standard
`data: <json>\n\n` per event, with `: keepalive\n\n` heartbeat comments
every 25 s. Response headers include `Content-Type: text/event-stream`,
`Cache-Control: no-store, no-transform`, `Connection: keep-alive`, and
`X-Accel-Buffering: no` (nginx compat).

Events:

| Kind | Payload | When |
|---|---|---|
| `tree.invalidated` | `{}` (no path) | Bulk change: any directory may have new entries |
| `file.created` | `{ path }` | A new file appeared at `path` |
| `file.modified` | `{ path }` | `path` changed (size / mtime) |
| `file.deleted` | `{ path }` | `path` was removed |

The pub/sub is in-process and single-process. If PeakUI ever runs multiple
Node processes behind a load balancer, swap `workspace-files-pubsub.ts` for
Redis pub/sub or Postgres `LISTEN/NOTIFY` — the publish/subscribe API surface
stays the same.

## Sandbox and Security

- **Per-user, per-workspace path.** Writes are confined to
  `/mnt/openclaw/workspace/users/<userId>/workspaces/<slug>/` inside the
  container. The server resolves and rejects any path that escapes it
  (absolute paths, `..` segments, symlinks outside the workspace).
- **Permission gate.** Every route requires `openclaw.use` and
  `openclaw.filesystem`. The host executor's `OPENCLAW_*` allowlists do **not**
  apply here — this panel is its own self-contained sandbox.
- **Limits.** 50 MB per upload, 100 files per request, 500 files per zip,
  500 MB per zip, depth-limited listings, and ETag-aware writes.
- **Audit.** Every successful mutation publishes a `WorkspaceEvent` so other
  connected clients can react.

## AI Integration

When a workspace is selected, the chat system prompt gains a
`WORKSPACE FILES GUI PANEL` block that tells the model:

- The panel exists in the sidebar and lists files in the active workspace.
- Any write / edit / rename / delete through the filesystem, shell, or code
  tools appears in the panel live.
- Paths in the panel are workspace-relative — refer to files by
  `skills/release-checklist.md`, not by an absolute container path.
- The panel is a viewer over the same on-disk state the tools write to —
  it is not a separate copy.

New workspaces also get a `## GUI Panel Awareness` block in `BOOT.md` and a
`## File Editing Surfaces` block in `TOOLS.md`. Existing workspaces do **not**
receive these blocks automatically — the system prompt is sufficient and
covers all workspaces regardless of age.

## Client Library

Browser code interacts with the panel via `src/lib/workspace-files-client.ts`:

| Function | Use |
|---|---|
| `listWorkspaceTree(workspaceId, { path, depth })` | Read a directory |
| `readWorkspaceFile(workspaceId, path, ifMatch?)` | Read one file |
| `writeWorkspaceFile(workspaceId, req, ifMatch?)` | Write or mkdir |
| `renameWorkspacePath(workspaceId, { action, from, to })` | Rename / move |
| `deleteWorkspacePath(workspaceId, path, recursive?)` | Delete |
| `uploadWorkspaceFiles(workspaceId, files)` | Multipart upload |
| `downloadWorkspaceFile(workspaceId, path)` | Stream one file |
| `downloadWorkspaceZip(workspaceId, paths)` | Bulk zip |
| `subscribeWorkspaceEvents(workspaceId, onEvent, onError?)` | SSE with reconnect-with-backoff |

Every method throws a structured `WorkspaceFilesError` (`status`, `code`,
`actionRequired?`, `currentEtag?`) on non-2xx responses so the UI can
surface a real reason instead of guessing.

## Component Map

| File | Responsibility |
|---|---|
| `WorkspaceFilesPanel.tsx` | The panel itself: state, SSE subscription, debounced refetch, context-menu / rename / move wiring |
| `workspace-files/WorkspaceFileTree.tsx` | Virtualized tree with `selectableKinds`, in-place rename, F2, context-menu, expansion |
| `workspace-files/WorkspaceBreadcrumb.tsx` | The `a/b/c` breadcrumb + `← Back` step-up button |
| `workspace-files/WorkspaceFilePreview.tsx` | Type-dispatched preview router |
| `workspace-files/WorkspaceFileEditor.tsx` | Line-numbered editor with `Cmd/Ctrl+S`, dirty dot, ETag conflict banner |
| `workspace-files/WorkspaceFileUpload.tsx` | Drag-and-drop / click-to-pick upload |
| `workspace-files/WorkspaceFileContextMenu.tsx` | Right-click menu |
| `workspace-files/WorkspaceMoveDialog.tsx` | Move-to dialog (directories-only tree picker) |
| `workspace-files/WorkspaceConfirmDialog.tsx` | Shared confirm modal (Esc/Enter, destructive variant) |
| `workspace-files/file-display.ts` | Path / size / mime classification helpers |
| `workspace-files-types.ts` | Shared types: `WorkspaceFileEntry`, `WorkspaceFileContent`, `WorkspaceEvent`, etc. |
| `workspace-files-pubsub.ts` | In-process publish/subscribe |
| `workspace-files-events-encoder.ts` | SSE wire-format helpers (encoder + parser + keepalive bytes) |

## Testing

- `workspace-files-client.test.ts` — every public function is exercised
  with a mocked `fetch`, including a reconnect-with-backoff assertion for
  the SSE consumer.
- `workspace-files-pubsub.test.ts` — pub/sub semantics.
- `workspace-files-events-encoder.test.ts` — wire-format round-trip:
  encode → parse → re-encode yields identical bytes; partial chunk buffering;
  malformed payload skip; keepalive comment skip.
- `WorkspaceFileTree.test.tsx` — `flattenTreeRows` cases.
- `file-display.test.ts` — `joinPath`, `parentPath`, `extensionOf`,
  `humanFileSize`, `classifyFile`, `isEditableFile`.

All 283 tests across 36 files pass after every phase commit.