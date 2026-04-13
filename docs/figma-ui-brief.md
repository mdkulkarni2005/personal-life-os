# Personal Life OS / RemindOS UI Brief For Figma

## 1. Product Identity

Personal Life OS, branded in the app shell as **RemindOS**, is not just a to-do app.
It is a **chat-first personal operating system** for managing reminders, tasks, day planning, and lightweight collaboration.

The product combines:

- an AI assistant conversation surface
- a reminder system with due times, recurrence, notes, priority, and completion states
- a task system with optional linked reminders
- collaboration through reminder sharing and invite acceptance
- PWA/mobile-style alerts and notification actions

The current product behavior suggests this positioning:

> "A mobile-first personal control center where a user talks to an assistant, captures reminders and tasks quickly, sees what is urgent, and reacts to due items in real time."

## 2. Core Jobs The Product Solves

The current app solves these jobs:

- Help the user know what is overdue, due today, due tomorrow, and coming later.
- Let the user create reminders quickly, either manually or through chat.
- Let the user organize reminders around larger tasks.
- Distinguish between structured work and one-off reminders through **task-linked** vs **ADHOC** reminders.
- Help the user prioritize using a 1 to 5 star system.
- Let the user act from notifications and due prompts with very little friction.
- Let users share reminders with other users inside the app.

This means the redesign should feel like a **focused command center**, not like a generic dashboard with many unrelated widgets.

## 3. Current Information Model

### Main Objects

**Reminder**

- title
- due date/time
- status: pending, done, archived
- recurrence: none, daily, weekly, monthly
- notes
- priority: 1 to 5 stars
- optional linked task
- optional life domain: health, finance, career, hobby, fun
- access mode: owner or shared

**Task**

- title
- due date/time optional
- status: pending or done
- notes
- priority: 1 to 5 stars
- optional life domain
- can have many linked reminders

**Share / Collaboration**

- owner can share one or more reminders
- recipients receive an invite inside the app
- recipients can accept or deny
- accepted reminders show in shared views

**Chat Message**

- user, assistant, or system role
- supports reply context
- supports editing user messages
- can carry system reminder-due states

## 4. Current UI Architecture

The current UI is heavily centered on a single dashboard workspace.

### A. Top App Shell

The shell is simple and persistent:

- sticky header
- logo and product name
- small user context in the brand area
- icon button for reminders
- icon button for snapshot/menu
- user menu with theme toggle

This shell is intentionally light. Most product behavior happens after entering the dashboard.

### B. Main Screen: Chat Workspace

This is the real home screen.

The primary panel is a **dark, immersive assistant chat surface** with:

- streamed briefing messages
- user and assistant bubbles
- reply-to context
- edit message behavior
- suggested follow-up prompts
- compact composer at the bottom
- due reminder system messages injected into chat

This means the product is **assistant-first**, not list-first.
The chat is not a side feature. It is the product’s emotional center.

### C. Snapshot / Menu Drawer

Opening the snapshot shows a right-side drawer that behaves like a compact control panel.

It includes:

- reminder counts
- suggested-question toggle
- notification settings
- create reminder action
- open reminders action
- create task action
- open tasks action
- import, export, batch actions
- clear chat

This is effectively a **mobile utility menu**, not a full analytics dashboard.

### D. Reminder Management

Reminders open in a modal / bottom-sheet style list.

It includes:

- tabs: Missed, Today, Tomorrow, Later, Shared, Sent, Done
- filters by linked task or ADHOC
- optional filters by sharer or recipient
- bulk select for sharing
- reminder cards with chips for stars, shared state, task link, and domain
- edit, share, mark done, delete actions

This surface is operational and dense. It prioritizes utility over visual elegance.

### E. Reminder Create/Edit Modal

The reminder form supports:

- title
- date
- time
- recurrence
- notes
- related task
- quick inline task creation
- domain
- required star priority

This reveals that the current product is more structured than a simple reminder app.

### F. Task Management

Tasks also live in a modal / panel instead of a dedicated page.

It includes:

- create and edit task form
- due date/time
- notes
- domain
- required star priority
- quick action to add a linked reminder
- tabs for missed, upcoming, done
- display of linked pending reminders and completed reminder history

