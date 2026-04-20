# RemindOS — Product Designer A-to-Z Brief

Date: 2026-04-20
Owner: Product + Design handoff

## 1) What this project is

RemindOS (Personal Life OS) is an AI-assisted planning app that combines:

- reminders,
- tasks,
- urgency-based daily prioritization,
- chat-based assistant actions,
- lightweight collaboration/sharing,
- and onboarding guidance,

inside one authenticated workspace.

Core entry and shell:

- apps/web/app/page.tsx
- apps/web/app/layout.tsx
- apps/web/components/dashboard/dashboard-page.tsx
- apps/web/components/dashboard/dashboard-workspace.tsx

---

## 2) Product persona (brand + user)

### Product personality

- Clear, calm, execution-focused.
- “Tell me what matters now.”
- AI is practical (assistant for action), not decorative.
- Mobile-friendly and fast.

### Primary user personas

1. Busy professionals
   - Need: fast capture + reliable follow-through for meetings and personal commitments.

2. Students / learners
   - Need: clear deadline visibility (overdue/today/tomorrow) and simple progress tracking.

3. Founders / operators
   - Need: rapid planning loops, quick delegation via sharing, minimum context switching.

### Jobs-to-be-done

- “When I open the app, show me urgent actions immediately.”
- “Let me create/update reminders in natural language.”
- “Keep tasks and reminders linked so context is not lost.”
- “Allow collaboration without heavy PM tooling.”

---

## 3) App type and architecture

- Monorepo with Turborepo + pnpm workspaces.
- Frontend: Next.js App Router (React + TypeScript).
- Authentication: Clerk.
- Data backend: Convex.
- Shared intelligence package: @repo/reminder (intent, ranking, grouping, context blocks).
- PWA support: service worker + push notifications.

Reference files:

- package.json
- apps/web/package.json
- packages/db/convex/schema.ts
- packages/reminder/src/index.ts

---

## 4) User-facing route map (pages)

Total page routes: 4

1. /
   - Landing for signed-out users.
   - Signed-in users are redirected to /dashboard.

2. /dashboard
   - Main authenticated workspace.

3. /sign-in (Clerk catch-all route)
   - Returning user authentication flow.

4. /sign-up (Clerk catch-all route)
   - New user account creation flow.

Reference files:

- apps/web/app/page.tsx
- apps/web/app/dashboard/page.tsx
- apps/web/app/sign-in/[[...sign-in]]/page.tsx
- apps/web/app/sign-up/[[...sign-up]]/page.tsx

---

## 5) Screen inventory inside dashboard

### Primary workspace

1. Chat + planning workspace
   - conversation thread,
   - assistant actions,
   - follow-up prompts,
   - opening summary / session briefing.

### Overlay/panel screens

2. Create reminder overlay
3. Reminder list overlay
   - tabs: missed, today, tomorrow, upcoming, done, shared, sent
4. Task list overlay
5. Task form overlay (create/edit)
6. Snapshot overlay
7. Share overlay
8. Import overlay (JSON)
9. Batch questions overlay
10. Reschedule modal
11. Walkthrough overlay (new-user one-time onboarding)

Reference files:

- apps/web/components/dashboard/dashboard-workspace.tsx
- apps/web/components/dashboard/task-panels.tsx
- apps/web/components/dashboard/walkthrough-overlay.tsx
- apps/web/components/layout/app-drawer.tsx

---

## 6) API inventory

Total API routes: 19

### Chat

- POST /api/chat
- GET|POST|DELETE /api/chat/history

### Reminders core

- GET|POST /api/reminders
- PATCH|DELETE /api/reminders/[id]
- POST /api/reminders/import
- POST /api/reminders/[id]/invite

### Reminder sharing / inbox

- GET /api/reminders/inbox
- POST /api/reminders/inbox/dismiss
- POST /api/reminders/share/send
- GET|POST /api/reminders/share/[token]
- POST /api/reminders/share/batch/accept
- POST /api/reminders/share/batch/dismiss

### Tasks

- GET|POST /api/tasks
- PATCH|DELETE /api/tasks/[id]

### Directory / onboarding / infra

- GET /api/users/directory
- GET|POST /api/onboarding/walkthrough
- POST /api/push/subscribe
- GET /api/push/vapid-public
- GET /api/ping

Reference folder:

- apps/web/app/api

---

## 7) Data model summary

Core entities:

- reminders
- tasks
- chatMessages
- reminderInvites
- reminderParticipants
- reminderShareInbox
- pushSubscriptions

Domain model highlights:

- reminder status: pending / done / archived
- recurrence: none / daily / weekly / monthly
- life domains: health / finance / career / hobby / fun
- linked reminders to tasks
- owner/shared reminder access model

Reference:

- packages/db/convex/schema.ts

---

## 8) UX principles to preserve

1. One-workspace execution model
2. Urgency-first organization (overdue/today/tomorrow/later)
3. Fast capture (chat + quick form)
4. Linked planning (task ↔ reminder)
5. Lightweight accountability (share + inbox)
6. One-time onboarding walkthrough for new users

---

## 9) Current product positioning (recommended)

RemindOS is an AI-first daily execution workspace that turns scattered tasks and reminders into a clear, prioritized plan you can act on in seconds.

---

## 10) Notes for landing-page design direction

What the landing page must communicate quickly:

- What this app is: AI planning workspace for reminders + tasks.
- Who it is for: people who need daily clarity and follow-through.
- What happens after sign-up: one dashboard, guided walkthrough, immediate prioritization.
- Why it is different: chat + urgency intelligence + linked execution + collaboration.

Suggested section order:

1. Hero (clear value proposition)
2. Proof of clarity (urgency buckets + fast-first-action)
3. How it works (3-step flow)
4. Core feature pillars
5. Personas/use-cases
6. Final CTA strip

---

## 11) Source reference list

- apps/web/app/layout.tsx
- apps/web/app/page.tsx
- apps/web/app/dashboard/page.tsx
- apps/web/app/sign-in/[[...sign-in]]/page.tsx
- apps/web/app/sign-up/[[...sign-up]]/page.tsx
- apps/web/components/dashboard/dashboard-page.tsx
- apps/web/components/dashboard/dashboard-workspace.tsx
- apps/web/components/dashboard/task-panels.tsx
- apps/web/components/dashboard/walkthrough-overlay.tsx
- apps/web/components/layout/app-drawer.tsx
- apps/web/app/api/chat/route.ts
- apps/web/app/api/chat/history/route.ts
- apps/web/app/api/reminders/route.ts
- apps/web/app/api/reminders/[id]/route.ts
- apps/web/app/api/reminders/import/route.ts
- apps/web/app/api/reminders/inbox/route.ts
- apps/web/app/api/reminders/inbox/dismiss/route.ts
- apps/web/app/api/reminders/[id]/invite/route.ts
- apps/web/app/api/reminders/share/send/route.ts
- apps/web/app/api/reminders/share/[token]/route.ts
- apps/web/app/api/reminders/share/batch/accept/route.ts
- apps/web/app/api/reminders/share/batch/dismiss/route.ts
- apps/web/app/api/tasks/route.ts
- apps/web/app/api/tasks/[id]/route.ts
- apps/web/app/api/users/directory/route.ts
- apps/web/app/api/push/subscribe/route.ts
- apps/web/app/api/push/vapid-public/route.ts
- apps/web/app/api/ping/route.ts
- apps/web/app/api/onboarding/walkthrough/route.ts
- packages/db/convex/schema.ts
- packages/reminder/src/index.ts
- package.json
- apps/web/package.json
