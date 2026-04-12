import { auth } from "@clerk/nextjs/server";
import {
  analyzeSchedule,
  buildLifeOsContextBlock,
  buildListRemindersReply,
  classifyReminderIntent,
  filterToday,
  inferListScopeFromMessage,
  isCompoundReminderQuestion,
  looksLikeCreateIntent,
  rankTasks,
  tryGroundedReminderAnswer,
  type ReminderListScope,
  type LifeDomain,
  type ReminderItem,
  type TaskItem,
} from "@repo/reminder";
import { api } from "@repo/db/convex/api";
import { NextResponse } from "next/server";
import { getConvexClient } from "../../../lib/server/convex-client";
import {
  buildMessageWithReplyContext,
  type ReplyContextPayload,
} from "../../../lib/chat-reply-context";

type ReminderAgentActionType =
  | "create_reminder"
  | "list_reminders"
  | "mark_done"
  | "delete_reminder"
  | "reschedule_reminder"
  | "clarify"
  | "unknown";

interface ReminderAgentAction {
  type: ReminderAgentActionType;
  title?: string;
  dueAt?: string;
  notes?: string;
  targetTitle?: string;
  targetId?: string;
  scope?: "today" | "tomorrow" | "missed" | "done" | "pending" | "all";
}

interface ReminderAgentResponse {
  reply: string;
  action: ReminderAgentAction;
}

const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "meta/llama-3.1-70b-instruct";
const systemPrompt = `You are the RemindOS assistant for Personal Life OS. You help with the user's reminders and tasks (orchestration layer).

DATA RULES (critical):
- The LIFE OS DIGEST (tasks + reminders) and JSON below are the ONLY source of truth. Do not invent, rename, or assume items.
- Reminders may link to a task (see task id / task title in digest). If a reminder has no linked task, it is labeled ADHOC (standalone).
- Optional domain tags (health, finance, career, hobby, fun) may appear on reminders and tasks.
- If the answer is not in the data, say you do not see that in their data and suggest what they could ask instead.
- Never paste raw ISO-8601 timestamps in "reply". Use natural language dates/times. The digest lists due times in the user's time zone—quote them exactly as shown.

WHAT YOU CAN DO:
- Answer questions about reminders and tasks: schedules, conflicts, "what's next", which reminders belong to which task, ADHOC vs task-linked, domains, comparisons, counts, overdue, notes, recurrence.
- Small talk or unrelated topics: politely redirect to reminders and tasks.

ACTIONS (JSON action.type):
- list_reminders: user wants a simple list or roll-up by period (server may replace reply with a grounded list).
- mark_done: user wants to complete; set targetTitle or targetId from digest.
- delete_reminder: user wants to remove; set targetTitle or targetId.
- reschedule_reminder: user wants a new time; set dueAt as ISO in action only, targetTitle/targetId.
- create_reminder: only if user clearly wants to create (usually already handled earlier).
- clarify: you need one missing piece (which reminder, which time).
- unknown: questions you answer in "reply" only (no database change). Use for explanations, reasoning, comparisons, and open-ended Q&A grounded in the digest.

Keep "reply" helpful and concise but include enough detail (titles, times, notes) when relevant.

Output ONLY valid JSON:
{
  "reply":"string",
  "action":{
    "type":"create_reminder|list_reminders|mark_done|delete_reminder|reschedule_reminder|clarify|unknown",
    "title":"optional",
    "dueAt":"optional ISO string",
    "notes":"optional",
    "targetTitle":"optional",
    "targetId":"optional",
    "scope":"today|tomorrow|missed|done|pending|all optional"
  }
}`;

function formatDueInUserZone(iso: string, timeZone?: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
}

function mapAgentScopeToListScope(scope?: string): ReminderListScope | null {
  switch (scope) {
    case "today":
      return "today";
    case "tomorrow":
      return "tomorrow";
    case "missed":
      return "missed";
    case "pending":
    case "all":
      return "all_pending";
    default:
      return null;
  }
}

function formatDecisionReply(reminders: ReminderItem[], timeZone?: string) {
  const ranked = rankTasks(reminders).slice(0, 3);
  if (ranked.length === 0) return "You have no pending reminders right now.";
  const lines = ranked.map(
    (item, index) =>
      `${index + 1}. ${item.title} — ${formatDueInUserZone(item.dueAt, timeZone)}`
  );
  return [
    ranked.length === 1 ? "Your best next task is:" : "Your top next tasks are:",
    ...lines,
  ].join("\n");
}

