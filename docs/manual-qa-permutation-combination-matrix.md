# RemindOS Manual QA — Permutation & Combination Matrix

Date: 2026-04-23
Purpose: End-to-end manual validation checklist for all major user flows and critical combinations.

## How to use this sheet

- Run each scenario manually.
- Mark Actual Result and Status.
- Use at least 2 accounts for sharing scenarios.
- Use desktop + mobile viewport for UI/overlay scenarios.

Legend:
- Status: Pass / Fail / Blocked
- Priority: P0 (critical), P1 (high), P2 (normal)

---

## Test environment setup

| Item | Value |
|---|---|
| App URL | Local/Dev deployment URL |
| Browser 1 | Chrome latest |
| Browser 2 | Safari latest |
| Device | iPhone-size responsive + desktop |
| Account A | Owner account |
| Account B | Recipient account |
| Push enabled | Yes/No |
| Time zone | Local + one alternate zone (if possible) |

---

## A. Authentication, routing, and onboarding

| ID | Priority | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| AUTH-01 | P0 | Signed-out user opens root | Signed out | Open `/` | Landing page is shown |  |  |
| AUTH-02 | P0 | Signed-in user opens root | Signed in | Open `/` | Redirects to `/dashboard` |  |  |
| AUTH-03 | P0 | Signed-out opens dashboard | Signed out | Open `/dashboard` | Redirects to `/sign-in` |  |  |
| AUTH-04 | P1 | Sign-up flow success | Fresh email | Open `/sign-up` and complete sign-up | User lands on dashboard |  |  |
| AUTH-05 | P1 | Sign-in flow success | Existing user | Open `/sign-in` and login | User lands on dashboard |  |  |
| AUTH-06 | P1 | Sign-out from drawer | Signed in | Open drawer → Sign out | Returns to `/` |  |  |
| ONB-01 | P0 | Walkthrough appears once for eligible new user | New user created after release | First dashboard load | Walkthrough opens automatically |  |  |
| ONB-02 | P0 | Walkthrough next flow | Walkthrough open | Click Next until end | Reaches final step and completes |  |  |
| ONB-03 | P0 | Walkthrough close (X) skip | Walkthrough open | Click close button | Walkthrough closes and is marked done |  |  |
| ONB-04 | P0 | Walkthrough not shown again | Walkthrough completed | Refresh dashboard | Walkthrough does not re-open |  |  |
| ONB-05 | P1 | Existing old user eligibility | User older than release cutoff | Open dashboard | Walkthrough does not auto-open |  |  |

---

## B. Reminder creation permutations

| ID | Priority | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| REM-C-01 | P0 | Create reminder with minimum valid fields | Signed in | Open Create → Title + future date/time + priority → Save | Reminder created and visible in list |  |  |
| REM-C-02 | P0 | Create reminder then verify in All Reminders | Reminder created | Open All Reminders | New reminder appears in correct tab |  |  |
| REM-C-03 | P0 | Create and immediately delete | Reminder exists | Delete reminder | Removed from UI and from list on refresh |  |  |
| REM-C-04 | P0 | Create with notes | None | Add notes and save | Notes persist in list/details/edit |  |  |
| REM-C-05 | P0 | Create with recurrence daily | None | Set recurrence Daily, save | Recurrence displayed as daily |  |  |
| REM-C-06 | P0 | Create with recurrence weekly | None | Set recurrence Weekly, save | Recurrence displayed as weekly |  |  |
| REM-C-07 | P0 | Create with recurrence monthly | None | Set recurrence Monthly, save | Recurrence displayed as monthly |  |  |
| REM-C-08 | P0 | Create with recurrence none | None | Set recurrence None, save | Recurrence displayed as none/default |  |  |
| REM-C-09 | P1 | Create with priority 1..5 | None | Repeat create for each star value | Saved priority equals selected stars |  |  |
| REM-C-10 | P1 | Create with domain health | None | Choose domain health and save | Domain persists and filters correctly |  |  |
| REM-C-11 | P1 | Create with domain finance | None | Choose finance and save | Domain persists |  |  |
| REM-C-12 | P1 | Create with domain career | None | Choose career and save | Domain persists |  |  |
| REM-C-13 | P1 | Create with domain hobby | None | Choose hobby and save | Domain persists |  |  |
| REM-C-14 | P1 | Create with domain fun | None | Choose fun and save | Domain persists |  |  |
| REM-C-15 | P0 | Create with past date/time | None | Try saving with past dueAt | Validation blocks save |  |  |
| REM-C-16 | P1 | Empty title validation | None | Leave title empty, save | Error shown; no creation |  |  |
| REM-C-17 | P1 | Very long title | None | Enter long title and save | No crash; saved or validated gracefully |  |  |
| REM-C-18 | P1 | Special characters/emoji in title | None | Add emoji/symbols in title | Saved and displayed correctly |  |  |

