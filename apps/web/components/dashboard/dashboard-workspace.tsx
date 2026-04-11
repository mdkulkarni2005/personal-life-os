"use client";

import {
  buildListRemindersReply,
  buildReminderSnapshot,
  getReminderBucket,
  inferListScopeFromMessage,
  isCompoundReminderQuestion,
  tryGroundedReminderAnswer,
  type ReminderRecurrence,
  type ReminderItem,
} from "@repo/reminder";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type ChatRole = "user" | "assistant" | "system";

interface ChatMessageMeta {
  kind?: "due_reminder";
  reminderId?: string;
  dueAt?: number;
  title?: string;
  notes?: string;
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
  const searchParams = useSearchParams();
  const [reminders, setReminders] = usePersistentReminders(userId);
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
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const refreshReminders = useCallback(async () => {
    const response = await fetch("/api/reminders");
    if (!response.ok) return;
    const data = (await response.json()) as { reminders?: Array<Record<string, unknown>> };
    setReminders(() => (data.reminders ?? []).map((item) => fromApiReminder(item)));
  }, [setReminders]);

  useEffect(() => {
    if (!isLoading) return;
    const interval = window.setInterval(() => {
      setLoadingTextIndex((prev) => (prev + 1) % loadingTexts.length);
    }, 2200);
    return () => window.clearInterval(interval);
  }, [isLoading]);