The task system acts as a planning backbone behind reminders.

### G. Share Modal

Sharing is user-selection based, inside the product.

It includes:

- selected reminders summary
- searchable-feeling people list layout
- avatar, name, email
- multi-select
- send action

This suggests a light collaboration model, closer to accountability or coordination than full team project management.

## 5. Current Visual Language

### Overall Tone

The current interface mixes two visual modes:

- a relatively standard white/light utility shell for forms, lists, and modals
- a dark, high-contrast, slightly dramatic chat canvas as the main workspace

### Key Visual Traits

- rounded corners everywhere, especially 2xl and 3xl forms and message bubbles
- purple/violet used as brand and primary action color
- emerald/teal used for success and send actions
- amber used for priority stars and notice accents
- red/rose used for destructive actions
- slate used as the neutral base

### Typography

- Geist Sans / Geist Mono
- clean and modern
- not highly expressive
- optimized for utility and compact scanning

### Current UI Personality

The current UI feels:

- practical
- mobile-first
- dense
- function-heavy
- slightly developer-built rather than brand-polished

That is important for Figma:
the redesign should improve clarity and polish, but it should not accidentally turn the product into a generic SaaS admin dashboard.

## 6. Current Interaction Patterns

These behaviors are central to the product and should be preserved conceptually:

- Chat is the default center of gravity.
- Briefings stream into the conversation like an assistant narrative.
- Suggested prompts reduce blank-screen friction.
- Due reminders can appear directly in the chat stream as actionable notices.
- Notification actions matter: Done, Snooze, Delete, Set new time.
- Many secondary flows use slide-over panels, drawers, or bottom sheets.
- Mobile gestures matter: long press, swipe-to-reply, compact layouts, quick action buttons.
- The app is designed as a PWA, not just a desktop browser site.

## 7. Product Strengths To Preserve In A Redesign

- Assistant-first flow instead of forcing the user into forms first.
- Clear urgency framing: overdue, today, tomorrow, later.
- Strong connection between reminders and broader life tasks.
- Support for both structured planning and quick ADHOC capture.
- Collaboration without making the app feel like enterprise software.
- Real-time, action-oriented behavior around due reminders.

## 8. Current UX Weaknesses To Improve

These are good redesign targets for Figma:

- Too many important flows are hidden inside modals and drawers.
- The information hierarchy is functional but not elegant.
- The reminder list is powerful but visually crowded.
- The snapshot drawer acts like a miscellaneous control bucket.
- Brand personality is weaker than product capability.
- Landing page does not match the sophistication of the dashboard.
- Collaboration exists, but the UI does not strongly communicate shared ownership or trust.
- Tasks and reminders are both strong concepts, but the relationship could be visually clearer.

## 9. Primary Personas

Use these as the main personas for redesign exploration.

### Persona 1: The Daily Operator

**Name:** Aisha  
**Age:** 27  
**Role:** Young professional managing work and personal responsibilities  
**Behavior:** Opens the app multiple times per day on mobile, wants fast capture and fast checking  
**Needs:**

- know what is overdue right now
- quickly add one-off reminders
- get nudged at the exact due time
- avoid mental overload

**Pain Points:**

- loses track of small but important obligations
- forgets follow-ups when switching contexts
- hates cluttered productivity tools

**Why this persona matters:**

This is the default user the current UI seems built for. The assistant chat, due notifications, and mobile-first design all map strongly to this person.

### Persona 2: The Structured Planner

**Name:** Rohan  
**Age:** 33  
**Role:** Organized user who plans life through goals, categories, and recurring systems  
**Behavior:** Uses tasks as anchors and reminders as execution checkpoints  
**Needs:**

- connect reminders to larger goals or tasks
- tag life areas like finance, health, and career
- use repeat schedules and priorities
- see progress by structure, not just by time

**Pain Points:**

- basic reminder apps feel too shallow
- project tools feel too heavy for personal life
- wants structure without enterprise complexity

**Why this persona matters:**

The linked task model, domain tags, recurrence, and star-based priority are clearly serving this user type.

### Persona 3: The Accountability Partner

