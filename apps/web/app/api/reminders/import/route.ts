import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getConvexClient } from "../../../../lib/server/convex-client";

type ReminderRecurrence = "none" | "daily" | "weekly" | "monthly";

interface ImportReminderInput {
  title: string;
  dueAt: number | string;
  notes?: string;
  recurrence?: ReminderRecurrence;
}

interface ImportRequestBody {
  reminders?: ImportReminderInput[];
}

const allowedRecurrence = new Set<ReminderRecurrence>([
  "none",
  "daily",
  "weekly",
  "monthly",
]);

function normalizeDueAt(value: number | string): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeReminder(
  value: unknown
): { ok: true; value: { title: string; dueAt: number; notes?: string; recurrence: ReminderRecurrence } } | {
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
  return {
    ok: true,
    value: {
      title,
      dueAt,
      notes,
      recurrence: recurrenceRaw,
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

  if (!Array.isArray(remindersInput) || remindersInput.length === 0) {
    return NextResponse.json(
      {
        error:
          "Body must be either an array of reminders or an object like { reminders: [...] }.",
      },
      { status: 400 }
    );
  }

  const normalized: Array<{
    title: string;
    dueAt: number;
    notes?: string;
    recurrence: ReminderRecurrence;
  }> = [];

  for (const [index, rawReminder] of remindersInput.entries()) {
    const parsed = normalizeReminder(rawReminder);
    if (!parsed.ok) {
      return NextResponse.json(
        {
          error: `Invalid reminder at index ${index}: ${parsed.error}`,
        },
        { status: 400 }
      );
    }
    normalized.push(parsed.value);
  }

  const client = getConvexClient();
  const created: Array<unknown> = [];
  for (const reminder of normalized) {
    const result = await client.mutation("reminders:create" as any, {
      userId,
      title: reminder.title,
      notes: reminder.notes,
      dueAt: reminder.dueAt,
      recurrence: reminder.recurrence,
    });
    created.push(result);
  }

  return NextResponse.json({
    createdCount: created.length,
    created,
  });
}
