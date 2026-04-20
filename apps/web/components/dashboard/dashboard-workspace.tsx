"use client";

import {
  buildBriefingParts,
  buildFollowUpQuestions,
  replaceFollowUpSlot,
  buildListRemindersReply,
  getReminderBucket,
  inferListScopeFromMessage,
  isAdhocReminder,
  isCompoundReminderQuestion,
  tryGroundedReminderAnswer,
  type BriefingSection,
  type FollowUpQuestion,
  type LifeDomain,
  type TaskItemBrief,
  type ReminderRecurrence,
  type ReminderItem,
} from "@repo/reminder";
import { useUser } from "@clerk/nextjs";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { StarRating, priorityStarsLabel } from "./star-rating";
import { StructuredMessage } from "./structured-message";
import {
  TaskFormOverlay,
  TaskListOverlay,
  type TaskRow,
} from "./task-panels";
import { showDueReminderSystemNotification } from "../../lib/due-notifications-client";
import {
  showCollaborationNotification,
  shouldNotifyForCollaboration,
} from "../../lib/collaboration-notifications";
import { playUiCue } from "../../lib/ui-sound";
import type { ReplyContextPayload } from "../../lib/chat-reply-context";
import {
  isCompactViewport,
  loadDueNotificationPrefs,
  markNotifDueSent,
  readNotifDueSent,
  saveDueNotificationPrefs,
  shouldShowSystemDueNotification,
  type DueNotificationPrefs,
} from "../../lib/reminder-notification-prefs";
import { syncReminderPushSubscription } from "../../lib/push-subscription-client";

type ChatRole = "user" | "assistant" | "system";

interface ChatReplyToRef {
  id: string;
  content: string;
  role: ChatRole;
}

interface ChatMessageMeta {
  kind?: "due_reminder" | "briefing" | "opening_summary";
  /** Which slice of the session briefing this bubble is (split messages). */
  briefingSection?: BriefingSection;
  reminderId?: string;
  dueAt?: number;
  title?: string;
  notes?: string;
  /** When true, message is not written to chat history file */
  skipPersist?: boolean;
  replyTo?: ChatReplyToRef;
  editedAt?: string;
}

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  meta?: ChatMessageMeta;
}

interface AgentAction {
  type:
    | "create_reminder"
    | "list_reminders"
    | "mark_done"
    | "delete_reminder"
    | "reschedule_reminder"
    | "clarify"
    | "unknown";
  title?: string;
  dueAt?: string;
  notes?: string;
  linkedTaskId?: string;
  priority?: number;
  targetTitle?: string;
  targetId?: string;
  scope?: "today" | "tomorrow" | "missed" | "done" | "pending" | "all";
}

interface AgentResponse {
  reply: string;
  action: AgentAction;
}
interface PendingCreateDraft {
  step: "title" | "date" | "time" | "task" | "priority";
  title?: string;
  notes?: string;
  dateIso?: string;
  dueAt?: string;
  linkedTaskId?: string;
  priority?: number;
}

interface WorkspaceProps {
  userId: string;
}

type DashboardOverlay =
  | "snapshot"
  | "create"
  | "reminders"
  | "tasks"
  | "share"
  | "import"
  | "batch";

interface DashboardOverlayState {
  overlay: DashboardOverlay;
  taskMode?: "create" | "browse";
  shareReminderIds?: string[];
}

interface DirectoryUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  username: string;
  imageUrl: string;
}

interface ShareInboxRow {
  _id: string;
  reminderId: string;
  token: string;
  fromUserId: string;
  fromDisplayName: string;
  toUserId: string;
  title: string;
  dueAt: number;
  createdAt: number;
  shareBatchId?: string;
}


function groupShareInboxRows(
  rows: ShareInboxRow[],
): { batchKey: string; rows: ShareInboxRow[] }[] {
  const map = new Map<string, ShareInboxRow[]>();
  for (const row of rows) {
    const key = row.shareBatchId ?? `legacy:${row._id}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  }
  return [...map.entries()].map(([batchKey, list]) => ({
    batchKey,
    rows: list,
  }));
}

function directoryDisplayName(u: DirectoryUser): string {
  const n = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  if (n) return n;
  if (u.username) return `@${u.username}`;
  return u.email || "User";
}

const loadingTexts = [
  "Processing your message...",
  "Understanding your reminder intent...",
  "Preparing the best response for you...",
  "Almost there, finalizing your reminder assistant reply...",
];

const STARTER_MESSAGE = {
  id: "starter",
  role: "assistant" as const,
  content:
    "Hi! Ask me anything about your reminders—what's next, times, notes, or compare your day. I can also create or complete them. Example: 'Create reminder tomorrow at 9am for gym'.",
  createdAt: new Date().toISOString(),
  meta: {
    skipPersist: true,
  },
};

function formatSummaryTime(value: string) {
  try {
    return new Date(value).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function buildOpeningSummaryMessage(input: {
  reminders: ReminderItem[];
  tasks: TaskItemBrief[];
  firstName?: string | null;
  now?: Date;
}): ChatMessage {
  const now = input.now ?? new Date();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const next2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  const overdueToday: ReminderItem[] = [];
  const nextTwoHours: ReminderItem[] = [];
  const upcomingLater: ReminderItem[] = [];

  for (const reminder of input.reminders) {
    if (reminder.status === "done" || reminder.status === "archived") continue;
    const dueMs = new Date(reminder.dueAt).getTime();
    if (!Number.isFinite(dueMs)) continue;

    if (dueMs >= startToday.getTime() && dueMs < now.getTime()) {
      overdueToday.push(reminder);
      continue;
    }
    if (dueMs >= now.getTime() && dueMs < next2h.getTime()) {
      nextTwoHours.push(reminder);
      continue;
    }
    if (dueMs >= next2h.getTime()) {
      upcomingLater.push(reminder);
    }
  }

  overdueToday.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  nextTwoHours.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  upcomingLater.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

  const name = input.firstName?.trim();
  const lines = [
    name ? `Good ${now.getHours() < 12 ? "morning" : now.getHours() < 18 ? "afternoon" : "evening"}, ${name}.` : "Here is your reminder overview:",
    "",
    `### 1) Today's overdue reminders (${overdueToday.length})`,
  ];

  if (overdueToday.length === 0) {
    lines.push("- None");
  } else {
    for (const item of overdueToday) {
      lines.push(`- ${formatSummaryTime(item.dueAt)} — **${item.title}**`);
    }
  }

  lines.push("", `### 2) Next 2 hours reminders (${nextTwoHours.length})`);
  if (nextTwoHours.length === 0) {
    lines.push("- None");
  } else {
    for (const item of nextTwoHours) {
      lines.push(`- ${formatSummaryTime(item.dueAt)} — **${item.title}**`);
    }
  }

  lines.push("", `### 3) Remaining upcoming reminders (${upcomingLater.length})`);
  if (upcomingLater.length === 0) {
    lines.push("- None");
  } else {
    for (const item of upcomingLater.slice(0, 12)) {
      lines.push(`- ${new Date(item.dueAt).toLocaleDateString()} ${formatSummaryTime(item.dueAt)} — **${item.title}**`);
    }
  }

  return {
    id: `opening-summary-${Date.now()}`,
    role: "assistant",
    content: lines.join("\n"),
    createdAt: now.toISOString(),
    meta: {
      kind: "opening_summary",
      skipPersist: true,
    },
  };
}

const SHOW_SUGGESTED_QUESTIONS_KEY = "remindos:showSuggestedQuestions";

function usePersistentReminders(userId: string) {
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setReminders([]);
    setIsLoaded(false);
    const load = async () => {
      try {
        const response = await fetch("/api/reminders");
        if (!response.ok) throw new Error("Failed to load reminders");
        const data = (await response.json()) as {
          reminders?: Array<Record<string, unknown>>;
        };
        const parsed = (data.reminders ?? []).map((item) =>
          fromApiReminder(item),
        );
        setReminders(parsed);
      } catch {
        setReminders([]);
      } finally {
        setIsLoaded(true);
      }
    };
    void load();
  }, [userId]);

  const updateReminders = (
    updater: (prev: ReminderItem[]) => ReminderItem[],
  ) => {
    setReminders((prev) => {
      return updater(prev);
    });
  };

  return [reminders, updateReminders, isLoaded] as const;
}

function dedupeMessagesById(messages: ChatMessage[]) {
  const map = new Map<string, ChatMessage>();
  for (const message of messages) {
    if (!message?.id) continue;
    map.set(message.id, message);
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

/** Ensures server-side chat uses the same IANA zone as the browser (fixes UTC vs local due times). */
function clientTimeZonePayload(): { timeZone?: string } {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz ? { timeZone: tz } : {};
  } catch {
    return {};
  }
}

function mergeRemoteChat(
  local: ChatMessage[],
  remote: ChatMessage[],
): ChatMessage[] {
  if (remote.length === 0) return local;
  const localBase = local.filter((m) => m.id !== "starter");
  const remoteMap = new Map(remote.map((m) => [m.id, m]));
  const out: ChatMessage[] = [];
  const seen = new Set<string>();
  for (const m of localBase) {
    if (m.meta?.skipPersist) {
      out.push(m);
      seen.add(m.id);
      continue;
    }
    const r = remoteMap.get(m.id);
    out.push(r ?? m);
    seen.add(m.id);
  }
  for (const m of remote) {
    if (!seen.has(m.id)) {
      out.push(m);
      seen.add(m.id);
    }
  }
  return dedupeMessagesById(out);
}

const CHAT_THREAD_BACKUP_PREFIX = "remindos:chatThread:";

function chatThreadBackupKey(userId: string) {
  return `${CHAT_THREAD_BACKUP_PREFIX}${userId}`;
}

function loadChatBackup(userId: string): ChatMessage[] | null {
  if (typeof localStorage === "undefined" || !userId) return null;
  try {
    const raw = localStorage.getItem(chatThreadBackupKey(userId));
    if (!raw) return null;
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data) || data.length === 0) return null;
    const out: ChatMessage[] = [];
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const m = item as Record<string, unknown>;
      const id = typeof m.id === "string" ? m.id : null;
      const role = m.role;
      const content = typeof m.content === "string" ? m.content : "";
      const createdAt = typeof m.createdAt === "string" ? m.createdAt : null;
      if (!id || !createdAt) continue;
      if (role !== "user" && role !== "assistant" && role !== "system")
        continue;
      if (!content.trim()) continue;
      out.push({
        id,
        role,
        content,
        createdAt,
        meta: m.meta as ChatMessage["meta"],
      });
    }
    return out.length > 0 ? dedupeMessagesById(out) : null;
  } catch {
    return null;
  }
}

function saveChatBackup(userId: string, messages: ChatMessage[]): void {
  if (typeof localStorage === "undefined" || !userId) return;
  try {
    const persistable = dedupeMessagesById(messages).filter(
      (m) => !m.meta?.skipPersist,
    );
    if (persistable.length === 0) {
      localStorage.removeItem(chatThreadBackupKey(userId));
      return;
    }
    const capped = persistable.slice(-400);
    localStorage.setItem(chatThreadBackupKey(userId), JSON.stringify(capped));
  } catch {
    /* quota or private mode */
  }
}

function clearChatBackup(userId: string): void {
  if (typeof localStorage === "undefined" || !userId) return;
  try {
    localStorage.removeItem(chatThreadBackupKey(userId));
  } catch {
    /* ignore */
  }
}

const LIFE_DOMAINS = new Set<string>([
  "health",
  "finance",
  "career",
  "hobby",
  "fun",
]);

function parseLifeDomain(value: unknown): LifeDomain | undefined {
  return typeof value === "string" && LIFE_DOMAINS.has(value)
    ? (value as LifeDomain)
    : undefined;
}

function fromApiTask(row: Record<string, unknown>): TaskRow {
  const pr = row.priority;
  return {
    id: String(row._id ?? row.id ?? crypto.randomUUID()),
    title: String(row.title ?? ""),
    notes: typeof row.notes === "string" ? row.notes : undefined,
    dueAt:
      row.dueAt != null ? new Date(Number(row.dueAt)).toISOString() : undefined,
    status: row.status === "done" ? "done" : "pending",
    priority: typeof pr === "number" && Number.isFinite(pr) ? pr : undefined,
    domain: parseLifeDomain(row.domain),
  };
}

function taskBucket(task: TaskRow, now: Date): "missed" | "later" | "done" {
  if (task.status === "done") return "done";
  if (task.dueAt && new Date(task.dueAt).getTime() < now.getTime())
    return "missed";
  return "later";
}

function fromApiReminder(item: Record<string, unknown>): ReminderItem {
  const access = item._access === "shared" ? "shared" : "owner";
  const p = item.priority;
  const linked = item.linkedTaskId;
  const ownerUserId =
    access === "shared" && typeof item.userId === "string"
      ? item.userId
      : undefined;
  const shareRecipients = Array.isArray(item._shareRecipients)
    ? (item._shareRecipients as { userId: string; displayName: string }[])
    : undefined;
  const outgoingShared = item._outgoingShared === true;
  return {
    id: String(item._id ?? item.id ?? crypto.randomUUID()),
    title: String(item.title ?? ""),
    dueAt: new Date(Number(item.dueAt ?? Date.now())).toISOString(),
    notes: typeof item.notes === "string" ? item.notes : "",
    recurrence:
      item.recurrence === "daily" ||
      item.recurrence === "weekly" ||
      item.recurrence === "monthly"
        ? item.recurrence
        : "none",
    status:
      item.status === "done" || item.status === "archived"
        ? item.status
        : "pending",
    priority: typeof p === "number" && Number.isFinite(p) ? p : undefined,
    createdAt: new Date(Number(item.createdAt ?? Date.now())).toISOString(),
    updatedAt: new Date(Number(item.updatedAt ?? Date.now())).toISOString(),
    access,
    ownerUserId,
    shareRecipients: access === "owner" ? shareRecipients : undefined,
    outgoingShared: access === "owner" ? outgoingShared : undefined,
    linkedTaskId: typeof linked === "string" ? linked : undefined,
    domain: parseLifeDomain(item.domain),
  };
}

function matchesReminder(
  reminder: ReminderItem,
  targetId?: string,
  targetTitle?: string,
) {
  if (targetId && reminder.id === targetId) return true;
  if (!targetTitle) return false;
  return reminder.title.toLowerCase().includes(targetTitle.toLowerCase());
}

const DUE_SHOWN_KEY = "remindos:dueShown";