---

## C. Reminder edit/update permutations

| ID | Priority | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| REM-U-01 | P0 | Edit title | Existing reminder | Edit title and save | Updated title visible everywhere |  |  |
| REM-U-02 | P0 | Edit notes | Existing reminder | Edit notes and save | Notes update persists |  |  |
| REM-U-03 | P0 | Edit due date/time | Existing reminder | Change dueAt future and save | New dueAt reflected in bucket/tab |  |  |
| REM-U-04 | P0 | Edit recurrence daily→weekly | Existing recurring | Change recurrence and save | New recurrence persists |  |  |
| REM-U-05 | P1 | Edit priority each value | Existing reminder | Change priority 1..5 | Each update persists |  |  |
| REM-U-06 | P1 | Edit linked task add | Existing adhoc reminder | Link to task and save | Reminder now task-linked |  |  |
| REM-U-07 | P1 | Edit linked task remove | Existing linked reminder | Clear link and save | Reminder becomes ADHOC |  |  |
| REM-U-08 | P1 | Edit domain change | Existing reminder | Change domain and save | Domain updates |  |  |
| REM-U-09 | P0 | Mark done from list/action | Pending reminder | Mark done | Status changes and appears in Done tab |  |  |
| REM-U-10 | P0 | Reopen done reminder | Done reminder | Reopen/mark pending | Back to pending bucket |  |  |
| REM-U-11 | P1 | Archive reminder | Existing reminder | Archive action (if exposed) | Moved/hidden as expected |  |  |
| REM-U-12 | P0 | Reschedule using custom modal | Due reminder bubble exists | Trigger reschedule, pick time, save | Reminder moved to selected time |  |  |

---

## D. Reminder bucket/list/filter combinations

| ID | Priority | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| REM-L-01 | P0 | Missed bucket correctness | Create overdue and future reminders | Open Reminders tab: Missed | Only overdue pending shown |  |  |
| REM-L-02 | P0 | Today bucket correctness | Reminder due today | Open Today tab | Today reminders shown |  |  |
| REM-L-03 | P0 | Tomorrow bucket correctness | Reminder due tomorrow | Open Tomorrow tab | Tomorrow reminders shown |  |  |
| REM-L-04 | P0 | Upcoming bucket correctness | Reminder beyond tomorrow | Open Upcoming tab | Later reminders shown |  |  |
| REM-L-05 | P0 | Done bucket correctness | Done reminders exist | Open Done tab | Only done shown |  |  |
| REM-L-06 | P1 | Shared tab filter by sender | Shared reminders from different users | Shared tab → sender filter | Filter works correctly |  |  |
| REM-L-07 | P1 | Sent tab filter by recipient | Owner shared to multiple users | Sent tab → recipient filter | Filter works correctly |  |  |
| REM-L-08 | P1 | Reminder task filter ADHOC | Mixed linked+adhoc reminders | Filter = ADHOC | Only adhoc shown |  |  |
| REM-L-09 | P1 | Reminder task filter by task | Linked reminders to task T1/T2 | Filter by T1 | Only T1-linked reminders shown |  |  |
| REM-L-10 | P1 | Tab counts consistency | Mixed statuses | Compare counts vs visible rows | Counts match visible data |  |  |

---

## E. Task module permutations

| ID | Priority | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| TASK-C-01 | P0 | Create task required fields | Signed in | Create task title + priority | Task created in pending tab |  |  |
| TASK-C-02 | P1 | Create task with dueAt | None | Add future dueAt and save | Due date visible |  |  |
| TASK-C-03 | P1 | Create task with notes | None | Add notes and save | Notes visible in task card |  |  |
| TASK-C-04 | P1 | Create task with each domain | None | Create for all domains | Domains persist |  |  |
| TASK-C-05 | P0 | Task edit title/notes | Existing task | Edit and save | Updates persist |  |  |
| TASK-C-06 | P0 | Mark task done | Pending task | Mark done | Moves to done tab |  |  |
| TASK-C-07 | P0 | Reopen done task | Done task | Reopen action | Moves back pending/missed |  |  |
| TASK-C-08 | P0 | Delete task | Existing task | Delete | Removed from list after refresh |  |  |
| TASK-C-09 | P1 | Task missed bucket logic | Task due in past pending | Open missed tab | Appears in missed |  |  |
| TASK-C-10 | P1 | Create linked reminder from task | Editing task | Click add linked reminder | Reminder create opens with task linked |  |  |
| TASK-C-11 | P1 | Save linked reminder and return task context | From task flow | Create linked reminder and save | Lands back correctly without broken state |  |  |