**Name:** Meera  
**Age:** 29  
**Role:** Partner, sibling, or friend coordinating reminders with another person  
**Behavior:** Shares reminders for follow-through, coordination, and support  
**Needs:**

- send reminders to another user cleanly
- know what was accepted
- avoid repetitive texting and manual follow-up
- feel collaborative, not managerial

**Pain Points:**

- shared planning usually happens in messy chat threads
- existing productivity tools are either solo-only or too team-oriented
- wants lightweight coordination with trust

**Why this persona matters:**

The share inbox, accept/deny flow, and sent/shared tabs are specifically built for this behavior.

### Persona 4: The Conversational Organizer

**Name:** Arjun  
**Age:** 24  
**Role:** User who thinks faster in natural language than in forms  
**Behavior:** Talks to the assistant to create, inspect, and reschedule reminders  
**Needs:**

- type or paste messy thoughts
- ask questions like “what is next?” or “what is overdue?”
- get suggestions without constructing filters manually
- feel like the app understands context

**Pain Points:**

- traditional reminder UIs feel mechanical
- form-heavy task tools break momentum
- wants a planning tool that feels alive and responsive

**Why this persona matters:**

The dashboard architecture clearly treats conversation as a first-class input system, not just a support feature.

## 10. Figma Design Direction Guardrails

When generating UI concepts, keep these constraints:

- Do not design this as a spreadsheet-like task manager.
- Do not design this as a corporate team project tool.
- Do not make the dashboard look like an analytics admin panel.
- Keep chat as a primary or near-primary surface.
- Preserve strong urgency grouping for reminders.
- Preserve the relationship between tasks and reminders.
- Keep mobile usage first-class, not secondary.
- Make collaboration feel human and lightweight.
- Treat notifications and due-time actions as core product moments.

## 11. Figma Prompt You Can Paste

Use this prompt in Figma AI or as a handoff brief:

```text
Design a polished mobile-first and desktop-responsive UI for a product called RemindOS (Personal Life OS).

This product is an assistant-first personal productivity system, not a generic to-do app. Its core experience combines:
- AI chat for planning and reminder actions
- reminders with due times, recurrence, notes, star priority, and completion states
- tasks that can own linked reminders
- ADHOC reminders that are standalone
- lightweight collaboration where users can share reminders and accept invites
- PWA-style mobile behavior and due-time notification actions

The main screen should feel like a focused command center. Chat should remain central, but the design should make reminder and task management easier to scan and act on. The experience should balance clarity, urgency, and warmth.

Important information architecture:
- Sticky app shell with brand, reminder access, snapshot/menu access, and user menu
- Main assistant workspace with streaming briefing, chat bubbles, suggested prompts, and message composer
- Reminder views grouped by Missed, Today, Tomorrow, Later, Shared, Sent, and Done
- Task views grouped by Missed, Upcoming, and Done
- Reminder forms support title, date, time, recurrence, notes, linked task, domain, and required star priority
- Tasks support title, due date/time, notes, domain, star priority, and linked reminders
- Sharing reminders should feel simple and human, not enterprise-heavy

Primary personas:
1. Daily Operator: wants quick capture, due alerts, and low mental load
2. Structured Planner: wants task-linked reminders, categories, recurrence, and priority
3. Accountability Partner: wants lightweight reminder sharing and follow-through
4. Conversational Organizer: prefers natural-language interaction over forms

Visual direction:
- modern, intentional, and calm
- more polished than the current implementation
- preserve dark immersive assistant space or an equivalent strong focal surface
- avoid generic SaaS dashboard aesthetics
- prioritize scannability, urgency, and action readiness
- support both light and dark modes

Design outputs:
- dashboard main screen
- reminder list / management view
- create/edit reminder modal or sheet
- tasks panel
- share reminder flow
- mobile and desktop variants
```

## 12. Redesign Opportunity Summary

The best redesign direction is:

- keep the assistant as the heart of the product
- make planning objects more legible and connected
- reduce modal clutter with stronger hierarchy
- improve emotional clarity around urgency and shared responsibility
- turn the app from “powerful utility” into “confident personal command center”

