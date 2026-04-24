import { resolveE2EEnv } from "./e2e-env";

export type ReminderRecurrence = "none" | "daily" | "weekly" | "monthly";
export type LifeDomain = "health" | "finance" | "career" | "hobby" | "fun";

export interface TaskSeed {
  title: string;
  notes: string;
  priority: number;
  domain: LifeDomain;
  dueAt: Date;
}

export interface ReminderSeed {
  title: string;
  notes: string;
  priority: number;
  recurrence: ReminderRecurrence;
  domain: LifeDomain;
  taskTitle: string;
  dueAt: Date;
}

export interface TaskReminderMatrixRow {
  task: TaskSeed;
  reminders: ReminderSeed[];
}

const DOMAINS: LifeDomain[] = ["health", "finance", "career", "hobby", "fun"];
const RECURRENCES: ReminderRecurrence[] = ["daily", "weekly", "monthly", "none"];
const HEAVY_REMINDER_OFFSETS_MINUTES = [
  60,
  90,
  120,
  180,
  240,
  360,
  720,
  24 * 60 + 45,
  24 * 60 + 120,
  24 * 60 + 240,
  2 * 24 * 60 + 60,
  2 * 24 * 60 + 180,
  3 * 24 * 60 + 120,
  4 * 24 * 60 + 90,
  5 * 24 * 60 + 180,
];

export function getTestTimeZone() {
  return resolveE2EEnv("E2E_TIMEZONE_ID") ?? "Asia/Kolkata";
}

function dateParts(date: Date, timeZone = getTestTimeZone()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<string, string>;
}

function timeParts(date: Date, timeZone = getTestTimeZone()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<string, string>;
}

export function formatDateInput(date: Date, timeZone = getTestTimeZone()) {
  const parts = dateParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatTimeInput(date: Date, timeZone = getTestTimeZone()) {
  const parts = timeParts(date, timeZone);
  return `${parts.hour}:${parts.minute}`;
}

export function formatDateTimeLocalInput(date: Date, timeZone = getTestTimeZone()) {
  return `${formatDateInput(date, timeZone)}T${formatTimeInput(date, timeZone)}`;
}

export function offsetDate(
  base: Date,
  offset: { days?: number; hours?: number; minutes?: number },
) {
  return new Date(
    base.getTime() +
      (offset.days ?? 0) * 24 * 60 * 60 * 1000 +
      (offset.hours ?? 0) * 60 * 60 * 1000 +
      (offset.minutes ?? 0) * 60 * 1000,
  );
}

export function uniqueName(prefix: string) {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildTaskReminderMatrix(base = new Date(), prefix = uniqueName("Matrix")) {
  return Array.from({ length: 10 }, (_, taskIndex): TaskReminderMatrixRow => {
    const taskTitle = `${prefix} Task ${String(taskIndex + 1).padStart(2, "0")}`;
    const taskDomain = DOMAINS[taskIndex % DOMAINS.length]!;
    const taskDueAt = offsetDate(base, { days: taskIndex % 4, hours: 6 + (taskIndex % 5) });

    return {
      task: {
        title: taskTitle,
        notes: `Regression task ${taskIndex + 1} covering linked reminders and persistence.`,
        priority: (taskIndex % 5) + 1,
        domain: taskDomain,
        dueAt: taskDueAt,
      },
      reminders: Array.from({ length: 15 }, (_, reminderIndex) => {
        const offsetMinutes = HEAVY_REMINDER_OFFSETS_MINUTES[reminderIndex]!;
        const dueAt = offsetDate(base, { minutes: offsetMinutes + taskIndex * 25 });
        return {
          title: `${taskTitle} Reminder ${String(reminderIndex + 1).padStart(2, "0")}`,
          notes: `Matrix reminder ${reminderIndex + 1} for ${taskTitle}.`,
          priority: (reminderIndex % 5) + 1,
          recurrence: RECURRENCES[reminderIndex % RECURRENCES.length]!,
          domain: taskDomain,
          taskTitle,
          dueAt,
        } satisfies ReminderSeed;
      }),
    };
  });
}
