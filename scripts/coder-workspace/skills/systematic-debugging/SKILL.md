---
name: systematic-debugging
description: Four-phase root-cause debugging before touching code. Use when a bug's cause is not obvious, a fix keeps failing, or the user reports the same symptom repeatedly.
when_to_use: When debugging a bug, when a fix does not resolve the reported symptom, or when you are about to change code to "try something" without knowing the root cause.
---

# Systematic Debugging

Never patch a symptom without understanding its cause. Work through these four
phases in order and do not skip ahead.

## Phase 1 — Reproduce

- Get the exact symptom from the user or from the running system before
  theorizing. A vague "it's broken" is not a bug report.
- Reproduce it yourself where possible: run the same command, open the same
  page, hit the same endpoint. Record the exact input, the exact error, and the
  exact output.
- If you cannot reproduce it, say so — do not fix a problem you have not seen.

## Phase 2 — Locate the root cause

- Read the actual code path that produced the symptom, not the code you
  *expect* to be at fault. Use `grep`/`rg` to trace the symbol from the error
  message to its definition.
- For a multi-runtime or multi-layer bug (client + server, app + daemon, code
  + proxy), read the protocol/message first, then each layer in the path. A
  fix in one layer does not fix the layer that is the actual source of truth.
- Form a hypothesis that explains *all* the observed symptoms, not just one.
  A hypothesis that fits only half the symptoms is wrong.

## Phase 3 — Fix the cause, not the symptom

- Make the smallest change that removes the root cause. Do not add a wrapper,
  a retry, or a suppression that masks the symptom while the cause remains.
- If the fix requires touching many files, re-check the hypothesis: a
  well-understood cause usually has a small fix.
- Distinguish the real invariant from the incidental one. A boolean lock that
  cannot express "second caller waits for the first" is the wrong shape; use
  the structure that actually models the state.

## Phase 4 — Verify, and verify the *right* thing

- Run the exact reproduction from Phase 1 again and confirm the symptom is
  gone. A green test of a different path is not proof.
- Check for silent failure paths: `let _ = result`, swallowed `catch`, and
  `/* ignore */` are data-loss bugs waiting to happen. Grep for them in the
  code you changed.
- Report the real evidence (command + output), never "should work now".

## Stop-and-check rule

If you have changed code twice and the symptom is unchanged, stop editing.
Re-read the actual running code / rendered output, and re-form your
hypothesis from what is really there — not from what you assumed.