---

## F. Task-reminder linking combinations

| ID | Priority | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| LINK-01 | P0 | Create reminder linked to existing task | At least 1 pending task | In reminder form pick task and save | Link stored and visible in task card |  |  |
| LINK-02 | P1 | Reminder list filter by linked task | Linked reminders exist | Apply task filter | Correct subset shown |  |  |
| LINK-03 | P1 | Task card linked reminder section | Task with linked reminders | Open task list | Linked reminders section shows counts/items |  |  |
| LINK-04 | P1 | Linked reminder marked done updates task card | Linked reminder exists | Mark linked reminder done | Moved to completed-on-task display |  |  |
| LINK-05 | P1 | Delete linked reminder updates task card | Linked reminder exists | Delete reminder | Removed from linked section |  |  |

---

## G. Chat assistant permutations

| ID | Priority | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| CHAT-01 | P0 | Create reminder via chat (clear prompt) | Signed in | “Create reminder tomorrow 9am for gym” | Assistant creates reminder |  |  |
| CHAT-02 | P0 | Chat asks clarification when missing time | None | “Create reminder tomorrow for gym” | Clarification requested |  |  |
| CHAT-03 | P0 | List reminders today via chat | Today reminders exist | Ask “What’s due today?” | Grounded today list returned |  |  |
| CHAT-04 | P1 | Planning query | Mixed reminders | Ask planning question | Ranked/planning response returned |  |  |
| CHAT-05 | P1 | Mark reminder done via chat | Existing reminder | Ask to mark done | Reminder status updates |  |  |
| CHAT-06 | P1 | Delete reminder via chat | Existing reminder | Ask to delete | Reminder removed |  |  |
| CHAT-07 | P1 | Reschedule via chat | Existing reminder | Ask to reschedule | dueAt updated |  |  |
| CHAT-08 | P1 | Ambiguous target clarification | Similar titles exist | Ask action by partial name | Assistant asks which reminder |  |  |
| CHAT-09 | P1 | Reply-to context in chat | Existing messages | Reply to previous message and submit | Reply context preserved |  |  |
| CHAT-10 | P1 | Edit user message and resend | Existing user message | Edit previous user message | Updated request processed |  |  |
| CHAT-11 | P1 | Chat history persists on refresh | Existing conversation | Refresh page | Messages reload correctly |  |  |
| CHAT-12 | P1 | Clear chat | Existing history | Use clear chat | History cleared and stays cleared after refresh |  |  |
| CHAT-13 | P2 | Non-English/Indian time phrase parsing | None | Use Hindi/Marathi style time words | Correct parse or clear clarification |  |  |

---

## H. Sharing & collaboration combinations (2 accounts)

| ID | Priority | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| SHARE-01 | P0 | Share single reminder A→B | Account A has reminder | A share to B | Success toast; B gets inbox row |  |  |
| SHARE-02 | P0 | Share multiple reminders batch A→B | A has multiple reminders | Select multiple and share | Single batch delivered to B |  |  |
| SHARE-03 | P0 | B accepts batch | SHARE-02 done | B accept batch | Reminders appear for B as shared |  |  |
| SHARE-04 | P1 | B dismisses batch | Shared batch exists | B dismiss batch | Rows removed from inbox |  |  |
| SHARE-05 | P1 | B accepts invite token URL | Invite link generated | Open `/dashboard?invite=<token>` while signed in B | Invite accepted and reminder appears |  |  |
| SHARE-06 | P1 | Owner cannot accept own invite | User A token used by A | Accept token as owner | Proper validation error |  |  |
| SHARE-07 | P1 | Shared reminder edit by participant notifies owner | Reminder shared to B | B edits status/due/title | Owner receives system chat notification |  |  |
| SHARE-08 | P1 | Shared reminder delete by participant notifies owner | Shared reminder exists | B deletes shared reminder | Owner notified; behavior as designed |  |  |
| SHARE-09 | P1 | Sent tab recipient filter correctness | A shared to B and C | A opens sent filter by B/C | Rows filter correctly |  |  |
| SHARE-10 | P1 | Shared tab sender filter correctness | B has reminders from A and C | B filter sender | Rows filter correctly |  |  |

---

## I. Notifications and PWA combinations

