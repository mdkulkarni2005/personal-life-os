import type { ReminderItem } from "./index";

type Bucket = "missed" | "today" | "tomorrow" | "upcoming" | "done";

function bucketOf(reminder: ReminderItem, now: Date): Bucket {
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

export interface TaskItemBrief {
  id: string;
  title: string;
  dueAt?: string;
  status: "pending" | "done";
}

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtUpdated(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * Full session briefing: greeting + completed + overdue + today + tomorrow + later upcoming (all items per section).
 */
export function buildBriefingNarrative(
  reminders: ReminderItem[],
  firstName?: string | null,
  now = new Date()
): string {
  const name = firstName?.trim();
  const greet = name
    ? `Hello, ${name} — this is your briefing.`
    : "Hello — this is your briefing.";

  const active = reminders.filter((r) => r.status !== "done" && r.status !== "archived");
  const completed = reminders
    .filter((r) => r.status === "done")
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const missed = active
    .filter((r) => bucketOf(r, now) === "missed")
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  const today = active
    .filter((r) => bucketOf(r, now) === "today")
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  const tomorrow = active
    .filter((r) => bucketOf(r, now) === "tomorrow")
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  const later = active
    .filter((r) => bucketOf(r, now) === "upcoming")
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

  const lines: string[] = [greet, ""];

  lines.push(`COMPLETED (${completed.length})`);
  if (completed.length === 0) {
    lines.push("• None yet.");
  } else {
    for (const r of completed) {
      lines.push(`• ${r.title} — completed ${fmtUpdated(r.updatedAt)}`);
    }
  }
  lines.push("");

  lines.push(`OVERDUE / MISSED (${missed.length})`);
  if (missed.length === 0) {
    lines.push("• None — you're caught up on overdue items.");
  } else {
    for (const m of missed) {
      lines.push(`• ${m.title} — was due ${fmtTime(m.dueAt)}`);
    }
  }
  lines.push("");

  lines.push(`TODAY (${today.length})`);
  if (today.length === 0) {
    lines.push("• Nothing else scheduled for today.");
  } else {
    for (const r of today) {
      lines.push(`• ${r.title} — ${fmtTime(r.dueAt)}`);
    }
  }
  lines.push("");

  lines.push(`TOMORROW (${tomorrow.length})`);
  if (tomorrow.length === 0) {
    lines.push("• Nothing scheduled for tomorrow yet.");
  } else {
    for (const r of tomorrow) {
      lines.push(`• ${r.title} — ${fmtTime(r.dueAt)}`);
    }
  }
  lines.push("");

  lines.push(`COMING UP LATER (${later.length})`);
  if (later.length === 0) {
    lines.push("• Nothing further out on the calendar.");
  } else {
    for (const r of later) {
      lines.push(`• ${r.title} — ${fmtTime(r.dueAt)}`);
    }
  }

  lines.push("");
  lines.push("Ask me anything about these, or tell me what to reschedule.");

  return lines.join("\n");
}

export type FollowUpQuestion = {
  text: string;
  kind: "info" | "action";
};

/**
 * Two information-seeking questions + one actionable suggestion, from current reminder/task context.
 */
export function buildFollowUpQuestions(input: {
  reminders: ReminderItem[];
  tasks?: TaskItemBrief[];
  lastUserMessage?: string;
  firstName?: string | null;
  now?: Date;
}): FollowUpQuestion[] {
  const now = input.now ?? new Date();
  const name = input.firstName?.trim();
  const pending = input.reminders.filter((r) => r.status !== "done" && r.status !== "archived");
  const missed = pending.filter((r) => bucketOf(r, now) === "missed");
  const today = pending.filter((r) => bucketOf(r, now) === "today");
  const upcoming = pending
    .filter((r) => {
      const b = bucketOf(r, now);
      return b === "tomorrow" || b === "upcoming";
    })
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

  const tasks = input.tasks?.filter((t) => t.status === "pending") ?? [];
  const taskMissed = tasks.filter((t) => t.dueAt && new Date(t.dueAt).getTime() < now.getTime());
  const taskNoDate = tasks.filter((t) => !t.dueAt);

  const info: FollowUpQuestion[] = [];
  const actions: FollowUpQuestion[] = [];

  if (missed.length > 0 && missed[0]) {
    info.push({
      kind: "info",
      text: `Why is "${missed[0].title.slice(0, 42)}${missed[0].title.length > 42 ? "…" : ""}" overdue?`,
    });
  } else if (today.length > 0 && today[0]) {
    info.push({
      kind: "info",
      text: `What should I prioritize before "${today[0].title.slice(0, 40)}${today[0].title.length > 40 ? "…" : ""}" today?`,
    });
  } else {
    info.push({
      kind: "info",
      text: name
        ? `${name}, what feels most important to lock in this week?`
        : "What feels most important to lock in this week?",
    });
  }

  if (upcoming.length > 0 && upcoming[0]) {
    info.push({
      kind: "info",
      text: `How much time should I plan for "${upcoming[0].title.slice(0, 38)}${upcoming[0].title.length > 38 ? "…" : ""}"?`,
    });
  } else if (today.length > 1) {
    info.push({
      kind: "info",
      text: "Do any of today's reminders conflict with each other?",
    });
  } else {
    info.push({
      kind: "info",
      text: "Summarize what's due tomorrow vs later this week.",
    });
  }

  if (taskMissed.length > 0 && taskMissed[0]) {
    actions.push({
      kind: "action",
      text: `Mark task "${taskMissed[0].title.slice(0, 36)}${taskMissed[0].title.length > 36 ? "…" : ""}" done or move it?`,
    });
  } else if (missed.length > 0 && missed[0]) {
    actions.push({
      kind: "action",
      text: `Should I reschedule "${missed[0].title.slice(0, 36)}${missed[0].title.length > 36 ? "…" : ""}" to a new time?`,
    });
  } else if (today.length > 0 && today[0]) {
    actions.push({
      kind: "action",
      text: `Mark "${today[0].title.slice(0, 40)}${today[0].title.length > 40 ? "…" : ""}" as done?`,
    });
  } else if (taskNoDate.length > 0 && taskNoDate[0]) {
    actions.push({
      kind: "action",
      text: `Add a due time to "${taskNoDate[0].title.slice(0, 36)}${taskNoDate[0].title.length > 36 ? "…" : ""}"?`,
    });
  } else {
    actions.push({
      kind: "action",
      text: "Create a new reminder for something you're worried about forgetting?",
    });
  }

  const last = input.lastUserMessage?.toLowerCase() ?? "";
  if (/schedule|time|calendar|busy/i.test(last) && actions.length > 0) {
    actions[0] = {
      kind: "action",
      text: "Want me to find a free slot later today for your next reminder?",
    };
  }

  return [info[0]!, info[1]!, actions[0]!];
}

const INFO_ROTATION_EXTRAS: FollowUpQuestion[] = [
  { kind: "info", text: "What is the single best use of the next hour?" },
  { kind: "info", text: "What would make today feel successful?" },
  { kind: "info", text: "Anything you are avoiding that we should name?" },
  { kind: "info", text: "Which reminder feels most uncertain on timing?" },
  { kind: "info", text: "What should I know about your energy level today?" },
  { kind: "info", text: "Compare what is due today vs later this week." },
];

const ACTION_ROTATION_EXTRAS: FollowUpQuestion[] = [
  { kind: "action", text: "Snooze everything non-critical by one day?" },
  { kind: "action", text: "Create a reminder for something small you keep forgetting?" },
  { kind: "action", text: "Mark one overdue item done or reschedule it?" },
  { kind: "action", text: "Add a 15-minute prep reminder before your next due time?" },
  { kind: "action", text: "Set a softer time for your most stressful item?" },
  { kind: "action", text: "Archive or delete a reminder you no longer need?" },
];

/**
 * Replace one suggested-question slot with a new question (not duplicating the other two chips).
 */
export function replaceFollowUpSlot(
  current: FollowUpQuestion[],
  slotIndex: 0 | 1 | 2,
  input: Parameters<typeof buildFollowUpQuestions>[0]
): FollowUpQuestion[] {
  const kind: "info" | "action" = slotIndex === 2 ? "action" : "info";
  const base = current.length >= 3 ? [...current] : buildFollowUpQuestions(input);
  const fresh = buildFollowUpQuestions(input);
  const extras = kind === "info" ? INFO_ROTATION_EXTRAS : ACTION_ROTATION_EXTRAS;
  const pool: FollowUpQuestion[] = [];
  const seen = new Set<string>();
  const add = (q: FollowUpQuestion) => {
    if (q.kind !== kind || seen.has(q.text)) return;
    seen.add(q.text);
    pool.push(q);
  };
  for (const q of fresh) add(q);
  for (const q of extras) add(q);

  const exclude = new Set(base.map((x) => x.text));
  const pick =
    pool.find((q) => !exclude.has(q.text))
    ?? pool.find((q) => q.text !== base[slotIndex]?.text)
    ?? base[slotIndex]!;
  const out = [...base];
  out[slotIndex] = { kind, text: pick.text };
  return out;
}
