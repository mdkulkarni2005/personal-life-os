# Playwright Test Suite

This project uses Playwright for end-to-end browser testing in `apps/web`.

The suite checks the real UI, real page flows, form validation, reload behavior, auth flow, and reminder/task behavior across the app.

## Quick Start

### Run all tests

```bash
pnpm test:e2e
```

### Run tests in a visible browser

Use this when you want to watch the UI while the test runs.

```bash
pnpm test:e2e:headed
```

### Run tests in debug mode

Use this when you want Playwright Inspector and step-by-step debugging.

```bash
pnpm --filter web test:e2e:debug
```

### Open the HTML report

Use this after a test run to inspect passed/failed tests, screenshots, traces, and videos.

```bash
pnpm --filter web test:e2e:report
```

## What This Test Suite Checks

### 1. Authentication Flows

File:
- `apps/web/tests/auth/auth-ui.spec.ts`

This checks:
- Existing user can sign in from the landing page.
- New user can sign up.
- New user can sign out and sign back in again.
- Auth navigation lands on the dashboard correctly.

Run only auth tests:

```bash
pnpm --filter web exec playwright test -c playwright.config.ts tests/auth/auth-ui.spec.ts
```

### 2. Reminder CRUD

File:
- `apps/web/tests/reminders/reminder-crud.spec.ts`

This checks:
- Create a reminder from the UI.
- Verify it appears in the correct reminder tab.
- Refresh the page and confirm it still exists.
- Edit the reminder and verify updated values.
- Delete the reminder and verify it is removed everywhere.

Run only reminder CRUD:

```bash
pnpm --filter web exec playwright test -c playwright.config.ts tests/reminders/reminder-crud.spec.ts
```

### 3. Reminder State Transitions

File:
- `apps/web/tests/reminders/reminder-state-transitions.spec.ts`

This checks:
- Upcoming reminders move into due state correctly.
- Marking a reminder as done works.
- Rescheduling a reminder works.
- Snoozing or skipping a reminder works.
- Missed reminders move into the missed tab/state.
- Time-based behavior stays correct after reload.

Notes:
- These tests use a mock clock to simulate time passing.
- This avoids flaky waiting and makes the scenario deterministic.

Run only reminder state transition tests:

```bash
pnpm --filter web exec playwright test -c playwright.config.ts tests/reminders/reminder-state-transitions.spec.ts
```

### 4. Chat-Created Reminder Flow

File:
- `apps/web/tests/chat/chat-reminder.spec.ts`

This checks:
- A reminder can be created through chat.
- The assistant message confirms the reminder creation.
- The reminder appears in the correct tab in the UI.
- The reminder still exists after page refresh.

Run only chat reminder tests:

```bash
pnpm --filter web exec playwright test -c playwright.config.ts tests/chat/chat-reminder.spec.ts
```

### 5. Task and Reminder Edge Cases

File:
- `apps/web/tests/tasks/task-reminder-edges.spec.ts`

This checks:
- Deleting a task with pending reminders shows a warning first.
- Linked reminders are preserved after task deletion.
- Closing a task with incomplete reminders requires confirmation.
- Duplicate reminders are rejected.
- Invalid reminder inputs stay in validation-error state.
- Rapid create/delete loops do not leave stale data behind.

Run only task and reminder edge-case tests:

```bash
pnpm --filter web exec playwright test -c playwright.config.ts tests/tasks/task-reminder-edges.spec.ts
```

### 6. Heavy Data Regression

File:
- `apps/web/tests/regression/heavy-data-generation.spec.ts`

This checks:
- Bulk creation of tasks through the UI.
- Bulk creation of linked reminders through the UI.
- Larger UI data loads do not immediately break the main flows.

Run only heavy regression tests:

```bash
pnpm --filter web exec playwright test -c playwright.config.ts tests/regression/heavy-data-generation.spec.ts
```

## What Happens When The Suite Runs

### Auth setup runs first

Before authenticated tests run, Playwright executes a setup test that:
- Opens the app.
- Signs in using `E2E_USER_EMAIL` and `E2E_USER_PASSWORD`.
- Saves the browser login state.

This means most tests do not need to log in manually every time.

### The app usually starts automatically

If `PLAYWRIGHT_BASE_URL` is not set, Playwright builds the app and starts a dedicated production server automatically with:

```bash
pnpm build && pnpm exec next start --port 3100
```

If `PLAYWRIGHT_BASE_URL` is set, Playwright uses the already-running app instead.

### Failed tests keep useful artifacts

On failure, the suite keeps:
- Trace files
- Screenshots
- Videos

These can be opened from the HTML report.

## Before You Run The Suite

### 1. Add app environment variables

Your app envs must be available in `apps/web/.env.local`.

At minimum, this project expects values like:
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CONVEX_URL`

### 2. Add E2E credentials

For authenticated tests:

```bash
E2E_USER_EMAIL=your-test-user-email
E2E_USER_PASSWORD=your-test-user-password
```

For sign-up coverage, also add:

```bash
E2E_SIGNUP_EMAIL=your-signup-test-email
E2E_SIGNUP_PASSWORD=your-signup-test-password
```

Optional sign-up verification code:

```bash
E2E_SIGNUP_VERIFICATION_CODE=123456
```

Optional timezone override:

```bash
E2E_TIMEZONE_ID=Asia/Kolkata
```

### 3. Install Playwright browsers once

If Playwright browsers are not installed yet, run:

```bash
pnpm --filter web exec playwright install
```

## Copy-Paste Commands

### List all tests

```bash
pnpm --filter web exec playwright test -c playwright.config.ts --list
```

### Run all tests

```bash
pnpm test:e2e
```

### Run all tests in visible UI mode

```bash
pnpm test:e2e:headed
```

### Run all tests in debug mode

```bash
pnpm --filter web test:e2e:debug
```

### Run a single test file

Example:

```bash
pnpm --filter web exec playwright test -c playwright.config.ts tests/reminders/reminder-crud.spec.ts
```

### Run a single named test

Example:

```bash
pnpm --filter web exec playwright test -c playwright.config.ts -g "reminder CRUD stays consistent across refreshes"
```

### Run only auth tests

```bash
pnpm --filter web exec playwright test -c playwright.config.ts tests/auth/auth-ui.spec.ts
```

### Run only reminder tests

```bash
pnpm --filter web exec playwright test -c playwright.config.ts tests/reminders/reminder-crud.spec.ts
pnpm --filter web exec playwright test -c playwright.config.ts tests/reminders/reminder-state-transitions.spec.ts
```

### Run only chat tests

```bash
pnpm --filter web exec playwright test -c playwright.config.ts tests/chat/chat-reminder.spec.ts
```

### Run only task/reminder edge-case tests

```bash
pnpm --filter web exec playwright test -c playwright.config.ts tests/tasks/task-reminder-edges.spec.ts
```

### Run only heavy regression tests

```bash
pnpm --filter web exec playwright test -c playwright.config.ts tests/regression/heavy-data-generation.spec.ts
```

### Open the last HTML report

```bash
pnpm --filter web test:e2e:report
```

## Recommended Day-to-Day Workflow

### If you changed UI code

Run:

```bash
pnpm test:e2e:headed
```

### If you changed one specific feature

Run only the matching spec file first.

Example:

```bash
pnpm --filter web exec playwright test -c playwright.config.ts tests/reminders/reminder-crud.spec.ts
```

### If you need to debug a failing flow

Run:

```bash
pnpm --filter web test:e2e:debug
```

### Before pushing larger changes

Run:

```bash
pnpm test:e2e
```
