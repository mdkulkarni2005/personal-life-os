export type ReminderChatRole = "system" | "user" | "assistant";

export interface ReminderChatMessage {
  role: ReminderChatRole;
  content: string;
}

export interface ReminderChatRequest {
  model?: string;
  messages: ReminderChatMessage[];
  temperature?: number;
  maxTokens?: number;
  // Reserved for future tool-calling support.
  tools?: unknown[];
}

export interface ReminderChatProvider {
  complete(request: ReminderChatRequest): Promise<string>;
}

export type ReminderStatus = "pending" | "done";
export type ReminderRecurrence = "none" | "daily" | "weekly" | "monthly";

export interface ReminderItem {
  id: string;
  title: string;
  dueAt: string;
  recurrence?: ReminderRecurrence;
  notes?: string;
  status: ReminderStatus;
  createdAt: string;
  updatedAt: string;
}

export type ReminderBucket = "missed" | "today" | "tomorrow" | "upcoming" | "done";

export function getReminderBucket(reminder: ReminderItem, now = new Date()): ReminderBucket {
  if (reminder.status === "done") return "done";

  const due = new Date(reminder.dueAt);
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startTomorrow = new Date(startToday);
  startTomorrow.setDate(startTomorrow.getDate() + 1);
  const startDayAfterTomorrow = new Date(startTomorrow);
  startDayAfterTomorrow.setDate(startDayAfterTomorrow.getDate() + 1);

  if (due < now) return "missed";
  if (due >= startToday && due < startTomorrow) return "today";
  if (due >= startTomorrow && due < startDayAfterTomorrow) return "tomorrow";
  return "upcoming";
}

export function buildReminderSnapshot(reminders: ReminderItem[], now = new Date()) {
  const counts = {
    pending: 0,
    done: 0,
    missed: 0,
    today: 0,
    tomorrow: 0,
  };

  for (const reminder of reminders) {
    if (reminder.status === "done") {
      counts.done += 1;
      continue;
    }

    counts.pending += 1;
    const bucket = getReminderBucket(reminder, now);
    if (bucket === "missed") counts.missed += 1;
    if (bucket === "today") counts.today += 1;
    if (bucket === "tomorrow") counts.tomorrow += 1;
  }

  return counts;
}

export interface NvidiaNimProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "meta/llama-3.1-70b-instruct";

export function createNvidiaNimChatProvider(
  options: NvidiaNimProviderOptions
): ReminderChatProvider {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const model = options.model ?? DEFAULT_MODEL;

  return {
    async complete(request) {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: request.model ?? model,
          messages: request.messages,
          temperature: request.temperature ?? 0.3,
          max_tokens: request.maxTokens ?? 500,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`NIM request failed (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error("NIM response did not include assistant content.");
      }

      return content;
    },
  };
}
