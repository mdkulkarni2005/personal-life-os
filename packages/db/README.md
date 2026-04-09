# @repo/db

Convex database package for Personal Life OS.

## Scope

- Owns Convex schema and database contracts
- Keeps database logic out of app packages
- Provides a clean foundation for upcoming Convex integration in chat/reminders

## Commands

Run from repo root:

- `pnpm --filter @repo/db convex:dev`
- `pnpm --filter @repo/db convex:deploy`

## Environment

For web app runtime, add to `apps/web/.env.local`:

- `NEXT_PUBLIC_CONVEX_URL=...`

For Convex dashboard/deploy auth, use Convex CLI login in your local shell.
