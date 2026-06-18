# Contributing to PeakUI

Thank you for your interest in PeakUI. This document explains how to contribute code, report issues, and suggest features.

## How to Contribute

1. **Open an issue first** for bug reports, feature requests, or large refactors so we can agree on direction before you invest time.
2. **Fork the repository** and create a feature branch.
3. **Make your changes** with clear commits.
4. **Run tests and lint** before opening a pull request.
5. **Open a pull request** with a concise description and reference the issue.

## Development Setup

See [DEVELOPMENT.md](DEVELOPMENT.md) for local development, testing, and Prisma workflow.

For Docker-based setup, see [INSTALL.md](INSTALL.md) and [WINDOWS-SETUP.md](WINDOWS-SETUP.md).

## Coding Style

- TypeScript throughout the app and API routes.
- React functional components with hooks; no class components.
- Vanilla CSS with CSS variables and glassmorphism conventions; no Tailwind or CSS-in-JS.
- Match the existing comment density and naming in any file you touch.
- Prefer explicit types over `any`.

## Tests

```bash
npm test
```

Add or update tests for any changed logic, especially utility libraries in `src/lib/`.

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
