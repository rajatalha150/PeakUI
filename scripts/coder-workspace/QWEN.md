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
- **site / lab-site / weather-site** (no unified runner): each has an ad-hoc
  self-test (`node-suite.test.mjs`, `selftest.js`, `probes.js`). Run them
  directly with `node <file>`. They deliberately avoid a real browser.

## Browser verification (real UI checks)

A Puppeteer harness lives in the workspace scratch space and can drive a real
headless Chrome (installed under `/root/.cache/puppeteer/.../chrome-headless-shell`).

- `ldd` on the chrome binary reports 0 missing libraries, so it is runnable.
- Screenshots are produced by e.g. `lab-site/screenshot.mjs` and the
  `/tmp/wx-e2e.mjs` style harness (light/dark/mobile).
- The main model is text-only; a vision model is configured via the daemon's
  `visionModel` setting so screenshots can actually be *read*. If visual
  verification fails, check that `visionModel` is set (see the daemon's
  `settings.json`) before assuming the site is broken.

## Conventions to respect

- Prefer zero-dependency solutions for the static sites; they have no build
  step and no package.json of their own.
- Match the existing CSS token / theme / accessibility patterns rather than
  introducing a framework.
- Put throwaway scripts in `/tmp`, not in a project directory, unless the user
  explicitly asks for a committed harness.
