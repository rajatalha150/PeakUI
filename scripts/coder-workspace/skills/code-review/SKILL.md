---
name: code-review
description: Self-review code before declaring it done: correctness, security, edge cases, and silent failure paths.
when_to_use: Before reporting a change as complete, or before merging/committing a non-trivial change.
---

# Code Review (self-review before "done")

Before you report any non-trivial change as complete, review it as a hostile
reviewer would.

## Checklist

1. **Correctness** — does it do what was asked for the normal case *and* the
   edge cases (empty input, missing config, failure mid-way)?
2. **Silent failure** — grep for `let _ =`, `catch {}`, `catch (_) {}`,
   `/* ignore */`, and `.catch(() => {})`. Each one that swallows an error the
   caller needs is a bug.
3. **Security** — no secrets in logs/errors/responses, no user input flowing
   into a shell or URL without validation, no over-broad permissions.
4. **Type / build** — run the project's type-check and build; a clean
   type-check is not optional.
5. **Tests** — run the relevant tests; if none cover the change, add one.
6. **Evidence** — the claim "works" must be backed by a real command and its
   real output, attached to the report.

## What to report

List exactly what changed, the command you ran and its output, and anything
still unresolved. Never turn a failed check into a passing claim.
