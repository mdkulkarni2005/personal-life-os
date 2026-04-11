export type ReminderChatRole = "system" | "user" | "assistant";

export interface ReminderChatMessage {
  role: ReminderChatRole;
  content: string;
}

export interface ReminderChatRequest {
  model?: string;
  messages: ReminderChatMessage[];
  temperature?: number;
  maxTokens?: number;
  // Reserved for future tool-calling support.
  tools?: unknown[];
}

export interface ReminderChatProvider {
  complete(request: ReminderChatRequest): Promise<string>;
}

export type ReminderStatus = "pending" | "done" | "archived";
export type ReminderRecurrence = "none" | "daily" | "weekly" | "monthly";

export interface ReminderItem {
  id: string;
  title: string;
  dueAt: string;
  recurrence?: ReminderRecurrence;
  notes?: string;
  priority?: number;
  urgency?: number;
  tags?: string[];
  status: ReminderStatus;
  createdAt: string;
  updatedAt: string;
  /** Present when loaded from dashboard API (owned vs shared invite). */
  access?: "owner" | "shared";
}

export type ReminderIntent =
  | "list_reminders"
  | "create_reminder"
  | "update_reminder"
  | "decision_query"
  | "planning_query"
  | "ambiguous";

export type ReminderBucket = "missed" | "today" | "tomorrow" | "upcoming" | "done";

export function getReminderBucket(reminder: ReminderItem, now = new Date()): ReminderBucket {
  if (reminder.status === "done") return "done";

  const due = new Date(reminder.dueAt);
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startTomorrow = new Date(startToday);
  startTomorrow.setDate(startTomorrow.getDate() + 1);
  const startDayAfterTomorrow = new Date(startTomorrow);
  startDayAfterTomorrow.setDate(startDayAfterTomorrow.getDate() + 1);

  if (due < now) return "missed";
  if (due >= startToday && due < startTomorrow) return "today";
  if (due >= startTomorrow && due < startDayAfterTomorrow) return "tomorrow";
  return "upcoming";
}

export function buildReminderSnapshot(reminders: ReminderItem[], now = new Date()) {
  const counts = {
    pending: 0,
    done: 0,
    missed: 0,
    today: 0,
    tomorrow: 0,
  };

  for (const reminder of reminders) {
    if (reminder.status === "done") {
      counts.done += 1;
      continue;
    }

    counts.pending += 1;
    const bucket = getReminderBucket(reminder, now);
    if (bucket === "missed") counts.missed += 1;
    if (bucket === "today") counts.today += 1;
    if (bucket === "tomorrow") counts.tomorrow += 1;
  }

  return counts;
}

/** How to filter reminders for a natural-language list query */
export type ReminderListScope =
  | "missed"
  | "today"
  | "tomorrow"
  /** Strict UI bucket: due after end of tomorrow */
  | "later"
  /** Pending with due >= now (colloquial “upcoming”, includes today/tomorrow) */
  | "future"
  /** All pending (may include missed) */
  | "all_pending";

function sortByDueAsc(a: ReminderItem, b: ReminderItem) {
  return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
}

export function filterRemindersByListScope(
  reminders: ReminderItem[],
  scope: ReminderListScope,
  now = new Date()
): ReminderItem[] {
  const pending = reminders.filter((r) => r.status !== "done");
  switch (scope) {
    case "all_pending":
      return pending.slice().sort(sortByDueAsc);
    case "future":
      return pending
        .filter((r) => new Date(r.dueAt).getTime() >= now.getTime())
        .sort(sortByDueAsc);
    case "missed":
      return pending.filter((r) => getReminderBucket(r, now) === "missed").sort(sortByDueAsc);
    case "today":
      return pending.filter((r) => getReminderBucket(r, now) === "today").sort(sortByDueAsc);
    case "tomorrow":
      return pending.filter((r) => getReminderBucket(r, now) === "tomorrow").sort(sortByDueAsc);
    case "later":
      return pending.filter((r) => getReminderBucket(r, now) === "upcoming").sort(sortByDueAsc);
    default:
      return pending.slice().sort(sortByDueAsc);
  }
}