  useEffect(() => {
    const loadHistory = async () => {
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
          setMessages(dedupeMessagesById(parsed));
        } else {
          setMessages([{ ...STARTER_MESSAGE, createdAt: new Date().toISOString() }]);
        }
      } catch {
        setMessages([{ ...STARTER_MESSAGE, createdAt: new Date().toISOString() }]);
      } finally {
        setIsHistoryLoaded(true);
      }
    };
    void loadHistory();
  }, []);

  useEffect(() => {
    if (!isHistoryLoaded) return;
    const deduped = dedupeMessagesById(messages);
    void fetch("/api/chat/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: deduped }),
    });
  }, [messages, isHistoryLoaded]);

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, isLoading]);

  useEffect(() => {
    const openSnapshot = () => setIsSnapshotOpen(true);
    window.addEventListener("dashboard:snapshot-open", openSnapshot);
    return () => window.removeEventListener("dashboard:snapshot-open", openSnapshot);
  }, []);

  useEffect(() => {
    const token = searchParams.get("invite");
    if (!token?.trim() || !isHistoryLoaded) return;
    const storageKey = `remindos:inviteAccepted:${token}`;
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(storageKey)) {
      if (typeof window !== "undefined") window.history.replaceState({}, "", "/dashboard");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/reminders/share/${encodeURIComponent(token)}`, {
          method: "POST",
        });
        const data = (await res.json()) as { error?: string; title?: string };
        if (!cancelled && typeof window !== "undefined") {
          window.history.replaceState({}, "", "/dashboard");
        }
        if (cancelled) return;
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
        if (typeof sessionStorage !== "undefined") sessionStorage.setItem(storageKey, "1");
        await refreshReminders();
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
  }, [searchParams, isHistoryLoaded, refreshReminders]);

  useEffect(() => {
    if (!isHistoryLoaded) return;
    const tick = () => {
      const now = new Date();
      for (const r of reminders) {
        if (r.status !== "pending") continue;
        if (!isDueThisMinute(r.dueAt, now)) continue;
        const key = dueMinuteKey(r);
        if (readDueShown().has(key)) continue;
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
      }
    };
    tick();
    const id = window.setInterval(tick, 15000);
    return () => window.clearInterval(id);
  }, [reminders, isHistoryLoaded]);

  const snapshot = useMemo(() => buildReminderSnapshot(reminders), [reminders]);

  const grouped = useMemo(() => {
    return {
      missed: reminders.filter((r) => getReminderBucket(r) === "missed"),
      today: reminders.filter((r) => getReminderBucket(r) === "today"),
      tomorrow: reminders.filter((r) => getReminderBucket(r) === "tomorrow"),
      upcoming: reminders.filter((r) => getReminderBucket(r) === "upcoming"),
      done: reminders.filter((r) => getReminderBucket(r) === "done"),
    };
  }, [reminders]);

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

      void fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          dueAt: new Date(dueAt).getTime(),
          notes: action.notes ?? "",
          recurrence: "none",
        }),
      }).then(() => void refreshReminders());
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

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setLoadingTextIndex(0);

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
          body: JSON.stringify({ message: rebuiltPrompt, reminders }),
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
        const listReply = buildListRemindersReply(reminders, listScope);
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
        body: JSON.stringify({ message: prompt, reminders }),
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
      const grounded = tryGroundedReminderAnswer(prompt, reminders);
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
      await fetch("/api/chat/history", { method: "DELETE" });
      setPendingCreateDraft(null);
      setMessages([{ ...STARTER_MESSAGE, createdAt: new Date().toISOString() }]);
    } finally {
      setIsClearingChat(false);
    }
  };

  const copyReminderInviteLink = async (reminderId: string) => {
    try {
      const response = await fetch(`/api/reminders/${reminderId}/invite`, { method: "POST" });
      if (!response.ok) return;
      const data = (await response.json()) as { url?: string };
      if (data.url && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(data.url);
      }
    } catch {
      /* ignore */
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
        await fetch(`/api/reminders/${reminderId}`, { method: "DELETE" });
        await refreshReminders();
        resolveDueLine(messageId, `Deleted "${title}".`);
        return;
      }
      if (action === "done") {
        await fetch(`/api/reminders/${reminderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "done" }),
        });
        await refreshReminders();
        resolveDueLine(messageId, `Marked "${title}" as done.`);
        return;
      }
      if (action === "snooze") {
        const next = Date.now() + 60 * 60 * 1000;
        await fetch(`/api/reminders/${reminderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dueAt: next }),
        });
        await refreshReminders();
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
            body: JSON.stringify({ message: question, reminders }),
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
          const grounded = tryGroundedReminderAnswer(question, reminders);
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
    setIsCreateOpen(true);
  };

  const openEditModal = (reminder: ReminderItem) => {
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
    const dueAt = new Date(`${newDate}T${newTime}`).toISOString();
    const dueAtMs = new Date(dueAt).getTime();

    if (editingReminderId) {
      await fetch(`/api/reminders/${editingReminderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          dueAt: dueAtMs,
          recurrence: newRecurrence,
          notes: newNotes.trim(),
        }),
      });
      await refreshReminders();
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

      await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          dueAt: dueAtMs,
          recurrence: newRecurrence,
          notes: newNotes.trim(),
        }),
      });
      await refreshReminders();
    }
    resetReminderForm();
    setIsCreateOpen(false);
  };

  return (
    <>
      <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent px-3 pb-3 pt-1 sm:px-4 lg:mx-auto lg:max-w-3xl lg:px-6">
        <div
          ref={chatScrollRef}
          className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-slate-800 bg-[linear-gradient(180deg,#020617_0%,#0b1730_100%)] p-3 scrollbar-none"
        >
          <div className="grid gap-3">
            {messages.map((message) => {
              if (message.role === "system") {
                return (
                  <div
                    key={message.id}
                    className="mx-auto max-w-[92%] rounded-2xl border border-amber-400/35 bg-amber-950/40 px-3 py-2 text-center text-xs text-amber-50 shadow-sm"
                  >
                    <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                    <p className="mt-1 text-[10px] text-amber-200/80">
                      {new Date(message.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                );
              }
              const dueMeta = message.meta?.kind === "due_reminder" ? message.meta : null;
              return (
                <div
                  key={message.id}
                  className={`max-w-[92%] rounded-3xl px-4 py-2 text-sm shadow-sm ${
                    message.role === "user"
                      ? "ml-auto rounded-br-lg bg-emerald-600 text-white"
                      : "rounded-bl-lg bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                  }`}
                >
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
                    <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                  )}
                  <p
                    className={`mt-1 text-[10px] ${
                      message.role === "user" ? "text-emerald-100" : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    {new Date(message.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              );
            })}
            {isLoading ? (
              <div className="max-w-[84%] rounded-3xl rounded-bl-lg bg-white px-4 py-2 text-sm text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-100">
                {loadingTexts[loadingTextIndex]}
              </div>
            ) : null}
          </div>
        </div>

        <form
          onSubmit={handleChatSubmit}
          className="mt-3 grid shrink-0 grid-cols-[1fr_auto] items-end gap-2 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
        >
            <div className="rounded-xl border border-slate-300 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-950">
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
                placeholder="Type message..."
                className="max-h-32 min-h-10 w-full resize-none bg-transparent px-2 py-1 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
              />
            </div>
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="h-11 w-11 rounded-full bg-emerald-600 text-base font-semibold text-white shadow-md transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Send message"
            >
              {isLoading ? "..." : "➤"}
            </button>
        </form>
      </section>

      {isSnapshotOpen && (
        <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setIsSnapshotOpen(false)}>
          <aside
            className="absolute right-0 top-0 h-full w-[92%] max-w-sm overflow-y-auto border-l border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Dashboard menu</h2>
              <button
                type="button"
                onClick={() => setIsSnapshotOpen(false)}
                className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold dark:border-slate-700"
              >
                Close
              </button>
            </div>
            <ul className="grid gap-3">
              <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
                {snapshot.pending} reminders pending
              </li>
              <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
                {snapshot.today} due today
              </li>
              <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
                {snapshot.missed} overdue items
              </li>
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsSnapshotOpen(false);
                  openCreateModal();
                }}
                className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500"
              >
                Create reminder
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSnapshotOpen(false);
                  setIsListOpen(true);
                }}
                className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                View reminders
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSnapshotOpen(false);
                  setImportStatus(null);
                  setIsImportOpen(true);
                }}
                className="rounded-full border border-violet-300 px-4 py-2 text-sm font-semibold text-violet-700 transition hover:bg-violet-50 dark:border-violet-700 dark:text-violet-200 dark:hover:bg-violet-900/40"
              >
                Import JSON
              </button>
              <button
                type="button"
                onClick={() => {
                  setBatchStatus(null);
                  setIsSnapshotOpen(false);
                  setIsBatchOpen(true);
                }}
                disabled={isBatchRunning || isLoading}
                className="rounded-full border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-indigo-800 dark:text-indigo-200 dark:hover:bg-indigo-900/30"
              >
                Batch questions
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSnapshotOpen(false);
                  handleExportChat();
                }}
                disabled={isLoading || messages.length === 0}
                className="rounded-full border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-800 dark:text-emerald-200 dark:hover:bg-emerald-900/30"
              >
                Export chat
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSnapshotOpen(false);
                  void handleClearChat();
                }}
                disabled={isClearingChat || isLoading}
                className="rounded-full border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-800 dark:text-rose-200 dark:hover:bg-rose-900/30"
              >
                {isClearingChat ? "Clearing..." : "Clear chat"}
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
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
          <div className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">All reminders</h3>
              <button
                type="button"
                onClick={() => setIsListOpen(false)}
                className="rounded-full border border-slate-300 px-3 py-1 text-sm"
              >
                Close
              </button>
            </div>

            {(["missed", "today", "tomorrow", "upcoming", "done"] as const).map((bucket) => (
              <section key={bucket} className="mb-6">
                <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {bucket}
                </h4>
                <div className="grid gap-3">
                  {grouped[bucket].length === 0 ? (
                    <p className="text-sm text-slate-500">No reminders.</p>
                  ) : (
                    grouped[bucket].map((reminder) => (
                      <article
                        key={reminder.id}
                        className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"
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
                          <p className="mt-1 text-sm text-slate-600">{reminder.notes}</p>
                        ) : null}
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
                      </article>
                    ))
                  )}
                </div>
              </section>
            ))}
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
