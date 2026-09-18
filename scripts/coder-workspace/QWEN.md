# Workspace context (auto-loaded every session)

This file is the single source of truth for how this workspace is laid out and
how to verify it. Read it before starting work so you do not re-derive these
facts from scratch every turn.

## Project layout

Four independent, dependency-free projects live at the workspace root:

| Directory | What it is | Language |
|---|---|---|
| `src/` + `test/` | `cli-starter` — a minimal Node 22 + TypeScript CLI starter | TypeScript (tsc) |
| `site/` | hand-written static site (no build step, no runtime network requests) | HTML/CSS/JS |
| `lab-site/` | second static site, slightly richer (app.js, favicon.svg, screenshot.mjs) | HTML/CSS/JS |
| `weather-site/` | live-weather static site using Open-Meteo (keyless API), built to match the site/lab-site conventions | HTML/CSS/JS |

The static sites deliberately share a set of conventions: design tokens in CSS
custom properties, `data-theme` light/dark, semantic landmarks + skip link,
progressive enhancement, and no runtime network requests except where a
specific site's purpose requires it (weather-site fetches Open-Meteo).

## How to verify each project

- **cli-starter** (the only one with a real package.json):
  - `npm run typecheck` — `tsc -p tsconfig.json` (no emit)
  - `npm run build` — `tsc -p tsconfig.build.json` → `dist/`
  - `npm test` — `node --import tsx --test "test/**/*.test.ts"`
  - `npm run dev -- Ada --shout` / `npm start -- Ada` — run the CLI
- **lab-site**: `node node-suite.test.mjs` (2 tests). `selftest.js` and
  `probes.js` are *library* modules exported for that suite — they print
  nothing when run directly, so don't treat their silence as failure.
- **weather-site**: `node lib.test.mjs` (38 tests) and `node render.test.mjs`
  (4 tests).
- **site**: no self-test file at all — its only verification is the browser
  check below.

## Browser verification (real UI checks)

A committed harness lives at `/opt/qwen-code/browser/verify-site.mjs` (source in
`scripts/coder-browser/`). Both Chrome builds and the runtime libs are baked
into the image, so this works on a fresh VM with no downloads.

- `node /opt/qwen-code/browser/verify-site.mjs /workspace/<site>` serves the
  site on a loopback port, drives it with headless Chrome, prints a JSON report
  (title/h1/landmarks/errors) and writes `/tmp/verify-light.png` + dark.
- Run it from `/opt/qwen-code/browser` (ESM resolves `puppeteer` relative to
  the script's own location, not the cwd). Both `chrome-headless-shell` and the
  full `chrome` build are installed under `/root/.cache/puppeteer`.
- The sites implement dark mode via the `data-theme` attribute, NOT
  `prefers-color-scheme`. `lab-site/screenshot.mjs` has one check that emulates
  `prefers-color-scheme` and will always report "dark scheme changes the
  palette" as a false failure — that is a harness bug, not a site bug.
- The main model is text-only; a `visionModel` is configured via the daemon so
  screenshots can be transcribed. If visual verification fails, check that the
  vision model is set (Settings → Model orchestration → Vision) before assuming
  the site is broken.

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
anything it got wrong yourself. If `peakui-writer` is NOT listed (no writer
model configured), write files directly as normal. For trivial one-off snippets
where the round-trip overhead is not worth it, writing directly is acceptable.

## Conventions to respect

- Prefer zero-dependency solutions for the static sites; they have no build
  step and no package.json of their own.
- Match the existing CSS token / theme / accessibility patterns rather than
  introducing a framework.
- Put throwaway scripts in `/tmp`, not in a project directory, unless the user
  explicitly asks for a committed harness.