export function filterToday(reminders: ReminderItem[], now = new Date()): ReminderItem[] {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  return reminders
    .filter((r) => {
      if (r.status === "done" || r.status === "archived") return false;
      const dueAt = new Date(r.dueAt).getTime();
      return dueAt >= startOfDay.getTime() && dueAt < endOfDay.getTime();
    })
    .sort(sortByDueAsc);
}

export function getTodayReminders(reminders: ReminderItem[], now = new Date()): ReminderItem[] {
  return filterToday(reminders, now);
}

function reminderPriority(reminder: ReminderItem): number {
  if (typeof reminder.priority === "number" && Number.isFinite(reminder.priority)) return reminder.priority;
  return 0;
}

function reminderUrgency(reminder: ReminderItem): number {
  if (typeof reminder.urgency === "number" && Number.isFinite(reminder.urgency)) return reminder.urgency;
  return 0;
}

export function rankTasks(reminders: ReminderItem[], now = new Date()): ReminderItem[] {
  const active = reminders.filter((r) => r.status !== "done" && r.status !== "archived");
  return active.slice().sort((a, b) => {
    const aOverdue = new Date(a.dueAt).getTime() < now.getTime() ? 1 : 0;
    const bOverdue = new Date(b.dueAt).getTime() < now.getTime() ? 1 : 0;
    if (aOverdue !== bOverdue) return bOverdue - aOverdue;

    const byDue = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    if (byDue !== 0) return byDue;

    const byUrgency = reminderUrgency(b) - reminderUrgency(a);
    if (byUrgency !== 0) return byUrgency;

    return reminderPriority(b) - reminderPriority(a);
  });
}

export interface ScheduleConflict {
  first: ReminderItem;
  second: ReminderItem;
  minutesApart: number;
}

export interface ScheduleAnalysis {
  nextTask: ReminderItem | null;
  overdueTasks: ReminderItem[];
  upcomingTasks: ReminderItem[];
  conflicts: ScheduleConflict[];
  freeSlots: string[];
}

export function analyzeSchedule(reminders: ReminderItem[], now = new Date()): ScheduleAnalysis {
  const ranked = rankTasks(reminders, now);
  const overdueTasks = ranked.filter((r) => new Date(r.dueAt).getTime() < now.getTime()).slice(0, 5);
  const upcomingTasks = ranked.filter((r) => new Date(r.dueAt).getTime() >= now.getTime()).slice(0, 5);
  const nextTask = upcomingTasks[0] ?? overdueTasks[0] ?? null;

  const sortedByDue = reminders
    .filter((r) => r.status !== "done" && r.status !== "archived")
    .slice()
    .sort(sortByDueAsc);
  const conflicts: ScheduleConflict[] = [];
  for (let i = 0; i < sortedByDue.length - 1; i += 1) {
    const first = sortedByDue[i];
    const second = sortedByDue[i + 1];
    if (!first || !second) continue;
    const minutesApart = Math.round(
      (new Date(second.dueAt).getTime() - new Date(first.dueAt).getTime()) / 60000
    );
    if (minutesApart >= 0 && minutesApart <= 30) {
      conflicts.push({ first, second, minutesApart });
    }
  }

  const freeSlots: string[] = [];
  for (let i = 0; i < sortedByDue.length - 1 && freeSlots.length < 3; i += 1) {
    const current = sortedByDue[i];
    const next = sortedByDue[i + 1];
    if (!current || !next) continue;
    const currentDue = new Date(current.dueAt);
    const nextDue = new Date(next.dueAt);
    const gapMinutes = Math.round((nextDue.getTime() - currentDue.getTime()) / 60000);
    if (gapMinutes >= 90) {
      const start = new Date(currentDue.getTime() + 30 * 60 * 1000);
      freeSlots.push(
        `${start.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} to ${nextDue.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        })}`
      );
    }
  }

  return { nextTask, overdueTasks, upcomingTasks, conflicts, freeSlots };
}

/** True when the user is likely trying to create a new reminder (broad, natural phrasing). */
export function looksLikeCreateIntent(message: string): boolean {
  const n = message.toLowerCase();
  if (/\bremind me to\b/.test(n)) return true;
  if (/\b(create|add|set|make)\s+(a\s+)?reminder\b/.test(n)) return true;
  if (/\b(schedule|set)\s+(a\s+)?(task|meeting|event|appointment|call)\b/.test(n)) return true;
  if (/\b(add|create)\s+to\s+(my\s+)?(calendar|reminders)\b/.test(n)) return true;
  return /\b(create|add|set|make|schedule|remind me)\b/.test(n) && /\b(reminder|remind)\b/.test(n);
}

