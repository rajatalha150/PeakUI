# Development Guide

This guide covers the Next.js app running locally. The full Docker and
persistent-Coder paths are in [INSTALL.md](INSTALL.md).

## Requirements

- Node.js 22 and npm (CI uses the latest Node 22 release)
- PostgreSQL 15+ with the `pgvector` extension for app/database work
- Ollama or a compatible remote model provider to exercise AI features; neither is needed for unit tests

## Setup

```bash
# 1. Install locked dependencies
npm ci

# 2. Configure environment
cp .env.example .env
# Edit .env: set DATABASE_URL and a strong JWT_SECRET. If using Compose for
# PostgreSQL, set POSTGRES_PASSWORD to the password in DATABASE_URL too.
# Replace the YOUR_USER placeholders in optional host paths before using them.
# Never commit .env or real credentials.

# 3. Generate the Prisma client
npx prisma generate

# 4. Apply committed migrations to a fresh development database
npx prisma migrate deploy

# 5. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start Next.js development server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm test` | Run Vitest suite |
| `npm run lint -- path/to/file.ts` | Lint changed files; the full-repo command can need more than Node's default heap |
| `npm run bundle:check` | Check first-load JavaScript per route after `npm run build` |
| `npm run workspace-tool:host-executor` | Start optional host shell executor |

## Testing

```bash
npm test
npm run lint -- src/lib/your-changed-file.ts
npm run build
npm run bundle:check
node --test scripts/check-bundle-budget.node-test.mjs
```

Add tests for new logic in `src/lib/` and co-locate API route tests where appropriate.

## Prisma Workflow

```bash
# Generate client after schema changes
npx prisma generate

# Create and apply a migration in development
npx prisma migrate dev --name add_new_feature

# Apply committed migrations without changing the schema
npx prisma migrate deploy

# Open the database GUI
npx prisma studio
```

Use an isolated development database for schema changes. Commit the generated
migration with its schema change. Do not use `prisma db push` or
`db push --force-reset` on a database with data you need to keep.

The production container entrypoint runs fail-closed `npx prisma migrate deploy`.
It applies the committed migration history and stops on an unbaselined or
inconsistent database. Legacy databases must be backed up, schema-compared, and
explicitly baselined before production deployment; do not restore an automatic
`db push --accept-data-loss` startup fallback.

## Code Style

- TypeScript strict mode is enabled.
- React functional components with hooks.
- Vanilla CSS with CSS variables; no Tailwind or CSS-in-JS.
- Match surrounding code style for naming and comments.

## Architecture Notes

- `src/app/page.tsx` is the app shell that renders `WorkspaceToolWorkspace`.
- `src/app/components/WorkspaceToolWorkspace.tsx` is the main WorkSpaces UI.
- `src/lib/chat-completion.ts` is the shared streaming completion pipeline.
- `src/lib/chat-sessions.ts` handles session persistence, branching, and analytics.
- `src/lib/session-intelligence.ts` manages context compression and continuation.
- `src/lib/model-context.ts` detects model capacity (parameter size + native context window via Ollama `/api/show`) and maps it to a prompt tier (`minimal` / `compact` / `standard` / `full`) and a `num_ctx` recommendation. It also exports `classifyModelFit`, which flags models that won't fit the GPU's free VRAM (used by the model picker). `workspace-tool-prompt.ts` consumes the tier; `chat-completion.ts` and `workspace-tool-automation-execution.ts` fetch the profile before building the prompt.
- `src/lib/workspace-tool-tools.ts` is the tool-call parser. It accepts the custom `<workspace_tool>` wrapper plus the native syntax of Qwen, Gemma, Llama, Mistral, GLM, and Anthropic-style models, normalizing them all to the same request shape (see `docs/tool-call-formats.md`). `stripAllToolTags` removes every format from the visible transcript.
- `src/instrumentation.ts` starts the server-side automation worker.

## Internal Naming

The public UI label is **WorkSpaces**. Internal code uses the `workspace-tool` prefix for routes, schema fields, CSS classes, and tool tags. Keep code identifiers as-is; update only user-facing labels.
