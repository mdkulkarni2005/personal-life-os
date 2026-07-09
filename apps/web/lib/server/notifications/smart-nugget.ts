/**
 * notifications/smart-nugget.ts — "Smart Nugget" notification mode.
 *
 * A SEPARATE, additive generation path from ai-generate.ts's per-moment nudges.
 * Where ai-generate.ts personalizes copy for a specific selected moment
 * (morning_launch, overwhelm_rescue, etc.), a "smart nugget" is a standalone,
 * curiosity-driven teaser — closer to a chief-of-staff "hey, check this" ping
 * than a moment-specific coach line. It picks its own category from the
 * fixed list below and returns a `reason` explaining the engagement bet.
 *
 * Same contract as generateAiNudge: best-effort, returns null on any failure
 * (no API key, timeout, bad JSON, validator rejection) so the caller can fall
 * back to the deterministic engine or simply skip sending. Output is gated
 * through the same anti-surveillance validator — a smart nugget is never an
 * exception to the "fragrant garden, not iron cage" rule.
 */

import { safeNotification } from "./validate";

const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";
const NIM_DEFAULT_MODEL = "mistralai/mistral-medium-3.5-128b";

const MAX_TITLE_CHARS = 80;
const MAX_BODY_CHARS = 120;

export type SmartNuggetCategory =
  | "Motivation"
  | "Focus"
  | "Deadline"
  | "Habit"
  | "Goal Progress"
  | "Planning"
  | "Productivity Insight"
  | "AI Suggestion"
  | "Missed Opportunity"
  | "Daily Reset";

const SYSTEM_PROMPT = `You are the notification engine for PersonalOS.

Your job is to generate highly engaging push notifications that encourage users to open the app and take action.

The notification should feel like a smart life assistant, not a task manager.

Rules:

1. Never sound robotic.
2. Never simply list tasks.
3. Create curiosity.
4. Focus on outcomes, not reminders.
5. Use simple language.
6. Maximum 2 short sentences.
7. Maximum 80 characters for title.
8. Maximum 120 characters for body.
9. Make the user feel they are missing something important.
10. Be positive and motivating, not fear-based.
11. Occasionally use emojis, but never more than 2.
12. Sound like a personal coach, chief of staff, or second brain.
13. Every notification should make the user think:
   "Let me quickly check."

Generate notifications in this JSON format:

{
  "title": "",
  "body": "",
  "reason": "",
  "category": ""
}

The "reason" field explains internally why this notification should increase engagement.
The "category" field must be exactly one of the notification categories below.

Notification categories:
- Motivation
- Focus
- Deadline
- Habit
- Goal Progress
- Planning
- Productivity Insight
- AI Suggestion
- Missed Opportunity
- Daily Reset

Avoid:
- "Don't forget..."
- "Reminder..."
- "You have X tasks pending..."
- Generic productivity clichés

Good examples:

Title: Your future self is waiting.
Body: One important task could disappear today.

Title: Your brain deserves less clutter 🧠
Body: I've already organized what needs attention.

Title: You're closer than you think.
Body: One small win today moves your goal forward.

Title: Something needs 5 minutes.
Body: It could save you an hour later.

Title: Today's plan has a weak spot.
Body: Want me to show you where?

Title: You're carrying this mentally.
Body: Let PersonalOS remember it instead.

Title: Momentum is still alive.
Body: Don't let today's streak break.

Title: I found a hidden priority.
Body: It might matter more than you think.

Title: Your calendar looks ambitious.
Body: I found one thing worth adjusting.

Title: Small decisions create big weeks.
Body: Let's make the next one easier.

Reply with ONLY the JSON object, nothing else.`;

export interface SmartNuggetContext {
  displayName?: string | null;
  pendingCount: number;
  overdueCount: number;
  doneToday: number;
  streakDays: number;
  topDomain?: string | null;
  nextDueTitle?: string | null;
  minutesUntilDue?: number | null;
  focusTaskTitle?: string | null;
  completedTaskTitle?: string | null;
  localHour: number;
  /** Only pass when genuinely available — never fabricate. */
  productivityScoreNote?: string | null;
}

export type SmartNugget = {
  title: string;
  body: string;
  reason: string;
  category: SmartNuggetCategory | null;
};

const VALID_CATEGORIES: SmartNuggetCategory[] = [
  "Motivation", "Focus", "Deadline", "Habit", "Goal Progress",
  "Planning", "Productivity Insight", "AI Suggestion", "Missed Opportunity", "Daily Reset",
];

function buildUserContext(ctx: SmartNuggetContext): string {
  const facts: Record<string, unknown> = {
    displayName: ctx.displayName ?? undefined,
    pendingCount: ctx.pendingCount,
    overdueCount: ctx.overdueCount,
    doneToday: ctx.doneToday,
    streakDays: ctx.streakDays,
    topDomain: ctx.topDomain ?? undefined,
    nextDueTitle: ctx.nextDueTitle ?? undefined,
    minutesUntilDue: ctx.minutesUntilDue ?? undefined,
    focusTaskTitle: ctx.focusTaskTitle ?? undefined,
    completedTaskTitle: ctx.completedTaskTitle ?? undefined,
    localHour: ctx.localHour,
    productivityInsight: ctx.productivityScoreNote ?? undefined,
  };
  const clean = Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== undefined));
  return `Generate one notification for this user context (only reference facts present here — never invent data):\n${JSON.stringify(clean)}`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Best-effort smart-nugget copy. Returns null on any failure — callers must
 * treat this as optional and fall back to silence or the existing nudge
 * engine, never block sending on it.
 */
export async function generateSmartNugget(
  ctx: SmartNuggetContext,
  opts: { timeoutMs?: number } = {},
): Promise<SmartNugget | null> {
  const apiKey = process.env.NVIDIA_NIM_API_KEY;
  if (!apiKey) return null;
  const model = process.env.NVIDIA_NIM_MODEL ?? NIM_DEFAULT_MODEL;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
    const res = await fetch(`${NIM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.9,
        max_tokens: 220,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserContext(ctx) },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "";
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    const parsed = JSON.parse(content.slice(start, end + 1)) as {
      title?: unknown; body?: unknown; reason?: unknown; category?: unknown;
    };

    let title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    let body = typeof parsed.body === "string" ? parsed.body.trim() : "";
    const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";
    const categoryRaw = typeof parsed.category === "string" ? parsed.category.trim() : "";
    const category = (VALID_CATEGORIES as string[]).includes(categoryRaw)
      ? (categoryRaw as SmartNuggetCategory)
      : null;
    if (!title || !body) return null;

    title = truncate(title, MAX_TITLE_CHARS);
    body = truncate(body, MAX_BODY_CHARS);

    // Same anti-surveillance backstop every other notification path runs
    // through — curiosity-driven copy is not an exception to the safety rules.
    const safe = safeNotification(title, body);
    if (!safe.title || !safe.body) return null;
    if (safe.title !== title || safe.body !== body) return null;

    return { title: safe.title, body: safe.body, reason, category };
  } catch {
    return null;
  }
}