function formatPlanningReply(reminders: ReminderItem[], timeZone?: string) {
  const analysis = analyzeSchedule(reminders);
  const lines: string[] = [];
  if (analysis.nextTask) {
    lines.push(
      `Start with ${analysis.nextTask.title} at ${formatDueInUserZone(analysis.nextTask.dueAt, timeZone)}.`
    );
  }
  if (analysis.overdueTasks.length > 0) {
    lines.push(`You have ${analysis.overdueTasks.length} overdue task(s).`);
  }
  if (analysis.conflicts.length > 0) {
    const conflict = analysis.conflicts[0];
    if (conflict) {
      lines.push(
        `Possible clash: ${conflict.first.title} and ${conflict.second.title} are ${conflict.minutesApart} minutes apart.`
      );
    }
  }
  if (analysis.freeSlots.length > 0) {
    lines.push(`Free slot: ${analysis.freeSlots[0]}`);
  }
  return lines.join("\n") || "You have no pending reminders to plan right now.";
}

function fallbackDeterministicReply(message: string, reminders: ReminderItem[], timeZone?: string) {
  const intent = classifyReminderIntent(message);
  if (intent === "decision_query") return formatDecisionReply(reminders, timeZone);
  if (intent === "planning_query") return formatPlanningReply(reminders, timeZone);

  const listScope = inferListScopeFromMessage(message);
  if (listScope === "today") {
    const today = filterToday(reminders).slice(0, 5);
    if (today.length === 0) return "You have no reminders for today.";
    return [
      "Here are your reminders for today:",
      ...today.map((item, idx) => `${idx + 1}. ${item.title} — ${formatDueInUserZone(item.dueAt, timeZone)}`),
    ].join("\n");
  }
  if (listScope) return buildListRemindersReply(reminders, listScope, new Date(), 5, { timeZone });
  return (
    tryGroundedReminderAnswer(message, reminders, new Date(), { timeZone })
    ?? "I can help with reminder lists, what to do next, planning your day, and reminder updates."
  );
}

function hasExplicitTime(input: string) {
  const normalized = input.replace(/\b([ap])\.\s?m\.\b/gi, "$1m");
  return /\b(\d{1,2})(:\d{2})?\s?(am|pm)\b/i.test(normalized)
    || /\b\d{1,2}:\d{2}\b/.test(input)
    || /\b(noon|midnight)\b/i.test(input);
}

function hasTodayHint(input: string) {
  return /\btoday\b/i.test(input);
}

function hasTomorrowHint(input: string) {
  return /\b(tomorrow|tomorow|tommarow|tmrw)\b/i.test(input);
}

function hasDayAfterTomorrowHint(input: string) {
  return /\b(day after tomorrow|after tomorrow)\b/i.test(input);
}

function parseTimeFromInput(input: string) {
  const normalized = input.replace(/\b([ap])\.\s?m\.\b/gi, "$1m");
  const meridiemMatch = normalized.match(/\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/i);
  if (meridiemMatch) {
    const rawHour = Number.parseInt(meridiemMatch[1] ?? "0", 10);
    const minute = Number.parseInt(meridiemMatch[2] ?? "0", 10);
    const meridiem = (meridiemMatch[3] ?? "am").toLowerCase();
    let hour = rawHour % 12;
    if (meridiem === "pm") hour += 12;
    return { hour, minute };
  }

  const clockMatch = input.match(/\b(\d{1,2}):(\d{2})\b/);
  if (clockMatch) {
    return {
      hour: Number.parseInt(clockMatch[1] ?? "0", 10),
      minute: Number.parseInt(clockMatch[2] ?? "0", 10),
    };
  }

  if (/\bnoon\b/i.test(input)) return { hour: 12, minute: 0 };
  if (/\bmidnight\b/i.test(input)) return { hour: 0, minute: 0 };
  return null;
}

function parseDateTimeFromInput(input: string) {
  const now = new Date();
  const day = new Date(now);
  day.setSeconds(0, 0);

  if (hasDayAfterTomorrowHint(input)) {
    day.setDate(day.getDate() + 2);
  } else if (hasTomorrowHint(input)) {
    day.setDate(day.getDate() + 1);
  } else if (hasTodayHint(input)) {
    // no change
  } else {
    return null;
  }

  const time = parseTimeFromInput(input);
  if (!time) return null;

  day.setHours(time.hour, time.minute, 0, 0);
  return day.toISOString();
}

function isValidFutureIsoDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() > Date.now() - 60 * 1000;
}

function extractTitleFromCreateInput(input: string) {
  let working = input.trim();
  const remindGlobal = /\bremind me to\s+/i.exec(working);
  if (remindGlobal && remindGlobal.index !== undefined) {
    working = working.slice(remindGlobal.index + remindGlobal[0].length);
  }

  const normalized = working
    .replace(/\b(create|add|set|make|schedule)\b/gi, " ")
    .replace(/\b(reminder|remind me|remind)\b/gi, " ")
    .replace(/\b(for|about)\b/gi, " ")
    .replace(
      /\b(today|tomorrow|tomorow|tommarow|tmrw|day after tomorrow|after tomorrow|at|on|by|noon|midnight)\b/gi,
      " "
    )
    .replace(/\b\d{1,2}(:\d{2})?\s?([ap]\.?m\.?)\b/gi, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || undefined;
}

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model output.");
  }
  return text.slice(start, end + 1);
}

function safeAgentResponse(text: string): ReminderAgentResponse {
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as ReminderAgentResponse;
    if (!parsed?.action?.type || !parsed?.reply) {
      throw new Error("Invalid response shape.");
    }
    return parsed;
  } catch {
    return {
      reply: text.trim() || "I could not understand that request.",
      action: { type: "unknown" },
    };
  }
}

const LIFE_DOMAINS = new Set(["health", "finance", "career", "hobby", "fun"]);

function parseLifeDomain(value: unknown): LifeDomain | undefined {
  return typeof value === "string" && LIFE_DOMAINS.has(value) ? (value as LifeDomain) : undefined;
}

function fromDbReminder(item: Record<string, unknown>): ReminderItem {
  const dueAtMs = Number(item.dueAt ?? Date.now());
  const createdAtMs = Number(item.createdAt ?? Date.now());
  const updatedAtMs = Number(item.updatedAt ?? Date.now());
  const linkedRaw = item.linkedTaskId;
  return {
    id: String(item._id ?? item.id ?? crypto.randomUUID()),
    title: String(item.title ?? ""),
    dueAt: new Date(dueAtMs).toISOString(),
    recurrence:
      item.recurrence === "daily" || item.recurrence === "weekly" || item.recurrence === "monthly"
        ? item.recurrence
        : "none",
    notes: typeof item.notes === "string" ? item.notes : "",
    priority: typeof item.priority === "number" ? item.priority : undefined,
    urgency: typeof item.urgency === "number" ? item.urgency : undefined,
    tags: Array.isArray(item.tags) ? item.tags.filter((t): t is string => typeof t === "string") : undefined,
    status: item.status === "done" || item.status === "archived" ? item.status : "pending",
    createdAt: new Date(createdAtMs).toISOString(),
    updatedAt: new Date(updatedAtMs).toISOString(),
    linkedTaskId: typeof linkedRaw === "string" ? linkedRaw : undefined,
    domain: parseLifeDomain(item.domain),
  };
}

function fromDbTask(item: Record<string, unknown>): TaskItem {
  const createdAtMs = Number(item.createdAt ?? Date.now());
  const updatedAtMs = Number(item.updatedAt ?? Date.now());
  const dueRaw = item.dueAt;
  return {
    id: String(item._id ?? item.id ?? crypto.randomUUID()),
    title: String(item.title ?? ""),
    notes: typeof item.notes === "string" ? item.notes : undefined,
    dueAt: dueRaw != null && Number.isFinite(Number(dueRaw))
      ? new Date(Number(dueRaw)).toISOString()
      : undefined,
    status: item.status === "done" ? "done" : "pending",
    priority: typeof item.priority === "number" ? item.priority : undefined,
    domain: parseLifeDomain(item.domain),
    createdAt: new Date(createdAtMs).toISOString(),
    updatedAt: new Date(updatedAtMs).toISOString(),
  };
}

