# Workspace context (auto-loaded every session)

This file is the single source of truth for how this workspace is laid out and
how to verify it. Read it before starting work so you do not re-derive these
facts from scratch every turn.

## Where projects live

You work against the persistent workspace volumes mounted into this container:

- `/workspace` — the primary project directory (default session cwd).
- `/apps` — a second project directory for separate apps/projects.

Both are mounted volumes, so the files you create or edit here survive
container restarts and redeploys. When the user points you at a different
workspace path (the session cwd can change in the Coding Settings drawer), trust
that path — it is the project you are being asked to work in.

## Discover the layout before you assume it

Do NOT assume a fixed project layout. The contents of `/workspace` and `/apps`
are user-owned and change over time, so at the start of each task:

1. List the workspace root (and any subdirectory the user names) to see what is
   actually there.
2. Read each project's own `README`, `package.json` (or equivalent manifest), and
   its docs before relying on guessed commands or conventions.
3. Prefer each project's declared scripts (`npm run …`, `make …`, etc.) over
   re-inventing build/test steps. If a project has no manifest or README, say so
   and fall back to the obvious defaults for its language rather than asserting
   a command that may not exist.

## How to verify work

- Prefer the project's own test/build commands from its `package.json` or
  equivalent manifest (`npm test`, `npm run typecheck`, `npm run build`,
  `pytest`, `go test`, `cargo test`, …).
- A passing test/typecheck/build is the evidence of record — report the command
  you ran and its output, don't just claim "it works".
- If a project has no tests, verify it by running it (or, for static output, the
  browser check below) and report the observable result.

## Browser verification (real UI checks)

A committed harness lives at `/opt/qwen-code/browser/verify-site.mjs` (source in
`scripts/coder-browser/`). Both Chrome builds and the runtime libs are baked
into the image, so this works on a fresh VM with no downloads.

- `node /opt/qwen-code/browser/verify-site.mjs <path-to-static-site>` serves the
  site on a loopback port, drives it with headless Chrome, prints a JSON report
  (title/h1/landmarks/errors) and writes `/tmp/verify-light.png` + dark.
- Run it from `/opt/qwen-code/browser` (ESM resolves `puppeteer` relative to
  the script's own location, not the cwd). Both `chrome-headless-shell` and the
  full `chrome` build are installed under `/opt/puppeteer-cache`.
- The main model IS vision-capable (it carries the `vision` capability), and a
  separate `visionModel` is also configured via the daemon for image
  transcription. Screenshots CAN be seen: write one to `/tmp/*.png` and read it
  with `read_file`, or rely on the daemon's vision bridge. Do NOT claim "no
  vision model" or "no browser" — both are present and working on this image.

## Model orchestration (main / vision / writer)

This workspace may be configured with a three-model split, chosen in the Coding
Settings drawer:

- **Main** — you (the planning/execution model).
- **Vision** — a separate image-capable model used automatically by the
  daemon's vision bridge whenever you receive an image. No action needed on
  your part.
- **Writer** — a dedicated subagent named `peakui-writer` (via the Agent tool,
  `subagent_type: "peakui-writer"`), pinned to a different model and restricted
  to read/write/edit/search/shell.

**When a writer subagent is available, delegate code/file authoring to it**: use
the Agent tool with `subagent_type: "peakui-writer"` to write or edit files
rather than calling `write_file`/`edit` yourself. Give it precise instructions
(the exact files, paths, and content), then review its reported files and fix
anything it got wrong yourself.

This is the DEFAULT, not an exception: for any task that creates or edits one
or more files (including whole projects), delegate the writing to
`peakui-writer`. Only after the agent reports back should you review, and use
`edit`/`write_file` yourself ONLY to correct specific defects — never for the
initial authoring. If `peakui-writer` is NOT listed (no writer model
configured), write files directly as normal.

## Presenting work in the preview

The Coding UI has a **Preview pane** the user can open. To show your work there:

1. Start a dev server (e.g. `python3 -m http.server 8000` or the project's own
   `npm run dev`) in the background.
2. Write the URL to the file `.peakui-preview.json` at the workspace root, as
   JSON: `{"url":"http://localhost:8000","device":"mobile"}`.
   - `device` is optional and one of `desktop`, `tablet`, or `mobile`; omit it
     to leave the user's current device selection unchanged.

The preview pane polls that file, so as soon as you write it the user sees your
work there automatically — you are in control of what is presented. Update the
file whenever the URL or the suggested device changes.

## Conventions to respect

- Follow the conventions already present in the project you are editing; don't
  introduce a new framework or style unless the user asks.
- Put throwaway scripts in `/tmp`, not in a project directory, unless the user
  explicitly asks for a committed harness.
- Never overwrite or delete user files to "simplify" a task. Make the smallest
  change that achieves the goal and report exactly what you changed.
