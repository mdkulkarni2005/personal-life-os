import { auth } from "@clerk/nextjs/server";
import { api } from "@repo/db/convex/api";
import { NextResponse } from "next/server";
import { getConvexClient } from "../../../../lib/server/convex-client";

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

type ReminderRecurrence = "none" | "daily" | "weekly" | "monthly";

interface ImportReminderInput {
  title: string;
  dueAt: number | string;
  notes?: string;
  recurrence?: ReminderRecurrence;
  priority?: number;
  urgency?: number;
  tags?: string[];
  status?: "pending" | "done" | "archived";
  linkedTaskId?: string;
  linkedTaskRef?: string;
  taskRef?: string;
  taskKey?: string;
  linkedTaskTitle?: string;
  taskTitle?: string;
  domain?: LifeDomain;
}

type LifeDomain = "health" | "finance" | "career" | "hobby" | "fun";

type ReminderTaskLink =
  | { kind: "taskIndex"; index: number }
  | { kind: "taskRef"; ref: string }
  | { kind: "taskId"; taskId: string }
  | { kind: "taskTitle"; title: string };

interface ImportTaskInput {
  title: string;
  notes?: string;
  dueAt?: number | string | null;
  status?: "pending" | "done";
  priority?: number;
  domain?: LifeDomain;
  ref?: string;
  key?: string;
  importKey?: string;
  reminders?: ImportReminderInput[];
}

interface ImportRequestBody {
  reminders?: ImportReminderInput[];
  tasks?: ImportTaskInput[];
}

const allowedRecurrence = new Set<ReminderRecurrence>([
  "none",
  "daily",
  "weekly",
  "monthly",
]);

const allowedDomain = new Set<LifeDomain>([
  "health",
  "finance",
  "career",
  "hobby",
  "fun",
]);

function normalizeDueAt(value: number | string): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTaskDueAt(value: number | string | null | undefined): number | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRef(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeReminder(
  value: unknown
): {
  ok: true;
  value: {
    title: string;
    dueAt: number;
    notes?: string;
    recurrence: ReminderRecurrence;
    priority?: number;
    urgency?: number;
    tags?: string[];
    status?: "pending" | "done" | "archived";
    linkedTask?: ReminderTaskLink;
    domain?: LifeDomain;
  };
} | {
  ok: false;
  error: string;
} {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "Each reminder must be an object." };
  }

  const input = value as Partial<ImportReminderInput>;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) {
    return { ok: false, error: "title is required and must be a non-empty string." };
  }

  if (input.dueAt === undefined || input.dueAt === null) {
    return { ok: false, error: "dueAt is required." };
  }
  const dueAt = normalizeDueAt(input.dueAt);
  if (dueAt === null) {
    return { ok: false, error: "dueAt must be a valid unix timestamp (ms) or ISO date string." };
  }

  const recurrenceRaw = input.recurrence ?? "none";
  if (!allowedRecurrence.has(recurrenceRaw)) {
    return { ok: false, error: "recurrence must be one of none, daily, weekly, monthly." };
  }

  const notes = typeof input.notes === "string" ? input.notes : undefined;
  const priority = typeof input.priority === "number" && Number.isFinite(input.priority)
    ? input.priority
    : undefined;
  const urgency = typeof input.urgency === "number" && Number.isFinite(input.urgency)
    ? input.urgency
    : undefined;
  const tags = Array.isArray(input.tags)
    ? input.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : undefined;
  const status = input.status === "done" || input.status === "archived" || input.status === "pending"
    ? input.status
    : undefined;
  const domain = input.domain && allowedDomain.has(input.domain) ? input.domain : undefined;

  const linkedTaskId =
    typeof input.linkedTaskId === "string" && input.linkedTaskId.trim()
      ? input.linkedTaskId.trim()
      : null;
  const linkedTaskRefRaw =
    typeof input.linkedTaskRef === "string" && input.linkedTaskRef.trim()
      ? input.linkedTaskRef
      : typeof input.taskRef === "string" && input.taskRef.trim()
        ? input.taskRef
        : typeof input.taskKey === "string" && input.taskKey.trim()
          ? input.taskKey
          : null;
  const linkedTaskTitle =
    typeof input.linkedTaskTitle === "string" && input.linkedTaskTitle.trim()
      ? input.linkedTaskTitle.trim()
      : typeof input.taskTitle === "string" && input.taskTitle.trim()
        ? input.taskTitle.trim()
        : null;

  const linkedTask: ReminderTaskLink | undefined = linkedTaskId
    ? { kind: "taskId", taskId: linkedTaskId }
    : linkedTaskRefRaw
      ? { kind: "taskRef", ref: normalizeRef(linkedTaskRefRaw) }
      : linkedTaskTitle
        ? { kind: "taskTitle", title: linkedTaskTitle }
        : undefined;
  return {
    ok: true,
    value: {
      title,
      dueAt,
      notes,
      recurrence: recurrenceRaw,
      priority,
      urgency,
      tags,
      status,
      linkedTask,
      domain,
    },
  };
}