async function loadRemindersForChat(userId: string, fallback: ReminderItem[]): Promise<ReminderItem[]> {
  try {
    const client = getConvexClient();
    const raw = await client.query(api.reminders.listForUser, { userId });
    const dbReminders = [...raw.owned, ...raw.shared].sort(
      (a, b) => Number(a.dueAt) - Number(b.dueAt)
    );
    return dbReminders.map((item) => fromDbReminder(item));
  } catch {
    // Keep the chat functional if DB fetch temporarily fails.
    return fallback;
  }
}

async function loadTasksForChat(userId: string, fallback: TaskItem[]): Promise<TaskItem[]> {
  try {
    const client = getConvexClient();
    const rows = await client.query(api.tasks.listForUser, { userId });
    return rows.map((item) => fromDbTask(item as Record<string, unknown>));
  } catch {
    return fallback;
  }
}

function normalizeClientTimeZone(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  if (t.length < 2 || t.length > 120) return undefined;
  return t;
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    message?: string;
    reminders?: ReminderItem[];
    tasks?: TaskItem[];
    timeZone?: string;
    replyContext?: ReplyContextPayload;
  };
  const timeZone = normalizeClientTimeZone(body.timeZone);
  const message = body.message?.trim();
  const reminders = await loadRemindersForChat(userId, body.reminders ?? []);
  const tasks = await loadTasksForChat(userId, body.tasks ?? []);
  const taskTitleById = Object.fromEntries(tasks.map((t) => [t.id, t.title]));
  const displayOptions = { timeZone, taskTitleById };
  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  const replyContext =
    body.replyContext
    && typeof body.replyContext.id === "string"
    && typeof body.replyContext.content === "string"
    && (body.replyContext.role === "user"
      || body.replyContext.role === "assistant"
      || body.replyContext.role === "system")
      ? body.replyContext
      : undefined;
  const effectiveMessage = buildMessageWithReplyContext(message, replyContext);

  const intent = classifyReminderIntent(effectiveMessage);
  if (intent === "decision_query") {
    return NextResponse.json({
      reply: formatDecisionReply(reminders, timeZone),
      action: { type: "unknown" },
    } satisfies ReminderAgentResponse);
  }
  if (intent === "planning_query") {
    return NextResponse.json({
      reply: formatPlanningReply(reminders, timeZone),
      action: { type: "unknown" },
    } satisfies ReminderAgentResponse);
  }

  // Deterministic path first: create reminder with explicit date/time should not rely on LLM.
  if (looksLikeCreateIntent(effectiveMessage)) {
    const title = extractTitleFromCreateInput(effectiveMessage);
    const dueAt = parseDateTimeFromInput(effectiveMessage);

    if (!title) {
      return NextResponse.json({
        reply: "Got it. What is the reminder title?",
        action: { type: "clarify" },
      } satisfies ReminderAgentResponse);
    }

    if (dueAt && isValidFutureIsoDate(dueAt)) {
      return NextResponse.json({
        reply: `Reminder created for ${formatDueInUserZone(dueAt, timeZone)}.`,
        action: { type: "create_reminder", title, dueAt },
      } satisfies ReminderAgentResponse);
    }

    return NextResponse.json({
      reply: "I can create it. Please share date and exact time, like: tomorrow at 8:00 PM.",
      action: { type: "clarify", title },
    } satisfies ReminderAgentResponse);
  }

  const listScopeFromMessage = inferListScopeFromMessage(effectiveMessage);
  if (listScopeFromMessage && !isCompoundReminderQuestion(effectiveMessage)) {
    if (listScopeFromMessage === "today") {
      const today = filterToday(reminders).slice(0, 5);
      return NextResponse.json({
        reply:
          today.length === 0
            ? "You have no reminders for today."
            : [
              today.length === 1
                ? "Here is your reminder for today:"
                : "Here are your reminders for today:",
              ...today.map((item, idx) =>
                `${idx + 1}. ${item.title} — ${formatDueInUserZone(item.dueAt, timeZone)}`
              ),
            ].join("\n"),
        action: { type: "list_reminders" },
      } satisfies ReminderAgentResponse);
    }
    return NextResponse.json({
      reply: buildListRemindersReply(reminders, listScopeFromMessage, new Date(), 5, { timeZone }),
      action: { type: "list_reminders" },
    } satisfies ReminderAgentResponse);
  }

  const nimApiKey = process.env.NVIDIA_NIM_API_KEY;
  if (!nimApiKey) {
    const fallback: ReminderAgentResponse = {
      reply: fallbackDeterministicReply(effectiveMessage, reminders, timeZone),
      action: { type: "unknown" },
    };
    return NextResponse.json(fallback);
  }

  try {
    const model = process.env.NVIDIA_NIM_MODEL ?? DEFAULT_MODEL;
    const digest = buildLifeOsContextBlock(reminders, tasks, new Date(), displayOptions);
    const nimResponse = await fetch(`${NIM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${nimApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `User message:\n${effectiveMessage}\n\n--- LIFE OS DIGEST (authoritative) ---\n${digest}\n\n--- LIFE OS JSON (same data, machine-readable) ---\n${JSON.stringify({ reminders, tasks })}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 900,
      }),
    });

    if (nimResponse.status === 429) {
      return NextResponse.json({
        reply: fallbackDeterministicReply(effectiveMessage, reminders, timeZone),
        action: { type: "unknown" },
      } satisfies ReminderAgentResponse);
    }

    if (!nimResponse.ok) {
      return NextResponse.json({
        reply: fallbackDeterministicReply(effectiveMessage, reminders, timeZone),
        action: { type: "unknown" },
      } satisfies ReminderAgentResponse);
    }

    const data = (await nimResponse.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";

    const parsed = safeAgentResponse(content);

    if (parsed.action.type === "list_reminders") {
      const scope =
        mapAgentScopeToListScope(parsed.action.scope) ?? inferListScopeFromMessage(effectiveMessage) ?? "future";
      if (scope === "today") {
        const today = filterToday(reminders).slice(0, 5);
        parsed.reply = today.length === 0
          ? "You have no reminders for today."
          : [
            "Here are your reminders for today:",
            ...today.map((item, idx) =>
              `${idx + 1}. ${item.title} — ${formatDueInUserZone(item.dueAt, timeZone)}`
            ),
          ].join("\n");
      } else {
        parsed.reply = buildListRemindersReply(reminders, scope, new Date(), 5, { timeZone });
      }
    }

    if (parsed.action.type === "create_reminder") {
      const deterministicDueAt = parseDateTimeFromInput(effectiveMessage);
      if (deterministicDueAt) {
        parsed.action.dueAt = deterministicDueAt;
      }

      const asksForRelativeDate =
        hasTodayHint(effectiveMessage) || hasTomorrowHint(effectiveMessage) || hasDayAfterTomorrowHint(effectiveMessage);

      if (asksForRelativeDate && !deterministicDueAt) {
        return NextResponse.json({
          reply:
            "I understood you want to create a reminder, but I could not confidently parse the date/time. Please resend with clear format like: tomorrow at 8:00 PM.",
          action: { type: "clarify", title: parsed.action.title },
        } satisfies ReminderAgentResponse);
      }

      if (!parsed.action.dueAt || !hasExplicitTime(effectiveMessage) || !isValidFutureIsoDate(parsed.action.dueAt)) {
        return NextResponse.json({
          reply:
            "I can create that reminder. Please confirm the exact time (for example: tomorrow at 8:00 PM).",
          action: { type: "clarify", title: parsed.action.title },
        } satisfies ReminderAgentResponse);
      }
    }

    if (
      (parsed.action.type === "delete_reminder"
        || parsed.action.type === "mark_done"
        || parsed.action.type === "reschedule_reminder")
      && !parsed.action.targetId
      && !parsed.action.targetTitle
    ) {
      return NextResponse.json({
        reply: "Please tell me exactly which reminder you mean.",
        action: { type: "clarify" },
      } satisfies ReminderAgentResponse);
    }

    if (
      (parsed.action.type === "delete_reminder"
        || parsed.action.type === "mark_done"
        || parsed.action.type === "reschedule_reminder")
      && parsed.action.targetTitle
    ) {
      const matches = reminders.filter((item) =>
        item.title.toLowerCase().includes(parsed.action.targetTitle!.toLowerCase())
      );
      if (matches.length > 1) {
        const sample = matches
          .slice(0, 2)
          .map((item) => `${item.title} at ${formatDueInUserZone(item.dueAt, timeZone)}`);
        return NextResponse.json({
          reply: `Do you mean ${sample.join(" or ")}?`,
          action: { type: "clarify", targetTitle: parsed.action.targetTitle },
        } satisfies ReminderAgentResponse);
      }
    }

    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json({
      reply: fallbackDeterministicReply(effectiveMessage, reminders, timeZone),
      action: { type: "unknown" },
    });
  }
}
