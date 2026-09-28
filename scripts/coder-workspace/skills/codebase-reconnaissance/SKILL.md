---
name: codebase-reconnaissance
description: Build a mental model of an unfamiliar codebase before editing it: locate the manifest, entry points, and conventions.
when_to_use: When starting work in a repository or project you have not read before.
---

# Codebase Reconnaissance

Do not edit an unfamiliar codebase from guesses. Reconstruct how it works first.

## Steps

1. **Manifest** — read `package.json` (or equivalent: `Cargo.toml`, `pyproject.toml`,
   `go.mod`, `Makefile`, `docker-compose.yml`). Note the declared scripts, deps,
   and toolchain.
2. **Entry points** — find where the app starts and where routes/handlers are
   registered. Trace one request or one command end to end.
3. **Conventions** — look at how existing code names things, how it's laid out,
   and what test framework is used. Follow those conventions; do not introduce a
   new style or framework unless asked.
4. **Manifest commands** — prefer the project's own scripts (`npm test`,
   `npm run build`, `make …`) over re-inventing steps.
5. **Docs** — read the repo's `README` and any `docs/` before relying on guessed
   behavior.

## Rule

The smallest change that fits the existing structure is almost always right.
A large rewrite of a codebase you just met is almost always wrong.