function normalizeTask(
  value: unknown
): {
  ok: true;
  value: {
    title: string;
    notes?: string;
    dueAt?: number;
    status: "pending" | "done";
    priority?: number;
    domain?: LifeDomain;
    ref?: string;
    reminders: Array<{
      title: string;
      dueAt: number;
      notes?: string;
      recurrence: ReminderRecurrence;
      priority?: number;
      urgency?: number;
      tags?: string[];
      status?: "pending" | "done" | "archived";
      linkedTask?: ReminderTaskLink;
      domain?: LifeDomain;
    }>;
  };
} | {
  ok: false;
  error: string;
} {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "Each task must be an object." };
  }

  const input = value as Partial<ImportTaskInput>;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) {
    return { ok: false, error: "title is required and must be a non-empty string." };
  }

  const dueAt = normalizeTaskDueAt(input.dueAt);
  if (dueAt === null) {
    return { ok: false, error: "dueAt must be a valid unix timestamp (ms), ISO date string, or null." };
  }

  const status = input.status === "done" ? "done" : "pending";
  const notes = typeof input.notes === "string" ? input.notes : undefined;
  const priority =
    typeof input.priority === "number" && Number.isFinite(input.priority)
      ? Math.max(1, Math.min(5, Math.round(input.priority)))
      : undefined;
  const domain = input.domain && allowedDomain.has(input.domain) ? input.domain : undefined;

  const rawRef =
    typeof input.ref === "string" && input.ref.trim()
      ? input.ref
      : typeof input.key === "string" && input.key.trim()
        ? input.key
        : typeof input.importKey === "string" && input.importKey.trim()
          ? input.importKey
          : undefined;
  const ref = rawRef ? normalizeRef(rawRef) : undefined;

  const remindersRaw = Array.isArray(input.reminders) ? input.reminders : [];
  const reminders: Array<{
    title: string;
    dueAt: number;
    notes?: string;
    recurrence: ReminderRecurrence;
    priority?: number;
    urgency?: number;
    tags?: string[];
    status?: "pending" | "done" | "archived";
    linkedTask?: ReminderTaskLink;
    domain?: LifeDomain;
  }> = [];

  for (const [index, rawReminder] of remindersRaw.entries()) {
    const parsed = normalizeReminder(rawReminder);
    if (!parsed.ok) {
      return {
        ok: false,
        error: `Invalid nested reminder at index ${index}: ${parsed.error}`,
      };
    }
    reminders.push(parsed.value);
  }

  return {
    ok: true,
    value: {
      title,
      notes,
      dueAt: dueAt === undefined ? undefined : dueAt,
      status,
      priority,
      domain,
      ref,
      reminders,
    },
  };
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = (await request.json()) as unknown;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const remindersInput = Array.isArray(body)
    ? body
    : (body as ImportRequestBody)?.reminders;
  const tasksInput =
    !Array.isArray(body) && body && typeof body === "object"
      ? (body as ImportRequestBody).tasks
      : undefined;

  const hasReminders = Array.isArray(remindersInput) && remindersInput.length > 0;
  const hasTasks = Array.isArray(tasksInput) && tasksInput.length > 0;

  if (!hasReminders && !hasTasks) {
    return NextResponse.json(
      {
        error:
          "Body must include reminders and/or tasks. Supported formats: [...reminders], { reminders: [...] }, or { tasks: [...], reminders: [...] }.",
      },
      { status: 400 }
    );
  }

  const normalizedReminders: Array<{
    title: string;
    dueAt: number;
    notes?: string;
    recurrence: ReminderRecurrence;
    priority?: number;
    urgency?: number;
    tags?: string[];
    status?: "pending" | "done" | "archived";
    linkedTask?: ReminderTaskLink;
    domain?: LifeDomain;
  }> = [];

  const normalizedTasks: Array<{
    title: string;
    notes?: string;
    dueAt?: number;
    status: "pending" | "done";
    priority?: number;
    domain?: LifeDomain;
    ref?: string;
    reminders: Array<{
      title: string;
      dueAt: number;
      notes?: string;
      recurrence: ReminderRecurrence;
      priority?: number;
      urgency?: number;
      tags?: string[];
      status?: "pending" | "done" | "archived";
      linkedTask?: ReminderTaskLink;
      domain?: LifeDomain;
    }>;
  }> = [];

  if (hasTasks) {
    for (const [index, rawTask] of (tasksInput ?? []).entries()) {
      const parsed = normalizeTask(rawTask);
      if (!parsed.ok) {
        return NextResponse.json(
          {
            error: `Invalid task at index ${index}: ${parsed.error}`,
          },
          { status: 400 }
        );
      }
      normalizedTasks.push(parsed.value);
    }
  }

  if (hasReminders) {
    for (const [index, rawReminder] of (remindersInput ?? []).entries()) {
      const parsed = normalizeReminder(rawReminder);
      if (!parsed.ok) {
        return NextResponse.json(
          {
            error: `Invalid reminder at index ${index}: ${parsed.error}`,
          },
          { status: 400 }
        );
      }
      normalizedReminders.push(parsed.value);
    }
  }

  const reminderRows: Array<{
    title: string;
    dueAt: number;
    notes?: string;
    recurrence: ReminderRecurrence;
    priority?: number;
    urgency?: number;
    tags?: string[];
    status?: "pending" | "done" | "archived";
    linkedTask?: ReminderTaskLink;
    domain?: LifeDomain;
  }> = [...normalizedReminders];

  for (const [taskIndex, task] of normalizedTasks.entries()) {
    for (const nestedReminder of task.reminders) {
      reminderRows.push({
        ...nestedReminder,
        linkedTask: { kind: "taskIndex", index: taskIndex },
      });
    }
  }

  try {
    const client = getConvexClient();
    const createdTasks: Array<unknown> = [];
    const createdTaskIdsByIndex: string[] = [];
    const createdTaskIdsByRef = new Map<string, string>();
    const createdTaskIdsByTitle = new Map<string, string | null>();

    for (const task of normalizedTasks) {
      const createdTask = await client.mutation(api.tasks.create, {
        userId,
        title: task.title,
        notes: task.notes,
        dueAt: task.dueAt,
        status: task.status,
        priority: task.priority,
        domain: task.domain,
      });

      createdTasks.push(createdTask);
      const createdTaskId =
        createdTask && typeof createdTask === "object" && "_id" in createdTask
          ? String(createdTask._id)
          : "";
      createdTaskIdsByIndex.push(createdTaskId);

      if (task.ref && createdTaskId) {
        if (createdTaskIdsByRef.has(task.ref)) {
          return NextResponse.json(
            {
              error: `Duplicate task ref detected: \"${task.ref}\". Task refs must be unique in a single import payload.`,
            },
            { status: 400 }
          );
        }
        createdTaskIdsByRef.set(task.ref, createdTaskId);
      }

      if (createdTaskId) {
        const normalizedTitle = normalizeRef(task.title);
        if (!createdTaskIdsByTitle.has(normalizedTitle)) {
          createdTaskIdsByTitle.set(normalizedTitle, createdTaskId);
        } else {
          createdTaskIdsByTitle.set(normalizedTitle, null);
        }
      }
    }

    const existingTasks = await client.query(api.tasks.listForUser, { userId });
    const existingTaskIds = new Set(existingTasks.map((task) => String(task._id)));
    const existingTaskIdsByTitle = new Map<string, string | null>();
    for (const task of existingTasks) {
      const normalizedTitle = normalizeRef(task.title);
      const value = String(task._id);
      if (!existingTaskIdsByTitle.has(normalizedTitle)) {
        existingTaskIdsByTitle.set(normalizedTitle, value);
      } else {
        existingTaskIdsByTitle.set(normalizedTitle, null);
      }
    }

    const resolveLinkedTaskId = (link?: ReminderTaskLink): string | undefined => {
      if (!link) return undefined;
      if (link.kind === "taskIndex") {
        return createdTaskIdsByIndex[link.index];
      }
      if (link.kind === "taskRef") {
        return createdTaskIdsByRef.get(link.ref);
      }
      if (link.kind === "taskId") {
        if (existingTaskIds.has(link.taskId)) {
          return link.taskId;
        }
        return createdTaskIdsByRef.get(normalizeRef(link.taskId));
      }

      const normalizedTitle = normalizeRef(link.title);
      const created = createdTaskIdsByTitle.get(normalizedTitle);
      if (created !== undefined) return created ?? undefined;
      const existing = existingTaskIdsByTitle.get(normalizedTitle);
      return existing ?? undefined;
    };

    const createdReminders: Array<unknown> = [];
    for (const [index, reminder] of reminderRows.entries()) {
      const linkedTaskId = resolveLinkedTaskId(reminder.linkedTask);

      if (reminder.linkedTask && !linkedTaskId) {
        return NextResponse.json(
          {
            error: `Could not resolve linked task for reminder at import index ${index}.`,
          },
          { status: 400 }
        );
      }

      const result = await client.mutation(api.reminders.create, {
        userId,
        title: reminder.title,
        notes: reminder.notes,
        dueAt: reminder.dueAt,
        recurrence: reminder.recurrence,
        priority: reminder.priority,
        urgency: reminder.urgency,
        tags: reminder.tags,
        status: reminder.status ?? "pending",
        linkedTaskId: linkedTaskId as any,
        domain: reminder.domain,
      });
      createdReminders.push(result);
    }

    return NextResponse.json({
      createdReminderCount: createdReminders.length,
      createdTaskCount: createdTasks.length,
      createdCount: createdReminders.length,
      createdReminders,
      createdTasks,
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
