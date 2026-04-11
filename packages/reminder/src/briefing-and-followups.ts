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

/** Short narrative: missed (up to 3 oldest overdue) + upcoming (next 3). */
export function buildBriefingNarrative(
  reminders: ReminderItem[],
  _firstName?: string | null,
  now = new Date()
): string {
  const pending = reminders.filter((r) => r.status !== "done" && r.status !== "archived");
  const missed = pending
    .filter((r) => bucketOf(r, now) === "missed")
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  const missedPick = missed.slice(0, 3);

  const upcomingPool = pending
    .filter((r) => bucketOf(r, now) !== "missed")
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  const upcomingPick = upcomingPool.slice(0, 3);

  const lines: string[] = [];
  lines.push("Here is your quick briefing.");

  if (missed.length === 0 && upcomingPick.length === 0) {
    lines.push("No pending reminders on your list—nice and clear.");
    return lines.join("\n");
  }

  if (missed.length > 0) {
    lines.push(
      missed.length > 3
        ? `You have ${missed.length} overdue reminders; focusing on the ${missedPick.length} earliest:`
        : `Overdue (${missed.length}):`
    );
    for (const m of missedPick) {
      lines.push(`• ${m.title} — was due ${fmtTime(m.dueAt)}`);
    }
  } else {
    lines.push("Nothing overdue.");
  }

  if (upcomingPick.length > 0) {
    lines.push(
      upcomingPool.length > 3
        ? `Next up (${upcomingPick.length} of ${upcomingPool.length} upcoming):`
        : "Coming up:"
    );
    for (const u of upcomingPick) {
      lines.push(`• ${u.title} — ${fmtTime(u.dueAt)}`);
    }
  } else if (missed.length === 0) {
    lines.push("No further upcoming times scheduled.");
  }

  lines.push("Ask me anything about these, or say what you want to reschedule.");
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