export function classifyReminderIntent(message: string): ReminderIntent {
  const n = message.toLowerCase().trim();
  if (!n) return "ambiguous";
  if (looksLikeCreateIntent(message)) {
    return "create_reminder";
  }
  if (/\b(update|edit|change|move|reschedule|complete|done|mark|delete|remove|archive)\b/.test(n)) {
    return "update_reminder";
  }
  if (/\b(what should i do right now|what should i do next|what next|next best|top priority|prioritize)\b/.test(n)) {
    return "decision_query";
  }
  if (/\b(plan|planning|schedule my day|organize my day|how should i plan)\b/.test(n)) {
    return "planning_query";
  }
  if (/\b(list|show|which|what|give me|reminders|due today|due tomorrow|upcoming)\b/.test(n)) {
    return "list_reminders";
  }
  return "ambiguous";
}

/** When set (e.g. IANA `Asia/Kolkata`), due times format in the user's zone — required on servers whose default is UTC. */
export type ReminderDisplayOptions = {
  timeZone?: string;
};

function dueTimeLocaleOptions(options?: ReminderDisplayOptions): Intl.DateTimeFormatOptions {
  return {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(options?.timeZone ? { timeZone: options.timeZone } : {}),
  };
}

/** Single-line, human-readable; never emits raw ISO strings */
export function describeReminderForChat(
  reminder: ReminderItem,
  now = new Date(),
  options?: ReminderDisplayOptions
): string {
  const due = new Date(reminder.dueAt);
  const when = due.toLocaleString(undefined, dueTimeLocaleOptions(options));
  const bucket = getReminderBucket(reminder, now);
  const bucketLabel =
    bucket === "missed"
      ? "overdue"
      : bucket === "today"
        ? "today"
        : bucket === "tomorrow"
          ? "tomorrow"
          : bucket === "upcoming"
            ? "later"
            : "";

  let line = `${reminder.title} — ${when}`;
  if (bucketLabel) line += ` (${bucketLabel})`;
  if (reminder.recurrence && reminder.recurrence !== "none") {
    line += `. Repeats ${reminder.recurrence}`;
  }
  if (reminder.notes?.trim()) {
    line += `. Notes: ${reminder.notes.trim()}`;
  }
  return line;
}

export function buildListRemindersReply(
  reminders: ReminderItem[],
  scope: ReminderListScope,
  now = new Date(),
  limit = 5,
  options?: ReminderDisplayOptions
): string {
  const filtered = filterRemindersByListScope(reminders, scope, now).slice(0, Math.max(1, limit));
  if (filtered.length === 0) {
    const scopeHint =
      scope === "future"
        ? "nothing scheduled ahead"
        : scope === "all_pending"
          ? "no pending reminders"
          : scope === "missed"
            ? "no overdue reminders"
            : `no reminders in this view (${scope})`;
    return `You have ${scopeHint}.`;
  }

  const header =
    filtered.length === 1
      ? "Here is your reminder:"
      : `Here are your top ${filtered.length} reminders:`;
  const lines = filtered.map((r, i) => `${i + 1}. ${describeReminderForChat(r, now, options)}`);
  return [header, ...lines].join("\n");
}

/**
 * Map a user message to a list scope, or null if this is not a list/summary query.
 * Colloquial “upcoming” maps to `future` (due >= now), not the strict “later” bucket.
 */
