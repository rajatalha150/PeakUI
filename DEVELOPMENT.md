# Development Guide

This guide covers local development outside Docker.

## Requirements

- Node.js 22+
- PostgreSQL 15+ running locally
- Ollama running locally
- npm or equivalent package manager

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env and point DATABASE_URL at your local Postgres.

# 3. Generate the Prisma client
npx prisma generate

# 4. Apply the schema
npx prisma db push

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
| `npm run lint` | Run ESLint |
| `npm run openclaw:host-executor` | Start optional host shell executor |

## Testing

```bash
npm test
```

Add tests for new logic in `src/lib/` and co-locate API route tests where appropriate.

## Prisma Workflow

```bash
# Generate client after schema changes
npx prisma generate

# Apply schema changes in development
npx prisma db push

# Create a migration
npx prisma migrate dev --name add_new_feature

# Open the database GUI
npx prisma studio
```

Do not use `npx prisma db push --force-reset` on a real database.

The production container entrypoint runs `npx prisma db push --accept-data-loss`
(not `migrate deploy`) because installer-created databases have no migration
baseline. The `--accept-data-loss` flag is required so that, on upgrade, adding a
unique/`@@unique` constraint to a table that already has rows does not refuse
non-interactively and leave the container in a restart loop. Keep the flag when
editing the Dockerfile `CMD`. See the comment above the `CMD` for details.

## Code Style

- TypeScript strict mode is enabled.
- React functional components with hooks.
- Vanilla CSS with CSS variables; no Tailwind or CSS-in-JS.
- Match surrounding code style for naming and comments.

## Architecture Notes

- `src/app/page.tsx` is the app shell that renders `OpenClawWorkspace`.
- `src/app/components/OpenClawWorkspace.tsx` is the main WorkSpaces UI.
- `src/lib/chat-completion.ts` is the shared streaming completion pipeline.
- `src/lib/chat-sessions.ts` handles session persistence, branching, and analytics.
- `src/lib/session-intelligence.ts` manages context compression and continuation.
- `src/lib/model-context.ts` detects model capacity (parameter size + native context window via Ollama `/api/show`) and maps it to a prompt tier (`minimal` / `compact` / `standard` / `full`) and a `num_ctx` recommendation. `openclaw-prompt.ts` consumes the tier; `chat-completion.ts` and `openclaw-automation-execution.ts` fetch the profile before building the prompt.
- `src/instrumentation.ts` starts the server-side automation worker.

## Internal Naming

The public UI label is **WorkSpaces**. Internal code uses the `openclaw` prefix for routes, schema fields, CSS classes, and tool tags. Keep code identifiers as-is; update only user-facing labels.
