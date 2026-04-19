# RemindOS UI Redesign + UX Fix Execution Plan

## 1) Goal
Redesign the application end-to-end for mobile + desktop and fix UX/navigation reliability issues (especially back-button and overlay routing behavior).

## 2) Scope
- Complete UI refresh (visual + interaction model)
- Navigation and history model stabilization
- Overlay/modal behavior standardization
- Responsive behavior unification (phone + tablet + desktop)
- Form UX consistency across reminders/tasks/share flows
- Error, loading, empty, and success states for every screen

## 3) Current Critical Problems (to fix first)
1. Back button does not close overlays predictably on mobile.
2. Overlay routing state is inconsistent across nested flows.
3. Too many flows depend on ad-hoc modal state transitions.
4. Mobile-first behavior exists, but desktop adaptation is not fully systematic.
5. Core actions are powerful but visually dense and inconsistent.

## 4) New Information Architecture (target)
1. App Shell
   - Header actions: open reminders, open menu, create reminder, profile/menu
2. Dashboard Workspace
   - Assistant stream + composer + quick prompts
3. Reminders Hub
   - Tabs: Missed, Today, Tomorrow, Later, Shared, Sent, Done
4. Tasks Hub
   - Tabs: Missed, Upcoming, Done
5. Creation Flows
   - Create/Edit Reminder
   - Create/Edit Task
   - Linked reminder from task flow
6. Utility Flows
   - Share reminders
   - Reschedule reminder
   - Import JSON
   - Batch questions

## 5) Navigation Model (new standard)
1. Single overlay stack manager with deterministic open/close behavior.
2. Every overlay push must write a history state token.
3. Back action always closes top-most overlay first.
4. Deep overlay flows preserve origin context (task -> reminder -> back to same task).
5. Browser back from root dashboard exits page only when no overlay is open.

## 6) Responsive Design Rules
### Mobile (primary)
- Bottom-sheet and right-drawer patterns for quick actions
- Large touch targets (>=44px)
- Action clusters near thumb zones
- Sticky composer and lightweight top controls

### Desktop
- Centered workspace container
- Layered dialogs with stable focus handling
- Better content density with clear section hierarchy
- Side utilities preserved without overwhelming chat focus

## 7) Component System (Figma + Code parity)
1. Buttons
   - Primary / Secondary / Ghost / Danger / Icon
2. Inputs
   - Text / Textarea / Date / Time / Datetime / Select / Checkbox
3. Chips
   - Priority stars, domain tags, shared/task badges
4. Cards
   - Reminder card, task card, summary card, message card
5. Dialog primitives
   - Modal, bottom sheet, side drawer, toast, success overlay
6. State blocks
   - Empty state, loading state, inline error state

## 8) Rendering + Data Fill Contract (per screen)
For each screen we must define:
1. Data source (API/state)
2. Prefill logic
3. Validation rules
4. Submit/mutation behavior
5. Success transition
6. Error fallback
7. Back/close behavior

## 9) Execution Phases
### Phase 1: UX Foundation
- Build navigation/overlay stack manager
- Fix back-button + history behavior
- Add close/open consistency tests

### Phase 2: Design System + Layout
- Finalize visual tokens (spacing, radius, colors, typography)
- Build reusable primitives
- Normalize all forms

### Phase 3: Screen Redesign
- Dashboard workspace refresh
- Reminders hub redesign
- Tasks hub redesign
- Share + reschedule + import + batch polish

### Phase 4: QA + Stabilization
- Mobile back stack testing (Android + iOS browsers/PWA)
- Desktop keyboard/focus checks
- Regression tests for reminder/task CRUD and linking flows

## 10) Acceptance Criteria
1. Mobile back button closes overlays in correct order 100%.
2. Returning from linked flows restores origin context.
3. All primary actions are reachable within 2 taps from dashboard.
4. All forms have consistent validation and feedback.
5. No dead-end UI states.
6. Visual consistency across light/dark and mobile/desktop.

## 11) Immediate Next Task
Start with Phase 1 implementation: refactor overlay history handling and back-button logic in dashboard workspace, then run full overlay flow verification.