| ID | Priority | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| PUSH-01 | P1 | Push subscription success | Browser supports push | Allow permission and subscribe | Subscription saved without error |  |  |
| PUSH-02 | P1 | Permission denied path | Deny permission | Trigger notification setup | Graceful UI state, no crash |  |  |
| PUSH-03 | P1 | Due reminder in-app notification | Reminder due now | Wait until due minute | Due notification shown once per session rule |  |  |
| PUSH-04 | P2 | Collaboration push payload arrives | Share accept/send actions | Trigger event | Push/banner text matches action |  |  |
| PWA-01 | P2 | Install app banner logic | Compatible browser | Open app | Install banner appears correctly |  |  |
| PWA-02 | P2 | Service worker registration | Browser supports SW | Load app and inspect | SW registered without console errors |  |  |

---

## J. Import / batch / utility combinations

| ID | Priority | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| IMP-01 | P1 | Import valid reminders JSON | Import overlay available | Paste valid JSON and import | Created count correct; reminders appear |  |  |
| IMP-02 | P1 | Import invalid JSON | None | Paste malformed JSON | Error shown; nothing imported |  |  |
| IMP-03 | P1 | Import missing required fields | None | JSON missing title/dueAt | Proper validation errors |  |  |
| IMP-04 | P2 | Import mixed statuses | JSON includes pending/done | Import | Statuses retained correctly |  |  |
| BATCH-01 | P2 | Batch questions valid array | Batch overlay open | Submit question array | Questions processed sequentially |  |  |
| BATCH-02 | P2 | Batch with invalid payload | Batch open | Submit invalid payload | Validation error; no crash |  |  |

---

## K. Overlay, navigation, and UX-state combinations

| ID | Priority | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| UX-01 | P0 | One-overlay-at-a-time rule | Dashboard open | Open Create, then Tasks, then Reminders | Only latest overlay visible |  |  |
| UX-02 | P0 | Browser back closes overlay correctly | Overlay open via in-app trigger | Hit browser back | Returns to previous dashboard state |  |  |
| UX-03 | P1 | Open tasks from create flow | Create overlay open | Open all tasks from create | No stacked broken layers |  |  |
| UX-04 | P1 | Open reminders from task flow | Task overlay open | View reminders | Correct switch, no ghost overlays |  |  |
| UX-05 | P1 | Mobile bottom-sheet interaction | Mobile viewport | Open/close overlays by tap outside | Smooth close, no scroll lock issues |  |  |
| UX-06 | P1 | Body scroll lock when modal open | Any overlay open | Attempt page scroll | Background scroll locked; restored on close |  |  |
| UX-07 | P2 | Drawer open/close transitions | Signed in | Open drawer + close + escape key | Works smoothly |  |  |

---

## L. Data consistency and refresh checks

| ID | Priority | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| CONS-01 | P0 | Create → Refresh → Exists | New reminder/task created | Hard refresh page | Item still exists |  |  |
| CONS-02 | P0 | Delete → Refresh → Gone | Existing item deleted | Hard refresh page | Item does not return |  |  |
| CONS-03 | P0 | Edit → Refresh → Updated | Existing item edited | Hard refresh page | Latest values persist |  |  |
| CONS-04 | P1 | Multi-tab sync sanity | Same account in 2 tabs | Update in tab A, refresh tab B | Data consistency maintained |  |  |
| CONS-05 | P1 | Network error handling | Simulate temporary offline | Attempt create/edit/delete | Friendly error and no corrupted UI |  |  |

---

## M. Full regression “critical path” script (quick run)

| Step | Action | Expected |
|---|---|---|
| 1 | Sign up new user | Lands on dashboard |
| 2 | Walkthrough next/close | Completes, does not reappear |
| 3 | Create reminder (daily, priority 5, domain health) | Saved and listed |
| 4 | Edit reminder title/time | Updated |
| 5 | Mark done, then reopen | Status transitions correct |
| 6 | Create task and link reminder | Link visible both sides |
| 7 | Share reminder A→B and accept on B | Shared reminders visible |
| 8 | Use chat to create and delete a reminder | Actions reflected in lists |
| 9 | Import one valid reminder JSON | Imported item visible |
| 10 | Delete created items, refresh | Deleted items stay deleted |

---

## N. Execution tracker

| Area | Total Cases | Passed | Failed | Blocked | Notes |
|---|---:|---:|---:|---:|---|
| Auth + Onboarding | 11 |  |  |  |  |
| Reminders Create/Update/List | 40 |  |  |  |  |
| Tasks + Linking | 16 |  |  |  |  |
| Chat | 13 |  |  |  |  |
| Sharing | 10 |  |  |  |  |
| Push/PWA | 6 |  |  |  |  |
| Import/Batch | 6 |  |  |  |  |
| UX/Overlays | 7 |  |  |  |  |
| Consistency | 5 |  |  |  |  |
| **Overall** | **114** |  |  |  |  |

---

## Notes

- This matrix is intentionally broad and practical for manual validation.
- For future optimization, you can split this into smoke, sanity, regression, and release-check subsets.