export function inferListScopeFromMessage(message: string): ReminderListScope | null {
  const n = message.toLowerCase().trim();
  if (classifyReminderIntent(message) === "decision_query") return null;
  if (looksLikeCreateIntent(message)) return null;

  // Detail-style questions are handled elsewhere, not as a bulk list
  if (/\bwhat'?s that\b/.test(n)) return null;
  if (/\bwhat time\b/.test(n)) return null;
  if (/\b(which|what) (one|reminder)\b/.test(n) && !/\b(list|show|all|my upcoming|many)\b/.test(n)) {
    return null;
  }

  if (/\b(overdue|missed)\b/.test(n) && /\b(reminder|reminders)\b/.test(n)) return "missed";
  if (/\btomorrow\b/.test(n) && /\b(reminder|reminders|due|scheduled)\b/.test(n)) return "tomorrow";
  if (
    /\b(today|tonight)\b/.test(n)
    && /\b(reminder|reminders|due|scheduled)\b/.test(n)
    && !/\bupcoming\b/.test(n)
  ) {
    return "today";
  }

  if (
    /\b(later|after tomorrow|past tomorrow|next week|upcoming week)\b/.test(n)
    && /\b(reminder|reminders)\b/.test(n)
    && !/\bupcoming\b/.test(n)
  ) {
    return "later";
  }

  if (
    /\b(upcoming|coming up|ahead|scheduled next|what'?s next|what do i have (coming|next))\b/.test(n)
    && /\b(reminder|reminders|appointment|meeting|call)\b/i.test(n)
  ) {
    return "future";
  }

  if (
    /\b(what|which|show|list|tell me|give me|how many)\b/.test(n)
    && /\breminders?\b/.test(n)
  ) {
    if (/\b(all|everything|full)\b/.test(n)) return "all_pending";
    if (/\b(today|tonight)\b/.test(n)) return "today";
    if (/\btomorrow\b/.test(n)) return "tomorrow";
    if (/\b(missed|overdue)\b/.test(n)) return "missed";
    if (/\b(later|after tomorrow)\b/.test(n)) return "later";
    return "future";
  }

  return null;
}

export function inferDetailQueryAboutReminders(message: string): boolean {
  const n = message.toLowerCase().trim();
  if (inferListScopeFromMessage(message)) return false;
  if (/\b(what|which)\s+reminders?\b/.test(n)) return false;

  if (/\b(what'?s that|which one|which reminder|what reminder|more detail)\b/.test(n)) return true;
  if (/\b(tell me (more )?about|details (on|about|for))\b/.test(n)) return true;
  if (/\bwhat time\b/.test(n) && /\b(for|is|was|about|call|meeting|reminder)\b/.test(n)) return true;
  if (
    /\b(about my reminder|my reminder|describe)\b/.test(n)
    && /\b(reminder|call|meeting)\b/.test(n)
  ) {
    return true;
  }
  return false;
}

/**
 * Compound or open-ended questions need the LLM; do not short-circuit with deterministic list/detail.
 */
export function isCompoundReminderQuestion(message: string): boolean {
  const m = message.trim().toLowerCase();
  if (m.length > 180) return true;
  if (/\b(and|but|except|unless|only if|compared to|between|versus|vs\.?|if i|what if|why|how)\b/.test(m)) {
    return true;
  }
  if ((m.match(/\?/g) ?? []).length > 1) return true;
  return false;
}

/** Rich, human-readable block for LLM context (avoid relying on raw ISO in JSON). */
export function buildRemindersContextBlock(
  reminders: ReminderItem[],
  now = new Date(),
  options?: ReminderDisplayOptions
): string {
  const pending = reminders.filter((r) => r.status !== "done");
  const done = reminders.filter((r) => r.status === "done");
  const lines: string[] = [];
  const nowOpts = options?.timeZone ? { timeZone: options.timeZone } : undefined;
  lines.push(`Now (user device context): ${now.toLocaleString(undefined, nowOpts)}`);
  if (options?.timeZone) {
    lines.push(`User time zone (IANA): ${options.timeZone}`);
  }
  lines.push(`Summary: ${pending.length} pending, ${done.length} completed.`);

  const byBucket = (label: string, bucket: ReminderBucket) => {
    const items = pending
      .filter((r) => getReminderBucket(r, now) === bucket)
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
    if (items.length === 0) {
      lines.push(`${label}: none`);
      return;
    }
    lines.push(`${label}:`);
    for (const r of items) {
      lines.push(`  - ${describeReminderForChat(r, now, options)} | id=${r.id}`);
    }
  };

  byBucket("Missed / overdue", "missed");
  byBucket("Today", "today");
  byBucket("Tomorrow", "tomorrow");
  byBucket("Later (after tomorrow)", "upcoming");

  if (done.length > 0) {
    lines.push("Recently completed (sample, up to 5):");
    for (const r of done.slice(0, 5)) {
      lines.push(`  - ${r.title} (done) | id=${r.id}`);
    }
  }

  return lines.join("\n");
}

function answerReminderDetailHeuristic(
  query: string,
  reminders: ReminderItem[],
  now = new Date(),
  options?: ReminderDisplayOptions
): string {
  const normalized = query.toLowerCase();
  const activeReminders = reminders.filter((item) => item.status === "pending");
  if (activeReminders.length === 0) return "You currently have no pending reminders.";

  const scored = activeReminders
    .map((reminder) => {
      const title = reminder.title.toLowerCase();
      if (normalized.includes(title)) return { reminder, score: 100 };
      const tokens = title.split(/\s+/).filter((token) => token.length > 2);
      const score = tokens.reduce(
        (sum, token) => (normalized.includes(token) ? sum + 1 : sum),
        0
      );
      return { reminder, score };
    })
    .sort((a, b) => b.score - a.score);

  if (scored[0] && scored[0].score > 0) {
    return describeReminderForChat(scored[0].reminder, now, options);
  }

  const only = activeReminders[0];
  if (activeReminders.length === 1 && only) {
    return describeReminderForChat(only, now, options);
  }

  const summary = activeReminders
    .slice(0, 5)
    .map((reminder) => describeReminderForChat(reminder, now, options))
    .join("\n");
  return `You have ${activeReminders.length} pending reminders:\n${summary}\n\nSay part of a title if you want one in more detail.`;
}

/**
 * Fast grounded answers without an LLM (list + simple detail). Returns null if unclear.
 */
export function tryGroundedReminderAnswer(
  message: string,
  reminders: ReminderItem[],
  now = new Date(),
  options?: ReminderDisplayOptions
): string | null {
  const intent = classifyReminderIntent(message);
  if (intent === "decision_query") {
    const ranked = rankTasks(reminders, now).slice(0, 3);
    if (ranked.length === 0) return "You have no pending reminders right now.";
    return [
      ranked.length === 1 ? "Your best next task is:" : "Your top next tasks are:",
      ...ranked.map((item, idx) => `${idx + 1}. ${describeReminderForChat(item, now, options)}`),
    ].join("\n");
  }

  if (isCompoundReminderQuestion(message) && intent !== "planning_query") return null;

  const listScope = inferListScopeFromMessage(message);
  if (listScope) {
    if (listScope === "today") {
      const today = filterToday(reminders, now).slice(0, 5);
      if (today.length === 0) return "You have no reminders for today.";
      return [
        today.length === 1 ? "Here is your reminder for today:" : "Here are your reminders for today:",
        ...today.map((r, i) => `${i + 1}. ${describeReminderForChat(r, now, options)}`),
      ].join("\n");
    }
    return buildListRemindersReply(reminders, listScope, now, 5, options);
  }
  if (inferDetailQueryAboutReminders(message)) {
    return answerReminderDetailHeuristic(message, reminders, now, options);
  }
  if (intent === "planning_query") {
    const analysis = analyzeSchedule(reminders, now);
    const lines: string[] = [];
    if (analysis.nextTask) {
      lines.push(`Start with: ${describeReminderForChat(analysis.nextTask, now, options)}`);
    }
    if (analysis.conflicts.length > 0) {
      const c = analysis.conflicts[0];
      if (c) lines.push(`Potential clash: ${c.first.title} and ${c.second.title} are ${c.minutesApart} minutes apart.`);
    }
    if (analysis.freeSlots.length > 0) {
      lines.push(`Free slot: ${analysis.freeSlots[0]}`);
    }
    return lines.join("\n") || "You have no pending reminders to plan right now.";
  }
  return null;
}

export interface NvidiaNimProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "meta/llama-3.1-70b-instruct";

export function createNvidiaNimChatProvider(
  options: NvidiaNimProviderOptions
): ReminderChatProvider {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const model = options.model ?? DEFAULT_MODEL;

  return {
    async complete(request) {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: request.model ?? model,
          messages: request.messages,
          temperature: request.temperature ?? 0.3,
          max_tokens: request.maxTokens ?? 500,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`NIM request failed (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error("NIM response did not include assistant content.");
      }

      return content;
    },
  };
}

export {
  buildBriefingNarrative,
  buildFollowUpQuestions,
  replaceFollowUpSlot,
  type FollowUpQuestion,
  type TaskItemBrief,
} from "./briefing-and-followups";
