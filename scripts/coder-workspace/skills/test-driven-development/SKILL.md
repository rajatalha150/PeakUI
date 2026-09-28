---
name: test-driven-development
description: RED-GREEN-REFACTOR discipline. Write a failing test before the implementation, run it to watch it fail, then make it pass. Use when adding or changing behavior that can be tested.
when_to_use: When adding a new function, fixing a bug, or changing behavior where a test can express the expected result.
---

# Test-Driven Development

Write the test first, watch it fail, then make it pass. Do not skip the RED
step — it is the proof that your test actually exercises the change.

## The loop

1. **RED** — write a minimal test that asserts the behavior you want. Run it
   and confirm it fails *for the reason you expect* (not a syntax error or a
   missing import).
2. **GREEN** — write the smallest implementation that makes the test pass.
3. **REFACTOR** — clean up without changing behavior; the test must stay green.

## Rules

- Test the observable behavior, not the implementation detail.
- When fixing a bug, write the test that *reproduces* the bug first. It should
  fail before the fix and pass after — that is your proof the fix is real.
- Do not weaken a test to make a broken implementation pass. If a test fails,
  the implementation is wrong; change the code, not the assertion.
- Keep tests fast and deterministic. No flaky timing, no network, no shared
  mutable state between tests.

## When a test cannot be written

If the change is not testable (a pure UI layout change, an infra config), say
so and verify by actually running the thing and reporting the observable
result — never by claiming it works.