function dueMinuteKey(reminder: ReminderItem) {
  const d = new Date(reminder.dueAt);
  return `${reminder.id}|${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
}

function isDueThisMinute(dueAtIso: string, now: Date) {
  const d = new Date(dueAtIso);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate() &&
    d.getHours() === now.getHours() &&
    d.getMinutes() === now.getMinutes()
  );
}

function isOverdueTodayReminder(reminder: ReminderItem, now = new Date()) {
  if (reminder.status === "done" || reminder.status === "archived") return false;
  const dueMs = new Date(reminder.dueAt).getTime();
  if (!Number.isFinite(dueMs)) return false;
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startTodayMs = startToday.getTime();
  const nowMs = now.getTime();
  return dueMs >= startTodayMs && dueMs < nowMs;
}

function readDueShown(): Set<string> {
  if (typeof sessionStorage === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(DUE_SHOWN_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function markDueShown(key: string) {
  if (typeof sessionStorage === "undefined") return;
  const next = readDueShown();
  next.add(key);
  sessionStorage.setItem(DUE_SHOWN_KEY, JSON.stringify([...next]));
}

function toReplyContextPayload(
  target: ChatMessage | null | undefined,
): ReplyContextPayload | undefined {
  if (!target?.content?.trim()) return undefined;
  return {
    id: target.id,
    content: target.content,
    role: target.role === "system" ? "system" : target.role,
  };
}

function chatReplyLabel(role: ChatRole): string {
  if (role === "user") return "You";
  if (role === "assistant") return "RemindOS";
  return "Notice";
}

function briefingSectionLabel(section: BriefingSection | undefined): string {
  switch (section) {
    case "greeting":
      return "Briefing";
    case "completed":
      return "Completed";
    case "overdue":
      return "Overdue";
    case "today":
      return "Today";
    case "tomorrow":
      return "Tomorrow";
    case "later":
      return "Coming up";
    case "tasks":
      return "Tasks by priority";
    case "closing":
      return "Next step";
    default:
      return "Session briefing";
  }
}

/** Desktop (md+): chevron opens Reply / Edit. Mobile: swipe right → reply; long-press user bubble → edit. */
function ChatBubbleShell({
  children,
  onReply,
  onEdit,
  showEdit,
  actionAlign = "end",
  showActionsAlways = false,
  desktopHoverMenu = false,
  onLongPressEdit,
}: {
  children: ReactNode;
  onReply: () => void;
  onEdit?: () => void;
  showEdit: boolean;
  actionAlign?: "start" | "center" | "end";
  showActionsAlways?: boolean;
  desktopHoverMenu?: boolean;
  onLongPressEdit?: () => void;
}) {
  const touchStart = useRef({ x: 0, y: 0 });
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [desktopMenuOpen, setDesktopMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swipeReleasing, setSwipeReleasing] = useState(false);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const justify =
    actionAlign === "center"
      ? "justify-center"
      : actionAlign === "start"
        ? "justify-start"
        : "justify-end";

  const runReplySwipeAnimation = () => {
    setSwipeReleasing(true);
    setSwipeOffset(96);
    window.setTimeout(() => {
      setSwipeOffset(0);
    }, 110);
    window.setTimeout(() => {
      setSwipeReleasing(false);
    }, 240);
  };

  return (
    <div
      className="group/msg relative min-w-0 w-full max-w-full"
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (!t) return;
        touchStart.current = { x: t.clientX, y: t.clientY };
        setSwipeReleasing(false);
        if (swipeOffset !== 0) setSwipeOffset(0);
        clearLongPress();
        longPressTimer.current = setTimeout(() => {
          longPressTimer.current = null;
          setMobileMenuOpen(true);
        }, 470);
      }}
      onTouchMove={(e) => {
        const t = e.touches[0];
        if (!t) return;
        const dx = t.clientX - touchStart.current.x;
        const dy = t.clientY - touchStart.current.y;

        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
          clearLongPress();
        }

        if (dx > 0 && Math.abs(dy) < 72 && dx > Math.abs(dy)) {
          setSwipeReleasing(false);
          setSwipeOffset(Math.min(dx, 96));
        } else if (swipeOffset !== 0) {
          setSwipeOffset(0);
        }
      }}
      onTouchEnd={(e) => {
        clearLongPress();
        const t = e.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - touchStart.current.x;
        const dy = t.clientY - touchStart.current.y;
        if (dx > 84 && Math.abs(dy) < 64) {
          runReplySwipeAnimation();
          onReply();
          return;
        }
        if (swipeOffset > 0) {
          setSwipeReleasing(true);
          setSwipeOffset(0);
          window.setTimeout(() => {
            setSwipeReleasing(false);
          }, 180);
        }
      }}
      onTouchCancel={() => {
        clearLongPress();
        if (swipeOffset > 0) {
          setSwipeReleasing(true);
          setSwipeOffset(0);
          window.setTimeout(() => {
            setSwipeReleasing(false);
          }, 180);
        }
      }}
    >
      {desktopHoverMenu ? (
        <div
          className="pointer-events-none absolute -right-1 -top-1 z-30 hidden pb-10 pl-10 pt-1 md:block"
          onMouseEnter={() => setDesktopMenuOpen(true)}
          onMouseLeave={() => setDesktopMenuOpen(false)}
        >
          <div
            className={`pointer-events-auto transition-opacity duration-150 ${
              desktopMenuOpen
                ? "opacity-100"
                : "opacity-0 group-hover/msg:opacity-100"
            }`}
          >
            <div className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDesktopMenuOpen((o) => !o);
                }}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-300/50 bg-white/95 text-slate-600 shadow-sm backdrop-blur-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800/95 dark:text-slate-200 dark:hover:bg-slate-700"
                aria-expanded={desktopMenuOpen}
                aria-haspopup="menu"
                aria-label="Message options"
              >
                <span className="text-base leading-none" aria-hidden>
                  ⌄
                </span>
              </button>
              {desktopMenuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-40 mt-1 min-w-[9rem] rounded-xl border border-slate-200 bg-white py-1 text-xs font-medium text-slate-800 shadow-lg dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700"
                    onClick={() => {
                      setDesktopMenuOpen(false);
                      onReply();
                    }}
                  >
                    Reply
                  </button>
                  {showEdit && onEdit ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="block w-full px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700"
                      onClick={() => {
                        setDesktopMenuOpen(false);
                        onEdit();
                      }}
                    >
                      Edit message
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {mobileMenuOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-slate-950/20 p-3 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="w-full rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onReply();
              }}
              className="block w-full rounded-xl px-3 py-3 text-left text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Reply
            </button>
            {showEdit && (onEdit || onLongPressEdit) ? (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  (onEdit ?? onLongPressEdit)?.();
                }}
                className="block w-full rounded-xl px-3 py-3 text-left text-sm font-medium text-violet-700 hover:bg-violet-50"
              >
                Edit
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-2 z-0 flex items-center md:hidden">
          <span
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 text-violet-700"
            style={{ opacity: Math.min(1, swipeOffset / 34) }}
            aria-hidden
          >
            ↩
          </span>
        </div>
        <div
          className={`relative z-10 ${swipeReleasing ? "transition-transform duration-200 ease-out" : ""}`}
          style={{ transform: `translateX(${swipeOffset}px)` }}
        >
          {children}
        </div>
      </div>

      <div
        className={`mt-1 flex flex-wrap gap-2 ${justify} transition-opacity ${
          desktopHoverMenu
            ? "hidden"
            : showActionsAlways
              ? "opacity-100"
              : "opacity-100 sm:opacity-0 sm:group-hover/msg:opacity-100"
        }`}
      >
        <button
          type="button"
          className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-900"
          onClick={onReply}
        >
          Reply
        </button>
        {showEdit && onEdit ? (
          <button
            type="button"
            className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[10px] font-semibold text-violet-700 shadow-sm transition hover:border-violet-300 hover:bg-violet-100"
            onClick={onEdit}
          >
            Edit
          </button>
        ) : null}
      </div>
    </div>
  );
}

function toDateTimeLocalValue(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function currentDateTimeLocalValue(): string {
  return toDateTimeLocalValue(new Date().toISOString());
}

function extractInviteToken(text: string): string | null {
  const trimmed = text.trim();
  const fromUrl = trimmed.match(/[?&]invite=([^&\s#]+)/i);
  if (fromUrl?.[1]) return decodeURIComponent(fromUrl[1]);
  const acceptHex = trimmed.match(/\baccept\s+invite\s+([a-f\d]{16,64})\b/i);
  if (acceptHex?.[1]) return acceptHex[1];
  const plainHex = trimmed.match(/\b([a-f\d]{24,40})\b/i);
  if (plainHex?.[1] && /\b(accept|invite|join)\b/i.test(trimmed))
    return plainHex[1];
  return null;
}

export function DashboardWorkspace({ userId }: WorkspaceProps) {
  const { user } = useUser();
  const searchParams = useSearchParams();
  const notifUrlHandledRef = useRef<string | null>(null);
  const shareBatchUrlHandledRef = useRef<string | null>(null);
  const [reminders, setReminders, remindersLoaded] = usePersistentReminders(userId);
  const [dueNotifPrefs, setDueNotifPrefs] = useState<DueNotificationPrefs>(() =>
    loadDueNotificationPrefs(),
  );
  const [notifUiTick, setNotifUiTick] = useState(0);
  const [dueNotifBannerDismissed, setDueNotifBannerDismissed] = useState(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const userIdRef = useRef(userId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isListOpen, setIsListOpen] = useState(false);
  const [isSnapshotOpen, setIsSnapshotOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [isClearingChat, setIsClearingChat] = useState(false);
  const [isBatchOpen, setIsBatchOpen] = useState(false);
  const [batchJson, setBatchJson] = useState("");
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);
  const [editingReminderId, setEditingReminderId] = useState<string | null>(
    null,
  );
  const [loadingTextIndex, setLoadingTextIndex] = useState(0);
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newRecurrence, setNewRecurrence] =
    useState<ReminderRecurrence>("none");
  const [newNotes, setNewNotes] = useState("");
  const [pendingCreateDraft, setPendingCreateDraft] =
    useState<PendingCreateDraft | null>(null);
  const [createFormError, setCreateFormError] = useState<string | null>(null);
  const [showReminderSuccess, setShowReminderSuccess] = useState(false);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [followUpQuestions, setFollowUpQuestions] = useState<
    FollowUpQuestion[]
  >([]);
  const [showSuggestedQuestions, setShowSuggestedQuestions] = useState(true);
  const [reminderListTab, setReminderListTab] = useState<
    "missed" | "today" | "tomorrow" | "upcoming" | "done" | "shared" | "sent"
  >("missed");
  const [sharedFromFilter, setSharedFromFilter] = useState<"all" | string>(
    "all",
  );
  const [sentToFilter, setSentToFilter] = useState<"all" | string>("all");
  const [isTasksOpen, setIsTasksOpen] = useState(false);
  const [taskMode, setTaskMode] = useState<"browse" | "create">("browse");
  const [taskTab, setTaskTab] = useState<"missed" | "pending" | "done">(
    "pending",
  );
  const [taskFormTitle, setTaskFormTitle] = useState("");
  const [taskFormDue, setTaskFormDue] = useState(() =>
    currentDateTimeLocalValue(),
  );
  const [taskFormNotes, setTaskFormNotes] = useState("");
  const [taskFormError, setTaskFormError] = useState<string | null>(null);
  const [reminderStars, setReminderStars] = useState(0);
  const [taskStars, setTaskStars] = useState(0);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [reminderLinkedTaskId, setReminderLinkedTaskId] = useState("");
  const [reminderDomain, setReminderDomain] = useState<"" | LifeDomain>("");
  const [reminderTaskFilter, setReminderTaskFilter] = useState<
    "all" | "adhoc" | string
  >("all");
  const [taskFormDomain, setTaskFormDomain] = useState<"" | LifeDomain>("");
  /** False until user focuses/changes due — then live "now" updates stop for new tasks. */
  const [taskDueUserEdited, setTaskDueUserEdited] = useState(false);
  const [showReminderInlineTask, setShowReminderInlineTask] = useState(false);
  const [reminderInlineTaskTitle, setReminderInlineTaskTitle] = useState("");
  const [reminderInlineTaskDue, setReminderInlineTaskDue] = useState("");
  const [reminderInlineTaskSaving, setReminderInlineTaskSaving] =
    useState(false);
  const [rescheduleReminder, setRescheduleReminder] = useState<{
    messageId: string;
    reminderId: string;
    title: string;
    value: string;
    error: string | null;
  } | null>(null);
  const [shareToast, setShareToast] = useState<string | null>(null);
  const shareToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reminderSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [shareReminderIds, setShareReminderIds] = useState<string[]>([]);
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [selectedShareUserIds, setSelectedShareUserIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [shareSending, setShareSending] = useState(false);
  const [reminderSelectionMode, setReminderSelectionMode] = useState(false);
  const [selectedReminderIds, setSelectedReminderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [shareInbox, setShareInbox] = useState<ShareInboxRow[]>([]);
  const isAnyOverlayOpen =
    isSnapshotOpen ||
    isCreateOpen ||
    isListOpen ||
    isShareOpen ||
    isTasksOpen ||
    isImportOpen ||
    isBatchOpen;
  /** DOM timer id; avoid NodeJS.Timeout vs number mismatch in mixed typings. */
  const reminderLongPressTimerRef = useRef<number | null>(null);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const briefingRanRef = useRef(false);
  const openingSummaryAppliedRef = useRef(false);
  const missedRemindersAppliedRef = useRef(false);
  const resetTaskFormRef = useRef<() => void>(() => {});
  const briefingPlaybackActiveRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remindersRef = useRef(reminders);
  remindersRef.current = reminders;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const listOpenRef = useRef(false);
  const [briefingStreaming, setBriefingStreaming] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const chatFormRef = useRef<HTMLFormElement>(null);
  const quickSubmitTextRef = useRef<string | null>(null);
  /** When false, do not auto-scroll on new/streaming content so the user can read history. */
  const chatPinnedToBottomRef = useRef(true);
  /** After clear chat, ignore poll merges briefly so in-flight GETs cannot restore deleted history. */
  const skipRemotePollMergeUntilRef = useRef(0);
  const isHistoryLoadedRef = useRef(false);

  messagesRef.current = messages;
  userIdRef.current = userId;
  isHistoryLoadedRef.current = isHistoryLoaded;

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("dashboard:reminders-changed", {
        detail: {
          reminders: reminders.map((reminder) => ({
            id: reminder.id,
            dueAt: reminder.dueAt,
            status: reminder.status,
          })),
        },
      }),
    );
  }, [reminders]);

  /** Persists latest messages; uses sendBeacon/keepalive so a refresh does not drop unsaved debounced writes. */
  const flushChatHistoryToServer = useCallback(() => {
    if (!isHistoryLoadedRef.current) return;
    saveChatBackup(userIdRef.current, messagesRef.current);
    const deduped = dedupeMessagesById(messagesRef.current).filter(
      (m) => !m.meta?.skipPersist,
    );
    if (deduped.length === 0) return;
    const body = JSON.stringify({ messages: deduped });
    const url = "/api/chat/history";
    try {
      if (
        typeof navigator !== "undefined" &&
        typeof Blob !== "undefined" &&
        body.length < 55_000
      ) {
        const blob = new Blob([body], { type: "application/json" });
        if (navigator.sendBeacon(url, blob)) return;
      }
    } catch {
      /* fall through to fetch */
    }
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  }, []);

  const onChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    chatPinnedToBottomRef.current = gap <= 120;
  }, []);

  const runBriefingStream = useCallback(
    (recordAutoBriefing = false) => {
      if (!isHistoryLoaded || briefingPlaybackActiveRef.current) return;
      briefingPlaybackActiveRef.current = true;
      setBriefingStreaming(true);
      chatPinnedToBottomRef.current = true;

      const taskBrief: TaskItemBrief[] = tasksRef.current.map((t) => ({
        id: t.id,
        title: t.title,
        dueAt: t.dueAt,
        status: t.status,
        priority: t.priority,
      }));
      const parts = buildBriefingParts(
        remindersRef.current,
        user?.firstName ?? null,
        taskBrief,
      );

      setMessages((prev) =>
        prev.filter((m) => m.id !== "starter" && m.meta?.kind !== "briefing"),
      );

      setMessages((prev) => [
        ...prev,
        ...parts.map((part, index) => ({
          id: `briefing-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 9)}`,
          role: "assistant" as const,
          content: part.text,
          createdAt: new Date().toISOString(),
          meta: {
            kind: "briefing" as const,
            briefingSection: part.section,
            skipPersist: true,
          },
        })),
      ]);

      briefingPlaybackActiveRef.current = false;
      setBriefingStreaming(false);
      if (recordAutoBriefing) {
        try {
          if (typeof localStorage !== "undefined") {
            localStorage.setItem(
              `remindos:lastAutoBriefingAt:${userId}`,
              String(Date.now()),
            );
          }
        } catch {
          /* ignore */
        }
      }
    },
    [isHistoryLoaded, user?.firstName, userId],
  );

  const refreshReminders = useCallback(async () => {
    const response = await fetch("/api/reminders");
    if (!response.ok) return;
    const data = (await response.json()) as {
      reminders?: Array<Record<string, unknown>>;
    };
    setReminders(() =>
      (data.reminders ?? []).map((item) => fromApiReminder(item)),
    );
  }, [setReminders]);

  const showShareToast = useCallback((message: string) => {
    setShareToast(message);
    if (shareToastTimerRef.current) clearTimeout(shareToastTimerRef.current);
    shareToastTimerRef.current = setTimeout(() => {
      setShareToast(null);
      shareToastTimerRef.current = null;
    }, 3400);
  }, []);

  const refreshAfterReminderMutation = useCallback(
    async (responsePromise: Promise<Response>) => {
      const response = await responsePromise;
      if (!response.ok) {
        throw new Error("Reminder update failed");
      }
      await refreshReminders();
    },
    [refreshReminders],
  );

  const playReminderSuccessAnimation = useCallback(() => {
    setShowReminderSuccess(true);
    if (reminderSuccessTimerRef.current)
      clearTimeout(reminderSuccessTimerRef.current);
    reminderSuccessTimerRef.current = setTimeout(() => {
      setShowReminderSuccess(false);
      reminderSuccessTimerRef.current = null;
    }, 900);
  }, []);

  const loadShareInbox = useCallback(async () => {
    try {
      const res = await fetch("/api/reminders/inbox");
      if (!res.ok) return;
      const data = (await res.json()) as { inbox?: ShareInboxRow[] };
      setShareInbox(data.inbox ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  const loadDirectory = useCallback(async () => {
    setDirectoryLoading(true);
    setDirectoryError(null);
    try {
      const res = await fetch("/api/users/directory");
      const data = (await res.json()) as {
        users?: DirectoryUser[];
        error?: string;
      };
      if (!res.ok) {
        setDirectoryError(data.error ?? "Could not load users");
        setDirectoryUsers([]);
        return;
      }
      setDirectoryUsers(data.users ?? []);
    } catch {
      setDirectoryError("Could not load users");
      setDirectoryUsers([]);
    } finally {
      setDirectoryLoading(false);
    }
  }, []);

  const openShareModal = useCallback(
    (ids: string[]) => {
      const unique = [...new Set(ids)].filter(Boolean);
      if (unique.length === 0) return;
      setShareReminderIds(unique);
      setSelectedShareUserIds(new Set());
      setIsShareOpen(true);
      void loadDirectory();
    },
    [loadDirectory],
  );

  const sendShares = useCallback(async () => {
    if (shareReminderIds.length === 0 || selectedShareUserIds.size === 0)
      return;
    setShareSending(true);
    try {
      const res = await fetch("/api/reminders/share/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reminderIds: shareReminderIds,
          targetUserIds: [...selectedShareUserIds],
        }),
      });
      const data = (await res.json()) as { delivered?: number; error?: string };
      if (!res.ok) {
        showShareToast(data.error ?? "Could not share");
        return;
      }
      showShareToast(
        data.delivered != null
          ? `Sent · ${data.delivered} notification(s)`
          : "Shared successfully",
      );
      if (
        typeof window !== "undefined" &&
        ((
          window.history.state as {
            dashboardOverlay?: DashboardOverlayState;
          } | null
        )?.dashboardOverlay?.overlay ?? null) === "share"
      ) {
        window.history.back();
      } else {
        setIsShareOpen(false);
      }
      setReminderSelectionMode(false);
      setSelectedReminderIds(new Set());
      void loadShareInbox();
    } catch {
      showShareToast("Could not share. Try again.");
    } finally {
      setShareSending(false);
    }
  }, [shareReminderIds, selectedShareUserIds, showShareToast, loadShareInbox]);

  const toggleShareUser = useCallback((id: string) => {
    setSelectedShareUserIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const toggleReminderSelect = useCallback((id: string) => {
    setSelectedReminderIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const joinShareBatch = useCallback(
    async (batchKey: string) => {
      try {
        const res = await fetch("/api/reminders/share/batch/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchKey }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          showShareToast(data.error ?? "Could not accept");
          return;
        }
        showShareToast("You're in on those reminders.");
        await refreshReminders();
        void loadShareInbox();
      } catch {
        showShareToast("Could not accept");
      }
    },
    [refreshReminders, loadShareInbox, showShareToast],
  );

  const dismissShareBatch = useCallback(
    async (batchKey: string) => {
      try {
        await fetch("/api/reminders/share/batch/dismiss", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchKey }),
        });
        void loadShareInbox();
      } catch {
        /* ignore */
      }
    },
    [loadShareInbox],
  );

  useEffect(() => {
    if (isListOpen) void loadShareInbox();
  }, [isListOpen, loadShareInbox]);

  const refreshRemindersRef = useRef(refreshReminders);
  refreshRemindersRef.current = refreshReminders;

  const refreshTasks = useCallback(async () => {
    try {
      const response = await fetch("/api/tasks");
      if (!response.ok) return;
      const data = (await response.json()) as {
        tasks?: Array<Record<string, unknown>>;
      };
      setTasks((data.tasks ?? []).map((item) => fromApiTask(item)));
    } finally {
      setTasksLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refreshTasks();
  }, [userId, refreshTasks]);

  useEffect(() => {
    try {
      if (
        typeof localStorage !== "undefined" &&
        localStorage.getItem(SHOW_SUGGESTED_QUESTIONS_KEY) === "0"
      ) {
        setShowSuggestedQuestions(false);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const runReminderQuickAction = useCallback(
    async (reminderId: string, action: "delete" | "done" | "snooze") => {
      if (action === "delete") {
        await refreshAfterReminderMutation(
          fetch(`/api/reminders/${reminderId}`, { method: "DELETE" }),
        );
      } else if (action === "done") {
        await refreshAfterReminderMutation(
          fetch(`/api/reminders/${reminderId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "done" }),
          }),
        );
      } else {
        await refreshAfterReminderMutation(
          fetch(`/api/reminders/${reminderId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dueAt: Date.now() + 60 * 60 * 1000 }),
          }),
        );
      }
    },
    [refreshAfterReminderMutation],
  );

  useEffect(() => {
    if (!isLoading) return;
    const interval = window.setInterval(() => {
      setLoadingTextIndex((prev) => (prev + 1) % loadingTexts.length);
    }, 2200);
    return () => window.clearInterval(interval);
  }, [isLoading]);

  useEffect(() => {
    const loadHistory = async () => {
      const fallbackStarter = () =>
        setMessages([
          { ...STARTER_MESSAGE, createdAt: new Date().toISOString() },
        ]);

      const syncServer = (list: ChatMessage[]) => {
        const persistable = dedupeMessagesById(list).filter(
          (m) => !m.meta?.skipPersist,
        );
        if (persistable.length === 0) return;
        void fetch("/api/chat/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: persistable }),
        });
      };

      try {
        const response = await fetch("/api/chat/history");
        if (!response.ok) throw new Error("Failed to load chat history");
        const data = (await response.json()) as { messages?: ChatMessage[] };
        const parsed = (data.messages ?? []).filter(
          (item) =>
            item.id &&
            item.content &&
            item.createdAt &&
            (item.role === "user" ||
              item.role === "assistant" ||
              item.role === "system"),
        );
        if (parsed.length > 0) {
          const next = dedupeMessagesById(parsed);
          setMessages(next);
          saveChatBackup(userId, next);
        } else {
          // Server is empty — trust it (do not restore localStorage backup or cleared chat comes back on refresh).
          clearChatBackup(userId);
          fallbackStarter();
        }
      } catch {
        const backup = loadChatBackup(userId);
        if (backup && backup.length > 0) {
          const next = dedupeMessagesById(backup);
          setMessages(next);
          syncServer(next);
        } else {
          fallbackStarter();
        }
      } finally {
        setIsHistoryLoaded(true);
      }
    };
    void loadHistory();
  }, [userId]);

  useEffect(() => {
    if (!isHistoryLoaded) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      flushChatHistoryToServer();
    }, 350);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [messages, isHistoryLoaded, flushChatHistoryToServer]);

  useEffect(() => {
    if (!isHistoryLoaded || isLoading) return;
    flushChatHistoryToServer();
  }, [isLoading, isHistoryLoaded, flushChatHistoryToServer]);

  useEffect(() => {
    const onLeave = () => {
      if (document.visibilityState === "hidden") flushChatHistoryToServer();
    };
    const onUnload = () => flushChatHistoryToServer();
    document.addEventListener("visibilitychange", onLeave);
    window.addEventListener("pagehide", onUnload);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("visibilitychange", onLeave);
      window.removeEventListener("pagehide", onUnload);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [flushChatHistoryToServer]);

  useEffect(() => {
    if (!isHistoryLoaded) return;
    const poll = async () => {
      if (briefingStreaming) return;
      try {
        const response = await fetch("/api/chat/history");
        if (!response.ok) return;
        const data = (await response.json()) as { messages?: ChatMessage[] };
        const remote = (data.messages ?? []).filter(
          (item) =>
            item.id &&
            item.content &&
            item.createdAt &&
            (item.role === "user" ||
              item.role === "assistant" ||
              item.role === "system"),
        );
        setMessages((prev) => {
          if (Date.now() < skipRemotePollMergeUntilRef.current) {
            return prev;
          }
          return mergeRemoteChat(prev, remote);
        });
      } catch {
        /* ignore */
      }
    };
    const id = window.setInterval(poll, 2800);
    const onVis = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [isHistoryLoaded, briefingStreaming]);

  useEffect(() => {
    if (briefingStreaming) return;
    const lastUser = [...messages]
      .reverse()
      .find((m) => m.role === "user")?.content;
    const taskBrief: TaskItemBrief[] = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      dueAt: t.dueAt,
      status: t.status,
      priority: t.priority,
    }));
    setFollowUpQuestions(
      buildFollowUpQuestions({
        reminders,
        tasks: taskBrief,
        lastUserMessage: lastUser,
        firstName: user?.firstName,
      }),
    );
  }, [messages, reminders, tasks, user?.firstName, briefingStreaming]);

  useEffect(() => {
    return () => {
      if (shareToastTimerRef.current) clearTimeout(shareToastTimerRef.current);
      if (reminderSuccessTimerRef.current)
        clearTimeout(reminderSuccessTimerRef.current);
    };
  }, []);

  useEffect(() => {
    briefingRanRef.current = false;
    openingSummaryAppliedRef.current = false;
    missedRemindersAppliedRef.current = false;
    setTasksLoaded(false);
  }, [userId]);

  useEffect(() => {
    if (!isHistoryLoaded || !remindersLoaded || !tasksLoaded) return;
    if (openingSummaryAppliedRef.current) return;
    const summary = buildOpeningSummaryMessage({
      reminders,
      tasks: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        dueAt: task.dueAt,
        status: task.status,
        priority: task.priority,
      })),
      firstName: user?.firstName,
    });
    setMessages((prev) => [
      summary,
      ...prev.filter(
        (message) => message.id !== "starter" && message.meta?.kind !== "opening_summary",
      ),
    ]);
    openingSummaryAppliedRef.current = true;
  }, [isHistoryLoaded, remindersLoaded, tasksLoaded, reminders, tasks, user?.firstName]);

  useEffect(() => {
    if (!isHistoryLoaded || !remindersLoaded || !tasksLoaded) return;
    if (missedRemindersAppliedRef.current) return;
    if (!openingSummaryAppliedRef.current) return;
    // Opening summary already contains ordered sections including overdue today.
    // Prevent duplicate missed reminder bubbles on refresh/reopen.
    missedRemindersAppliedRef.current = true;
  }, [isHistoryLoaded, remindersLoaded, tasksLoaded, reminders]);

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return;
    if (!chatPinnedToBottomRef.current) return;
    const id = requestAnimationFrame(() => {
      const el = chatScrollRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [messages, isLoading, briefingStreaming]);

  const cueInitRef = useRef(false);
  const lastCueMessageIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isHistoryLoaded) return;
    const latest = [...messages].reverse().find((m) => m.role !== "user");
    if (!latest) return;
    if (!cueInitRef.current) {
      cueInitRef.current = true;
      lastCueMessageIdRef.current = latest.id;
      return;
    }
    if (lastCueMessageIdRef.current === latest.id) return;
    lastCueMessageIdRef.current = latest.id;
    void playUiCue(
      latest.meta?.kind === "briefing" ? "briefing" : "notification",
    );
  }, [messages, isHistoryLoaded]);

  useEffect(() => {
    const textarea = composerTextareaRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";
    const maxHeight = Math.min(window.innerHeight * 0.28, 144);
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${Math.max(nextHeight, 44)}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [input, briefingStreaming, editingMessageId, replyTarget]);

  const inviteQueryParam = searchParams.get("invite");

  useEffect(() => {
    const token = inviteQueryParam?.trim();
    if (!token || !isHistoryLoaded) return;

    const handledKey = `remindos:inviteUiHandled:${token}`;
    if (
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem(handledKey)
    ) {
      if (typeof window !== "undefined") {
        window.history.replaceState(window.history.state, "", "/dashboard");
      }
      return;
    }

    // Strip ?invite= from the URL immediately so this effect does not re-fire in a loop
    // (each run would otherwise append another error/success message).
    if (typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", "/dashboard");
    }

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/reminders/share/${encodeURIComponent(token)}`,
          {
            method: "POST",
          },
        );
        const data = (await res.json()) as { error?: string; title?: string };
        if (cancelled) return;

        if (typeof sessionStorage !== "undefined") {
          sessionStorage.setItem(handledKey, "1");
        }

        if (!res.ok) {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: data.error ?? "Could not accept that invite.",
              createdAt: new Date().toISOString(),
            },
          ]);
          return;
        }

        await refreshRemindersRef.current();
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: data.title
              ? `You're in on "${data.title}". Shared reminders appear in your list.`
              : "Invite accepted.",
            createdAt: new Date().toISOString(),
          },
        ]);
      } catch {
        if (!cancelled) {
          if (typeof sessionStorage !== "undefined") {
            sessionStorage.setItem(handledKey, "1");
          }
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content:
                "Could not accept the invite. Try again from chat with the link.",
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [inviteQueryParam, isHistoryLoaded]);

  const shareBatchAction = searchParams.get("shareBatchAction");
  const batchKeyParam = searchParams.get("batchKey");

  useEffect(() => {
    const act = shareBatchAction?.trim();
    const key = batchKeyParam?.trim();
    if (!act || !key || !isHistoryLoaded) return;
    const sig = `${act}:${key}`;
    if (shareBatchUrlHandledRef.current === sig) return;
    shareBatchUrlHandledRef.current = sig;
    let cancelled = false;
    void (async () => {
      try {
        if (act === "accept") {
          const res = await fetch("/api/reminders/share/batch/accept", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ batchKey: key }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          if (!res.ok && !cancelled) {
            showShareToast(data.error ?? "Could not accept");
            shareBatchUrlHandledRef.current = null;
            return;
          }
          if (!cancelled) showShareToast("You're in on those reminders.");
        } else if (act === "deny") {
          await fetch("/api/reminders/share/batch/dismiss", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ batchKey: key }),
          });
        }
        if (!cancelled) {
          await refreshRemindersRef.current();
          void loadShareInbox();
        }
      } catch {
        shareBatchUrlHandledRef.current = null;
      } finally {
        if (typeof window !== "undefined") {
          window.history.replaceState(window.history.state, "", "/dashboard");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    shareBatchAction,
    batchKeyParam,
    isHistoryLoaded,
    loadShareInbox,
    showShareToast,
  ]);

  useEffect(() => {
    if (!isHistoryLoaded) return;
    void syncReminderPushSubscription();
  }, [isHistoryLoaded]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!isAnyOverlayOpen) return;

    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }, [isAnyOverlayOpen]);

  useEffect(() => {
    if (!isHistoryLoaded) return;
    for (const m of messages) {
      if (m.role !== "system") continue;
      if (!/\bwas accepted by\b|\byou joined\b/i.test(m.content)) continue;
      if (!shouldNotifyForCollaboration(m.id, m.createdAt)) continue;
      const title = /\bwas accepted by\b/i.test(m.content)
        ? "Reminder shared"
        : "Shared reminder";
      void showCollaborationNotification(
        title,
        m.content.slice(0, 200),
        `collab-${m.id}`,
      );
    }
  }, [messages, isHistoryLoaded]);

  useEffect(() => {
    const rid = searchParams.get("reminderId")?.trim();
    const act = searchParams.get("notifAction")?.trim();
    if (!rid) return;
    const sig = `${act ?? ""}:${rid}`;
    if (notifUrlHandledRef.current === sig) return;
    if (!act || act === "open") {
      notifUrlHandledRef.current = sig;
      if (typeof window !== "undefined") {
        window.history.replaceState(window.history.state, "", "/dashboard");
      }
      return;
    }
    if (act !== "done" && act !== "snooze" && act !== "delete") return;
    notifUrlHandledRef.current = sig;
    void runReminderQuickAction(rid, act).finally(() => {
      const reminderTitle = remindersRef.current.find((r) => r.id === rid)?.title ?? "Reminder";
      const resolutionLine =
        act === "done"
          ? `Marked "${reminderTitle}" as done.`
          : act === "snooze"
            ? `Snoozed "${reminderTitle}" by one hour.`
            : `Deleted "${reminderTitle}".`;
      resolveDueReminderById(rid, resolutionLine);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "system",
          content:
            act === "done"
              ? `Marked **${reminderTitle}** as done from notification.`
              : act === "snooze"
                ? `Snoozed **${reminderTitle}** for 1 hour from notification.`
                : `Deleted **${reminderTitle}** from notification.`,
          createdAt: new Date().toISOString(),
        },
      ]);
      if (typeof window !== "undefined") {
        window.history.replaceState(window.history.state, "", "/dashboard");
      }
    });
  }, [searchParams, runReminderQuickAction]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const nav = navigator.serviceWorker;
    const handler = (event: MessageEvent) => {
      const d = event.data as {
        type?: string;
        action?: string;
        reminderId?: string;
        batchKey?: string;
        title?: string;
      };
      if (d?.type === "SHARE_INVITE_NOTIF" && d.batchKey) {
        const a = d.action ?? "open";
        if (a === "accept") void joinShareBatch(d.batchKey);
        else if (a === "deny") void dismissShareBatch(d.batchKey);
        return;
      }
      if (d?.type !== "REMINDER_NOTIF" || !d.reminderId) return;
      const a = d.action ?? "open";
      if (a === "open") return;
      if (a === "done" || a === "snooze" || a === "delete") {
        const reminderId = d.reminderId;
        void runReminderQuickAction(reminderId, a).then(() => {
          const reminderTitle =
            remindersRef.current.find((r) => r.id === reminderId)?.title ??
            d.title ??
            "Reminder";
          const resolutionLine =
            a === "done"
              ? `Marked "${reminderTitle}" as done.`
              : a === "snooze"
                ? `Snoozed "${reminderTitle}" by one hour.`
                : `Deleted "${reminderTitle}".`;
          resolveDueReminderById(reminderId, resolutionLine);
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "system",
              content:
                a === "done"
                  ? `Marked **${reminderTitle}** as done from notification.`
                  : a === "snooze"
                    ? `Snoozed **${reminderTitle}** for 1 hour from notification.`
                    : `Deleted **${reminderTitle}** from notification.`,
              createdAt: new Date().toISOString(),
            },
          ]);
        });
      }
    };
    nav.addEventListener("message", handler);
    return () => nav.removeEventListener("message", handler);
  }, [runReminderQuickAction, joinShareBatch, dismissShareBatch]);

  useEffect(() => {
    try {
      if (
        typeof sessionStorage !== "undefined" &&
        sessionStorage.getItem("remindos:dueNotifBannerDismissed") === "1"
      ) {
        setDueNotifBannerDismissed(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const onVis = () => setNotifUiTick((t) => t + 1);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (!isHistoryLoaded) return;
    const tick = () => {
      const now = new Date();
      for (const r of reminders) {
        if (r.status !== "pending") continue;
        if (!isDueThisMinute(r.dueAt, now)) continue;
        const key = dueMinuteKey(r);

        if (!readDueShown().has(key)) {
          markDueShown(key);
          const msg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Reminder due: ${r.title}`,
            createdAt: new Date().toISOString(),
            meta: {
              kind: "due_reminder",
              reminderId: r.id,
              dueAt: new Date(r.dueAt).getTime(),
              title: r.title,
              notes: r.notes,
            },
          };
          setMessages((prev) => [...prev, msg]);
          if (
            typeof navigator !== "undefined" &&
            navigator.vibrate &&
            isCompactViewport()
          ) {
            navigator.vibrate(80);
          }
        }

        if (
          shouldShowSystemDueNotification(dueNotifPrefs) &&
          !readNotifDueSent(key)
        ) {
          markNotifDueSent(key);
          void (async () => {
            try {
              await showDueReminderSystemNotification(r, key);
            } catch {
              /* iOS / unsupported */
            }
          })();
        }
      }
    };
    tick();
    const id = window.setInterval(tick, 12000);
    return () => window.clearInterval(id);
  }, [reminders, isHistoryLoaded, dueNotifPrefs, notifUiTick]);

  const grouped = useMemo(() => {
    const now = new Date();
    const next = {
      missed: [] as ReminderItem[],
      today: [] as ReminderItem[],
      tomorrow: [] as ReminderItem[],
      upcoming: [] as ReminderItem[],
      done: [] as ReminderItem[],
    };

    for (const reminder of reminders) {
      if (isOverdueTodayReminder(reminder, now)) {
        next.missed.push(reminder);
        continue;
      }

      const bucket = getReminderBucket(reminder, now);
      if (bucket === "today") next.today.push(reminder);
      else if (bucket === "tomorrow") next.tomorrow.push(reminder);
      else if (bucket === "upcoming") next.upcoming.push(reminder);
      else if (bucket === "done") next.done.push(reminder);
    }

    return {
      missed: next.missed,
      today: next.today,
      tomorrow: next.tomorrow,
      upcoming: next.upcoming,
      done: next.done,
    };
  }, [reminders]);

  const snapshot = useMemo(
    () => ({
      pending: reminders.filter((r) => r.status !== "done").length,
      done: reminders.filter((r) => r.status === "done").length,
      missed: grouped.missed.length,
      today: grouped.today.length,
      tomorrow: grouped.tomorrow.length,
    }),
    [grouped.missed.length, grouped.today.length, grouped.tomorrow.length, reminders],
  );

  useEffect(() => {
    if (isListOpen && !listOpenRef.current) {
      const order = [
        "missed",
        "today",
        "tomorrow",
        "upcoming",
        "shared",
        "sent",
        "done",
      ] as const;
      const sharedCount = reminders.filter((r) => r.access === "shared").length;
      const sentCount = reminders.filter(
        (r) => r.access === "owner" && r.outgoingShared,
      ).length;
      const hit =
        order.find((k) => {
          if (k === "shared") return sharedCount > 0;
          if (k === "sent") return sentCount > 0;
          return grouped[k].length > 0;
        }) ?? "missed";
      setReminderListTab(hit);
    }
    listOpenRef.current = isListOpen;
  }, [isListOpen, grouped, reminders]);

  const tasksGrouped = useMemo(() => {
    const now = new Date();
    const byPriDue = (a: TaskRow, b: TaskRow) => {
      const pa = typeof a.priority === "number" ? a.priority : 0;
      const pb = typeof b.priority === "number" ? b.priority : 0;
      if (pa !== pb) return pb - pa;
      const da = a.dueAt
        ? new Date(a.dueAt).getTime()
        : Number.MAX_SAFE_INTEGER;
      const db = b.dueAt
        ? new Date(b.dueAt).getTime()
        : Number.MAX_SAFE_INTEGER;
      return da - db;
    };
    return {
      missed: tasks
        .filter((t) => taskBucket(t, now) === "missed")
        .slice()
        .sort(byPriDue),
      pending: tasks
        .filter(
          (t) => t.status === "pending" && taskBucket(t, now) !== "missed",
        )
        .slice()
        .sort(byPriDue),
      done: tasks
        .filter((t) => t.status === "done")
        .slice()
        .sort(byPriDue),
    };
  }, [tasks]);

  const taskTitleById = useMemo(
    () => Object.fromEntries(tasks.map((t) => [t.id, t.title] as const)),
    [tasks],
  );

  const reminderListRows = useMemo(() => {
    if (reminderListTab === "shared") {
      let rows = reminders.filter((r) => r.access === "shared");
      if (sharedFromFilter !== "all") {
        rows = rows.filter((r) => r.ownerUserId === sharedFromFilter);
      }
      if (reminderTaskFilter === "adhoc")
        return rows.filter((r) => isAdhocReminder(r));
      if (reminderTaskFilter !== "all") {
        return rows.filter((r) => r.linkedTaskId === reminderTaskFilter);
      }
      return rows;
    }
    if (reminderListTab === "sent") {
      let rows = reminders.filter(
        (r) => r.access === "owner" && r.outgoingShared,
      );
      if (sentToFilter !== "all") {
        rows = rows.filter((r) =>
          r.shareRecipients?.some((p) => p.userId === sentToFilter),
        );
      }
      if (reminderTaskFilter === "adhoc")
        return rows.filter((r) => isAdhocReminder(r));
      if (reminderTaskFilter !== "all") {
        return rows.filter((r) => r.linkedTaskId === reminderTaskFilter);
      }
      return rows;
    }
    const base = grouped[reminderListTab];
    if (reminderTaskFilter === "all") return base;
    if (reminderTaskFilter === "adhoc")
      return base.filter((r) => isAdhocReminder(r));
    return base.filter((r) => r.linkedTaskId === reminderTaskFilter);
  }, [
    grouped,
    reminderListTab,
    reminderTaskFilter,
    reminders,
    sharedFromFilter,
    sentToFilter,
  ]);

  const sharedTabCount = useMemo(
    () => reminders.filter((r) => r.access === "shared").length,
    [reminders],
  );
  const sentTabCount = useMemo(
    () =>
      reminders.filter((r) => r.access === "owner" && r.outgoingShared).length,
    [reminders],
  );

  const sharedFromOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const r of reminders) {
      if (r.access === "shared" && r.ownerUserId) ids.add(r.ownerUserId);
    }
    return [...ids];
  }, [reminders]);

  const sentRecipientOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of reminders) {
      if (r.access !== "owner" || !r.shareRecipients?.length) continue;
      for (const p of r.shareRecipients) {
        if (!map.has(p.userId)) map.set(p.userId, p.displayName);
      }
    }
    return [...map.entries()];
  }, [reminders]);

  const applyAction = (action: AgentAction) => {
    if (action.type === "create_reminder" && action.title && action.dueAt) {
      setPendingCreateDraft(null);
      const title = action.title;
      const dueAt = action.dueAt;
      const isDuplicate = reminders.some(
        (item) =>
          item.status === "pending" &&
          item.title.trim().toLowerCase() === title.trim().toLowerCase() &&
          new Date(item.dueAt).getTime() === new Date(dueAt).getTime(),
      );
      if (isDuplicate) return;

      void (async () => {
        const res = await fetch("/api/reminders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            dueAt: new Date(dueAt).getTime(),
            notes: action.notes?.trim() ? action.notes : undefined,
            recurrence: "none",
            priority:
              typeof action.priority === "number" && action.priority >= 1 && action.priority <= 5
                ? action.priority
                : 3,
            linkedTaskId: action.linkedTaskId?.trim() ? action.linkedTaskId : undefined,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          created?: boolean;
        };
        if (res.ok) {
          await refreshReminders();
          playReminderSuccessAnimation();
          if (data.created === false) return;
        }
      })();
      return;
    }

    if (action.type === "mark_done") {
      const target = reminders.find((r) =>
        matchesReminder(r, action.targetId, action.targetTitle),
      );
      if (!target) return;
      void refreshAfterReminderMutation(
        fetch(`/api/reminders/${target.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "done" }),
        }),
      ).catch(() => showShareToast("Could not update reminder. Try again."));
      return;
    }

    if (action.type === "delete_reminder") {
      const target = reminders.find((r) =>
        matchesReminder(r, action.targetId, action.targetTitle),
      );
      if (!target) return;
      void refreshAfterReminderMutation(
        fetch(`/api/reminders/${target.id}`, { method: "DELETE" }),
      ).catch(() => showShareToast("Could not delete reminder. Try again."));
      return;
    }

    if (action.type === "reschedule_reminder" && action.dueAt) {
      const target = reminders.find((r) =>
        matchesReminder(r, action.targetId, action.targetTitle),
      );
      if (!target) return;
      void refreshAfterReminderMutation(
        fetch(`/api/reminders/${target.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dueAt: new Date(action.dueAt).getTime() }),
        }),
      ).catch(() => showShareToast("Could not reschedule reminder. Try again."));
    }

    if (action.type === "clarify") {
      setPendingCreateDraft({
        step: action.title ? "date" : "title",
        title: action.title,
        notes: action.notes,
      });
    }
  };

  const extractCreateTitle = (value: string) =>
    value
      .replace(/^\s*create(\s+a)?\s+reminder\s*/i, "")
      .replace(/^\s*(for|about)\s+/i, "")
      .trim();

  const parseDateInput = (value: string, now: Date) => {
    const text = value
      .trim()
      .toLowerCase()
      .replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d)));
    const base = new Date(now);
    base.setHours(0, 0, 0, 0);

    if (/^(today|आज)$/.test(text)) return base.toISOString().slice(0, 10);
    if (/^(tomorrow|tmrw|tomorow|tommarow|कल|उद्या)$/.test(text)) {
      const d = new Date(base);
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    }
    if (/^(day after tomorrow|after tomorrow|परसों|परवा)$/.test(text)) {
      const d = new Date(base);
      d.setDate(d.getDate() + 2);
      return d.toISOString().slice(0, 10);
    }

    const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const parsed = new Date(y, mo - 1, d);
    if (
      parsed.getFullYear() !== y ||
      parsed.getMonth() !== mo - 1 ||
      parsed.getDate() !== d
    ) {
      return null;
    }
    return `${y.toString().padStart(4, "0")}-${mo.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
  };

  const parseTimeInput = (value: string) => {
    const text = value
      .trim()
      .toLowerCase()
      .replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d)))
      .replace(/\b([ap])\.\s?m\.\b/g, "$1m");
    if (text === "noon") return "12:00";
    if (text === "midnight") return "00:00";
    if (/^(दोपहर|दुपारी)$/.test(text)) return "12:00";
    if (/^(आधी रात|मध्यरात्र)$/.test(text)) return "00:00";

    const meridiem = text.match(/\b(\d{1,2})(?:[:.]\s*(\d{2}))?\s?(am|pm)\b/i);
    if (meridiem) {
      const hourRaw = Number(meridiem[1] ?? "0");
      const minute = Number(meridiem[2] ?? "0");
      if (!Number.isFinite(hourRaw) || hourRaw < 1 || hourRaw > 12) return null;
      if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;
      let hour = hourRaw % 12;
      if ((meridiem[3] ?? "am").toLowerCase() === "pm") hour += 12;
      return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
    }

    const clock = text.match(/^\s*(\d{1,2})[:.]\s*(\d{2})\s*$/);
    if (clock) {
      const hour = Number(clock[1] ?? "-1");
      const minute = Number(clock[2] ?? "-1");
      if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
      return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
    }

    const regional = text.match(
      /^\s*(\d{1,2})(?:[:.]\s*(\d{2}))?\s*(?:बजे|वाजता|वाजले)?\s*(सुबह|सकाळी|दोपहर|दुपारी|शाम|सायंकाळी|रात)?\s*$/,
    );
    if (!regional) return null;
    const rawHour = Number(regional[1] ?? "-1");
    const minute = Number(regional[2] ?? "0");
    if (rawHour < 0 || rawHour > 23 || minute < 0 || minute > 59) return null;
    const part = (regional[3] ?? "").toLowerCase();
    if (!part && !/(?:बजे|वाजता|वाजले)/i.test(text)) return null;

    let hour = rawHour;
    if (/सुबह|सकाळी/i.test(part)) {
      if (hour === 12) hour = 0;
    } else if (/दोपहर|दुपारी|शाम|सायंकाळी|रात/i.test(part)) {
      if (hour >= 1 && hour <= 11) hour += 12;
    }
    return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
  };

  const pendingTaskChoices = () =>
    tasks.filter((t) => t.status === "pending").slice(0, 8);

  const taskChoicePrompt = (choices: TaskRow[]) => {
    if (choices.length === 0) {
      return "Step 3/4: Should this reminder be linked to a task? Reply " +
        '"no" for standalone.';
    }
    return [
      "Step 3/4: Which task is this reminder related to?",
      ...choices.map((t, idx) => `${idx + 1}. ${t.title}`),
      'Reply with number/name, or "no" for standalone.',
    ].join("\n");
  };

  const taskLinkQuickReplies = useMemo(
    () =>
      pendingCreateDraft?.step === "task"
        ? tasks.filter((t) => t.status === "pending").slice(0, 8)
        : [],
    [pendingCreateDraft?.step, tasks],
  );

  const handleChatSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = (quickSubmitTextRef.current ?? input).trim();
    quickSubmitTextRef.current = null;
    if (!prompt || isLoading) return;

    const dispatchAssistantResponse = async (
      messageText: string,
      responseReplyPayload: ReplyContextPayload | undefined,
      messagesSnapshot: ChatMessage[],
    ) => {
      try {
        const inviteToken = extractInviteToken(messageText);
        if (inviteToken) {
          const res = await fetch(
            `/api/reminders/share/${encodeURIComponent(inviteToken)}`,
            {
              method: "POST",
            },
          );
          const data = (await res.json()) as { error?: string; title?: string };
          if (!res.ok) {
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: data.error ?? "Could not accept that invite.",
                createdAt: new Date().toISOString(),
              },
            ]);
            return;
          }
          await refreshReminders();
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: data.title
                ? `You're in on "${data.title}". It is now in your reminder list.`
                : "Invite accepted.",
              createdAt: new Date().toISOString(),
            },
          ]);
          return;
        }

        if (pendingCreateDraft) {
          const text = messageText.trim();

          if (pendingCreateDraft.step === "title") {
            if (!text) {
              setMessages((prev) => [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: "What should the reminder title be?",
                  createdAt: new Date().toISOString(),
                },
              ]);
              return;
            }
            setPendingCreateDraft((prev) => ({
              ...(prev ?? { step: "date" as const }),
              step: "date",
              title: text,
            }));
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: "Step 1/4: What date should I set? (today / tomorrow / YYYY-MM-DD)",
                createdAt: new Date().toISOString(),
              },
            ]);
            return;
          }

          if (pendingCreateDraft.step === "date") {
            const dateIso = parseDateInput(text, new Date());
            if (!dateIso) {
              setMessages((prev) => [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: "Please share a valid date: today, tomorrow, or YYYY-MM-DD.",
                  createdAt: new Date().toISOString(),
                },
              ]);
              return;
            }
            setPendingCreateDraft((prev) => ({
              ...(prev ?? { step: "time" as const }),
              step: "time",
              dateIso,
            }));
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: "Step 2/4: What time? (e.g. 8:30 PM or 20:30)",
                createdAt: new Date().toISOString(),
              },
            ]);
            return;
          }

          if (pendingCreateDraft.step === "time") {
            const time24 = parseTimeInput(text);
            if (!time24 || !pendingCreateDraft.dateIso) {
              setMessages((prev) => [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: "Please share a valid time, like 8:30 PM or 20:30.",
                  createdAt: new Date().toISOString(),
                },
              ]);
              return;
            }
            const dueAt = new Date(`${pendingCreateDraft.dateIso}T${time24}:00`).toISOString();
            if (!Number.isFinite(new Date(dueAt).getTime()) || new Date(dueAt).getTime() <= Date.now()) {
              setMessages((prev) => [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: "That date/time is in the past. Please send a future time.",
                  createdAt: new Date().toISOString(),
                },
              ]);
              return;
            }
            const choices = pendingTaskChoices();
            setPendingCreateDraft((prev) => ({
              ...(prev ?? { step: "task" as const }),
              step: "task",
              dueAt,
            }));
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: taskChoicePrompt(choices),
                createdAt: new Date().toISOString(),
              },
            ]);
            return;
          }

          if (pendingCreateDraft.step === "task") {
            const choices = pendingTaskChoices();
            let linkedTaskId = "";
            if (!/^(no|none|standalone|skip)$/i.test(text)) {
              const byIndex = Number(text);
              if (Number.isFinite(byIndex) && byIndex >= 1 && byIndex <= choices.length) {
                linkedTaskId = choices[byIndex - 1]?.id ?? "";
              } else {
                const byName = choices.find((t) => t.title.toLowerCase().includes(text.toLowerCase()));
                if (!byName) {
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: crypto.randomUUID(),
                      role: "assistant",
                      content: taskChoicePrompt(choices),
                      createdAt: new Date().toISOString(),
                    },
                  ]);
                  return;
                }
                linkedTaskId = byName.id;
              }
            }
            setPendingCreateDraft((prev) => ({
              ...(prev ?? { step: "priority" as const }),
              step: "priority",
              linkedTaskId,
            }));
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: "Step 4/4: Set priority (1 to 5 stars).",
                createdAt: new Date().toISOString(),
              },
            ]);
            return;
          }

          if (pendingCreateDraft.step === "priority") {
            const mapWord: Record<string, number> = {
              one: 1,
              two: 2,
              three: 3,
              four: 4,
              five: 5,
            };
            const parsedNum = Number(text);
            const priority = Number.isFinite(parsedNum)
              ? Math.trunc(parsedNum)
              : mapWord[text.toLowerCase()] ?? 0;
            if (priority < 1 || priority > 5) {
              setMessages((prev) => [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: "Please choose a priority between 1 and 5.",
                  createdAt: new Date().toISOString(),
                },
              ]);
              return;
            }

            const title = pendingCreateDraft.title?.trim();
            const dueAt = pendingCreateDraft.dueAt;
            if (!title || !dueAt) {
              setPendingCreateDraft(null);
              setMessages((prev) => [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: "I lost context for this draft. Please say 'create reminder' again.",
                  createdAt: new Date().toISOString(),
                },
              ]);
              return;
            }

            const res = await fetch("/api/reminders", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title,
                dueAt: new Date(dueAt).getTime(),
                recurrence: "none",
                priority,
                linkedTaskId: pendingCreateDraft.linkedTaskId || undefined,
              }),
            });
            if (!res.ok) {
              setMessages((prev) => [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: "I couldn’t create the reminder. Please try once more.",
                  createdAt: new Date().toISOString(),
                },
              ]);
              return;
            }
            await refreshReminders();
            playReminderSuccessAnimation();
            setPendingCreateDraft(null);
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: `Done — reminder created for ${new Date(dueAt).toLocaleString()}.`,
                createdAt: new Date().toISOString(),
              },
            ]);
            return;
          }
        }

        if (/^\s*create(\s+a)?\s+reminder\b/i.test(messageText)) {
          const extractedTitle = extractCreateTitle(messageText);
          if (!extractedTitle) {
            setPendingCreateDraft({ step: "title" });
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: "Sure — what should the reminder title be?",
                createdAt: new Date().toISOString(),
              },
            ]);
            return;
          }
          setPendingCreateDraft({ step: "date", title: extractedTitle });
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: "Step 1/4: What date should I set? (today / tomorrow / YYYY-MM-DD)",
              createdAt: new Date().toISOString(),
            },
          ]);
          return;
        }

        const listScope = inferListScopeFromMessage(messageText);
        if (listScope && !isCompoundReminderQuestion(messageText)) {
          const listReply = buildListRemindersReply(
            reminders,
            listScope,
            new Date(),
            5,
            clientTimeZonePayload(),
          );
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: listReply,
              createdAt: new Date().toISOString(),
            },
          ]);
          return;
        }

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: messageText,
            reminders,
            tasks: tasks.map((t) => ({
              id: t.id,
              title: t.title,
              notes: t.notes,
              dueAt: t.dueAt,
              status: t.status,
              priority: t.priority,
              domain: t.domain,
            })),
            ...clientTimeZonePayload(),
            ...(responseReplyPayload ? { replyContext: responseReplyPayload } : {}),
          }),
        });

        const data = (await response.json()) as AgentResponse;
        applyAction(data.action);

        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: data.reply || "Done.",
            createdAt: new Date().toISOString(),
          },
        ]);
      } catch {
        const grounded = tryGroundedReminderAnswer(
          messageText,
          reminders,
          new Date(),
          clientTimeZonePayload(),
        );
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content:
              grounded ??
              "I could not reach the assistant. Check your connection and try again.",
            createdAt: new Date().toISOString(),
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    };

    if (editingMessageId) {
      const editedAt = new Date().toISOString();
      const editingMessage = messagesRef.current.find(
        (m) => m.id === editingMessageId,
      );
      const replyFromEditedMessage = editingMessage?.meta?.replyTo
        ? {
            id: editingMessage.meta.replyTo.id,
            content: editingMessage.meta.replyTo.content,
            role: editingMessage.meta.replyTo.role,
          }
        : undefined;

      const nextMessages = (() => {
        const index = messagesRef.current.findIndex(
          (m) => m.id === editingMessageId,
        );
        if (index === -1) return messagesRef.current;
        return messagesRef.current.slice(0, index + 1).map((m) =>
          m.id === editingMessageId && m.role === "user"
            ? {
                ...m,
                content: prompt,
                meta: { ...(m.meta ?? {}), editedAt },
              }
            : m,
        );
      })();

      setMessages(nextMessages);
      setInput("");
      setEditingMessageId(null);
      setReplyTarget(null);
      chatPinnedToBottomRef.current = true;
      setIsLoading(true);
      setLoadingTextIndex(0);
      void dispatchAssistantResponse(prompt, replyFromEditedMessage, nextMessages);
      return;
    }

    if (briefingStreaming) return;

    chatPinnedToBottomRef.current = true;

    const replySnapshot = replyTarget;
    const replyPayload = toReplyContextPayload(replySnapshot);

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
      createdAt: new Date().toISOString(),
      ...(replySnapshot
        ? {
            meta: {
              replyTo: {
                id: replySnapshot.id,
                content: replySnapshot.content,
                role: replySnapshot.role,
              },
            },
          }
        : {}),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setReplyTarget(null);
    setIsLoading(true);
    setLoadingTextIndex(0);
    void dispatchAssistantResponse(prompt, replyPayload, messagesRef.current);
  };

  const getMinDate = () => {
    const now = new Date();
    return now.toISOString().slice(0, 10);
  };

  const resetReminderForm = useCallback(() => {
    setNewTitle("");
    setNewDate("");
    setNewTime("");
    setNewRecurrence("none");
    setNewNotes("");
    setEditingReminderId(null);
    setReminderStars(0);
    setReminderLinkedTaskId("");
    setReminderDomain("");
  }, []);

  const resetTaskForm = useCallback(() => {
    setTaskFormTitle("");
    setTaskFormDue(currentDateTimeLocalValue());
    setTaskFormNotes("");
    setTaskStars(0);
    setEditingTaskId(null);
    setTaskFormError(null);
    setTaskFormDomain("");
    setTaskDueUserEdited(false);
  }, []);
  resetTaskFormRef.current = resetTaskForm;

  const handleJsonImport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload = importJson.trim();
    if (!payload || isImporting) return;

    setIsImporting(true);
    setImportStatus(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload) as unknown;
      } catch {
        setImportStatus(
          "Invalid JSON. Please paste a valid JSON object or array.",
        );
        return;
      }

      const response = await fetch("/api/reminders/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = (await response.json()) as {
        error?: string;
        createdCount?: number;
      };
      if (!response.ok) {
        setImportStatus(data.error ?? "Import failed.");
        return;
      }

      setImportStatus(`Imported ${data.createdCount ?? 0} reminders.`);
      await refreshReminders();
      setImportJson("");
    } catch {
      setImportStatus("Import failed. Please try again.");
    } finally {
      setIsImporting(false);
    }
  };

  const handleClearChat = async () => {
    if (isClearingChat) return;
    setIsClearingChat(true);
    try {
      const del = await fetch("/api/chat/history", { method: "DELETE" });
      if (!del.ok) {
        return;
      }
      clearChatBackup(userId);
      skipRemotePollMergeUntilRef.current = Date.now() + 12_000;
      setPendingCreateDraft(null);
      setReplyTarget(null);
      setEditingMessageId(null);
      const starter: ChatMessage = {
        ...STARTER_MESSAGE,
        createdAt: new Date().toISOString(),
      };
      setMessages([starter]);
      // Persist fresh thread on server so refresh and other tabs see the new baseline, not old history.
      await fetch("/api/chat/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              id: starter.id,
              role: starter.role,
              content: starter.content,
              createdAt: starter.createdAt,
            },
          ],
        }),
      });
    } finally {
      setIsClearingChat(false);
    }
  };

  const resolveDueLine = (messageId: string, line: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, meta: undefined, content: line } : m,
      ),
    );
  };

  const resolveDueReminderById = (reminderId: string, line: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.meta?.kind === "due_reminder" && m.meta.reminderId === reminderId
          ? { ...m, meta: undefined, content: line }
          : m,
      ),
    );
  };

  const handleDueReminderAction = async (
    messageId: string,
    reminderId: string,
    action: "delete" | "done" | "snooze" | "reschedule",
  ) => {
    const title =
      reminders.find((x) => x.id === reminderId)?.title ?? "Reminder";
    try {
      if (action === "delete") {
        await runReminderQuickAction(reminderId, "delete");
        resolveDueLine(messageId, `Deleted "${title}".`);
        resolveDueReminderById(reminderId, `Deleted "${title}".`);
        return;
      }
      if (action === "done") {
        await runReminderQuickAction(reminderId, "done");
        resolveDueLine(messageId, `Marked "${title}" as done.`);
        resolveDueReminderById(reminderId, `Marked "${title}" as done.`);
        return;
      }
      if (action === "snooze") {
        await runReminderQuickAction(reminderId, "snooze");
        resolveDueLine(messageId, `Snoozed "${title}" by one hour.`);
        resolveDueReminderById(reminderId, `Snoozed "${title}" by one hour.`);
        return;
      }
      const reminder = reminders.find((x) => x.id === reminderId);
      setRescheduleReminder({
        messageId,
        reminderId,
        title,
        value: toDateTimeLocalValue(reminder?.dueAt ?? new Date().toISOString()) || currentDateTimeLocalValue(),
        error: null,
      });
    } catch {
      resolveDueLine(messageId, `Something went wrong updating "${title}".`);
      resolveDueReminderById(
        reminderId,
        `Something went wrong updating "${title}".`,
      );
    }
  };

  const handleExportChat = () => {
    if (messages.length === 0) return;
    const lines = messages.map((message) => {
      const date = new Date(message.createdAt);
      const timestamp = date.toLocaleString();
      const sender =
        message.role === "user"
          ? "You"
          : message.role === "system"
            ? "Notice"
            : "RemindOS (System)";
      return `[${timestamp}] ${sender}: ${message.content}`;
    });
    const content = lines.join("\n\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(
      now.getMinutes(),
    ).padStart(2, "0")}`;
    anchor.href = url;
    anchor.download = `remindos-chat-${stamp}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const commitRescheduleReminder = useCallback(async () => {
    if (!rescheduleReminder) return;
    const dueMs = Date.parse(rescheduleReminder.value);
    if (!Number.isFinite(dueMs)) {
      setRescheduleReminder((prev) =>
        prev ? { ...prev, error: "Choose a valid date and time." } : prev,
      );
      return;
    }
    if (dueMs <= Date.now()) {
      setRescheduleReminder((prev) =>
        prev ? { ...prev, error: "Choose a future date and time." } : prev,
      );
      return;
    }

    const { messageId, reminderId, title } = rescheduleReminder;
    try {
      await refreshAfterReminderMutation(
        fetch(`/api/reminders/${reminderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dueAt: dueMs }),
        }),
      );
      resolveDueLine(
        messageId,
        `Rescheduled "${title}" to ${new Date(dueMs).toLocaleString()}.`,
      );
      resolveDueReminderById(
        reminderId,
        `Rescheduled "${title}" to ${new Date(dueMs).toLocaleString()}.`,
      );
      setRescheduleReminder(null);
    } catch {
      showShareToast("Could not reschedule reminder. Try again.");
    }
  }, [refreshAfterReminderMutation, rescheduleReminder, showShareToast]);

  const parseBatchQuestions = (payload: unknown): string[] => {
    if (Array.isArray(payload)) {
      return payload
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
    }

    if (!payload || typeof payload !== "object") return [];
    const obj = payload as {
      questions?: unknown;
      items?: unknown;
      prompts?: unknown;
    };
    const candidate = obj.questions ?? obj.items ?? obj.prompts;
    if (!Array.isArray(candidate)) return [];
    return candidate
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  };

  const handleBatchQuestions = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const raw = batchJson.trim();
    if (!raw || isBatchRunning) return;

    setIsBatchRunning(true);
    setBatchStatus(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        setBatchStatus(
          "Invalid JSON. Please paste a valid JSON object or array.",
        );
        return;
      }

      const questions = parseBatchQuestions(parsed);
      if (questions.length === 0) {
        setBatchStatus(
          "No valid questions found. Use an array or { questions: [...] }.",
        );
        return;
      }

      let processed = 0;
      for (const question of questions) {
        const userMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "user",
          content: question,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMessage]);
        setBatchStatus(`Processing ${processed + 1}/${questions.length}...`);

        try {
          const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: question,
              reminders,
              tasks: tasks.map((t) => ({
                id: t.id,
                title: t.title,
                notes: t.notes,
                dueAt: t.dueAt,
                status: t.status,
                priority: t.priority,
                domain: t.domain,
              })),
              ...clientTimeZonePayload(),
            }),
          });
          const data = (await response.json()) as AgentResponse;
          applyAction(data.action);
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: data.reply || "Done.",
              createdAt: new Date().toISOString(),
            },
          ]);
        } catch {
          const grounded = tryGroundedReminderAnswer(
            question,
            reminders,
            new Date(),
            clientTimeZonePayload(),
          );
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content:
                grounded ??
                "I could not process this item right now. Continuing with next question.",
              createdAt: new Date().toISOString(),
            },
          ]);
        }

        processed += 1;
      }

      setBatchStatus(`Completed ${processed}/${questions.length} questions.`);
      setBatchJson("");
    } finally {
      setIsBatchRunning(false);
    }
  };

  const openCreateModal = useCallback(
    (opts?: { linkedTaskId?: string }) => {
      resetReminderForm();
      setCreateFormError(null);
      setShowReminderInlineTask(false);
      setReminderInlineTaskTitle("");
      setReminderInlineTaskDue("");
      setIsCreateOpen(true);
      if (opts?.linkedTaskId) {
        setReminderLinkedTaskId(opts.linkedTaskId);
      }
    },
    [resetReminderForm],
  );

  const openTasksPanel = useCallback(
    (mode: "create" | "browse" = "browse", preserveState = false) => {
      if (!preserveState) {
        resetTaskForm();
      }
      void refreshTasks();
      setTaskMode(mode);
      if (mode === "create") {
        setTaskTab("pending");
      } else {
        setTaskTab(
          tasksGrouped.missed.length > 0
            ? "missed"
            : tasksGrouped.pending.length > 0
              ? "pending"
              : "done",
        );
      }
      setIsTasksOpen(true);
    },
    [refreshTasks, resetTaskForm, tasksGrouped],
  );

  const closeAllDashboardOverlays = useCallback(() => {
    setIsShareOpen(false);
    setIsBatchOpen(false);
    setIsImportOpen(false);
    setIsTasksOpen(false);
    setTaskMode("browse");
    setIsCreateOpen(false);
    setIsListOpen(false);
    setIsSnapshotOpen(false);
  }, []);

  const readDashboardOverlayFromHistory =
    useCallback((): DashboardOverlayState | null => {
      if (typeof window === "undefined") return null;
      const raw = (
        window.history.state as {
          dashboardOverlay?: DashboardOverlayState;
        } | null
      )?.dashboardOverlay;
      return raw?.overlay ? raw : null;
    }, []);

  const pushDashboardOverlay = useCallback((state: DashboardOverlayState) => {
    if (typeof window === "undefined") return;
    const nextState = {
      ...(window.history.state && typeof window.history.state === "object"
        ? window.history.state
        : {}),
      dashboardOverlay: state,
    };
    window.history.pushState(nextState, "", window.location.href);
  }, []);

  const dismissDashboardOverlay = useCallback(
    (overlay: DashboardOverlay, fallback: () => void) => {
      const current = readDashboardOverlayFromHistory();
      if (current?.overlay === overlay && typeof window !== "undefined") {
        window.history.back();
        return;
      }
      fallback();
    },
    [readDashboardOverlayFromHistory],
  );

  const showSnapshotOverlay = useCallback(
    (pushHistory = true) => {
      closeAllDashboardOverlays();
      setIsSnapshotOpen(true);
      if (pushHistory) pushDashboardOverlay({ overlay: "snapshot" });
    },
    [closeAllDashboardOverlays, pushDashboardOverlay],
  );

  const showReminderListOverlay = useCallback(
    (pushHistory = true) => {
      closeAllDashboardOverlays();
      setIsListOpen(true);
      if (pushHistory) pushDashboardOverlay({ overlay: "reminders" });
    },
    [closeAllDashboardOverlays, pushDashboardOverlay],
  );

  const showCreateOverlay = useCallback(
    (
      opts?: { linkedTaskId?: string },
      pushHistory = true,
      preserveCurrent = false,
    ) => {
      if (!preserveCurrent) {
        closeAllDashboardOverlays();
      }
      openCreateModal(opts);
      if (pushHistory) pushDashboardOverlay({ overlay: "create" });
    },
    [closeAllDashboardOverlays, openCreateModal, pushDashboardOverlay],
  );

  const showTasksOverlay = useCallback(
    (
      mode: "create" | "browse" = "browse",
      pushHistory = true,
      preserveState = false,
    ) => {
      closeAllDashboardOverlays();
      openTasksPanel(mode, preserveState);
      if (pushHistory)
        pushDashboardOverlay({ overlay: "tasks", taskMode: mode });
    },
    [closeAllDashboardOverlays, openTasksPanel, pushDashboardOverlay],
  );

  const showImportOverlay = useCallback(
    (pushHistory = true) => {
      closeAllDashboardOverlays();
      setImportStatus(null);
      setIsImportOpen(true);
      if (pushHistory) pushDashboardOverlay({ overlay: "import" });
    },
    [closeAllDashboardOverlays, pushDashboardOverlay],
  );

  const showBatchOverlay = useCallback(
    (pushHistory = true) => {
      closeAllDashboardOverlays();
      setBatchStatus(null);
      setIsBatchOpen(true);
      if (pushHistory) pushDashboardOverlay({ overlay: "batch" });
    },
    [closeAllDashboardOverlays, pushDashboardOverlay],
  );

  const showShareOverlay = useCallback(
    (ids: string[], pushHistory = true) => {
      openShareModal(ids);
      if (pushHistory) {
        pushDashboardOverlay({
          overlay: "share",
          shareReminderIds: [...new Set(ids)].filter(Boolean),
        });
      }
    },
    [openShareModal, pushDashboardOverlay],
  );

  const closeSnapshotOverlay = useCallback(
    () => dismissDashboardOverlay("snapshot", () => setIsSnapshotOpen(false)),
    [dismissDashboardOverlay],
  );
  const closeReminderListOverlay = useCallback(
    () => dismissDashboardOverlay("reminders", () => setIsListOpen(false)),
    [dismissDashboardOverlay],
  );
  const closeCreateOverlay = useCallback(
    () => dismissDashboardOverlay("create", () => setIsCreateOpen(false)),
    [dismissDashboardOverlay],
  );
  const closeTasksOverlay = useCallback(
    () => dismissDashboardOverlay("tasks", () => setIsTasksOpen(false)),
    [dismissDashboardOverlay],
  );
  const closeShareOverlay = useCallback(
    () => dismissDashboardOverlay("share", () => setIsShareOpen(false)),
    [dismissDashboardOverlay],
  );
  const closeImportOverlay = useCallback(
    () => dismissDashboardOverlay("import", () => setIsImportOpen(false)),
    [dismissDashboardOverlay],
  );
  const closeBatchOverlay = useCallback(
    () => dismissDashboardOverlay("batch", () => setIsBatchOpen(false)),
    [dismissDashboardOverlay],
  );

  useEffect(() => {
    const openCreate = () => showCreateOverlay(undefined);
    window.addEventListener("dashboard:create-reminder", openCreate);
    return () =>
      window.removeEventListener("dashboard:create-reminder", openCreate);
  }, [showCreateOverlay]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const state =
        (event.state as { dashboardOverlay?: DashboardOverlayState } | null)
          ?.dashboardOverlay ?? null;
      if (!state?.overlay) {
        closeAllDashboardOverlays();
        return;
      }
      switch (state.overlay) {
        case "snapshot":
          showSnapshotOverlay(false);
          break;
        case "reminders":
          showReminderListOverlay(false);
          break;
        case "create":
          showCreateOverlay(undefined, false);
          break;
        case "tasks":
          showTasksOverlay(state.taskMode ?? "browse", false, true);
          break;
        case "share":
          showShareOverlay(state.shareReminderIds ?? [], false);
          break;
        case "import":
          showImportOverlay(false);
          break;
        case "batch":
          showBatchOverlay(false);
          break;
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [
    closeAllDashboardOverlays,
    showBatchOverlay,
    showCreateOverlay,
    showImportOverlay,
    showReminderListOverlay,
    showShareOverlay,
    showSnapshotOverlay,
    showTasksOverlay,
  ]);

  const openCreateReminderFromRemindersList = () => {
    showCreateOverlay();
  };

  const openCreateTaskFromRemindersList = () => {
    showTasksOverlay("create");
  };

  const openAllTasksFromSnapshot = () => {
    showTasksOverlay("browse");
  };

  const openReminderListFromCreateModal = () => {
    showReminderListOverlay();
  };

  const openReminderListFromTasksPanel = () => {
    showReminderListOverlay();
  };

  useEffect(() => {
    const openR = () => showReminderListOverlay();
    const openT = () => showTasksOverlay("create");
    const runB = () => runBriefingStream();
    window.addEventListener("dashboard:open-reminders", openR);
    window.addEventListener("dashboard:open-tasks", openT);
    window.addEventListener("dashboard:run-briefing", runB);
    return () => {
      window.removeEventListener("dashboard:open-reminders", openR);
      window.removeEventListener("dashboard:open-tasks", openT);
      window.removeEventListener("dashboard:run-briefing", runB);
    };
  }, [showReminderListOverlay, showTasksOverlay, runBriefingStream]);

  useEffect(() => {
    const openSnapshot = () => showSnapshotOverlay();
    window.addEventListener("dashboard:snapshot-open", openSnapshot);
    return () =>
      window.removeEventListener("dashboard:snapshot-open", openSnapshot);
  }, [showSnapshotOverlay]);

  useEffect(() => {
    const o = searchParams.get("open");
    if (o !== "reminders" && o !== "tasks" && o !== "create") return;
    if (typeof window !== "undefined") {
      const nextState =
        window.history.state && typeof window.history.state === "object"
          ? { ...window.history.state }
          : {};
      delete (nextState as { dashboardOverlay?: DashboardOverlayState })
        .dashboardOverlay;
      window.history.replaceState(nextState, "", "/dashboard");
    }
    if (o === "reminders") showReminderListOverlay();
    if (o === "tasks") showTasksOverlay("browse");
    if (o === "create") showCreateOverlay();
  }, [
    searchParams,
    showCreateOverlay,
    showReminderListOverlay,
    showTasksOverlay,
  ]);

  const openEditModal = useCallback(
    (reminder: ReminderItem) => {
      setCreateFormError(null);
      setShowReminderInlineTask(false);
      setReminderInlineTaskTitle("");
      setReminderInlineTaskDue("");
      const dueDate = new Date(reminder.dueAt);
      const datePart = dueDate.toISOString().slice(0, 10);
      const timePart = dueDate.toTimeString().slice(0, 5);
      setEditingReminderId(reminder.id);
      setNewTitle(reminder.title);
      setNewDate(datePart);
      setNewTime(timePart);
      setNewRecurrence(reminder.recurrence ?? "none");
      setNewNotes(reminder.notes ?? "");
      setReminderStars(
        typeof reminder.priority === "number" &&
          reminder.priority >= 1 &&
          reminder.priority <= 5
          ? reminder.priority
          : 0,
      );
      setReminderLinkedTaskId(reminder.linkedTaskId ?? "");
      setReminderDomain(reminder.domain ?? "");
      setIsCreateOpen(true);
      pushDashboardOverlay({ overlay: "create" });
    },
    [pushDashboardOverlay],
  );

  const handleManualCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newTitle.trim() || !newDate || !newTime) return;
    if (reminderStars < 1 || reminderStars > 5) {
      setCreateFormError("Choose a priority: tap 1–5 stars.");
      return;
    }
    setCreateFormError(null);
    const dueAt = new Date(`${newDate}T${newTime}`).toISOString();
    const dueAtMs = new Date(dueAt).getTime();
    if (!Number.isFinite(dueAtMs)) {
      setCreateFormError("Invalid date or time.");
      return;
    }
    if (dueAtMs <= Date.now()) {
      setCreateFormError("Date and time must be in the future.");
      return;
    }

    if (editingReminderId) {
      try {
        const canLink =
          reminders.find((r) => r.id === editingReminderId)?.access !==
          "shared";
        const linkPayload: Record<string, unknown> = {};
        if (canLink) {
          linkPayload.linkedTaskId = reminderLinkedTaskId.trim() || null;
          linkPayload.domain = reminderDomain || null;
        }
        const res = await fetch(`/api/reminders/${editingReminderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: newTitle.trim(),
            dueAt: dueAtMs,
            recurrence: newRecurrence,
            notes: newNotes.trim() ? newNotes.trim() : undefined,
            priority: reminderStars,
            ...linkPayload,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setCreateFormError(data.error ?? "Could not update reminder.");
          return;
        }
        await refreshReminders();
      } catch {
        setCreateFormError("Network error. Try again.");
        return;
      }
    } else {
      const isDuplicate = reminders.some(
        (item) =>
          item.status === "pending" &&
          item.title.trim().toLowerCase() === newTitle.trim().toLowerCase() &&
          new Date(item.dueAt).getTime() === dueAtMs,
      );
      if (isDuplicate) {
        resetReminderForm();
        closeCreateOverlay();
        return;
      }

      try {
        const createBody: Record<string, unknown> = {
          title: newTitle.trim(),
          dueAt: dueAtMs,
          recurrence: newRecurrence,
          notes: newNotes.trim() ? newNotes.trim() : undefined,
          priority: reminderStars,
        };
        if (reminderLinkedTaskId.trim()) {
          createBody.linkedTaskId = reminderLinkedTaskId.trim();
        }
        if (reminderDomain) {
          createBody.domain = reminderDomain;
        }
        const res = await fetch("/api/reminders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createBody),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          created?: boolean;
        };
        if (!res.ok) {
          setCreateFormError(data.error ?? "Could not save reminder.");
          return;
        }
        await refreshReminders();
        playReminderSuccessAnimation();
        resetReminderForm();
        setCreateFormError(null);
        closeCreateOverlay();
        if (data.created === false) return;
        return;
      } catch {
        setCreateFormError("Network error. Try again.");
        return;
      }
    }
    resetReminderForm();
    setCreateFormError(null);
    closeCreateOverlay();
  };

  const persistDueNotifPrefs = useCallback(
    (patch: Partial<DueNotificationPrefs>) => {
      setDueNotifPrefs((prev) => {
        const next = { ...prev, ...patch };
        saveDueNotificationPrefs(next);
        return next;
      });
    },
    [],
  );

  const requestDueNotificationPermission = useCallback(async () => {
    if (!("Notification" in window)) return;
    const p = await Notification.requestPermission();
    setNotifUiTick((t) => t + 1);
    if (p === "granted") {
      persistDueNotifPrefs({ enabled: true });
    }
  }, [persistDueNotifPrefs]);

  /** Only lock during session briefing stream — avoid clashing typewriter placeholder + caret. */
  const briefingComposerLocked = briefingStreaming && !editingMessageId;

  const dismissDueNotifBanner = useCallback(() => {
    try {
      sessionStorage.setItem("remindos:dueNotifBannerDismissed", "1");
    } catch {
      /* ignore */
    }
    setDueNotifBannerDismissed(true);
  }, []);

  const openTaskEdit = (task: TaskRow) => {
    setTaskMode("create");
    setEditingTaskId(task.id);
    setTaskFormTitle(task.title);
    setTaskFormNotes(task.notes ?? "");
    setTaskFormDue(toDateTimeLocalValue(task.dueAt));
    setTaskDueUserEdited(true);
    setTaskStars(
      typeof task.priority === "number" &&
        task.priority >= 1 &&
        task.priority <= 5
        ? task.priority
        : 0,
    );
    setTaskFormDomain(task.domain ?? "");
    setTaskFormError(null);
    setIsTasksOpen(true);
  };

  const handleTaskSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!taskFormTitle.trim()) return;
    if (taskStars < 1 || taskStars > 5) {
      setTaskFormError("Choose a priority: tap 1–5 stars.");
      return;
    }
    setTaskFormError(null);
    let dueAt: number | undefined;
    if (taskFormDue.trim()) {
      const ms = new Date(taskFormDue).getTime();
      if (!Number.isFinite(ms)) {
        setTaskFormError("Invalid date or time.");
        return;
      }
      dueAt = ms;
    }
    try {
      const payload: Record<string, unknown> = {
        title: taskFormTitle.trim(),
        notes: taskFormNotes.trim() ? taskFormNotes.trim() : undefined,
        dueAt,
        priority: taskStars,
      };
      if (editingTaskId) {
        payload.domain = taskFormDomain || null;
      } else if (taskFormDomain) {
        payload.domain = taskFormDomain;
      }
      const res = editingTaskId
        ? await fetch(`/api/tasks/${editingTaskId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setTaskFormError(data.error ?? "Could not save task.");
        return;
      }
      resetTaskForm();
      await refreshTasks();
    } catch {
      setTaskFormError("Network error. Try again.");
    }
  };

  useEffect(() => {
    if (!isTasksOpen || editingTaskId || taskDueUserEdited) return;
    const tick = () => setTaskFormDue(currentDateTimeLocalValue());
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [isTasksOpen, editingTaskId, taskDueUserEdited]);

  useEffect(() => {
    if (showReminderInlineTask) {
      setReminderInlineTaskDue(currentDateTimeLocalValue());
    }
  }, [showReminderInlineTask]);

  const createReminderInlineTask = useCallback(async () => {
    const title = reminderInlineTaskTitle.trim();
    if (!title) {
      setCreateFormError("Enter a name for the new task.");
      return;
    }
    setReminderInlineTaskSaving(true);
    setCreateFormError(null);
    try {
      let dueAt: number | undefined;
      if (reminderInlineTaskDue.trim()) {
        const ms = new Date(reminderInlineTaskDue).getTime();
        if (Number.isFinite(ms)) dueAt = ms;
      }
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          priority: 3,
          dueAt,
          status: "pending",
        }),
      });
      const data = (await res.json()) as {
        task?: { _id?: string };
        error?: string;
      };
      if (!res.ok) {
        setCreateFormError(data.error ?? "Could not create task.");
        return;
      }
      const tid = data.task?._id;
      if (tid) {
        setReminderLinkedTaskId(String(tid));
        await refreshTasks();
        setShowReminderInlineTask(false);
        setReminderInlineTaskTitle("");
        setReminderInlineTaskDue("");
      }
    } catch {
      setCreateFormError("Network error creating task.");
    } finally {
      setReminderInlineTaskSaving(false);
    }
  }, [reminderInlineTaskTitle, reminderInlineTaskDue, refreshTasks]);

  const startReminderForCurrentTask = useCallback(async () => {
    if (!taskFormTitle.trim()) {
      setTaskFormError("Add a task title first.");
      return;
    }
    if (taskStars < 1 || taskStars > 5) {
      setTaskFormError("Choose priority: tap 1–5 stars.");
      return;
    }
    setTaskFormError(null);
    let dueAt: number | undefined;
    if (taskFormDue.trim()) {
      const ms = new Date(taskFormDue).getTime();
      if (!Number.isFinite(ms)) {
        setTaskFormError("Invalid due date or time.");
        return;
      }
      dueAt = ms;
    }
    try {
      let taskId = editingTaskId;
      if (!taskId) {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: taskFormTitle.trim(),
            notes: taskFormNotes.trim() ? taskFormNotes.trim() : undefined,
            dueAt,
            priority: taskStars,
            status: "pending",
            ...(taskFormDomain ? { domain: taskFormDomain } : {}),
          }),
        });
        const data = (await res.json()) as {
          task?: { _id?: string };
          error?: string;
        };
        if (!res.ok) {
          setTaskFormError(data.error ?? "Could not save task.");
          return;
        }
        const tid = data.task?._id;
        if (!tid) {
          setTaskFormError("Task saved but missing id.");
          return;
        }
        taskId = String(tid);
        setEditingTaskId(taskId);
        await refreshTasks();
      }
      showCreateOverlay({ linkedTaskId: taskId }, true, true);
    } catch {
      setTaskFormError("Network error. Try again.");
    }
  }, [
    editingTaskId,
    taskFormTitle,
    taskFormDue,
    taskFormNotes,
    taskStars,
    taskFormDomain,
    refreshTasks,
    showCreateOverlay,
  ]);

  return (
    <>
      <section className="relative flex h-full min-h-0 flex-1 overflow-hidden bg-transparent px-0 pb-0 pt-0 sm:px-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))] sm:pt-4">
        <div className="pointer-events-none absolute inset-x-8 top-0 -z-10 h-48 rounded-full bg-[radial-gradient(circle_at_center,rgba(109,94,252,0.12),transparent_68%)] blur-3xl" />
        <div className="mx-auto flex min-h-0 w-full max-w-[88rem] flex-1 gap-3 lg:gap-6">
          <aside className="hidden w-20 shrink-0 lg:flex lg:flex-col lg:items-center lg:gap-3 lg:pt-6">
            <button
              type="button"
              onClick={() => showReminderListOverlay()}
              className="relative flex h-14 w-14 items-center justify-center rounded-[22px] bg-[linear-gradient(135deg,#79d8c2_0%,#7568ff_100%)] text-white shadow-[0_24px_45px_-22px_rgba(117,104,255,0.75)] transition hover:-translate-y-0.5"
              aria-label="All reminders"
              title="All reminders"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
                aria-hidden="true"
              >
                <path d="M7 7h10" />
                <path d="M7 12h10" />
                <path d="M7 17h6" />
              </svg>
              {snapshot.missed > 0 ? (
                <span className="absolute -bottom-1 -right-1 inline-flex min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                  {snapshot.missed > 99 ? "99+" : snapshot.missed}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={openAllTasksFromSnapshot}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-teal-200 bg-teal-50 text-teal-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-teal-100"
              aria-label="All tasks"
              title="All tasks"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M9 6h11" />
                <path d="M9 12h11" />
                <path d="M9 18h11" />
                <path d="M4.5 6h.01" />
                <path d="M4.5 12h.01" />
                <path d="M4.5 18h.01" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => showSnapshotOverlay()}
              className="relative flex h-14 w-14 items-center justify-center rounded-[22px] bg-violet-600 text-white shadow-[0_24px_45px_-22px_rgba(124,58,237,0.7)] transition hover:-translate-y-0.5"
              aria-label="Open workspace menu"
              title="Open workspace menu"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="2.5" />
                <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1 1 0 0 1 0 1.4l-1.3 1.3a1 1 0 0 1-1.4 0l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a1 1 0 0 1-1 1h-1.8a1 1 0 0 1-1-1v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a1 1 0 0 1-1.4 0l-1.3-1.3a1 1 0 0 1 0-1.4l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a1 1 0 0 1-1-1v-1.8a1 1 0 0 1 1-1h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a1 1 0 0 1 0-1.4l1.3-1.3a1 1 0 0 1 1.4 0l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4a1 1 0 0 1 1-1h1.8a1 1 0 0 1 1 1v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1 1 0 0 1 1.4 0l1.3 1.3a1 1 0 0 1 0 1.4l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6H20a1 1 0 0 1 1 1v1.8a1 1 0 0 1-1 1h-.2a1 1 0 0 0-.9.6Z" />
              </svg>
              {shareInbox.length > 0 ? (
                <span className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-white bg-rose-500" />
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => runBriefingStream()}
              disabled={!isHistoryLoaded || briefingStreaming || isLoading}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Run briefing"
              title="Run briefing"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M6 12h12" />
                <path d="M12 6v12" />
              </svg>
            </button>
          </aside>

          <div className="flex min-h-0 flex-1 flex-col gap-0 sm:gap-3">
            {typeof Notification !== "undefined" &&
            Notification.permission === "default" &&
            !dueNotifBannerDismissed ? (
              <div className="flex flex-col gap-2 rounded-none border-b border-violet-200 bg-white px-4 py-3 text-xs text-slate-600 shadow-sm sm:rounded-[24px] sm:border lg:hidden">
                <p className="leading-snug text-slate-600">
                  Allow notifications to get an instant alert when a reminder is
                  due, then act from the alert with Done, Snooze, or Delete.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void requestDueNotificationPermission()}
                    className="rounded-full bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500"
                  >
                    Allow alerts
                  </button>
                  <button
                    type="button"
                    onClick={dismissDueNotifBanner}
                    className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Not now
                  </button>
                </div>
              </div>
            ) : null}

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-slate-200/80 bg-white sm:rounded-[32px] sm:border sm:shadow-[0_32px_90px_-56px_rgba(15,23,42,0.35)]">
              {/* Inner toolbar — hidden on mobile to save vertical space; shown sm+ */}
              <div className="hidden shrink-0 items-center justify-end gap-2 border-b border-slate-100 px-4 py-3 sm:flex sm:px-6">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => showReminderListOverlay()}
                    className="hidden h-10 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 sm:inline-flex lg:hidden"
                  >
                    <span
                      aria-hidden
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-600"
                    >
                      ☰
                    </span>
                    All reminders
                  </button>
                  <button
                    type="button"
                    onClick={openAllTasksFromSnapshot}
                    className="hidden h-10 items-center justify-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-700 shadow-sm transition hover:border-teal-300 hover:bg-teal-100 sm:inline-flex lg:hidden"
                  >
                    <span
                      aria-hidden
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-teal-100 text-teal-700"
                    >
                      ≣
                    </span>
                    All tasks
                  </button>
                  <button
                    type="button"
                    onClick={() => showSnapshotOverlay()}
                    className="hidden h-10 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 sm:inline-flex lg:hidden"
                  >
                    Menu
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => runBriefingStream()}
                  disabled={
                    !isHistoryLoaded || briefingStreaming || isLoading
                  }
                  className="inline-flex h-9 items-center justify-center rounded-full border border-violet-200 bg-violet-50 px-3 text-[11px] font-semibold text-violet-700 shadow-sm transition hover:border-violet-300 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40 sm:h-10 sm:px-4 sm:text-xs"
                >
                  Briefing
                </button>
              </div>

              {/* Urgency strip — shows overdue / today / tomorrow chips */}
              {(snapshot.missed > 0 ||
                snapshot.today > 0 ||
                snapshot.tomorrow > 0) && (
                <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-100 bg-slate-50/70 px-4 py-2 scrollbar-none">
                  {snapshot.missed > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setReminderListTab("missed");
                        showReminderListOverlay();
                      }}
                      className="flex shrink-0 items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                      Overdue
                      <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] leading-none text-white">
                        {snapshot.missed}
                      </span>
                    </button>
                  )}
                  {snapshot.today > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setReminderListTab("today");
                        showReminderListOverlay();
                      }}
                      className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-100"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      Today
                      <span className="rounded-full bg-amber-600 px-1.5 py-0.5 text-[10px] leading-none text-white">
                        {snapshot.today}
                      </span>
                    </button>
                  )}
                  {snapshot.tomorrow > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setReminderListTab("tomorrow");
                        showReminderListOverlay();
                      }}
                      className="flex shrink-0 items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700 transition hover:bg-teal-100"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
                      Tomorrow
                      <span className="rounded-full bg-teal-600 px-1.5 py-0.5 text-[10px] leading-none text-white">
                        {snapshot.tomorrow}
                      </span>
                    </button>
                  )}
                </div>
              )}

              <div
                ref={chatScrollRef}
                onScroll={onChatScroll}
                className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain bg-[radial-gradient(circle_at_top,rgba(121,216,194,0.12),transparent_32%),linear-gradient(180deg,#ffffff_0%,#fafaf7_100%)] px-4 py-5 scrollbar-none sm:px-6 sm:py-6"
              >
                <div className="mx-auto grid min-w-0 max-w-4xl gap-4">
                  {messages.map((message) => {
                    const startReplyTo = () => {
                      setReplyTarget(message);
                      setEditingMessageId(null);
                    };
                    const startEditUser = () => {
                      if (message.role !== "user") return;
                      setEditingMessageId(message.id);
                      setInput(message.content);
                      setReplyTarget(null);
                    };

                    if (message.role === "system") {
                      return (
                        <ChatBubbleShell
                          key={message.id}
                          onReply={startReplyTo}
                          showEdit={false}
                          actionAlign="center"
                          showActionsAlways
                          desktopHoverMenu
                        >
                          <div className="mx-auto min-w-0 max-w-[42rem] rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-3 text-center text-xs text-amber-900 shadow-sm">
                            <StructuredMessage content={message.content} />
                            <p className="mt-1 text-[10px] text-amber-700/80">
                              {new Date(message.createdAt).toLocaleTimeString(
                                [],
                                {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                },
                              )}
                            </p>
                          </div>
                        </ChatBubbleShell>
                      );
                    }
                    const dueMeta =
                      message.meta?.kind === "due_reminder"
                        ? message.meta
                        : null;
                    const dueReminder = dueMeta?.reminderId
                      ? reminders.find((r) => r.id === dueMeta.reminderId)
                      : null;
                    const dueReminderResolved =
                      !!dueMeta?.reminderId &&
                      (!dueReminder ||
                        dueReminder.status === "done" ||
                        dueReminder.status === "archived");
                    const replyQuote = message.meta?.replyTo;
                    const showUserEdit =
                      message.role === "user" && !dueMeta?.reminderId;
                    const bubbleClass =
                      message.role === "user"
                        ? "relative ml-auto min-w-0 max-w-[42rem] overflow-hidden rounded-[28px] rounded-br-[12px] bg-[linear-gradient(135deg,#7c3aed_0%,#5b7bff_100%)] px-4 py-3 text-sm text-white shadow-[0_24px_45px_-28px_rgba(91,123,255,0.9)]"
                        : "min-w-0 max-w-[42rem] overflow-hidden rounded-[28px] rounded-bl-[12px] border border-slate-200 bg-[#f6f7fb] px-4 py-3 text-sm text-slate-800 shadow-[0_20px_40px_-36px_rgba(15,23,42,0.55)]";

                    const inner = (
                      <div className={bubbleClass}>
                        {replyQuote ? (
                          <div
                            className={`mb-2 rounded-2xl border-l-4 border-amber-400 pl-3 ${
                              message.role === "user"
                                ? "bg-white/12"
                                : "bg-white/70"
                            }`}
                          >
                            <p
                              className={`pt-2 text-[10px] font-semibold ${
                                message.role === "user"
                                  ? "text-amber-100"
                                  : "text-amber-700"
                              }`}
                            >
                              {chatReplyLabel(replyQuote.role)}
                            </p>
                            <p
                              className={`line-clamp-5 whitespace-pre-wrap pb-2 text-[11px] leading-snug ${
                                message.role === "user"
                                  ? "text-violet-50/95"
                                  : "text-slate-700"
                              }`}
                            >
                              {replyQuote.content}
                            </p>
                          </div>
                        ) : null}
                        {dueMeta?.reminderId ? (
                          <>
                            <p className="font-semibold text-slate-900">
                              Reminder due
                            </p>
                            <p className="mt-1 min-w-0 max-w-full whitespace-pre-wrap break-words leading-relaxed text-slate-800 [overflow-wrap:anywhere]">
                              {dueMeta.title}
                            </p>
                            <p className="mt-1 text-xs text-slate-600">
                              {new Date(
                                dueMeta.dueAt ?? Date.now(),
                              ).toLocaleString()}
                            </p>
                            {dueMeta.notes ? (
                              <p className="mt-1 text-xs text-slate-500">
                                {dueMeta.notes}
                              </p>
                            ) : null}
                            {dueReminderResolved ? (
                              <p className="mt-3 text-xs font-medium text-slate-600">
                                {dueReminder?.status === "done"
                                  ? "Already marked done."
                                  : "This reminder was already updated from another action."}
                              </p>
                            ) : (
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleDueReminderAction(
                                      message.id,
                                      dueMeta.reminderId!,
                                      "done",
                                    )
                                  }
                                  className="rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
                                >
                                  Done
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleDueReminderAction(
                                      message.id,
                                      dueMeta.reminderId!,
                                      "snooze",
                                    )
                                  }
                                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-50"
                                >
                                  Snooze 1h
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleDueReminderAction(
                                      message.id,
                                      dueMeta.reminderId!,
                                      "reschedule",
                                    )
                                  }
                                  className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold text-violet-900 hover:bg-violet-100"
                                >
                                  Set new time
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleDueReminderAction(
                                      message.id,
                                      dueMeta.reminderId!,
                                      "delete",
                                    )
                                  }
                                  className="rounded-full bg-rose-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-rose-500"
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            {message.meta?.kind === "briefing" ? (
                              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                                {briefingSectionLabel(
                                  message.meta.briefingSection,
                                )}
                              </p>
                            ) : null}
                            <StructuredMessage
                              content={message.content}
                              className="min-w-0 max-w-full leading-relaxed [overflow-wrap:anywhere]"
                            />
                          </>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <p
                            className={`flex min-w-0 flex-wrap items-center gap-2 text-[10px] ${
                              message.role === "user"
                                ? "text-violet-100"
                                : "text-slate-500"
                            }`}
                          >
                            <span>
                              {new Date(message.createdAt).toLocaleTimeString(
                                [],
                                {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                },
                              )}
                            </span>
                            {message.meta?.editedAt &&
                            message.role === "user" ? (
                              <span className="rounded-full bg-white/15 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-violet-50">
                                Edited
                              </span>
                            ) : null}
                          </p>
                        </div>
                      </div>
                    );

                    return (
                      <ChatBubbleShell
                        key={message.id}
                        onReply={startReplyTo}
                        onEdit={
                          message.role === "user" && showUserEdit
                            ? startEditUser
                            : undefined
                        }
                        showEdit={message.role === "user" && showUserEdit}
                        actionAlign={message.role === "user" ? "end" : "start"}
                        showActionsAlways={message.role === "user"}
                        desktopHoverMenu
                        onLongPressEdit={
                          message.role === "user" && showUserEdit
                            ? startEditUser
                            : undefined
                        }
                      >
                        {inner}
                      </ChatBubbleShell>
                    );
                  })}
                  {isLoading ? (
                    <div className="min-w-0 max-w-[42rem] rounded-[28px] rounded-bl-[12px] border border-slate-200 bg-[#f6f7fb] px-4 py-3 text-sm text-slate-700 shadow-[0_20px_40px_-36px_rgba(15,23,42,0.55)]">
                      <p className="min-w-0 break-words [overflow-wrap:anywhere]">
                        {loadingTexts[loadingTextIndex]}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>

              {showSuggestedQuestions && followUpQuestions.length > 0 ? (
                <div className="shrink-0 border-t border-slate-100 px-4 pb-3 pt-3 sm:px-6">
                  <div className="mx-auto max-w-4xl">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                      Suggested
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {followUpQuestions.map((q, i) => (
                        <button
                          key={`${q.kind}-${i}-${q.text.slice(0, 24)}`}
                          type="button"
                          disabled={briefingStreaming}
                          onClick={() => {
                            const lastUser = [...messages]
                              .reverse()
                              .find((m) => m.role === "user")?.content;
                            const taskBrief: TaskItemBrief[] = tasks.map(
                              (t) => ({
                                id: t.id,
                                title: t.title,
                                dueAt: t.dueAt,
                                status: t.status,
                                priority: t.priority,
                              }),
                            );
                            setInput(q.text);
                            setFollowUpQuestions((prev) =>
                              replaceFollowUpSlot(prev, i as 0 | 1 | 2, {
                                reminders,
                                tasks: taskBrief,
                                lastUserMessage: lastUser,
                                firstName: user?.firstName,
                              }),
                            );
                          }}
                          className={`min-h-[2.75rem] rounded-full border px-4 py-2 text-left text-xs font-medium leading-snug transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0 sm:px-3 sm:py-2 ${
                            q.kind === "action"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                          }`}
                        >
                          {q.text}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              <form
                ref={chatFormRef}
                onSubmit={handleChatSubmit}
                className={`shrink-0 border-t border-slate-100 bg-white px-3 pb-[max(0.875rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-4 ${
                  briefingComposerLocked ? "opacity-90" : ""
                }`}
              >
                <div className="mx-auto max-w-4xl">
                  {pendingCreateDraft?.step === "task" ? (
                    <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/60">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        Select task
                      </p>
                      <div className="flex gap-2 overflow-x-auto scroll-smooth pb-1">
                        <button
                          type="button"
                          disabled={isLoading || (briefingStreaming && !editingMessageId)}
                          onClick={() => {
                            quickSubmitTextRef.current = "no";
                            requestAnimationFrame(() => {
                              chatFormRef.current?.requestSubmit();
                            });
                          }}
                          className="shrink-0 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          Standalone
                        </button>
                        {taskLinkQuickReplies.map((task) => (
                          <button
                            key={`task-link-chip-${task.id}`}
                            type="button"
                            disabled={isLoading || (briefingStreaming && !editingMessageId)}
                            onClick={() => {
                              quickSubmitTextRef.current = task.title;
                              requestAnimationFrame(() => {
                                chatFormRef.current?.requestSubmit();
                              });
                            }}
                            className="shrink-0 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-medium text-violet-700 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-700 dark:bg-slate-950 dark:text-violet-200 dark:hover:bg-violet-900/30"
                          >
                            {task.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {editingMessageId ? (
                    <div className="mb-3 flex items-center justify-between gap-2 rounded-[22px] border border-violet-200 bg-violet-50 px-4 py-3 text-xs text-violet-700">
                      <span className="font-medium">Editing your message</span>
                      <button
                        type="button"
                        className="shrink-0 rounded-full border border-violet-200 px-3 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-100"
                        onClick={() => {
                          setEditingMessageId(null);
                          setInput("");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                  {replyTarget && !editingMessageId ? (
                    <div className="mb-3 flex items-start gap-2 rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-3">
                      <div className="min-w-0 flex-1 border-l-4 border-amber-400 pl-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-700">
                          {chatReplyLabel(replyTarget.role)}
                        </p>
                        <p className="line-clamp-4 whitespace-pre-wrap text-xs leading-snug text-slate-700">
                          {replyTarget.content}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 rounded-full border border-amber-200 px-2.5 py-0.5 text-lg leading-none text-amber-700 hover:bg-amber-100"
                        aria-label="Cancel reply"
                        onClick={() => setReplyTarget(null)}
                      >
                        ×
                      </button>
                    </div>
                  ) : null}
                  <div className="mb-2 flex items-center gap-2 sm:hidden">
                    <button
                      type="button"
                      onClick={() => showReminderListOverlay()}
                      className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-[11px] font-semibold text-violet-700"
                    >
                      ☰ All reminders
                    </button>
                    <button
                      type="button"
                      onClick={openAllTasksFromSnapshot}
                      className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-[11px] font-semibold text-teal-700"
                    >
                      ≣ All tasks
                    </button>
                  </div>
                  <div className="flex w-full min-w-0 items-end gap-2 rounded-[28px] border border-slate-200 bg-[#f5f6fa] py-2 pl-2 pr-2 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
                    {/* + Create reminder — visible on mobile, hidden on sm+ */}
                    <button
                      type="button"
                      onClick={() => showCreateOverlay()}
                      disabled={briefingComposerLocked}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-600 text-xl font-semibold text-white shadow-sm transition hover:bg-violet-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:hidden"
                      aria-label="Create reminder"
                      title="Create reminder"
                    >
                      +
                    </button>
                    <div className="relative min-h-[2.4rem] min-w-0 flex-1">
                      <textarea
                        ref={composerTextareaRef}
                        rows={1}
                        value={input}
                        onChange={(event) => setInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            event.currentTarget.form?.requestSubmit();
                          }
                        }}
                        placeholder={
                          briefingComposerLocked && !editingMessageId
                            ? "Briefing in progress…"
                            : "Ask or add a reminder…"
                        }
                        readOnly={briefingComposerLocked && !editingMessageId}
                        aria-busy={briefingStreaming}
                        aria-label={
                          briefingStreaming
                            ? "Message (wait for briefing to finish)"
                            : "Message"
                        }
                        className={`scrollbar-none relative z-10 min-h-10 w-full resize-none overflow-y-hidden rounded-2xl bg-transparent px-2 py-1.5 text-sm leading-6 text-slate-800 [overflow-wrap:anywhere] outline-none placeholder:text-slate-400 ${
                          briefingComposerLocked && !editingMessageId
                            ? "cursor-wait caret-transparent"
                            : ""
                        }`}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={
                        !input.trim() ||
                        isLoading ||
                        (briefingStreaming && !editingMessageId)
                      }
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-600 text-base font-semibold text-white shadow-md transition hover:bg-violet-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="Send message"
                    >
                      {isLoading || (briefingStreaming && !editingMessageId) ? (
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden>
                          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </section>

      {isSnapshotOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40"
          onClick={closeSnapshotOverlay}
        >
          <aside
            className="absolute right-0 top-0 flex h-full w-[92%] max-w-sm flex-col overflow-hidden border-l border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] dark:border-slate-800 dark:bg-slate-950">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Menu
              </h2>
              <button
                type="button"
                onClick={closeSnapshotOverlay}
                className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-800 dark:border-slate-600 dark:text-slate-100"
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
              <div className="grid grid-cols-3 gap-1.5">
                <div className="flex min-h-[3rem] flex-col items-center justify-center rounded-lg border border-slate-200/90 bg-gradient-to-b from-slate-50 to-slate-100/90 px-1 py-1.5 text-center dark:border-slate-700 dark:from-slate-900 dark:to-slate-950">
                  <span className="text-lg font-bold tabular-nums leading-none text-slate-900 dark:text-white">
                    {snapshot.pending}
                  </span>
                  <span className="mt-0.5 text-[9px] font-semibold uppercase leading-tight tracking-wide text-slate-500 dark:text-slate-400">
                    Left
                  </span>
                </div>
                <div className="flex min-h-[3rem] flex-col items-center justify-center rounded-lg border border-slate-200/90 bg-gradient-to-b from-slate-50 to-slate-100/90 px-1 py-1.5 text-center dark:border-slate-700 dark:from-slate-900 dark:to-slate-950">
                  <span className="text-lg font-bold tabular-nums leading-none text-slate-900 dark:text-white">
                    {snapshot.today}
                  </span>
                  <span className="mt-0.5 text-[9px] font-semibold uppercase leading-tight tracking-wide text-slate-500 dark:text-slate-400">
                    Today
                  </span>
                </div>
                <div className="flex min-h-[3rem] flex-col items-center justify-center rounded-lg border border-slate-200/90 bg-gradient-to-b from-slate-50 to-slate-100/90 px-1 py-1.5 text-center dark:border-slate-700 dark:from-slate-900 dark:to-slate-950">
                  <span className="text-lg font-bold tabular-nums leading-none text-slate-900 dark:text-white">
                    {snapshot.missed}
                  </span>
                  <span className="mt-0.5 text-[9px] font-semibold uppercase leading-tight tracking-wide text-slate-500 dark:text-slate-400">
                    Late
                  </span>
                </div>
              </div>

              <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/90 px-2.5 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-100">
                <input
                  type="checkbox"
                  className="mt-0.5 shrink-0"
                  checked={showSuggestedQuestions}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setShowSuggestedQuestions(on);
                    try {
                      localStorage.setItem(
                        SHOW_SUGGESTED_QUESTIONS_KEY,
                        on ? "1" : "0",
                      );
                    } catch {
                      /* ignore */
                    }
                  }}
                />
                <span>Suggested questions in chat</span>
              </label>

              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/90 p-2 text-xs dark:border-slate-700 dark:bg-slate-950/80">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex cursor-pointer items-center gap-2 text-slate-800 dark:text-slate-100">
                    <input
                      type="checkbox"
                      className="shrink-0"
                      checked={
                        dueNotifPrefs.enabled &&
                        Notification.permission === "granted"
                      }
                      onChange={(e) => {
                        if (e.target.checked)
                          void requestDueNotificationPermission();
                        else persistDueNotifPrefs({ enabled: false });
                      }}
                      disabled={
                        typeof Notification !== "undefined" &&
                        Notification.permission === "denied"
                      }
                    />
                    <span>Due-time alerts</span>
                  </label>
                  {typeof Notification !== "undefined" &&
                  Notification.permission === "default" ? (
                    <button
                      type="button"
                      onClick={() => void requestDueNotificationPermission()}
                      className="shrink-0 rounded-full bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-500"
                    >
                      Allow
                    </button>
                  ) : null}
                </div>
                <details className="mt-1.5 border-t border-slate-200 pt-1.5 dark:border-slate-700">
                  <summary className="cursor-pointer text-[11px] text-slate-600 dark:text-slate-400">
                    More alert options
                  </summary>
                  <div className="mt-2 space-y-1.5 pl-0.5">
                    <label className="flex cursor-pointer items-start gap-2 text-slate-800 dark:text-slate-100">
                      <input
                        type="checkbox"
                        className="mt-0.5 shrink-0"
                        checked={dueNotifPrefs.notifyWhenForeground}
                        onChange={(e) =>
                          persistDueNotifPrefs({
                            notifyWhenForeground: e.target.checked,
                          })
                        }
                        disabled={
                          !dueNotifPrefs.enabled ||
                          Notification.permission !== "granted"
                        }
                      />
                      <span>Also when this tab is visible</span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2 text-slate-800 dark:text-slate-100">
                      <input
                        type="checkbox"
                        className="mt-0.5 shrink-0"
                        checked={dueNotifPrefs.desktopEnabled}
                        onChange={(e) =>
                          persistDueNotifPrefs({
                            desktopEnabled: e.target.checked,
                          })
                        }
                        disabled={
                          !dueNotifPrefs.enabled ||
                          Notification.permission !== "granted"
                        }
                      />
                      <span>On large / desktop screens</span>
                    </label>
                  </div>
                </details>
                {typeof Notification !== "undefined" &&
                Notification.permission === "denied" ? (
                  <p className="mt-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                    Notifications blocked—enable in browser settings.
                  </p>
                ) : null}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => showCreateOverlay()}
                  className="flex min-h-[2.65rem] flex-col items-center justify-center rounded-lg bg-gradient-to-b from-violet-500 to-violet-700 px-1.5 py-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)] ring-1 ring-violet-400/25 transition hover:brightness-110 active:scale-[0.98]"
                >
                  <span aria-hidden className="text-sm leading-none opacity-90">
                    ＋
                  </span>
                  <span className="mt-0.5 leading-tight">Create reminder</span>
                </button>
                <button
                  type="button"
                  onClick={() => showReminderListOverlay()}
                  className="flex min-h-[2.65rem] flex-col items-center justify-center rounded-lg bg-gradient-to-b from-violet-500 to-violet-700 px-1.5 py-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)] ring-1 ring-violet-400/25 transition hover:brightness-110 active:scale-[0.98]"
                >
                  <span aria-hidden className="text-sm leading-none opacity-90">
                    ☰
                  </span>
                  <span className="mt-0.5 leading-tight">All reminders</span>
                </button>
                <button
                  type="button"
                  onClick={() => showTasksOverlay("create")}
                  className="flex min-h-[2.65rem] flex-col items-center justify-center rounded-lg bg-gradient-to-b from-violet-500 to-violet-700 px-1.5 py-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)] ring-1 ring-violet-400/25 transition hover:brightness-110 active:scale-[0.98]"
                >
                  <span aria-hidden className="text-sm leading-none opacity-90">
                    ✓
                  </span>
                  <span className="mt-0.5 leading-tight">Create task</span>
                </button>
                <button
                  type="button"
                  onClick={openAllTasksFromSnapshot}
                  className="flex min-h-[2.65rem] flex-col items-center justify-center rounded-lg bg-gradient-to-b from-teal-500 to-teal-700 px-1.5 py-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)] ring-1 ring-teal-400/25 transition hover:brightness-110 active:scale-[0.98]"
                >
                  <span aria-hidden className="text-sm leading-none opacity-90">
                    ≣
                  </span>
                  <span className="mt-0.5 leading-tight">All tasks</span>
                </button>
              </div>

              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => showImportOverlay()}
                  className="flex min-h-[2.35rem] flex-col items-center justify-center rounded-lg border border-slate-300/90 bg-slate-50/90 px-1.5 py-1 text-center text-[10px] font-semibold leading-tight text-slate-800 shadow-sm transition hover:bg-white dark:border-slate-600 dark:bg-slate-900/80 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  Import
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeSnapshotOverlay();
                    handleExportChat();
                  }}
                  disabled={isLoading || messages.length === 0}
                  className="flex min-h-[2.35rem] flex-col items-center justify-center rounded-lg border border-slate-300/90 bg-slate-50/90 px-1.5 py-1 text-center text-[10px] font-semibold leading-tight text-slate-800 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-600 dark:bg-slate-900/80 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  Export
                </button>
                <button
                  type="button"
                  onClick={() => showBatchOverlay()}
                  disabled={isBatchRunning || isLoading}
                  className="flex min-h-[2.35rem] flex-col items-center justify-center rounded-lg border border-slate-300/90 bg-slate-50/90 px-1.5 py-1 text-center text-[10px] font-semibold leading-tight text-slate-800 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-600 dark:bg-slate-900/80 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  Batch
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  closeSnapshotOverlay();
                  void handleClearChat();
                }}
                disabled={isClearingChat || isLoading}
                className="mt-3 w-full rounded-xl border border-rose-200 bg-rose-50/80 py-2 text-center text-xs font-semibold text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100 dark:hover:bg-rose-950/60"
              >
                {isClearingChat ? "Clearing…" : "Clear chat"}
              </button>
            </div>
          </aside>
        </div>
      )}

      {isCreateOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
          onClick={closeCreateOverlay}
        >
          <div
            className="my-auto flex max-h-[min(94vh,860px)] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <div>
                <h3 className="text-lg font-semibold">
                  {editingReminderId ? "Edit reminder" : "Create reminder"}
                </h3>
              </div>
              <button
                type="button"
                onClick={openReminderListFromCreateModal}
                className="shrink-0 rounded-full border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-900 transition hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-100 dark:hover:bg-violet-900/40"
              >
                View reminders
              </button>
            </div>
            <form
              className="min-h-0 overflow-y-auto"
              onSubmit={handleManualCreate}
            >
              <div className="grid gap-4 px-5 py-5">
                <label className="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
                  Title
                  <input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Reminder title (e.g. Pay electricity bill)"
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
                    Date
                    <input
                      type="date"
                      min={getMinDate()}
                      value={newDate}
                      onChange={(e) => setNewDate(e.target.value)}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:[color-scheme:dark]"
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
                    Time
                    <input
                      type="time"
                      min={newDate === getMinDate() ? new Date().toTimeString().slice(0, 5) : undefined}
                      value={newTime}
                      onChange={(e) => setNewTime(e.target.value)}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:[color-scheme:dark]"
                    />
                  </label>
                </div>
                <label className="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
                  Repeat
                  <select
                    value={newRecurrence}
                    onChange={(e) =>
                      setNewRecurrence(e.target.value as ReminderRecurrence)
                    }
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="none">Does not repeat</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
                  Notes
                  <textarea
                    rows={3}
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                    placeholder="Optional notes"
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
                {(() => {
                  const editingRem = editingReminderId
                    ? reminders.find((r) => r.id === editingReminderId)
                    : undefined;
                  const canEditLinks =
                    !editingRem || editingRem.access !== "shared";
                  return (
                    <>
                      <label
                        className={`grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-300 ${
                          !canEditLinks ? "opacity-60" : ""
                        }`}
                      >
                        Related task (optional)
                        <select
                          value={reminderLinkedTaskId}
                          onChange={(e) =>
                            setReminderLinkedTaskId(e.target.value)
                          }
                          disabled={!canEditLinks}
                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 disabled:cursor-not-allowed"
                        >
                          <option value="">None — counts as ADHOC</option>
                          {tasks.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.title}
                            </option>
                          ))}
                        </select>
                        <span className="text-[11px] font-normal text-slate-500">
                          No task selected → reminder is ADHOC (standalone).
                        </span>
                      </label>
                      {canEditLinks ? (
                        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/90 px-3 py-2 dark:border-slate-600 dark:bg-slate-900/50">
                          <button
                            type="button"
                            onClick={() => setShowReminderInlineTask((v) => !v)}
                            className="text-xs font-semibold text-violet-700 hover:underline dark:text-violet-300"
                          >
                            {showReminderInlineTask
                              ? "Hide quick task creator"
                              : "+ Create new task & link it"}
                          </button>
                          {showReminderInlineTask ? (
                            <div className="mt-2 grid gap-2">
                              <input
                                value={reminderInlineTaskTitle}
                                onChange={(e) =>
                                  setReminderInlineTaskTitle(e.target.value)
                                }
                                placeholder="New task title"
                                className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
                              />
                              <label className="grid gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-400">
                                Due (optional)
                                <input
                                  type="datetime-local"
                                  value={reminderInlineTaskDue}
                                  onChange={(e) =>
                                    setReminderInlineTaskDue(e.target.value)
                                  }
                                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
                                />
                              </label>
                              <button
                                type="button"
                                disabled={reminderInlineTaskSaving}
                                onClick={() => void createReminderInlineTask()}
                                className="rounded-full bg-violet-600 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                              >
                                {reminderInlineTaskSaving
                                  ? "Creating…"
                                  : "Create task & link"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <label
                        className={`grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-300 ${
                          !canEditLinks ? "opacity-60" : ""
                        }`}
                      >
                        Domain (optional)
                        <select
                          value={reminderDomain}
                          onChange={(e) =>
                            setReminderDomain(e.target.value as "" | LifeDomain)
                          }
                          disabled={!canEditLinks}
                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 disabled:cursor-not-allowed"
                        >
                          <option value="">No domain</option>
                          {(
                            [
                              "health",
                              "finance",
                              "career",
                              "hobby",
                              "fun",
                            ] as const
                          ).map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  );
                })()}
                <StarRating
                  value={reminderStars}
                  onChange={setReminderStars}
                  label="Priority (required)"
                />
                {createFormError ? (
                  <p
                    className="text-sm text-rose-600 dark:text-rose-400"
                    role="alert"
                  >
                    {createFormError}
                  </p>
                ) : null}
                <div className="mt-1 flex gap-2">
                  <button
                    type="submit"
                    className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white"
                  >
                    {editingReminderId ? "Update" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetReminderForm();
                      setCreateFormError(null);
                      closeCreateOverlay();
                    }}
                    className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {isListOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={closeReminderListOverlay}
        >
          <div
            className="mt-auto flex max-h-[min(92vh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:my-auto sm:rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <h3 className="text-base font-semibold sm:text-lg">Reminders</h3>
              <button
                type="button"
                onClick={closeReminderListOverlay}
                className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold dark:border-slate-600"
              >
                Close
              </button>
            </div>
            <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 px-2 py-2 dark:border-slate-800">
              {(
                [
                  ["missed", "Missed"],
                  ["today", "Today"],
                  ["tomorrow", "Tomorrow"],
                  ["upcoming", "Later"],
                  ["shared", "Shared"],
                  ["sent", "Sent"],
                  ["done", "Done"],
                ] as const
              ).map(([key, label]) => {
                const count =
                  key === "shared"
                    ? sharedTabCount
                    : key === "sent"
                      ? sentTabCount
                      : grouped[key].length;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setReminderListTab(key)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      reminderListTab === key
                        ? "bg-violet-600 text-white"
                        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    }`}
                  >
                    {label} <span className="opacity-80">({count})</span>
                  </button>
                );
              })}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2 dark:border-slate-800">
              {reminderListTab !== "shared" ? (
                !reminderSelectionMode ? (
                  <button
                    type="button"
                    className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                    onClick={() => {
                      setReminderSelectionMode(true);
                      setSelectedReminderIds(new Set());
                    }}
                  >
                    Select
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold dark:border-slate-600"
                      onClick={() => {
                        setReminderSelectionMode(false);
                        setSelectedReminderIds(new Set());
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={selectedReminderIds.size === 0}
                      className="rounded-full bg-violet-600 px-3 py-1 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => showShareOverlay([...selectedReminderIds])}
                    >
                      Share ({selectedReminderIds.size})
                    </button>
                  </div>
                )
              ) : (
                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                  Invites you joined appear here; pending invites stay above.
                </span>
              )}
            </div>
            {shareInbox.length > 0 ? (
              <div className="max-h-48 shrink-0 space-y-2 overflow-y-auto border-b border-violet-200/50 bg-violet-50/60 px-4 py-2 dark:border-violet-900/50 dark:bg-violet-950/35">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200">
                    Shared with you
                  </p>
                  <button
                    type="button"
                    className="rounded-full border border-violet-400 px-2.5 py-0.5 text-[10px] font-semibold text-violet-900 dark:border-violet-600 dark:text-violet-100"
                    onClick={() => {
                      void Notification.requestPermission().then((p) => {
                        if (p === "granted")
                          void syncReminderPushSubscription();
                      });
                    }}
                  >
                    Enable invite alerts
                  </button>
                </div>
                {groupShareInboxRows(shareInbox).map(({ batchKey, rows }) => {
                  const first = rows[0]!;
                  const n = rows.length;
                  return (
                    <div
                      key={batchKey}
                      className="rounded-lg border border-violet-200/90 bg-white/95 px-2.5 py-2 text-xs dark:border-violet-800 dark:bg-slate-900"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">
                            {first.fromDisplayName}
                            {n > 1 ? ` · ${n} reminders` : ` · ${first.title}`}
                          </p>
                          {n > 1 ? (
                            <ul className="mt-1 max-h-20 list-inside list-disc overflow-y-auto text-[11px] text-slate-600 dark:text-slate-300">
                              {rows.map((r) => (
                                <li key={r._id}>{r.title}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                        <span className="flex shrink-0 flex-col gap-1 sm:flex-row">
                          <button
                            type="button"
                            className="rounded-full bg-violet-600 px-2.5 py-0.5 text-[11px] font-semibold text-white"
                            onClick={() => void joinShareBatch(batchKey)}
                          >
                            Accept all
                          </button>
                          <button
                            type="button"
                            className="rounded-full border border-slate-300 px-2.5 py-0.5 text-[11px] font-semibold dark:border-slate-600"
                            onClick={() => void dismissShareBatch(batchKey)}
                          >
                            Deny all
                          </button>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <div className="shrink-0 border-b border-slate-200 px-4 py-2 dark:border-slate-800">
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <label className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                      <span className="font-medium">Filter</span>
                      <select
                        value={reminderTaskFilter}
                        onChange={(e) =>
                          setReminderTaskFilter(
                            e.target.value as "all" | "adhoc" | string,
                          )
                        }
                        className="max-w-[min(100%,14rem)] rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-950"
                      >
                        <option value="all">All in this tab</option>
                        <option value="adhoc">ADHOC only</option>
                        {tasks.map((t) => (
                          <option key={t.id} value={t.id}>
                            Task: {t.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    {reminderListTab === "shared" ? (
                      <label className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                        <span className="font-medium">From</span>
                        <select
                          value={sharedFromFilter}
                          onChange={(e) =>
                            setSharedFromFilter(
                              e.target.value as "all" | string,
                            )
                          }
                          className="max-w-[min(100%,16rem)] rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-950"
                        >
                          <option value="all">Everyone</option>
                          {sharedFromOptions.map((id) => (
                            <option key={id} value={id}>
                              …{id.slice(-8)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {reminderListTab === "sent" ? (
                      <label className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                        <span className="font-medium">Sent to</span>
                        <select
                          value={sentToFilter}
                          onChange={(e) =>
                            setSentToFilter(e.target.value as "all" | string)
                          }
                          className="max-w-[min(100%,16rem)] rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-950"
                        >
                          <option value="all">Everyone</option>
                          {sentRecipientOptions.map(([id, name]) => (
                            <option key={id} value={id}>
                              {name || `…${id.slice(-8)}`}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={openCreateReminderFromRemindersList}
                      className="inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-violet-50 px-2.5 py-1.5 text-xs font-semibold text-violet-900 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-100"
                      title="Create reminder"
                      aria-label="Create reminder"
                    >
                      <span aria-hidden className="text-base leading-none">
                        +
                      </span>
                      Reminder
                    </button>
                    <button
                      type="button"
                      onClick={openCreateTaskFromRemindersList}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      title="Create task"
                      aria-label="Create task"
                    >
                      <span aria-hidden className="text-base leading-none">
                        +
                      </span>
                      Task
                    </button>
                    <button
                      type="button"
                      onClick={openAllTasksFromSnapshot}
                      className="inline-flex items-center gap-1 rounded-lg border border-teal-300 bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-900 dark:border-teal-700 dark:bg-teal-950/50 dark:text-teal-100"
                      title="All tasks"
                      aria-label="All tasks"
                    >
                      <span aria-hidden className="text-base leading-none">
                        ≣
                      </span>
                      Tasks
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="grid gap-3">
                {reminderListRows.length === 0 ? (
                  <p className="text-sm text-slate-500">Nothing in this tab.</p>
                ) : (
                  reminderListRows.map((reminder) => (
                    <article
                      key={reminder.id}
                      className={`flex gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700 sm:p-4 ${
                        reminderSelectionMode &&
                        selectedReminderIds.has(reminder.id)
                          ? "ring-2 ring-violet-500/55"
                          : ""
                      }`}
                      onTouchStart={() => {
                        if (
                          reminder.access === "shared" ||
                          reminderListTab === "done" ||
                          reminderListTab === "shared"
                        ) {
                          return;
                        }
                        reminderLongPressTimerRef.current = window.setTimeout(
                          () => {
                            reminderLongPressTimerRef.current = null;
                            setReminderSelectionMode(true);
                            toggleReminderSelect(reminder.id);
                            if (
                              typeof navigator !== "undefined" &&
                              navigator.vibrate
                            ) {
                              navigator.vibrate(35);
                            }
                          },
                          450,
                        );
                      }}
                      onTouchEnd={() => {
                        const id = reminderLongPressTimerRef.current;
                        if (id != null) {
                          window.clearTimeout(id);
                          reminderLongPressTimerRef.current = null;
                        }
                      }}
                      onTouchMove={() => {
                        const id = reminderLongPressTimerRef.current;
                        if (id != null) {
                          window.clearTimeout(id);
                          reminderLongPressTimerRef.current = null;
                        }
                      }}
                    >
                      {reminderSelectionMode &&
                      reminderListTab !== "shared" &&
                      reminder.access !== "shared" &&
                      reminderListTab !== "done" ? (
                        <div className="flex shrink-0 items-start pt-0.5">
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 rounded border-slate-400 text-violet-600"
                            checked={selectedReminderIds.has(reminder.id)}
                            onChange={() => toggleReminderSelect(reminder.id)}
                            aria-label={`Select ${reminder.title}`}
                          />
                        </div>
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">
                          {reminder.title}
                          <span className="text-amber-500">
                            {priorityStarsLabel(reminder.priority)}
                          </span>
                          {reminder.access === "shared" ? (
                            <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium uppercase text-sky-800 dark:bg-sky-900/50 dark:text-sky-200">
                              Shared
                            </span>
                          ) : null}
                          {isAdhocReminder(reminder) ? (
                            <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium uppercase text-slate-800 dark:bg-slate-700 dark:text-slate-100">
                              ADHOC
                            </span>
                          ) : (
                            <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-900 dark:bg-indigo-950/80 dark:text-indigo-100">
                              Task:{" "}
                              {taskTitleById[reminder.linkedTaskId!] ??
                                "linked"}
                            </span>
                          )}
                          {reminder.domain ? (
                            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100">
                              {reminder.domain}
                            </span>
                          ) : null}
                        </p>
                        <p className="text-sm text-slate-500">
                          Due: {new Date(reminder.dueAt).toLocaleString()}
                        </p>
                        <p className="text-xs text-slate-500">
                          Repeat: {reminder.recurrence ?? "none"}
                        </p>
                        {reminder.notes ? (
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                            {reminder.notes}
                          </p>
                        ) : null}
                        {reminderListTab === "done" ? null : (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {reminder.access !== "shared" ? (
                              <button
                                type="button"
                                onClick={() => showShareOverlay([reminder.id])}
                                className="rounded-full border border-violet-400 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-900 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-100"
                              >
                                Share
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => openEditModal(reminder)}
                              className="rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const nextStatus =
                                  reminder.status === "done"
                                    ? "pending"
                                    : "done";
                                void refreshAfterReminderMutation(
                                  fetch(`/api/reminders/${reminder.id}`, {
                                    method: "PATCH",
                                    headers: {
                                      "Content-Type": "application/json",
                                    },
                                    body: JSON.stringify({ status: nextStatus }),
                                  }),
                                ).catch(() =>
                                  showShareToast(
                                    "Could not update reminder. Try again.",
                                  ),
                                );
                              }}
                              className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white"
                            >
                              {reminder.status === "done"
                                ? "Mark pending"
                                : "Mark done"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void refreshAfterReminderMutation(
                                  fetch(`/api/reminders/${reminder.id}`, {
                                    method: "DELETE",
                                  }),
                                ).catch(() =>
                                  showShareToast(
                                    "Could not delete reminder. Try again.",
                                  ),
                                );
                              }}
                              className="rounded-full bg-rose-600 px-3 py-1 text-xs font-semibold text-white"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {isShareOpen && (
        <div
          className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={closeShareOverlay}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-dialog-title"
            className="mt-auto flex max-h-[min(88vh,560px)] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:my-auto sm:rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="shrink-0 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <h3
                id="share-dialog-title"
                className="text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                Share{" "}
                {shareReminderIds.length === 1
                  ? "reminder"
                  : `${shareReminderIds.length} reminders`}
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Choose people in your app. They get an in-app invite to join
                this reminder.
              </p>
            </div>
            <div className="min-h-0 shrink px-4 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Reminders
              </p>
              <ul className="mt-1 max-h-20 list-inside list-disc overflow-y-auto text-xs text-slate-700 dark:text-slate-200">
                {shareReminderIds.map((id) => (
                  <li key={id}>
                    {reminders.find((r) => r.id === id)?.title ?? id}
                  </li>
                ))}
              </ul>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden border-t border-slate-200 px-2 dark:border-slate-800">
              <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                People
              </p>
              <div className="max-h-[min(40vh,280px)] space-y-1 overflow-y-auto px-2 pb-3">
                {directoryLoading ? (
                  <p className="px-2 text-sm text-slate-500">Loading users…</p>
                ) : directoryError ? (
                  <p className="px-2 text-sm text-rose-600">{directoryError}</p>
                ) : directoryUsers.length === 0 ? (
                  <p className="px-2 text-sm text-slate-500">
                    No other users found.
                  </p>
                ) : (
                  directoryUsers.map((u) => {
                    const selected = selectedShareUserIds.has(u.id);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => toggleShareUser(u.id)}
                        className={`flex w-full items-center gap-3 rounded-xl border px-2 py-2 text-left text-sm transition ${
                          selected
                            ? "border-violet-500 bg-violet-50 dark:border-violet-600 dark:bg-violet-950/50"
                            : "border-transparent hover:bg-slate-50 dark:hover:bg-slate-800"
                        }`}
                      >
                        <input
                          type="checkbox"
                          readOnly
                          checked={selected}
                          className="pointer-events-none h-4 w-4 rounded border-slate-400"
                          tabIndex={-1}
                          aria-hidden
                        />
                        {u.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={u.imageUrl}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                            {directoryDisplayName(u).slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-slate-900 dark:text-slate-100">
                            {directoryDisplayName(u)}
                          </span>
                          <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                            {u.email || "—"}
                          </span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            <div className="flex shrink-0 gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
              <button
                type="button"
                className="flex-1 rounded-full border border-slate-300 py-2 text-sm font-semibold dark:border-slate-600"
                onClick={closeShareOverlay}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={shareSending || selectedShareUserIds.size === 0}
                className="flex-1 rounded-full bg-violet-600 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
                onClick={() => void sendShares()}
              >
                {shareSending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}

      <TaskListOverlay
        open={isTasksOpen && taskMode === "browse"}
        taskTab={taskTab}
        setTaskTab={setTaskTab}
        tasksGrouped={tasksGrouped}
        reminders={reminders}
        onClose={closeTasksOverlay}
        onViewReminders={openReminderListFromTasksPanel}
        onCreateTask={() => {
          setTaskMode("create");
          showTasksOverlay("create");
        }}
        onEditTask={openTaskEdit}
        onToggleStatus={(task) => {
          void fetch(`/api/tasks/${task.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              status: task.status === "done" ? "pending" : "done",
            }),
          }).then(() => void refreshTasks());
        }}
        onDeleteTask={(task) => {
          void fetch(`/api/tasks/${task.id}`, {
            method: "DELETE",
          }).then(() => void refreshTasks());
        }}
      />

      <TaskFormOverlay
        open={isTasksOpen && taskMode === "create"}
        editingTaskId={editingTaskId}
        taskFormTitle={taskFormTitle}
        setTaskFormTitle={setTaskFormTitle}
        taskFormDue={taskFormDue}
        setTaskFormDue={setTaskFormDue}
        taskFormNotes={taskFormNotes}
        setTaskFormNotes={setTaskFormNotes}
        taskFormDomain={taskFormDomain}
        setTaskFormDomain={setTaskFormDomain}
        taskStars={taskStars}
        setTaskStars={setTaskStars}
        taskFormError={taskFormError}
        taskDueUserEdited={taskDueUserEdited}
        setTaskDueUserEdited={setTaskDueUserEdited}
        onSubmit={handleTaskSave}
        onCancelEdit={resetTaskForm}
        onClose={closeTasksOverlay}
        onViewReminders={openReminderListFromTasksPanel}
        onCreateLinkedReminder={() => void startReminderForCurrentTask()}
      />

      {isImportOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
          onClick={closeImportOverlay}
        >
          <div
            className="my-auto flex max-h-[min(92vh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <h3 className="text-lg font-semibold">Import reminders JSON</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Paste either an array or an object with <code>reminders</code>.
              </p>
            </div>
            <form
              className="min-h-0 overflow-y-auto"
              onSubmit={handleJsonImport}
            >
              <div className="grid gap-4 px-5 py-5">
                <textarea
                  value={importJson}
                  onChange={(event) => setImportJson(event.target.value)}
                  rows={12}
                  placeholder='{"reminders":[{"title":"Gym","dueAt":"2026-04-12T08:00:00.000Z"}]}'
                  className="min-h-[18rem] w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                />
                {importStatus ? (
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {importStatus}
                  </p>
                ) : null}
                <div className="mt-1 flex gap-2">
                  <button
                    type="submit"
                    disabled={!importJson.trim() || isImporting}
                    className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isImporting ? "Importing..." : "Import"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setImportStatus(null);
                      closeImportOverlay();
                    }}
                    className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold"
                  >
                    Close
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {shareToast ? (
        <div
          className="pointer-events-none fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-[60] -translate-x-1/2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 shadow-lg dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          role="status"
          aria-live="polite"
        >
          {shareToast}
        </div>
      ) : null}

      {rescheduleReminder ? (
        <div
          className="fixed inset-0 z-[66] flex items-end justify-center bg-black/45 p-3 sm:items-center sm:p-4"
          onClick={() => setRescheduleReminder(null)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-600 dark:text-violet-300">
                Reschedule reminder
              </p>
              <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                {rescheduleReminder.title}
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Choose a new date and time.
              </p>
            </div>
            <div className="grid gap-4 px-5 py-5">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "+15m", minutes: 15 },
                  { label: "+1h", minutes: 60 },
                  { label: "Tomorrow", minutes: 24 * 60 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
                    onClick={() => {
                      const next = new Date();
                      next.setMinutes(next.getMinutes() + preset.minutes);
                      setRescheduleReminder((prev) =>
                        prev ? { ...prev, value: toDateTimeLocalValue(next.toISOString()), error: null } : prev,
                      );
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <label className="grid gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                Date &amp; time
                <input
                  type="datetime-local"
                  min={currentDateTimeLocalValue()}
                  value={rescheduleReminder.value}
                  onChange={(event) =>
                    setRescheduleReminder((prev) =>
                      prev ? { ...prev, value: event.target.value, error: null } : prev,
                    )
                  }
                  className="w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:[color-scheme:dark]"
                />
              </label>
              {rescheduleReminder.error ? (
                <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
                  {rescheduleReminder.error}
                </p>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void commitRescheduleReminder()}
                  className="flex-1 rounded-full bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500"
                >
                  Save new time
                </button>
                <button
                  type="button"
                  onClick={() => setRescheduleReminder(null)}
                  className="rounded-full border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showReminderSuccess ? (
        <div className="pointer-events-none fixed inset-0 z-[65] flex items-center justify-center">
          <div className="relative">
            <span className="absolute inset-0 rounded-full bg-emerald-400/35 animate-ping" />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-3xl text-white shadow-2xl ring-4 ring-emerald-200 dark:ring-emerald-900 animate-pulse">
              ✓
            </div>
          </div>
        </div>
      ) : null}

      {isBatchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
          onClick={closeBatchOverlay}
        >
          <div
            className="my-auto flex max-h-[min(92vh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <h3 className="text-lg font-semibold">Batch questions</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Paste an array of questions or an object with{" "}
                <code>questions</code>.
              </p>
            </div>
            <form
              className="min-h-0 overflow-y-auto"
              onSubmit={handleBatchQuestions}
            >
              <div className="grid gap-4 px-5 py-5">
                <textarea
                  value={batchJson}
                  onChange={(event) => setBatchJson(event.target.value)}
                  rows={12}
                  placeholder='{"questions":["What is due today?","Show missed reminders","What is next?"]}'
                  className="min-h-[18rem] w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                />
                {batchStatus ? (
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {batchStatus}
                  </p>
                ) : null}
                <div className="mt-1 flex gap-2">
                  <button
                    type="submit"
                    disabled={!batchJson.trim() || isBatchRunning}
                    className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isBatchRunning ? "Running..." : "Run batch"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBatchStatus(null);
                      closeBatchOverlay();
                    }}
                    className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold"
                  >
                    Close
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
