"use client";

import {
  buildBriefingNarrative,
  buildFollowUpQuestions,
  replaceFollowUpSlot,
  buildListRemindersReply,
  buildReminderSnapshot,
  getReminderBucket,
  inferListScopeFromMessage,
  isCompoundReminderQuestion,
  tryGroundedReminderAnswer,
  type FollowUpQuestion,
  type TaskItemBrief,
  type ReminderRecurrence,
  type ReminderItem,
} from "@repo/reminder";
import { useUser } from "@clerk/nextjs";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { getChatPlaceholderCycle } from "../../lib/chat-placeholder";
import { TypingPlaceholderOverlay } from "./typing-placeholder-overlay";
import { showDueReminderSystemNotification } from "../../lib/due-notifications-client";
import {
  showCollaborationNotification,
  shouldNotifyForCollaboration,
} from "../../lib/collaboration-notifications";
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

type ChatRole = "user" | "assistant" | "system";

interface ChatReplyToRef {
  id: string;
  content: string;
  role: ChatRole;
}

interface ChatMessageMeta {
  kind?: "due_reminder" | "briefing";
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
  targetTitle?: string;
  targetId?: string;
  scope?: "today" | "tomorrow" | "missed" | "done" | "pending" | "all";
}

interface AgentResponse {
  reply: string;
  action: AgentAction;
}
interface PendingCreateDraft {
  title?: string;
  notes?: string;
}

interface WorkspaceProps {
  userId: string;
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
};

const SHOW_SUGGESTED_QUESTIONS_KEY = "remindos:showSuggestedQuestions";

function usePersistentReminders(userId: string) {
  const [reminders, setReminders] = useState<ReminderItem[]>([]);

  useEffect(() => {
    setReminders([]);
    const load = async () => {
      try {
        const response = await fetch("/api/reminders");
        if (!response.ok) throw new Error("Failed to load reminders");
        const data = (await response.json()) as { reminders?: Array<Record<string, unknown>> };
        const parsed = (data.reminders ?? []).map((item) => fromApiReminder(item));
        setReminders(parsed);
      } catch {
        setReminders([]);
      }
    };
    void load();
  }, [userId]);

  const updateReminders = (updater: (prev: ReminderItem[]) => ReminderItem[]) => {
    setReminders((prev) => {
      return updater(prev);
    });
  };

  return [reminders, updateReminders] as const;
}

