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

export type ReminderStatus = "pending" | "done";
export type ReminderRecurrence = "none" | "daily" | "weekly" | "monthly";

export interface ReminderItem {
  id: string;
  title: string;
  dueAt: string;
  recurrence?: ReminderRecurrence;
  notes?: string;
  status: ReminderStatus;
  createdAt: string;
  updatedAt: string;
}

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

/** Single-line, human-readable; never emits raw ISO strings */
export function describeReminderForChat(reminder: ReminderItem, now = new Date()): string {
  const due = new Date(reminder.dueAt);
  const when = due.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
  now = new Date()
): string {
  const filtered = filterRemindersByListScope(reminders, scope, now);
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
      : `Here are your ${filtered.length} reminders:`;
  const lines = filtered.map((r, i) => `${i + 1}. ${describeReminderForChat(r, now)}`);
  return [header, ...lines].join("\n");
}

/**
 * Map a user message to a list scope, or null if this is not a list/summary query.
 * Colloquial “upcoming” maps to `future` (due >= now), not the strict “later” bucket.
 */
export function inferListScopeFromMessage(message: string): ReminderListScope | null {
  const n = message.toLowerCase().trim();
  const looksLikeCreate =
    /\b(create|add|set|make|schedule)\b/i.test(n) && /\b(reminder|remind)\b/i.test(n);
  if (looksLikeCreate) return null;

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
export function buildRemindersContextBlock(reminders: ReminderItem[], now = new Date()): string {
  const pending = reminders.filter((r) => r.status !== "done");
  const done = reminders.filter((r) => r.status === "done");
  const lines: string[] = [];
  lines.push(`Now (user device context): ${now.toLocaleString()}`);
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
      lines.push(`  - ${describeReminderForChat(r, now)} | id=${r.id}`);
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

function answerReminderDetailHeuristic(query: string, reminders: ReminderItem[], now = new Date()): string {
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
    return describeReminderForChat(scored[0].reminder, now);
  }

  const only = activeReminders[0];
  if (activeReminders.length === 1 && only) {
    return describeReminderForChat(only, now);
  }

  const summary = activeReminders
    .slice(0, 5)
    .map((reminder) => describeReminderForChat(reminder, now))
    .join("\n");
  return `You have ${activeReminders.length} pending reminders:\n${summary}\n\nSay part of a title if you want one in more detail.`;
}

/**
 * Fast grounded answers without an LLM (list + simple detail). Returns null if unclear.
 */
export function tryGroundedReminderAnswer(message: string, reminders: ReminderItem[], now = new Date()): string | null {
  if (isCompoundReminderQuestion(message)) return null;

  const listScope = inferListScopeFromMessage(message);
  if (listScope) {
    return buildListRemindersReply(reminders, listScope, now);
  }
  if (inferDetailQueryAboutReminders(message)) {
    return answerReminderDetailHeuristic(message, reminders, now);
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
