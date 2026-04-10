"use client";

import {
  buildReminderSnapshot,
  getReminderBucket,
  type ReminderRecurrence,
  type ReminderItem,
} from "@repo/reminder";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type ChatRole = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
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
  };
}

function matchesReminder(reminder: ReminderItem, targetId?: string, targetTitle?: string) {
  if (targetId && reminder.id === targetId) return true;
  if (!targetTitle) return false;
  return reminder.title.toLowerCase().includes(targetTitle.toLowerCase());
}

export function DashboardWorkspace({ userId }: WorkspaceProps) {
  const [reminders, setReminders] = usePersistentReminders(userId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isListOpen, setIsListOpen] = useState(false);
  const [isSnapshotOpen, setIsSnapshotOpen] = useState(false);
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null);
  const [loadingTextIndex, setLoadingTextIndex] = useState(0);
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newRecurrence, setNewRecurrence] = useState<ReminderRecurrence>("none");
  const [newNotes, setNewNotes] = useState("");
  const [pendingCreateDraft, setPendingCreateDraft] = useState<PendingCreateDraft | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const refreshReminders = async () => {
    const response = await fetch("/api/reminders");
    if (!response.ok) return;
    const data = (await response.json()) as { reminders?: Array<Record<string, unknown>> };
    setReminders(() => (data.reminders ?? []).map((item) => fromApiReminder(item)));
  };

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
          (item) => item.id && item.content && item.createdAt
        );
        if (parsed.length > 0) {
          setMessages(dedupeMessagesById(parsed));
        } else {
          setMessages([
            {
              id: "starter",
              role: "assistant",
              content:
                "Hi! I can create, list, update, and complete reminders. Example: 'Create reminder tomorrow at 9am for gym'.",
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      } catch {
        setMessages([
          {
            id: "starter",
            role: "assistant",
            content:
              "Hi! I can create, list, update, and complete reminders. Example: 'Create reminder tomorrow at 9am for gym'.",
            createdAt: new Date().toISOString(),
          },
        ]);
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

  const getReminderDetailReply = (query: string) => {
    const normalized = query.toLowerCase();
    const activeReminders = reminders.filter((item) => item.status === "pending");
    if (activeReminders.length === 0) return "You currently have no pending reminders.";

    const scored = activeReminders
      .map((reminder) => {
        const title = reminder.title.toLowerCase();
        if (normalized.includes(title)) return { reminder, score: 100 };
        const tokens = title.split(/\s+/).filter((token) => token.length > 2);
        const score = tokens.reduce(
          (sum, token) => (normalized.includes(token) ? sum + 1 : sum),
          0
        );
        return { reminder, score };
      })
      .sort((a, b) => b.score - a.score);

    if (scored[0] && scored[0].score > 0) {
      const target = scored[0].reminder;
      return `Reminder "${target.title}" is pending, due ${new Date(
        target.dueAt
      ).toLocaleString()}${target.notes ? `. Notes: ${target.notes}` : "."}`;
    }

    const summary = activeReminders
      .slice(0, 3)
      .map((reminder) => `${reminder.title} (${new Date(reminder.dueAt).toLocaleString()})`)
      .join(", ");
    return `I found ${activeReminders.length} pending reminders: ${summary}. Tell me which one you want details for.`;
  };

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
      const normalized = prompt.toLowerCase();
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

      if (
        (normalized.includes("about my reminder")
          || normalized.includes("my reminder")
          || normalized.includes("tell me about")
          || normalized.includes("details"))
        && reminders.length > 0
      ) {
        const detailReply = getReminderDetailReply(prompt);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: detailReply,
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
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "I could not process that request. Please try again.",
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
      <section className="relative h-[calc(100dvh-4.5rem)] overflow-hidden bg-transparent lg:grid lg:grid-cols-3 lg:gap-4">
        <article className="flex h-[calc(100dvh-4.5rem)] flex-col px-3 pb-3 pt-2 sm:h-[calc(100dvh-6rem)] sm:px-2 lg:col-span-2 lg:h-[calc(100dvh-7rem)] lg:px-0">
          <div className="sticky top-0 z-10 mb-2 flex items-center justify-between bg-transparent pb-1">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                RemindOS chat
              </p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
                Reminder assistant
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Fast WhatsApp-style reminders, built for mobile first.
              </p>
            </div>
          </div>
          <div
            ref={chatScrollRef}
            className="mt-2 flex-1 overflow-y-auto rounded-2xl border border-slate-800 bg-[linear-gradient(180deg,#020617_0%,#0b1730_100%)] p-3 scrollbar-none"
          >
            <div className="grid gap-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[84%] rounded-3xl px-4 py-2 text-sm shadow-sm ${
                    message.role === "user"
                      ? "ml-auto rounded-br-lg bg-emerald-600 text-white"
                      : "rounded-bl-lg bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                  }`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
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
              ))}
              {isLoading ? (
                <div className="max-w-[84%] rounded-3xl rounded-bl-lg bg-white px-4 py-2 text-sm text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-100">
                  {loadingTexts[loadingTextIndex]}
                </div>
              ) : null}
            </div>
          </div>

          <form
            onSubmit={handleChatSubmit}
            className="sticky bottom-0 mt-3 grid grid-cols-[1fr_auto] items-end gap-2 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
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
        </article>

        <article className="hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:block">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Today snapshot</h2>
          <ul className="mt-4 grid gap-3">
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
              onClick={openCreateModal}
              className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500"
            >
              Create reminder
            </button>
            <button
              type="button"
              onClick={() => setIsListOpen(true)}
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              View reminders
            </button>
          </div>
        </article>
      </section>

      {isSnapshotOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 lg:hidden" onClick={() => setIsSnapshotOpen(false)}>
          <aside
            className="absolute right-0 top-0 h-full w-[92%] max-w-sm overflow-y-auto border-l border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Today snapshot</h2>
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
            </div>
          </aside>
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsListOpen(true)}
        className="fixed bottom-20 right-4 z-40 rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-lg transition hover:bg-violet-500 lg:hidden"
      >
        Reminders
      </button>

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
                        <p className="font-semibold">{reminder.title}</p>
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
    </>
  );
}