function dedupeMessagesById(messages: ChatMessage[]) {
  const map = new Map<string, ChatMessage>();
  for (const message of messages) {
    if (!message?.id) continue;
    map.set(message.id, message);
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
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

function mergeRemoteChat(local: ChatMessage[], remote: ChatMessage[]): ChatMessage[] {
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
      if (role !== "user" && role !== "assistant" && role !== "system") continue;
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
    const persistable = dedupeMessagesById(messages).filter((m) => !m.meta?.skipPersist);
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

interface TaskRow {
  id: string;
  title: string;
  notes?: string;
  dueAt?: string;
  status: "pending" | "done";
}

function fromApiTask(row: Record<string, unknown>): TaskRow {
  return {
    id: String(row._id ?? row.id ?? crypto.randomUUID()),
    title: String(row.title ?? ""),
    notes: typeof row.notes === "string" ? row.notes : undefined,
    dueAt: row.dueAt != null ? new Date(Number(row.dueAt)).toISOString() : undefined,
    status: row.status === "done" ? "done" : "pending",
  };
}

function taskBucket(task: TaskRow, now: Date): "missed" | "later" | "done" {
  if (task.status === "done") return "done";
  if (task.dueAt && new Date(task.dueAt).getTime() < now.getTime()) return "missed";
  return "later";
}

function fromApiReminder(item: Record<string, unknown>): ReminderItem {
  const access = item._access === "shared" ? "shared" : "owner";
  return {
    id: String(item._id ?? item.id ?? crypto.randomUUID()),
    title: String(item.title ?? ""),
    dueAt: new Date(Number(item.dueAt ?? Date.now())).toISOString(),
    notes: typeof item.notes === "string" ? item.notes : "",
    recurrence:
      item.recurrence === "daily" || item.recurrence === "weekly" || item.recurrence === "monthly"
        ? item.recurrence
        : "none",
    status: item.status === "done" ? "done" : "pending",
    createdAt: new Date(Number(item.createdAt ?? Date.now())).toISOString(),
    updatedAt: new Date(Number(item.updatedAt ?? Date.now())).toISOString(),
    access,
  };
}

function matchesReminder(reminder: ReminderItem, targetId?: string, targetTitle?: string) {
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
    d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate()
    && d.getHours() === now.getHours()
    && d.getMinutes() === now.getMinutes()
  );
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

function toReplyContextPayload(target: ChatMessage | null | undefined): ReplyContextPayload | undefined {
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

function ChatBubbleShell({
  children,
  onReply,
  onEdit,
  showEdit,
  actionAlign = "end",
  showActionsAlways = false,
}: {
  children: ReactNode;
  onReply: () => void;
  onEdit?: () => void;
  showEdit: boolean;
  actionAlign?: "start" | "center" | "end";
  showActionsAlways?: boolean;
}) {
  const touchStart = useRef({ x: 0, y: 0 });
  const justify =
    actionAlign === "center" ? "justify-center" : actionAlign === "start" ? "justify-start" : "justify-end";
  return (
    <div
      className="group relative"
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (t) touchStart.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const t = e.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - touchStart.current.x;
        const dy = t.clientY - touchStart.current.y;
        if (dx > 52 && Math.abs(dy) < 50) onReply();
      }}
    >
      {children}
      <div
        className={`mt-1 flex flex-wrap gap-2 ${justify} transition-opacity ${
          showActionsAlways ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        }`}
      >
        <button
          type="button"
          className="rounded-md px-1 text-[10px] font-semibold text-amber-200/95 hover:underline"
          onClick={onReply}
        >
          Reply
        </button>
        {showEdit && onEdit ? (
          <button
            type="button"
            className="rounded-md px-1 text-[10px] font-semibold text-emerald-100/95 hover:underline"
            onClick={onEdit}
          >
            Edit
          </button>
        ) : null}
      </div>
    </div>
  );
}

function extractInviteToken(text: string): string | null {
  const trimmed = text.trim();
  const fromUrl = trimmed.match(/[?&]invite=([^&\s#]+)/i);
  if (fromUrl?.[1]) return decodeURIComponent(fromUrl[1]);
  const acceptHex = trimmed.match(/\baccept\s+invite\s+([a-f\d]{16,64})\b/i);
  if (acceptHex?.[1]) return acceptHex[1];
  const plainHex = trimmed.match(/\b([a-f\d]{24,40})\b/i);
  if (plainHex?.[1] && /\b(accept|invite|join)\b/i.test(trimmed)) return plainHex[1];
  return null;
}

export function DashboardWorkspace({ userId }: WorkspaceProps) {
  const { user } = useUser();
  const searchParams = useSearchParams();
  const notifUrlHandledRef = useRef<string | null>(null);
  const [reminders, setReminders] = usePersistentReminders(userId);
  const [dueNotifPrefs, setDueNotifPrefs] = useState<DueNotificationPrefs>(() => loadDueNotificationPrefs());
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
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null);
  const [loadingTextIndex, setLoadingTextIndex] = useState(0);
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newRecurrence, setNewRecurrence] = useState<ReminderRecurrence>("none");
  const [newNotes, setNewNotes] = useState("");
  const [pendingCreateDraft, setPendingCreateDraft] = useState<PendingCreateDraft | null>(null);
  const [createFormError, setCreateFormError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [followUpQuestions, setFollowUpQuestions] = useState<FollowUpQuestion[]>([]);
  const [showSuggestedQuestions, setShowSuggestedQuestions] = useState(true);
  const [reminderListTab, setReminderListTab] = useState<
    "missed" | "today" | "tomorrow" | "upcoming" | "done"
  >("missed");
  const [isTasksOpen, setIsTasksOpen] = useState(false);
  const [taskTab, setTaskTab] = useState<"missed" | "pending" | "done">("pending");
  const [taskFormTitle, setTaskFormTitle] = useState("");
  const [taskFormDue, setTaskFormDue] = useState("");
  const [taskFormNotes, setTaskFormNotes] = useState("");
  const [taskFormError, setTaskFormError] = useState<string | null>(null);
  const [inviteLinkToast, setInviteLinkToast] = useState<string | null>(null);
  const inviteLinkToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const briefingRanRef = useRef(false);
  const briefingPlaybackActiveRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remindersRef = useRef(reminders);
  remindersRef.current = reminders;
  const listOpenRef = useRef(false);
  const [briefingStreaming, setBriefingStreaming] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  /** After clear chat, ignore poll merges briefly so in-flight GETs cannot restore deleted history. */
  const skipRemotePollMergeUntilRef = useRef(0);
  const isHistoryLoadedRef = useRef(false);

  messagesRef.current = messages;
  userIdRef.current = userId;
  isHistoryLoadedRef.current = isHistoryLoaded;

  /** Persists latest messages; uses sendBeacon/keepalive so a refresh does not drop unsaved debounced writes. */
  const flushChatHistoryToServer = useCallback(() => {
    if (!isHistoryLoadedRef.current) return;
    saveChatBackup(userIdRef.current, messagesRef.current);
    const deduped = dedupeMessagesById(messagesRef.current).filter((m) => !m.meta?.skipPersist);
    if (deduped.length === 0) return;
    const body = JSON.stringify({ messages: deduped });
    const url = "/api/chat/history";
    try {
      if (typeof navigator !== "undefined" && typeof Blob !== "undefined" && body.length < 55_000) {
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

  const runBriefingStream = useCallback(() => {
    if (!isHistoryLoaded || briefingPlaybackActiveRef.current) return;
    briefingPlaybackActiveRef.current = true;
    const full = buildBriefingNarrative(remindersRef.current, user?.firstName ?? null);
    const id = `briefing-${Date.now()}`;
    setBriefingStreaming(true);

    // Append briefing at the bottom so it stays in view (standard chat UX); no scroll-to-top wait.
    setMessages((prev) => {
      const rest = prev.filter((m) => m.id !== "starter" && m.meta?.kind !== "briefing");
      return [
        ...rest,
        {
          id,
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          meta: { kind: "briefing", skipPersist: true },
        },
      ];
    });

    let i = 0;
    const step = () => {
      i = Math.min(full.length, i + 2);
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, content: full.slice(0, i) } : m))
      );
      if (i < full.length) {
        window.setTimeout(step, 72);
      } else {
        briefingPlaybackActiveRef.current = false;
        setBriefingStreaming(false);
      }
    };
    window.setTimeout(step, 380);
  }, [isHistoryLoaded, user?.firstName]);

  const refreshReminders = useCallback(async () => {
    const response = await fetch("/api/reminders");
    if (!response.ok) return;
    const data = (await response.json()) as { reminders?: Array<Record<string, unknown>> };
    setReminders(() => (data.reminders ?? []).map((item) => fromApiReminder(item)));
  }, [setReminders]);

  const refreshRemindersRef = useRef(refreshReminders);
  refreshRemindersRef.current = refreshReminders;

  const refreshTasks = useCallback(async () => {
    const response = await fetch("/api/tasks");
    if (!response.ok) return;
    const data = (await response.json()) as { tasks?: Array<Record<string, unknown>> };
    setTasks((data.tasks ?? []).map((item) => fromApiTask(item)));
  }, []);

  useEffect(() => {
    void refreshTasks();
  }, [userId, refreshTasks]);

  useEffect(() => {
    try {
      if (typeof localStorage !== "undefined" && localStorage.getItem(SHOW_SUGGESTED_QUESTIONS_KEY) === "0") {
        setShowSuggestedQuestions(false);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const runReminderQuickAction = useCallback(
    async (reminderId: string, action: "delete" | "done" | "snooze") => {
      if (action === "delete") {
        await fetch(`/api/reminders/${reminderId}`, { method: "DELETE" });
      } else if (action === "done") {
        await fetch(`/api/reminders/${reminderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "done" }),
        });
      } else {
        await fetch(`/api/reminders/${reminderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dueAt: Date.now() + 60 * 60 * 1000 }),
        });
      }
      await refreshReminders();
    },
    [refreshReminders]
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
        setMessages([{ ...STARTER_MESSAGE, createdAt: new Date().toISOString() }]);

      const syncServer = (list: ChatMessage[]) => {
        const persistable = dedupeMessagesById(list).filter((m) => !m.meta?.skipPersist);
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
            item.id
            && item.content
            && item.createdAt
            && (item.role === "user" || item.role === "assistant" || item.role === "system")
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
            item.id
            && item.content
            && item.createdAt
            && (item.role === "user" || item.role === "assistant" || item.role === "system")
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
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content;
    const taskBrief: TaskItemBrief[] = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      dueAt: t.dueAt,
      status: t.status,
    }));
    setFollowUpQuestions(
      buildFollowUpQuestions({
        reminders,
        tasks: taskBrief,
        lastUserMessage: lastUser,
        firstName: user?.firstName,
      })
    );
  }, [messages, reminders, tasks, user?.firstName, briefingStreaming]);

  useEffect(() => {
    return () => {
      if (inviteLinkToastTimerRef.current) clearTimeout(inviteLinkToastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    briefingRanRef.current = false;
  }, [userId]);

  useEffect(() => {
    if (!isHistoryLoaded || briefingRanRef.current) return;
    const key = `remindos:briefingSession:${userId}`;
    try {
      if (sessionStorage.getItem(key)) {
        briefingRanRef.current = true;
        return;
      }
    } catch {
      /* ignore */
    }

    const timer = window.setTimeout(() => {
      if (briefingRanRef.current) return;
      briefingRanRef.current = true;
      try {
        sessionStorage.setItem(`remindos:briefingSession:${userId}`, "1");
      } catch {
        /* ignore */
      }
      runBriefingStream();
    }, 650);

    return () => window.clearTimeout(timer);
  }, [isHistoryLoaded, userId, runBriefingStream]);

  useEffect(() => {
    const openR = () => setIsListOpen(true);
    const openT = () => setIsTasksOpen(true);
    window.addEventListener("dashboard:open-reminders", openR);
    window.addEventListener("dashboard:open-tasks", openT);
    return () => {
      window.removeEventListener("dashboard:open-reminders", openR);
      window.removeEventListener("dashboard:open-tasks", openT);
    };
  }, []);

  useEffect(() => {
    const o = searchParams.get("open");
    if (o === "reminders") setIsListOpen(true);
    if (o === "tasks") setIsTasksOpen(true);
    if (o && typeof window !== "undefined") {
      window.history.replaceState({}, "", "/dashboard");
    }
  }, [searchParams]);

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return;
    const id = requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [messages, isLoading, briefingStreaming]);

  useEffect(() => {
    const openSnapshot = () => setIsSnapshotOpen(true);
    window.addEventListener("dashboard:snapshot-open", openSnapshot);
    return () => window.removeEventListener("dashboard:snapshot-open", openSnapshot);
  }, []);

  const inviteQueryParam = searchParams.get("invite");

  useEffect(() => {
    const token = inviteQueryParam?.trim();
    if (!token || !isHistoryLoaded) return;

    const handledKey = `remindos:inviteUiHandled:${token}`;
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(handledKey)) {
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", "/dashboard");
      }
      return;
    }

    // Strip ?invite= from the URL immediately so this effect does not re-fire in a loop
    // (each run would otherwise append another error/success message).
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", "/dashboard");
    }

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/reminders/share/${encodeURIComponent(token)}`, {
          method: "POST",
        });
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
              content: "Could not accept the invite. Try again from chat with the link.",
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

  useEffect(() => {
    if (!isHistoryLoaded) return;
    for (const m of messages) {
      if (m.role !== "system") continue;
      if (!/\bwas accepted by\b|\byou joined\b/i.test(m.content)) continue;
      if (!shouldNotifyForCollaboration(m.id, m.createdAt)) continue;
      const title = /\bwas accepted by\b/i.test(m.content) ? "Reminder shared" : "Shared reminder";
      void showCollaborationNotification(title, m.content.slice(0, 200), `collab-${m.id}`);
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
      if (typeof window !== "undefined") window.history.replaceState({}, "", "/dashboard");
      return;
    }
    if (act !== "done" && act !== "snooze" && act !== "delete") return;
    notifUrlHandledRef.current = sig;
    void runReminderQuickAction(rid, act).finally(() => {
      if (typeof window !== "undefined") window.history.replaceState({}, "", "/dashboard");
    });
  }, [searchParams, runReminderQuickAction]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const nav = navigator.serviceWorker;
    const handler = (event: MessageEvent) => {
      const d = event.data as { type?: string; action?: string; reminderId?: string };
      if (d?.type !== "REMINDER_NOTIF" || !d.reminderId) return;
      const a = d.action ?? "open";
      if (a === "open") return;
      if (a === "done" || a === "snooze" || a === "delete") {
        void runReminderQuickAction(d.reminderId, a);
      }
    };
    nav.addEventListener("message", handler);
    return () => nav.removeEventListener("message", handler);
  }, [runReminderQuickAction]);

  useEffect(() => {
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("remindos:dueNotifBannerDismissed") === "1") {
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
          if (typeof navigator !== "undefined" && navigator.vibrate && isCompactViewport()) {
            navigator.vibrate(80);
          }
        }

        if (
          shouldShowSystemDueNotification(dueNotifPrefs)
          && !readNotifDueSent(key)
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

  const snapshot = useMemo(() => buildReminderSnapshot(reminders), [reminders]);

  const placeholderCycleLines = useMemo(
    () =>
      getChatPlaceholderCycle({
        reminders,
        messages,
        firstName: user?.firstName,
      }),
    [reminders, messages, user?.firstName]
  );

  const grouped = useMemo(() => {
    return {
      missed: reminders.filter((r) => getReminderBucket(r) === "missed"),
      today: reminders.filter((r) => getReminderBucket(r) === "today"),
      tomorrow: reminders.filter((r) => getReminderBucket(r) === "tomorrow"),
      upcoming: reminders.filter((r) => getReminderBucket(r) === "upcoming"),
      done: reminders.filter((r) => getReminderBucket(r) === "done"),
    };
  }, [reminders]);

  useEffect(() => {
    if (isListOpen && !listOpenRef.current) {
      const order = ["missed", "today", "tomorrow", "upcoming", "done"] as const;
      const hit = order.find((k) => grouped[k].length > 0) ?? "missed";
      setReminderListTab(hit);
    }
    listOpenRef.current = isListOpen;
  }, [isListOpen, grouped]);

  const tasksGrouped = useMemo(() => {
    const now = new Date();
    return {
      missed: tasks.filter((t) => taskBucket(t, now) === "missed"),
      pending: tasks.filter((t) => t.status === "pending" && taskBucket(t, now) !== "missed"),
      done: tasks.filter((t) => t.status === "done"),
    };
  }, [tasks]);


  const applyAction = (action: AgentAction) => {
    if (action.type === "create_reminder" && action.title && action.dueAt) {
      setPendingCreateDraft(null);
      const title = action.title;
      const dueAt = action.dueAt;
      const isDuplicate = reminders.some(
        (item) =>
          item.status === "pending"
          && item.title.trim().toLowerCase() === title.trim().toLowerCase()
          && new Date(item.dueAt).getTime() === new Date(dueAt).getTime()
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
          }),
        });
        if (res.ok) await refreshReminders();
      })();
      return;
    }

    if (action.type === "mark_done") {
      const target = reminders.find((r) =>
        matchesReminder(r, action.targetId, action.targetTitle)
      );
      if (!target) return;
      void fetch(`/api/reminders/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      }).then(() => void refreshReminders());
      return;
    }

    if (action.type === "delete_reminder") {
      const target = reminders.find((r) =>
        matchesReminder(r, action.targetId, action.targetTitle)
      );
      if (!target) return;
      void fetch(`/api/reminders/${target.id}`, { method: "DELETE" }).then(() =>
        void refreshReminders()
      );
      return;
    }

    if (action.type === "reschedule_reminder" && action.dueAt) {
      const target = reminders.find((r) =>
        matchesReminder(r, action.targetId, action.targetTitle)
      );
      if (!target) return;
      void fetch(`/api/reminders/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueAt: new Date(action.dueAt).getTime() }),
      }).then(() => void refreshReminders());
    }

    if (action.type === "clarify") {
      setPendingCreateDraft({
        title: action.title,
        notes: action.notes,
      });
    }
  };

  const looksLikeYes = (value: string) => /^(yes|yup|yeah|ok|okay|sure|haan|han)$/i.test(value.trim());
  const hasDateOrTimeHint = (value: string) =>
    /\b(today|tomorrow|tmrw|tomorow|tommarow|day after tomorrow|after tomorrow|noon|midnight)\b/i.test(value)
    || /\b\d{1,2}(:\d{2})?\s?([ap]\.?m\.?)\b/i.test(value)
    || /\b\d{1,2}:\d{2}\b/.test(value);

  const handleChatSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = input.trim();
    if (!prompt || isLoading) return;

    if (editingMessageId) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === editingMessageId && m.role === "user"
            ? {
                ...m,
                content: prompt,
                meta: { ...m.meta, editedAt: new Date().toISOString() },
              }
            : m
        )
      );
      setInput("");
      setEditingMessageId(null);
      setReplyTarget(null);
      return;
    }

    if (briefingStreaming) return;

    const replySnapshot = replyTarget;

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

    const replyPayload = toReplyContextPayload(replySnapshot);

    try {
      const inviteToken = extractInviteToken(prompt);
      if (inviteToken) {
        const res = await fetch(`/api/reminders/share/${encodeURIComponent(inviteToken)}`, {
          method: "POST",
        });
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

      const lastAssistant = [...messages].reverse().find((item) => item.role === "assistant")?.content ?? "";

      if (pendingCreateDraft && looksLikeYes(prompt)) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content:
              "Please send date and time in one line, like: tomorrow at 8:00 PM. I will create it directly.",
            createdAt: new Date().toISOString(),
          },
        ]);
        return;
      }

      if (pendingCreateDraft && !hasDateOrTimeHint(prompt)) {
        setPendingCreateDraft((prev) => ({ ...(prev ?? {}), title: prompt.trim() }));
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content:
              "Got it. Now send only date and time, for example: tomorrow at 8:00 PM.",
            createdAt: new Date().toISOString(),
          },
        ]);
        return;
      }

      if (pendingCreateDraft && hasDateOrTimeHint(prompt)) {
        const rebuiltPrompt = `Create reminder ${pendingCreateDraft.title ?? "untitled"} ${prompt}`;
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: rebuiltPrompt,
            reminders,
            ...clientTimeZonePayload(),
            ...(replyPayload ? { replyContext: replyPayload } : {}),
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
        return;
      }

      if (/^\s*create(\s+a)?\s+reminder\s*$/i.test(prompt)) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content:
              "Send everything in one line: title + date + time. Example: create reminder cli testing tomorrow at 8 PM.",
            createdAt: new Date().toISOString(),
          },
        ]);
        return;
      }

      if (looksLikeYes(prompt) && /would you like to create one\?/i.test(lastAssistant)) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content:
              "Great. Send it in one message with title + time, for example: create reminder cli testing tomorrow at 8 PM.",
            createdAt: new Date().toISOString(),
          },
        ]);
        return;
      }

      const listScope = inferListScopeFromMessage(prompt);
      if (listScope && !isCompoundReminderQuestion(prompt)) {
        const listReply = buildListRemindersReply(
          reminders,
          listScope,
          new Date(),
          5,
          clientTimeZonePayload()
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
          message: prompt,
          reminders,
          ...clientTimeZonePayload(),
          ...(replyPayload ? { replyContext: replyPayload } : {}),
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
      const grounded = tryGroundedReminderAnswer(prompt, reminders, new Date(), clientTimeZonePayload());
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            grounded
            ?? "I could not reach the assistant. Check your connection and try again.",
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const resetReminderForm = () => {
    setNewTitle("");
    setNewDate("");
    setNewTime("");
    setNewRecurrence("none");
    setNewNotes("");
    setEditingReminderId(null);
  };

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
        setImportStatus("Invalid JSON. Please paste a valid JSON object or array.");
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
      const starter: ChatMessage = { ...STARTER_MESSAGE, createdAt: new Date().toISOString() };
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

  const showInviteLinkToast = useCallback((message: string) => {
    setInviteLinkToast(message);
    if (inviteLinkToastTimerRef.current) clearTimeout(inviteLinkToastTimerRef.current);
    inviteLinkToastTimerRef.current = setTimeout(() => {
      setInviteLinkToast(null);
      inviteLinkToastTimerRef.current = null;
    }, 3200);
  }, []);

  const copyReminderInviteLink = async (reminderId: string) => {
    try {
      const response = await fetch(`/api/reminders/${reminderId}/invite`, { method: "POST" });
      if (!response.ok) {
        showInviteLinkToast("Could not get invite link. Try again.");
        return;
      }
      const data = (await response.json()) as { url?: string };
      if (data.url && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(data.url);
        showInviteLinkToast("Link copied to clipboard");
      } else {
        showInviteLinkToast("Could not copy link.");
      }
    } catch {
      showInviteLinkToast("Could not copy link.");
    }
  };

  const resolveDueLine = (messageId: string, line: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, meta: undefined, content: line } : m))
    );
  };

  const handleDueReminderAction = async (
    messageId: string,
    reminderId: string,
    action: "delete" | "done" | "snooze" | "reschedule"
  ) => {
    const title = reminders.find((x) => x.id === reminderId)?.title ?? "Reminder";
    try {
      if (action === "delete") {
        await runReminderQuickAction(reminderId, "delete");
        resolveDueLine(messageId, `Deleted "${title}".`);
        return;
      }
      if (action === "done") {
        await runReminderQuickAction(reminderId, "done");
        resolveDueLine(messageId, `Marked "${title}" as done.`);
        return;
      }
      if (action === "snooze") {
        await runReminderQuickAction(reminderId, "snooze");
        resolveDueLine(messageId, `Snoozed "${title}" by one hour.`);
        return;
      }
      const raw = typeof window !== "undefined" ? window.prompt("New date and time (e.g. 2026-04-12T17:00)", "") : "";
      if (raw == null || !raw.trim()) return;
      let dueMs = Date.parse(raw.trim());
      if (Number.isNaN(dueMs)) {
        dueMs = Date.parse(`${new Date().toDateString()} ${raw.trim()}`);
      }
      if (Number.isNaN(dueMs)) {
        resolveDueLine(messageId, `Could not parse that time for "${title}".`);
        return;
      }
      await fetch(`/api/reminders/${reminderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueAt: dueMs }),
      });
      await refreshReminders();
      resolveDueLine(messageId, `Rescheduled "${title}" to ${new Date(dueMs).toLocaleString()}.`);
    } catch {
      resolveDueLine(messageId, `Something went wrong updating "${title}".`);
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
      now.getDate()
    ).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(
      2,
      "0"
    )}`;
    anchor.href = url;
    anchor.download = `remindos-chat-${stamp}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const parseBatchQuestions = (payload: unknown): string[] => {
    if (Array.isArray(payload)) {
      return payload
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
    }

    if (!payload || typeof payload !== "object") return [];
    const obj = payload as { questions?: unknown; items?: unknown; prompts?: unknown };
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
        setBatchStatus("Invalid JSON. Please paste a valid JSON object or array.");
        return;
      }

      const questions = parseBatchQuestions(parsed);
      if (questions.length === 0) {
        setBatchStatus("No valid questions found. Use an array or { questions: [...] }.");
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
            body: JSON.stringify({ message: question, reminders, ...clientTimeZonePayload() }),
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
          const grounded = tryGroundedReminderAnswer(question, reminders, new Date(), clientTimeZonePayload());
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content:
                grounded
                ?? "I could not process this item right now. Continuing with next question.",
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

  const openCreateModal = () => {
    resetReminderForm();
    setCreateFormError(null);
    setIsCreateOpen(true);
  };

  const openEditModal = (reminder: ReminderItem) => {
    setCreateFormError(null);
    const dueDate = new Date(reminder.dueAt);
    const datePart = dueDate.toISOString().slice(0, 10);
    const timePart = dueDate.toTimeString().slice(0, 5);
    setEditingReminderId(reminder.id);
    setNewTitle(reminder.title);
    setNewDate(datePart);
    setNewTime(timePart);
    setNewRecurrence(reminder.recurrence ?? "none");
    setNewNotes(reminder.notes ?? "");
    setIsListOpen(false);
    setIsCreateOpen(true);
  };

  const handleManualCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newTitle.trim() || !newDate || !newTime) return;
    setCreateFormError(null);
    const dueAt = new Date(`${newDate}T${newTime}`).toISOString();
    const dueAtMs = new Date(dueAt).getTime();
    if (!Number.isFinite(dueAtMs)) {
      setCreateFormError("Invalid date or time.");
      return;
    }

    if (editingReminderId) {
      try {
        const res = await fetch(`/api/reminders/${editingReminderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: newTitle.trim(),
            dueAt: dueAtMs,
            recurrence: newRecurrence,
            notes: newNotes.trim() ? newNotes.trim() : undefined,
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
          item.status === "pending"
          && item.title.trim().toLowerCase() === newTitle.trim().toLowerCase()
          && new Date(item.dueAt).getTime() === dueAtMs
      );
      if (isDuplicate) {
        resetReminderForm();
        setIsCreateOpen(false);
        return;
      }

      try {
        const res = await fetch("/api/reminders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: newTitle.trim(),
            dueAt: dueAtMs,
            recurrence: newRecurrence,
            notes: newNotes.trim() ? newNotes.trim() : undefined,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; created?: boolean };
        if (!res.ok) {
          setCreateFormError(data.error ?? "Could not save reminder.");
          return;
        }
        await refreshReminders();
      } catch {
        setCreateFormError("Network error. Try again.");
        return;
      }
    }
    resetReminderForm();
    setCreateFormError(null);
    setIsCreateOpen(false);
  };

  const persistDueNotifPrefs = useCallback((patch: Partial<DueNotificationPrefs>) => {
    setDueNotifPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveDueNotificationPrefs(next);
      return next;
    });
  }, []);

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

  const handleTaskCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!taskFormTitle.trim()) return;
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
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: taskFormTitle.trim(),
          notes: taskFormNotes.trim() ? taskFormNotes.trim() : undefined,
          dueAt,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setTaskFormError(data.error ?? "Could not save task.");
        return;
      }
      setTaskFormTitle("");
      setTaskFormDue("");
      setTaskFormNotes("");
      await refreshTasks();
    } catch {
      setTaskFormError("Network error. Try again.");
    }
  };

  return (
    <>
      <section className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-transparent px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1 sm:px-4 lg:mx-auto lg:max-w-3xl lg:px-6">
        {typeof Notification !== "undefined"
        && Notification.permission === "default"
        && !dueNotifBannerDismissed ? (
          <div className="mb-2 flex flex-col gap-2 rounded-xl border border-violet-400/35 bg-violet-950/50 px-3 py-2 text-xs text-violet-50 shadow-sm lg:hidden">
            <p className="leading-snug">
              Allow notifications to get an instant alert when a reminder’s time hits—then use Done, Snooze, or Delete
              from the notification (best when this app is installed to your home screen).
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
                className="rounded-full border border-white/25 px-3 py-1.5 text-xs font-semibold text-violet-100 hover:bg-white/10"
              >
                Not now
              </button>
            </div>
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-[linear-gradient(180deg,#020617_0%,#0b1730_100%)] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
          <div ref={chatScrollRef} className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-none sm:p-4">
          <div className="grid gap-3">
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
                  >
                    <div className="mx-auto max-w-[92%] rounded-2xl border border-amber-400/35 bg-amber-950/40 px-3 py-2 text-center text-xs text-amber-50 shadow-sm">
                      <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                      <p className="mt-1 text-[10px] text-amber-200/80">
                        {new Date(message.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </ChatBubbleShell>
                );
              }
              const dueMeta = message.meta?.kind === "due_reminder" ? message.meta : null;
              const replyQuote = message.meta?.replyTo;
              const bubbleClass =
                message.role === "user"
                  ? "ml-auto max-w-[92%] rounded-3xl rounded-br-lg bg-emerald-600 px-4 py-2 text-sm text-white shadow-sm"
                  : "max-w-[92%] rounded-3xl rounded-bl-lg bg-white px-4 py-2 text-sm text-slate-800 shadow-sm dark:bg-slate-800 dark:text-slate-100";

              const inner = (
                <div className={bubbleClass}>
                  {replyQuote ? (
                    <div
                      className={`mb-2 rounded-lg border-l-4 border-amber-400/95 pl-2.5 ${
                        message.role === "user" ? "bg-emerald-800/45" : "bg-slate-100/90 dark:bg-slate-900/80"
                      }`}
                    >
                      <p
                        className={`text-[10px] font-semibold ${
                          message.role === "user" ? "text-amber-100" : "text-amber-700 dark:text-amber-200"
                        }`}
                      >
                        {chatReplyLabel(replyQuote.role)}
                      </p>
                      <p
                        className={`line-clamp-5 whitespace-pre-wrap text-[11px] leading-snug ${
                          message.role === "user" ? "text-emerald-50/95" : "text-slate-700 dark:text-slate-200"
                        }`}
                      >
                        {replyQuote.content}
                      </p>
                    </div>
                  ) : null}
                  {dueMeta?.reminderId ? (
                    <>
                      <p className="font-semibold text-slate-900 dark:text-white">Reminder due</p>
                      <p className="mt-1 whitespace-pre-wrap leading-relaxed text-slate-800 dark:text-slate-100">
                        {dueMeta.title}
                      </p>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                        {new Date(dueMeta.dueAt ?? Date.now()).toLocaleString()}
                      </p>
                      {dueMeta.notes ? (
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{dueMeta.notes}</p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            void handleDueReminderAction(message.id, dueMeta.reminderId!, "done")
                          }
                          className="rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
                        >
                          Done
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleDueReminderAction(message.id, dueMeta.reminderId!, "snooze")
                          }
                          className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                        >
                          Snooze 1h
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleDueReminderAction(message.id, dueMeta.reminderId!, "reschedule")
                          }
                          className="rounded-full border border-violet-400 bg-violet-50 px-3 py-1 text-[11px] font-semibold text-violet-900 hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-950/60 dark:text-violet-100"
                        >
                          Set new time
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleDueReminderAction(message.id, dueMeta.reminderId!, "delete")
                          }
                          className="rounded-full bg-rose-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-rose-500"
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      {message.meta?.kind === "briefing" ? (
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          Session briefing
                        </p>
                      ) : null}
                      <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                    </>
                  )}
                  <div
                    className={`mt-2 flex flex-wrap items-center gap-2 ${
                      message.role === "user" ? "justify-between gap-3" : ""
                    }`}
                  >
                    <p
                      className={`flex min-w-0 flex-wrap items-center gap-2 text-[10px] ${
                        message.role === "user" ? "text-emerald-100" : "text-slate-500 dark:text-slate-400"
                      }`}
                    >
                      <span>
                        {new Date(message.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {message.meta?.editedAt && message.role === "user" ? (
                        <span className="rounded bg-emerald-800/60 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-emerald-100/90">
                          Edited
                        </span>
                      ) : null}
                    </p>
                    {message.role === "user" && !dueMeta?.reminderId ? (
                      <button
                        type="button"
                        onClick={startEditUser}
                        className="shrink-0 rounded-lg border border-emerald-300/50 bg-emerald-800/55 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-emerald-800/85 active:scale-[0.98]"
                      >
                        Edit
                      </button>
                    ) : null}
                  </div>
                </div>
              );

              return (
                <ChatBubbleShell
                  key={message.id}
                  onReply={startReplyTo}
                  onEdit={undefined}
                  showEdit={false}
                  actionAlign={message.role === "user" ? "end" : "start"}
                  showActionsAlways={message.role === "user"}
                >
                  {inner}
                </ChatBubbleShell>
              );
            })}
            {isLoading ? (
              <div className="max-w-[84%] rounded-3xl rounded-bl-lg bg-white px-4 py-2 text-sm text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-100">
                {loadingTexts[loadingTextIndex]}
              </div>
            ) : null}
          </div>
          </div>

        {showSuggestedQuestions && followUpQuestions.length > 0 ? (
          <div className="shrink-0 border-t border-white/10 px-3 pb-2 pt-2 sm:px-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Suggested
            </p>
            <div className="flex flex-col gap-2">
              {followUpQuestions.map((q, i) => (
                <button
                  key={`${q.kind}-${i}-${q.text.slice(0, 24)}`}
                  type="button"
                  disabled={briefingStreaming}
                  onClick={() => {
                    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content;
                    const taskBrief: TaskItemBrief[] = tasks.map((t) => ({
                      id: t.id,
                      title: t.title,
                      dueAt: t.dueAt,
                      status: t.status,
                    }));
                    setInput(q.text);
                    setFollowUpQuestions((prev) =>
                      replaceFollowUpSlot(prev, i as 0 | 1 | 2, {
                        reminders,
                        tasks: taskBrief,
                        lastUserMessage: lastUser,
                        firstName: user?.firstName,
                      })
                    );
                  }}
                  className={`w-full rounded-2xl border px-3 py-2.5 text-left text-xs font-medium leading-snug transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 ${
                    q.kind === "action"
                      ? "border-emerald-500/50 bg-emerald-950/35 text-emerald-50 hover:bg-emerald-900/45"
                      : "border-slate-600/80 bg-slate-900/50 text-slate-100 hover:bg-slate-800/65"
                  }`}
                >
                  {q.text}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <form
          onSubmit={handleChatSubmit}
          className={`shrink-0 border-t border-white/10 bg-slate-950/40 p-2 sm:p-3 ${
            briefingComposerLocked ? "opacity-90" : ""
          }`}
        >
          {editingMessageId ? (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-violet-500/35 bg-violet-950/45 px-3 py-2 text-xs text-violet-100">
              <span className="font-medium">Editing your message</span>
              <button
                type="button"
                className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold text-violet-200 hover:bg-violet-900/60"
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
            <div className="mb-2 flex items-start gap-2 rounded-xl border border-amber-500/35 bg-amber-950/35 px-3 py-2">
              <div className="min-w-0 flex-1 border-l-4 border-amber-400 pl-2.5">
                <p className="text-[10px] font-semibold text-amber-200">{chatReplyLabel(replyTarget.role)}</p>
                <p className="line-clamp-4 whitespace-pre-wrap text-xs leading-snug text-slate-100">
                  {replyTarget.content}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-full px-2 py-0.5 text-lg leading-none text-slate-300 hover:bg-white/10 hover:text-white"
                aria-label="Cancel reply"
                onClick={() => setReplyTarget(null)}
              >
                ×
              </button>
            </div>
          ) : null}
          <div className="flex w-full min-w-0 flex-wrap items-end gap-2">
            <button
              type="button"
              onClick={() => runBriefingStream()}
              disabled={!isHistoryLoaded || briefingStreaming || isLoading}
              className="shrink-0 rounded-xl border border-violet-400/40 bg-violet-950/50 px-3 py-2.5 text-xs font-semibold text-violet-100 shadow-sm transition hover:bg-violet-900/60 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Briefing
            </button>
            <div className="relative min-h-[2.75rem] min-w-0 flex-1 rounded-xl border border-slate-600/80 bg-slate-900/60 px-2 py-1.5 dark:border-slate-600">
              {!input.trim() ? (
                <div
                  className="pointer-events-none absolute left-2 top-1.5 z-0 min-h-[2.5rem] max-w-[calc(100%-0.5rem)] pr-2 text-sm leading-relaxed text-slate-500"
                  aria-hidden={!briefingStreaming}
                >
                  {briefingStreaming ? (
                    <span className="block text-slate-400">Briefing in progress…</span>
                  ) : (
                    <TypingPlaceholderOverlay
                      show={!input.trim() && !isLoading}
                      lines={placeholderCycleLines}
                      className="block whitespace-pre-wrap break-words"
                    />
                  )}
                </div>
              ) : null}
              <textarea
                rows={1}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder=""
                readOnly={briefingComposerLocked && !editingMessageId}
                aria-busy={briefingStreaming}
                aria-label={briefingStreaming ? "Message (wait for briefing to finish)" : "Message"}
                className={`relative z-10 max-h-32 min-h-11 w-full resize-none bg-transparent px-2 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 ${
                  briefingComposerLocked && !editingMessageId ? "cursor-wait caret-transparent" : ""
                }`}
              />
            </div>
            <button
              type="submit"
              disabled={!input.trim() || isLoading || (briefingStreaming && !editingMessageId)}
              className="h-11 w-11 shrink-0 rounded-full bg-emerald-600 text-base font-semibold text-white shadow-md transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Send message"
            >
              {isLoading ? "…" : briefingStreaming && !editingMessageId ? "…" : "➤"}
            </button>
          </div>
        </form>
        </div>
      </section>

      {isSnapshotOpen && (
        <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setIsSnapshotOpen(false)}>
          <aside
            className="absolute right-0 top-0 flex h-full w-[92%] max-w-sm flex-col overflow-hidden border-l border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] dark:border-slate-800 dark:bg-slate-950">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Menu</h2>
              <button
                type="button"
                onClick={() => setIsSnapshotOpen(false)}
                className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-800 dark:border-slate-600 dark:text-slate-100"
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="flex aspect-square min-h-[4.25rem] flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-1 text-center dark:border-slate-700 dark:bg-slate-950">
                <span className="text-xl font-bold tabular-nums leading-none text-slate-900 dark:text-white">
                  {snapshot.pending}
                </span>
                <span className="mt-1 text-[10px] font-semibold uppercase leading-tight tracking-wide text-slate-500 dark:text-slate-400">
                  Left
                </span>
              </div>
              <div className="flex aspect-square min-h-[4.25rem] flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-1 text-center dark:border-slate-700 dark:bg-slate-950">
                <span className="text-xl font-bold tabular-nums leading-none text-slate-900 dark:text-white">
                  {snapshot.today}
                </span>
                <span className="mt-1 text-[10px] font-semibold uppercase leading-tight tracking-wide text-slate-500 dark:text-slate-400">
                  Today
                </span>
              </div>
              <div className="flex aspect-square min-h-[4.25rem] flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-1 text-center dark:border-slate-700 dark:bg-slate-950">
                <span className="text-xl font-bold tabular-nums leading-none text-slate-900 dark:text-white">
                  {snapshot.missed}
                </span>
                <span className="mt-1 text-[10px] font-semibold uppercase leading-tight tracking-wide text-slate-500 dark:text-slate-400">
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
                    localStorage.setItem(SHOW_SUGGESTED_QUESTIONS_KEY, on ? "1" : "0");
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
                    checked={dueNotifPrefs.enabled && Notification.permission === "granted"}
                    onChange={(e) => {
                      if (e.target.checked) void requestDueNotificationPermission();
                      else persistDueNotifPrefs({ enabled: false });
                    }}
                    disabled={typeof Notification !== "undefined" && Notification.permission === "denied"}
                  />
                  <span>Due-time alerts</span>
                </label>
                {typeof Notification !== "undefined" && Notification.permission === "default" ? (
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
                      onChange={(e) => persistDueNotifPrefs({ notifyWhenForeground: e.target.checked })}
                      disabled={!dueNotifPrefs.enabled || Notification.permission !== "granted"}
                    />
                    <span>Also when this tab is visible</span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 text-slate-800 dark:text-slate-100">
                    <input
                      type="checkbox"
                      className="mt-0.5 shrink-0"
                      checked={dueNotifPrefs.desktopEnabled}
                      onChange={(e) => persistDueNotifPrefs({ desktopEnabled: e.target.checked })}
                      disabled={!dueNotifPrefs.enabled || Notification.permission !== "granted"}
                    />
                    <span>On large / desktop screens</span>
                  </label>
                </div>
              </details>
              {typeof Notification !== "undefined" && Notification.permission === "denied" ? (
                <p className="mt-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                  Notifications blocked—enable in browser settings.
                </p>
              ) : null}
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsSnapshotOpen(false);
                  openCreateModal();
                }}
                className="flex aspect-square min-h-[3.75rem] flex-col items-center justify-center rounded-xl bg-violet-600 px-1 py-1.5 text-center text-[11px] font-semibold leading-tight text-white shadow-sm transition hover:bg-violet-500 active:scale-[0.99]"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSnapshotOpen(false);
                  setIsListOpen(true);
                }}
                className="flex aspect-square min-h-[3.75rem] flex-col items-center justify-center rounded-xl bg-violet-600 px-1 py-1.5 text-center text-[11px] font-semibold leading-tight text-white shadow-sm transition hover:bg-violet-500 active:scale-[0.99]"
              >
                Reminders
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSnapshotOpen(false);
                  setTaskFormError(null);
                  void refreshTasks();
                  setIsTasksOpen(true);
                }}
                className="flex aspect-square min-h-[3.75rem] flex-col items-center justify-center rounded-xl bg-violet-600 px-1 py-1.5 text-center text-[11px] font-semibold leading-tight text-white shadow-sm transition hover:bg-violet-500 active:scale-[0.99]"
              >
                Tasks
              </button>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsSnapshotOpen(false);
                  setImportStatus(null);
                  setIsImportOpen(true);
                }}
                className="flex aspect-square min-h-[3.75rem] flex-col items-center justify-center rounded-xl border border-slate-200 bg-white px-1 py-1.5 text-center text-[11px] font-semibold leading-tight text-slate-800 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Import
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSnapshotOpen(false);
                  handleExportChat();
                }}
                disabled={isLoading || messages.length === 0}
                className="flex aspect-square min-h-[3.75rem] flex-col items-center justify-center rounded-xl border border-slate-200 bg-white px-1 py-1.5 text-center text-[11px] font-semibold leading-tight text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Export
              </button>
              <button
                type="button"
                onClick={() => {
                  setBatchStatus(null);
                  setIsSnapshotOpen(false);
                  setIsBatchOpen(true);
                }}
                disabled={isBatchRunning || isLoading}
                className="flex aspect-square min-h-[3.75rem] flex-col items-center justify-center rounded-xl border border-slate-200 bg-white px-1 py-1.5 text-center text-[11px] font-semibold leading-tight text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Batch
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setIsSnapshotOpen(false);
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <h3 className="text-lg font-semibold">
                {editingReminderId ? "Edit reminder" : "Create reminder"}
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Add details, schedule, and recurrence.
              </p>
            </div>
            <form className="grid gap-4 px-5 py-5" onSubmit={handleManualCreate}>
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
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
                  Time
                  <input
                    type="time"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
              </div>
              <label className="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
                Repeat
                <select
                  value={newRecurrence}
                  onChange={(e) => setNewRecurrence(e.target.value as ReminderRecurrence)}
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
              {createFormError ? (
                <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
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
                    setIsCreateOpen(false);
                  }}
                  className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isListOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
          <div className="flex max-h-[min(92vh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:rounded-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <h3 className="text-base font-semibold sm:text-lg">Reminders</h3>
              <button
                type="button"
                onClick={() => setIsListOpen(false)}
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
                  ["done", "Done"],
                ] as const
              ).map(([key, label]) => (
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
                  {label}{" "}
                  <span className="opacity-80">({grouped[key].length})</span>
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="grid gap-3">
                {grouped[reminderListTab].length === 0 ? (
                  <p className="text-sm text-slate-500">Nothing in this tab.</p>
                ) : (
                  grouped[reminderListTab].map((reminder) => (
                    <article
                      key={reminder.id}
                      className="rounded-xl border border-slate-200 p-3 dark:border-slate-700 sm:p-4"
                    >
                      <p className="font-semibold">
                        {reminder.title}
                        {reminder.access === "shared" ? (
                          <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium uppercase text-sky-800 dark:bg-sky-900/50 dark:text-sky-200">
                            Shared
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
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{reminder.notes}</p>
                      ) : null}
                      {reminderListTab === "done" ? null : (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {reminder.access !== "shared" ? (
                            <button
                              type="button"
                              onClick={() => void copyReminderInviteLink(reminder.id)}
                              className="rounded-full border border-sky-400 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-900 dark:border-sky-700 dark:bg-sky-950/50 dark:text-sky-100"
                            >
                              Copy invite link
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
                              const nextStatus = reminder.status === "done" ? "pending" : "done";
                              void fetch(`/api/reminders/${reminder.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ status: nextStatus }),
                              }).then(() => void refreshReminders());
                            }}
                            className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white"
                          >
                            {reminder.status === "done" ? "Mark pending" : "Mark done"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void fetch(`/api/reminders/${reminder.id}`, {
                                method: "DELETE",
                              }).then(() => void refreshReminders());
                            }}
                            className="rounded-full bg-rose-600 px-3 py-1 text-xs font-semibold text-white"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </article>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {isTasksOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
          <div className="flex max-h-[min(92vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:rounded-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <h3 className="text-base font-semibold sm:text-lg">Tasks</h3>
              <button
                type="button"
                onClick={() => setIsTasksOpen(false)}
                className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold dark:border-slate-600"
              >
                Close
              </button>
            </div>
            <form
              className="shrink-0 space-y-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800"
              onSubmit={handleTaskCreate}
            >
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">New task</p>
              <input
                value={taskFormTitle}
                onChange={(e) => setTaskFormTitle(e.target.value)}
                placeholder="Title"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
              />
              <input
                type="datetime-local"
                value={taskFormDue}
                onChange={(e) => setTaskFormDue(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
              />
              <textarea
                value={taskFormNotes}
                onChange={(e) => setTaskFormNotes(e.target.value)}
                placeholder="Notes (optional)"
                rows={2}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
              />
              {taskFormError ? (
                <p className="text-xs text-rose-600 dark:text-rose-400">{taskFormError}</p>
              ) : null}
              <button
                type="submit"
                className="w-full rounded-full bg-teal-600 py-2 text-sm font-semibold text-white hover:bg-teal-500"
              >
                Add task
              </button>
            </form>
            <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 px-2 py-2 dark:border-slate-800">
              {(
                [
                  ["missed", "Missed"],
                  ["pending", "Upcoming"],
                  ["done", "Done"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTaskTab(key)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    taskTab === key
                      ? "bg-teal-600 text-white"
                      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  }`}
                >
                  {label}{" "}
                  <span className="opacity-80">
                    (
                    {key === "missed"
                      ? tasksGrouped.missed.length
                      : key === "pending"
                        ? tasksGrouped.pending.length
                        : tasksGrouped.done.length}
                    )
                  </span>
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="grid gap-3">
                {(taskTab === "missed"
                  ? tasksGrouped.missed
                  : taskTab === "pending"
                    ? tasksGrouped.pending
                    : tasksGrouped.done
                ).length === 0 ? (
                  <p className="text-sm text-slate-500">No tasks here.</p>
                ) : (
                  (taskTab === "missed"
                    ? tasksGrouped.missed
                    : taskTab === "pending"
                      ? tasksGrouped.pending
                      : tasksGrouped.done
                  ).map((task) => (
                    <article
                      key={task.id}
                      className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"
                    >
                      <p className="font-semibold">{task.title}</p>
                      {task.dueAt ? (
                        <p className="text-sm text-slate-500">
                          {taskTab === "missed" ? "Was due: " : "Due: "}
                          {new Date(task.dueAt).toLocaleString()}
                        </p>
                      ) : (
                        <p className="text-sm text-slate-500">No due date</p>
                      )}
                      {task.notes ? (
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{task.notes}</p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {task.status === "pending" ? (
                          <button
                            type="button"
                            onClick={() => {
                              void fetch(`/api/tasks/${task.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ status: "done" }),
                              }).then(() => void refreshTasks());
                            }}
                            className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white"
                          >
                            Mark done
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              void fetch(`/api/tasks/${task.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ status: "pending" }),
                              }).then(() => void refreshTasks());
                            }}
                            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold dark:border-slate-600"
                          >
                            Reopen
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            void fetch(`/api/tasks/${task.id}`, { method: "DELETE" }).then(() =>
                              void refreshTasks()
                            );
                          }}
                          className="rounded-full bg-rose-600 px-3 py-1 text-xs font-semibold text-white"
                        >
                          Delete
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {isImportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <h3 className="text-lg font-semibold">Import reminders JSON</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Paste either an array or an object with <code>reminders</code>.
              </p>
            </div>
            <form className="grid gap-4 px-5 py-5" onSubmit={handleJsonImport}>
              <textarea
                value={importJson}
                onChange={(event) => setImportJson(event.target.value)}
                rows={12}
                placeholder='{"reminders":[{"title":"Gym","dueAt":"2026-04-12T08:00:00.000Z"}]}'
                className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              {importStatus ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">{importStatus}</p>
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
                    setIsImportOpen(false);
                    setImportStatus(null);
                  }}
                  className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold"
                >
                  Close
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {inviteLinkToast ? (
        <div
          className="pointer-events-none fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-[60] -translate-x-1/2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 shadow-lg dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          role="status"
          aria-live="polite"
        >
          {inviteLinkToast}
        </div>
      ) : null}

      {isBatchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <h3 className="text-lg font-semibold">Batch questions</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Paste an array of questions or an object with <code>questions</code>.
              </p>
            </div>
            <form className="grid gap-4 px-5 py-5" onSubmit={handleBatchQuestions}>
              <textarea
                value={batchJson}
                onChange={(event) => setBatchJson(event.target.value)}
                rows={12}
                placeholder='{"questions":["What is due today?","Show missed reminders","What is next?"]}'
                className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              {batchStatus ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">{batchStatus}</p>
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
                    setIsBatchOpen(false);
                    setBatchStatus(null);
                  }}
                  className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold"
                >
                  Close
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
