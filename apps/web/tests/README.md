**Playwright Suite**
The E2E suite lives under `apps/web` and uses real browser flows with a Page Object Model.

**Folders**
- `tests/`: executable specs plus the authenticated setup project
- `e2e-pages/`: landing, auth, and dashboard POMs
  Next.js reserves a root `pages/` directory for routing, so the POM folder is kept compile-safe here.
- `fixtures/`: shared Playwright fixtures
- `utils/`: env helpers, deterministic data factories, and mock clock helpers
- `data/`: reserved for reusable seed payloads and matrix expansions

**Required env**
- App envs must be available to the Next app: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CONVEX_URL`, and any optional chat provider keys.
- Authenticated regression specs require `E2E_USER_EMAIL` and `E2E_USER_PASSWORD`.
- Sign-up coverage additionally needs `E2E_SIGNUP_EMAIL` and `E2E_SIGNUP_PASSWORD`.
- If Clerk prompts for email verification during sign-up, set `E2E_SIGNUP_VERIFICATION_CODE`.
- `PLAYWRIGHT_BASE_URL` is optional when pointing the suite at an already-running environment.
- Without `PLAYWRIGHT_BASE_URL`, Playwright auto-builds the app and starts a dedicated local server on port `3100` by default.
- `E2E_TIMEZONE_ID` is optional and defaults to `Asia/Kolkata`.

**Run**
- Headless: `pnpm --filter web test:e2e`
- Headed: `pnpm --filter web test:e2e:headed`
- CI mode: `pnpm --filter web test:e2e:ci`
- HTML report: `pnpm --filter web test:e2e:report`

**Extend**
- Add new user journeys in `tests/` and keep selectors inside `pages/`, not in specs.
- Prefer unique generated titles from `utils/test-data.ts` to avoid collisions on shared environments.
- Use `utils/mock-clock.ts` for time-sensitive state transitions instead of sleeps.
- Keep CRUD assertions state-based: reload, reopen, and validate the actual UI card after every mutation.
