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
import { getChatHistory } from "../../../lib/server/chat-history";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  priority?: number;
  domain?: LifeDomain;
  recurrence?: "none" | "daily" | "weekly" | "monthly";
  linkedTaskId?: string;
  targetTitle?: string;
  targetId?: string;
  scope?: "today" | "tomorrow" | "missed" | "done" | "pending" | "all";
}

interface ReminderAgentResponse {
  reply: string;
  action: ReminderAgentAction;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "meta/llama-3.1-70b-instruct";
const DEFAULT_CHAT_REMINDER_TITLE = "Reminder";
const MAX_HISTORY_TURNS = 6; // last 3 user/assistant pairs

// ─── FLAW-3: simple per-user rate limiter (20 req/min) ───────────────────────
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 20;

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return false;
  }
  if (entry.count >= RATE_LIMIT_MAX) return true;
  entry.count++;
  return false;
}

// ─── System prompt ────────────────────────────────────────────────────────────

const systemPrompt = `You are the RemindOS assistant for Personal Life OS. You help with the user's reminders and tasks (orchestration layer).

DATA RULES (critical):
- The LIFE OS DIGEST (tasks + reminders) and JSON below are the ONLY source of truth. Do not invent, rename, or assume items.
- Reminders may link to a task (see task id / task title in digest). If a reminder has no linked task, it is labeled ADHOC (standalone).
- Optional domain tags (health, finance, career, hobby, fun) may appear on reminders and tasks.
- If the answer is not in the data, say you do not see that in their data and suggest what they could ask instead.
- Never paste raw ISO-8601 timestamps in "reply". Use natural language dates/times. The digest lists due times in the user's time zone—quote them exactly as shown.
- Overdue items show how long they have been overdue (e.g. "overdue 3d") — use this context when advising the user.

WHAT YOU CAN DO:
- Answer questions about reminders and tasks: schedules, conflicts, "what's next", which reminders belong to which task, ADHOC vs task-linked, domains, comparisons, counts, overdue, notes, recurrence.
- Small talk or unrelated topics: politely redirect to reminders and tasks.

ACTIONS (JSON action.type):
- list_reminders: user wants a simple list or roll-up by period (server may replace reply with a grounded list).
- mark_done: user wants to complete; set targetTitle or targetId from digest.
- delete_reminder: user wants to remove; set targetTitle or targetId.
- reschedule_reminder: user wants a new time; set dueAt as ISO in action only, targetTitle/targetId.
- create_reminder: only if user clearly wants to create (usually already handled earlier). May include priority (1-5), domain, recurrence.
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
    "priority":"optional 1-5",
    "domain":"optional health|finance|career|hobby|fun",
    "recurrence":"optional none|daily|weekly|monthly",
    "targetTitle":"optional",
    "targetId":"optional",
    "scope":"today|tomorrow|missed|done|pending|all optional"
  }
}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    case "today": return "today";
    case "tomorrow": return "tomorrow";
    case "missed": return "missed";
    case "pending":
    case "all": return "all_pending";
    default: return null;
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
  const analysis = analyzeSchedule(reminders, new Date(), { timeZone });
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
    const today = filterToday(reminders, new Date(), timeZone).slice(0, 5);
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

// ─── Date / time parsing ──────────────────────────────────────────────────────

function hasExplicitTime(input: string) {
  const normalized = input
    .replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d)))
    .replace(/\b([ap])\.\s?m\.\b/gi, "$1m");
  return /\b(\d{1,2})(?:[:.]\d{2})?\s?(am|pm)\b/i.test(normalized)
    || /\b\d{1,2}[:.]\d{2}\b/.test(input)
    || /(?:^|\s)\d{1,2}\s*(?:बजे|वाजता|वाजले)(?=\s|$|[,.!?])/i.test(normalized)
    || /(?:^|\s)(सुबह|सकाळी|दोपहर|दुपारी|शाम|सायंकाळी|रात)(?=\s|$|[,.!?])/i.test(normalized)
    || /\b(noon|midnight)\b/i.test(input);
}

function hasTodayHint(input: string) {
  return /\btoday\b/i.test(input) || /(^|\s)आज(?=\s|$|[,.!?])/i.test(input);
}

function hasTomorrowHint(input: string) {
  return /\b(tomorrow|tomorow|tommarow|tmrw)\b/i.test(input)
    || /(^|\s)(कल|उद्या)(?=\s|$|[,.!?])/i.test(input);
}

function hasDayAfterTomorrowHint(input: string) {
  return /\b(day after tomorrow|after tomorrow)\b/i.test(input)
    || /(^|\s)(परसों|परवा)(?=\s|$|[,.!?])/i.test(input);
}

function parseTimeFromInput(input: string) {
  const normalized = input
    .replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d)))
    .replace(/\b([ap])\.\s?m\.\b/gi, "$1m");

  const meridiemMatch = normalized.match(/\b(\d{1,2})(?:[:.]\s*(\d{2}))?\s?(am|pm)\b/i);
  if (meridiemMatch) {
    const rawHour = Number.parseInt(meridiemMatch[1] ?? "0", 10);
    const minute = Number.parseInt(meridiemMatch[2] ?? "0", 10);
    if (!Number.isFinite(rawHour) || rawHour < 1 || rawHour > 12) return null;
    if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;
    const meridiem = (meridiemMatch[3] ?? "am").toLowerCase();
    let hour = rawHour % 12;
    if (meridiem === "pm") hour += 12;
    return { hour, minute };
  }

  const clockMatch = input.match(/\b(\d{1,2})[:.]\s*(\d{2})\b/);
  if (clockMatch) {
    const hour = Number.parseInt(clockMatch[1] ?? "0", 10);
    const minute = Number.parseInt(clockMatch[2] ?? "0", 10);
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
    if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;
    return { hour, minute };
  }

  const regionalMatch = normalized.match(
    /(?:^|\s)(\d{1,2})(?:[:.]\s*(\d{2}))?\s*(?:बजे|वाजता|वाजले)?\s*(सुबह|सकाळी|दोपहर|दुपारी|शाम|सायंकाळी|रात)?(?=\s|$|[,.!?])/i,
  );
  if (regionalMatch) {
    const rawHour = Number.parseInt(regionalMatch[1] ?? "-1", 10);
    const minute = Number.parseInt(regionalMatch[2] ?? "0", 10);
    if (!Number.isFinite(rawHour) || rawHour < 0 || rawHour > 23) return null;
    if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;
    const part = (regionalMatch[3] ?? "").toLowerCase();
    if (!part && !/(?:बजे|वाजता|वाजले)/i.test(normalized)) return null;
    let hour = rawHour;
    if (part) {
      if (/सुबह|सकाळी/i.test(part)) { if (hour === 12) hour = 0; }
      else if (/दोपहर|दुपारी/i.test(part)) { if (hour >= 1 && hour <= 11) hour += 12; }
      else if (/शाम|सायंकाळी|रात/i.test(part)) { if (hour >= 1 && hour <= 11) hour += 12; }
    }
    return { hour, minute };
  }

  if (/\bnoon\b/i.test(input)) return { hour: 12, minute: 0 };
  if (/\bmidnight\b/i.test(input)) return { hour: 0, minute: 0 };
  if (/(?:^|\s)(दोपहर|दुपारी)(?=\s|$|[,.!?])/i.test(normalized)) return { hour: 12, minute: 0 };
  if (/(?:^|\s)(आधी रात|मध्यरात्र)(?=\s|$|[,.!?])/i.test(normalized)) return { hour: 0, minute: 0 };
  return null;
}

function getCalendarDateInTimeZone(date: Date, timeZone?: string) {
  if (!timeZone) {
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value])) as Record<string, string>;
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function addDaysToCalendarDate(value: { year: number; month: number; day: number }, days: number) {
  const utc = new Date(Date.UTC(value.year, value.month - 1, value.day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value])) as Record<string, string>;
  const zonedAsUtc = Date.UTC(
    Number(values.year), Number(values.month) - 1, Number(values.day),
    Number(values.hour), Number(values.minute), Number(values.second),
  );
  return (zonedAsUtc - date.getTime()) / 60000;
}

function calendarDateTimeToIso(
  calendar: { year: number; month: number; day: number },
  time: { hour: number; minute: number },
  timeZone?: string,
) {
  if (!timeZone) {
    const date = new Date();
    date.setHours(time.hour, time.minute, 0, 0);
    date.setFullYear(calendar.year, calendar.month - 1, calendar.day);
    return date.toISOString();
  }
  const utcGuess = Date.UTC(calendar.year, calendar.month - 1, calendar.day, time.hour, time.minute, 0, 0);
  const firstOffset = getTimeZoneOffsetMinutes(new Date(utcGuess), timeZone);
  let utcInstant = utcGuess - firstOffset * 60_000;
  const secondOffset = getTimeZoneOffsetMinutes(new Date(utcInstant), timeZone);
  if (secondOffset !== firstOffset) utcInstant = utcGuess - secondOffset * 60_000;
  return new Date(utcInstant).toISOString();
}

function parseDateTimeFromInput(input: string, timeZone?: string) {
  const now = new Date();
  let day = getCalendarDateInTimeZone(now, timeZone);
  if (hasDayAfterTomorrowHint(input)) {
    day = addDaysToCalendarDate(day, 2);
  } else if (hasTomorrowHint(input)) {
    day = addDaysToCalendarDate(day, 1);
  } else if (hasTodayHint(input)) {
    // no change
  } else {
    return null;
  }
  const time = parseTimeFromInput(input);
  if (!time) return null;
  return calendarDateTimeToIso(day, time, timeZone);
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
  } else {
    working = working
      .replace(
        /^(?:please\s+)?(?:create|add|set|make|schedule|बनाओ|तैयार करो|set karo|करो)\s+(?:(?:a|an)\s+)?(?:reminder|रिमाइंडर|स्मरणपत्र)?\s*/i,
        "",
      )
      .trim();
  }
  const normalized = working
    .replace(/^(?:called|named|titled)\s+/i, "")
    .replace(/\b(for|about|called|named|titled|के लिए|साठी)\b/gi, " ")
    .replace(
      /\b(today|tomorrow|tomorow|tommarow|tmrw|day after tomorrow|after tomorrow|आज|कल|उद्या|परसों|परवा|at|on|by|noon|midnight|बजे|वाजता|वाजले|सुबह|सकाळी|दोपहर|दुपारी|शाम|सायंकाळी|रात)\b/gi,
      " "
    )
    .replace(/\b\d{1,2}(?:[:.]\d{2})?\s?([ap]\.?m\.?)\b/gi, " ")
    .replace(/\b\d{1,2}[:.]\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || undefined;
}

// ─── FLAW-2: extract metadata from natural language for deterministic create ──

function extractPriorityFromInput(input: string): number | undefined {
  const n = input.toLowerCase();
  if (/\b(critical|urgent|asap|immediately)\b/.test(n)) return 5;
  if (/\b(high\s*priority|very\s*important|top\s*priority)\b/.test(n)) return 4;
  if (/\b(important|priority)\b/.test(n)) return 3;
  if (/\b(low\s*priority|whenever|sometime)\b/.test(n)) return 2;
  return undefined;
}

function extractDomainFromInput(input: string): LifeDomain | undefined {
  const n = input.toLowerCase();
  if (/\bhealth\b/.test(n)) return "health";
  if (/\b(finance|financial|money|bank|budget|invest)\b/.test(n)) return "finance";
  if (/\b(career|work|job|office|meeting|professional)\b/.test(n)) return "career";
  if (/\bhobby\b/.test(n)) return "hobby";
  if (/\b(fun|entertainment|party|vacation)\b/.test(n)) return "fun";
  return undefined;
}

function extractRecurrenceFromInput(input: string): "daily" | "weekly" | "monthly" | undefined {
  const n = input.toLowerCase();
  if (/\b(every\s*day|daily)\b/.test(n)) return "daily";
  if (/\b(every\s*week|weekly)\b/.test(n)) return "weekly";
  if (/\b(every\s*month|monthly)\b/.test(n)) return "monthly";
  return undefined;
}

// ─── JSON parsing ─────────────────────────────────────────────────────────────

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object found.");
  return text.slice(start, end + 1);
}

function safeAgentResponse(text: string): ReminderAgentResponse {
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as ReminderAgentResponse;
    if (!parsed?.action?.type || !parsed?.reply) throw new Error("Invalid response shape.");
    return parsed;
  } catch {
    return { reply: text.trim() || "I could not understand that request.", action: { type: "unknown" } };
  }
}

// ─── DB mappers ───────────────────────────────────────────────────────────────

const LIFE_DOMAINS = new Set(["health", "finance", "career", "hobby", "fun"]);

function parseLifeDomain(value: unknown): LifeDomain | undefined {
  return typeof value === "string" && LIFE_DOMAINS.has(value) ? (value as LifeDomain) : undefined;
}

function fromDbReminder(item: Record<string, unknown>): ReminderItem {
  const dueAtMs = Number(item.dueAt ?? Date.now());
  const createdAtMs = Number(item.createdAt ?? Date.now());
  const updatedAtMs = Number(item.updatedAt ?? Date.now());
  return {
    id: String(item._id ?? item.id ?? crypto.randomUUID()),
    title: String(item.title ?? ""),
    dueAt: new Date(dueAtMs).toISOString(),
    recurrence:
      item.recurrence === "daily" || item.recurrence === "weekly" || item.recurrence === "monthly"
        ? item.recurrence : "none",
    notes: typeof item.notes === "string" ? item.notes : "",
    priority: typeof item.priority === "number" ? item.priority : undefined,
    urgency: typeof item.urgency === "number" ? item.urgency : undefined,
    tags: Array.isArray(item.tags) ? item.tags.filter((t): t is string => typeof t === "string") : undefined,
    status: item.status === "done" || item.status === "archived" ? item.status : "pending",
    createdAt: new Date(createdAtMs).toISOString(),
    updatedAt: new Date(updatedAtMs).toISOString(),
    linkedTaskId: typeof item.linkedTaskId === "string" ? item.linkedTaskId : undefined,
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
    dueAt: dueRaw != null && Number.isFinite(Number(dueRaw)) ? new Date(Number(dueRaw)).toISOString() : undefined,
    status: item.status === "done" ? "done" : "pending",
    priority: typeof item.priority === "number" ? item.priority : undefined,
    domain: parseLifeDomain(item.domain),
    createdAt: new Date(createdAtMs).toISOString(),
    updatedAt: new Date(updatedAtMs).toISOString(),
  };
}

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadRemindersForChat(userId: string, fallback: ReminderItem[]): Promise<ReminderItem[]> {
  try {
    const client = getConvexClient();
    const raw = await client.query(api.reminders.listForUser, { userId });
    // BUG-6 fix: deduplicate owned+shared by id
    const seen = new Set<string>();
    const dbReminders = [...raw.owned, ...raw.shared]
      .filter((item) => {
        const id = String(item._id);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .sort((a, b) => Number(a.dueAt) - Number(b.dueAt));
    return dbReminders.map((item) => fromDbReminder(item));
  } catch {
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

// FLAW-5: limit reminders sent to LLM — pending only, most relevant first, max 50
function filterRemindersForLLM(reminders: ReminderItem[]): ReminderItem[] {
  const now = Date.now();
  const pending = reminders
    .filter((r) => r.status === "pending")
    .sort((a, b) => {
      const aOver = new Date(a.dueAt).getTime() < now ? 0 : 1;
      const bOver = new Date(b.dueAt).getTime() < now ? 0 : 1;
      if (aOver !== bOver) return aOver - bOver;
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    })
    .slice(0, 50);
  // Include recently completed for context (last 7 days)
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const recentDone = reminders
    .filter((r) => r.status === "done" && new Date(r.updatedAt).getTime() > weekAgo)
    .slice(0, 5);
  return [...pending, ...recentDone];
}

// MISSING-2/3: load behavioral profile + events for the digest
async function buildBehaviorContext(userId: string): Promise<string> {
  try {
    const client = getConvexClient();
    const [events, profile] = await Promise.all([
      client.query(api.userEvents.getRecent, { userId, limitDays: 30 }),
      client.query(api.userProfiles.get, { userId }),
    ]);

    const lines: string[] = ["--- BEHAVIORAL PROFILE ---"];
    const completions = (events as Array<Record<string, unknown>>).filter((e) => e.eventType === "reminder_completed");
    const creations = (events as Array<Record<string, unknown>>).filter((e) => e.eventType === "reminder_created");
    const taskDone = (events as Array<Record<string, unknown>>).filter((e) => e.eventType === "task_completed");

    lines.push(`Last 30 days: ${creations.length} reminders created, ${completions.length} completed, ${taskDone.length} tasks completed.`);

    if (creations.length > 0) {
      const rate = Math.round((completions.length / creations.length) * 100);
      lines.push(`Reminder completion rate: ${rate}%.`);
    }

    const domainCounts: Record<string, number> = {};
    for (const e of completions) {
      const d = e.domain as string | undefined;
      if (d) domainCounts[d] = (domainCounts[d] ?? 0) + 1;
    }
    const topDomain = Object.entries(domainCounts).sort((a, b) => b[1] - a[1])[0];
    if (topDomain) lines.push(`Most completed domain: ${topDomain[0]} (${topDomain[1]} items).`);

    const p = profile as Record<string, unknown> | null;
    if (p?.preferredWorkingHoursStart != null && p?.preferredWorkingHoursEnd != null) {
      lines.push(`Preferred working hours: ${p.preferredWorkingHoursStart}:00–${p.preferredWorkingHoursEnd}:00.`);
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}

// FLAW-4: save a single chat message server-side (idempotent)
async function saveMessageServerSide(
  userId: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  try {
    const client = getConvexClient();
    await client.mutation(api.chat.insertMessage, {
      userId,
      clientId: `server-${userId}-${Date.now()}-${crypto.randomUUID()}`,
      role,
      content,
      createdAt: Date.now(),
    });
  } catch {
    // best-effort; never block the response
  }
}

function normalizeClientTimeZone(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  if (t.length < 2 || t.length > 120) return undefined;
  return t;
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // FLAW-3: rate limit
  if (isRateLimited(userId)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
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

  if (!message) return NextResponse.json({ error: "Message is required" }, { status: 400 });

  const replyContext =
    body.replyContext
    && typeof body.replyContext.id === "string"
    && typeof body.replyContext.content === "string"
    && (body.replyContext.role === "user" || body.replyContext.role === "assistant" || body.replyContext.role === "system")
      ? body.replyContext : undefined;
  const effectiveMessage = buildMessageWithReplyContext(message, replyContext);

  // Deterministic fast paths — no LLM, no history needed
  const intent = classifyReminderIntent(effectiveMessage);
  if (intent === "decision_query") {
    const reply = formatDecisionReply(reminders, timeZone);
    void saveMessageServerSide(userId, "user", effectiveMessage);
    void saveMessageServerSide(userId, "assistant", reply);
    return NextResponse.json({ reply, action: { type: "unknown" } } satisfies ReminderAgentResponse);
  }
  if (intent === "planning_query") {
    const reply = formatPlanningReply(reminders, timeZone);
    void saveMessageServerSide(userId, "user", effectiveMessage);
    void saveMessageServerSide(userId, "assistant", reply);
    return NextResponse.json({ reply, action: { type: "unknown" } } satisfies ReminderAgentResponse);
  }

  if (looksLikeCreateIntent(effectiveMessage)) {
    const title = extractTitleFromCreateInput(effectiveMessage);
    const dueAt = parseDateTimeFromInput(effectiveMessage, timeZone);
    const resolvedTitle = title || DEFAULT_CHAT_REMINDER_TITLE;

    if (dueAt && isValidFutureIsoDate(dueAt)) {
      // FLAW-2: enrich with metadata extracted from the message
      const response: ReminderAgentResponse = {
        reply: `Reminder "${resolvedTitle}" created for ${formatDueInUserZone(dueAt, timeZone)}.`,
        action: {
          type: "create_reminder",
          title: resolvedTitle,
          dueAt,
          priority: extractPriorityFromInput(effectiveMessage),
          domain: extractDomainFromInput(effectiveMessage),
          recurrence: extractRecurrenceFromInput(effectiveMessage),
        },
      };
      void saveMessageServerSide(userId, "user", effectiveMessage);
      void saveMessageServerSide(userId, "assistant", response.reply);
      return NextResponse.json(response);
    }

    const response: ReminderAgentResponse = {
      reply: "I can create it. Please share date and exact time, like: tomorrow at 8:00 PM.",
      action: { type: "clarify", title: resolvedTitle },
    };
    void saveMessageServerSide(userId, "user", effectiveMessage);
    void saveMessageServerSide(userId, "assistant", response.reply);
    return NextResponse.json(response);
  }

  const listScopeFromMessage = inferListScopeFromMessage(effectiveMessage);
  if (listScopeFromMessage && !isCompoundReminderQuestion(effectiveMessage)) {
    let reply: string;
    if (listScopeFromMessage === "today") {
      // BUG-3 fix: pass timezone to filterToday
      const today = filterToday(reminders, new Date(), timeZone).slice(0, 5);
      reply = today.length === 0
        ? "You have no reminders for today."
        : [
          today.length === 1 ? "Here is your reminder for today:" : "Here are your reminders for today:",
          ...today.map((item, idx) => `${idx + 1}. ${item.title} — ${formatDueInUserZone(item.dueAt, timeZone)}`),
        ].join("\n");
    } else {
      reply = buildListRemindersReply(reminders, listScopeFromMessage, new Date(), 5, { timeZone });
    }
    void saveMessageServerSide(userId, "user", effectiveMessage);
    void saveMessageServerSide(userId, "assistant", reply);
    return NextResponse.json({ reply, action: { type: "list_reminders" } } satisfies ReminderAgentResponse);
  }

  const nimApiKey = process.env.NVIDIA_NIM_API_KEY;
  if (!nimApiKey) {
    const reply = fallbackDeterministicReply(effectiveMessage, reminders, timeZone);
    void saveMessageServerSide(userId, "user", effectiveMessage);
    void saveMessageServerSide(userId, "assistant", reply);
    return NextResponse.json({ reply, action: { type: "unknown" } } satisfies ReminderAgentResponse);
  }

  try {
    const model = process.env.NVIDIA_NIM_MODEL ?? DEFAULT_MODEL;

    // BUG-5 fix: only pending+recent-done reminders in JSON sent to LLM
    const llmReminders = filterRemindersForLLM(reminders);
    const digest = buildLifeOsContextBlock(llmReminders, tasks, new Date(), displayOptions);
    const behaviorCtx = await buildBehaviorContext(userId);

    // BUG-1 / MISSING-1 fix: inject recent conversation history
    const history = await getChatHistory(userId);
    const recentHistory = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-MAX_HISTORY_TURNS);

    const nimMessages = [
      { role: "system" as const, content: systemPrompt },
      ...recentHistory.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      {
        role: "user" as const,
        content: `${effectiveMessage}\n\n--- LIFE OS DIGEST (authoritative) ---\n${digest}${behaviorCtx ? `\n\n${behaviorCtx}` : ""}\n\n--- LIFE OS JSON (same data, machine-readable) ---\n${JSON.stringify({ reminders: llmReminders, tasks })}`,
      },
    ];

    const nimResponse = await fetch(`${NIM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${nimApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: nimMessages, temperature: 0.2, max_tokens: 900 }),
    });

    if (nimResponse.status === 429 || !nimResponse.ok) {
      const reply = fallbackDeterministicReply(effectiveMessage, reminders, timeZone);
      void saveMessageServerSide(userId, "user", effectiveMessage);
      void saveMessageServerSide(userId, "assistant", reply);
      return NextResponse.json({ reply, action: { type: "unknown" } } satisfies ReminderAgentResponse);
    }

    const data = (await nimResponse.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed = safeAgentResponse(content);

    if (parsed.action.type === "list_reminders") {
      const scope =
        mapAgentScopeToListScope(parsed.action.scope) ?? inferListScopeFromMessage(effectiveMessage) ?? "future";
      if (scope === "today") {
        const today = filterToday(reminders, new Date(), timeZone).slice(0, 5);
        parsed.reply = today.length === 0
          ? "You have no reminders for today."
          : ["Here are your reminders for today:", ...today.map((item, idx) => `${idx + 1}. ${item.title} — ${formatDueInUserZone(item.dueAt, timeZone)}`)].join("\n");
      } else {
        parsed.reply = buildListRemindersReply(reminders, scope, new Date(), 5, { timeZone });
      }
    }

    if (parsed.action.type === "create_reminder") {
      const deterministicDueAt = parseDateTimeFromInput(effectiveMessage, timeZone);
      if (deterministicDueAt) parsed.action.dueAt = deterministicDueAt;

      // FLAW-2: enrich LLM-generated create action with extracted metadata
      if (!parsed.action.priority) parsed.action.priority = extractPriorityFromInput(effectiveMessage);
      if (!parsed.action.domain) parsed.action.domain = extractDomainFromInput(effectiveMessage);
      if (!parsed.action.recurrence) parsed.action.recurrence = extractRecurrenceFromInput(effectiveMessage);

      const asksForRelativeDate =
        hasTodayHint(effectiveMessage) || hasTomorrowHint(effectiveMessage) || hasDayAfterTomorrowHint(effectiveMessage);
      if (asksForRelativeDate && !deterministicDueAt) {
        const r: ReminderAgentResponse = {
          reply: "I understood you want to create a reminder, but I could not confidently parse the date/time. Please resend with clear format like: tomorrow at 8:00 PM.",
          action: { type: "clarify", title: parsed.action.title },
        };
        void saveMessageServerSide(userId, "user", effectiveMessage);
        void saveMessageServerSide(userId, "assistant", r.reply);
        return NextResponse.json(r);
      }

      if (!parsed.action.dueAt || !hasExplicitTime(effectiveMessage) || !isValidFutureIsoDate(parsed.action.dueAt)) {
        const r: ReminderAgentResponse = {
          reply: "I can create that reminder. Please confirm the exact time (for example: tomorrow at 8:00 PM).",
          action: { type: "clarify", title: parsed.action.title },
        };
        void saveMessageServerSide(userId, "user", effectiveMessage);
        void saveMessageServerSide(userId, "assistant", r.reply);
        return NextResponse.json(r);
      }

      if (tasks && tasks.length > 0 && !parsed.action.linkedTaskId) {
        const pendingTasks = tasks.filter((t) => (t as unknown as Record<string, unknown>).status === "pending");
        if (pendingTasks.length > 0) {
          const taskList = pendingTasks.slice(0, 5).map((t, idx) => `${idx + 1}. ${t.title}`).join("\n");
          const r: ReminderAgentResponse = {
            reply: `Got it. Should this reminder be linked to a task?\n\n${taskList}\n\nOr just say "no" if it's standalone.`,
            action: { type: "clarify", title: parsed.action.title, dueAt: parsed.action.dueAt },
          };
          void saveMessageServerSide(userId, "user", effectiveMessage);
          void saveMessageServerSide(userId, "assistant", r.reply);
          return NextResponse.json(r);
        }
      }
    }

    if (
      (parsed.action.type === "delete_reminder" || parsed.action.type === "mark_done" || parsed.action.type === "reschedule_reminder")
      && !parsed.action.targetId && !parsed.action.targetTitle
    ) {
      const r: ReminderAgentResponse = { reply: "Please tell me exactly which reminder you mean.", action: { type: "clarify" } };
      void saveMessageServerSide(userId, "user", effectiveMessage);
      void saveMessageServerSide(userId, "assistant", r.reply);
      return NextResponse.json(r);
    }

    if (
      (parsed.action.type === "delete_reminder" || parsed.action.type === "mark_done" || parsed.action.type === "reschedule_reminder")
      && parsed.action.targetTitle
    ) {
      const matches = reminders.filter((item) =>
        item.title.toLowerCase().includes(parsed.action.targetTitle!.toLowerCase())
      );
      if (matches.length > 1) {
        const sample = matches.slice(0, 2).map((item) => `${item.title} at ${formatDueInUserZone(item.dueAt, timeZone)}`);
        const r: ReminderAgentResponse = {
          reply: `Do you mean ${sample.join(" or ")}?`,
          action: { type: "clarify", targetTitle: parsed.action.targetTitle },
        };
        void saveMessageServerSide(userId, "user", effectiveMessage);
        void saveMessageServerSide(userId, "assistant", r.reply);
        return NextResponse.json(r);
      }
    }

    void saveMessageServerSide(userId, "user", effectiveMessage);
    void saveMessageServerSide(userId, "assistant", parsed.reply);
    return NextResponse.json(parsed);

  } catch {
    const reply = fallbackDeterministicReply(effectiveMessage, reminders, timeZone);
    void saveMessageServerSide(userId, "user", effectiveMessage);
    void saveMessageServerSide(userId, "assistant", reply);
    return NextResponse.json({ reply, action: { type: "unknown" } });
  }
}
