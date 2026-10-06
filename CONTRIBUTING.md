# Contributing to PeakUI

Thank you for your interest in PeakUI. This document explains how to contribute code, report issues, and suggest features.

## How to Contribute

1. **Choose an issue** or open one before a feature or large refactor. Small documentation and test fixes can go directly to a pull request.
2. **Fork the repository** and create a branch from `main`.
3. **Make your changes** with clear commits.
4. **Run tests, lint on changed files, and the build** before opening a pull request. See the exact commands in [DEVELOPMENT.md](DEVELOPMENT.md).
5. **Open a pull request against `main`** with a concise description, verification, and a linked issue when one exists. Include screenshots for UI changes and migration/rollback notes for data or deployment changes.

## Development Setup

See [DEVELOPMENT.md](DEVELOPMENT.md) for local development, testing, and Prisma workflow.

For Docker-based setup, see [INSTALL.md](INSTALL.md) and [WINDOWS-SETUP.md](WINDOWS-SETUP.md).

## Coding Style

- TypeScript throughout the app and API routes.
- React functional components with hooks; no class components.
- Follow the existing CSS variables and theme tokens; no Tailwind or CSS-in-JS.
- Match the existing comment density and naming in any file you touch.
- Prefer explicit types over `any`.

## Tests

```bash
npm test
```

Add or update tests for any changed logic, especially utility libraries in `src/lib/`.
Contributors can start with issues labeled `good first issue` once available.

## Commit Messages

Use clear, descriptive commit messages in the present tense:

```text
feat: add new WorkSpaces tool capability
fix: resolve session branching edge case
docs: update install instructions
```

## Security

If you discover a security issue, please follow the process in [SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
