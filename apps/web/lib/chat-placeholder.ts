import { getReminderBucket, type ReminderItem } from "@repo/reminder";

type ChatLike = { role: string; content: string };

const MAX_LEN = 78;

function truncate(s: string, n: number) {
  const t = s.trim();
  if (t.length <= n) return t;
  return `${t.slice(0, Math.max(0, n - 1))}…`;
}

function lastUserSnippet(messages: ChatLike[], max = 120) {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last?.content) return "";
  return last.content.slice(0, max).toLowerCase();
}

/**
 * Suggests a short placeholder for the chat input from reminders, recent chat, time of day, and name.
 */
export function getContextualChatPlaceholder(input: {
  reminders: ReminderItem[];
  messages: ChatLike[];
  firstName?: string | null;
  now?: Date;
  /** Rotates which generic suggestion is shown when no strong context matches. */
  rotation: number;
}): string {
  const now = input.now ?? new Date();
  const hour = now.getHours();
  const pending = input.reminders.filter((r) => r.status !== "done");
  const missed = pending.filter((r) => getReminderBucket(r, now) === "missed");
  const today = pending.filter((r) => getReminderBucket(r, now) === "today");
  const sorted = [...pending].sort(
    (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
  );
  const next = sorted[0];
  const lastUser = lastUserSnippet(input.messages);

  const name = input.firstName?.trim();
  const greet = name ? `${name}, ` : "";

  if (missed.length >= 3) {
    return truncate(`${greet}how should we tackle ${missed.length} overdue reminders?`, MAX_LEN);
  }
  if (missed.length === 2) {
    return truncate(`What should we do about “${truncate(missed[0]!.title, 22)}” and one other overdue?`, MAX_LEN);
  }
  if (missed.length === 1 && missed[0]) {
    return truncate(`Reschedule or complete “${truncate(missed[0].title, 32)}”?`, MAX_LEN);
  }

  if (/create|add|schedule|new reminder/.test(lastUser)) {
    return truncate(`List what’s already on my calendar today…`, MAX_LEN);
  }
  if (/today|this morning|this afternoon|tonight/.test(lastUser)) {
    return truncate(
      today.length > 0
        ? `Anything else due today besides ${today.length} pending?`
        : `What’s on my plate tomorrow?`,
      MAX_LEN
    );
  }
  if (/tomorrow|next week|week/.test(lastUser)) {
    return truncate(`Show reminders for tomorrow and the rest of the week…`, MAX_LEN);
  }
  if (/done|complete|finish|mark/.test(lastUser)) {
    return truncate(`What’s still pending after that?`, MAX_LEN);
  }
  if (/miss|overdue|late/.test(lastUser)) {
    return truncate(`List missed reminders and what to do next…`, MAX_LEN);
  }

  if (next && today.length > 0) {
    const t = truncate(next.title, 26);
    const line =
      hour < 11
        ? `${greet}what should I do before “${t}”?`
        : `${gAskAfterNext(next, hour, name)}`;
    return truncate(line, MAX_LEN);
  }

  if (next) {
    return truncate(`When is “${truncate(next.title, 34)}” due?`, MAX_LEN);
  }

  const generics = [
    `${greet}list my upcoming reminders`,
    `${greet}what should I do next?`,
    `Tell me my upcoming reminders`,
    `What’s due today and tomorrow?`,
    `Any conflicts in my schedule?`,
    `${name ? `${name}, what’s` : "What’s"} the next thing to tackle?`,
  ];
  const idx = Math.abs(input.rotation) % generics.length;
  return truncate(generics[idx] ?? generics[0]!, MAX_LEN);
}

function gAskAfterNext(next: ReminderItem, hour: number, name?: string | null) {
  const t = truncate(next.title, 24);
  if (hour >= 17) {
    return `${name ? `${name}, ` : ""}plan tomorrow around “${t}”`;
  }
  if (hour >= 12) {
    return `What’s left after “${t}” this afternoon?`;
  }
  return `Walk me through what’s due before “${t}”`;
}
