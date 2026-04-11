import { api } from "@repo/db/convex/api";
import { getConvexClient } from "./convex-client";

export type ChatMessageMeta = {
  kind?: "due_reminder";
  reminderId?: string;
  dueAt?: number;
  title?: string;
  notes?: string;
};

export interface StoredChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  meta?: ChatMessageMeta;
}

function toStored(row: {
  clientId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  metaJson?: string;
}): StoredChatMessage {
  return {
    id: row.clientId,
    role: row.role,
    content: row.content,
    createdAt: new Date(row.createdAt).toISOString(),
    meta: row.metaJson
      ? (() => {
          try {
            return JSON.parse(row.metaJson) as ChatMessageMeta;
          } catch {
            return undefined;
          }
        })()
      : undefined,
  };
}

export async function getChatHistory(userId: string): Promise<StoredChatMessage[]> {
  try {
    const client = getConvexClient();
    const rows = await client.query(api.chat.listForUser, { userId });
    return rows.map(toStored);
  } catch {
    return [];
  }
}

export async function appendChatMessages(userId: string, messages: StoredChatMessage[]) {
  const client = getConvexClient();
  await client.mutation(api.chat.replaceAllForUser, {
    userId,
    messages: messages.map((m) => ({
      clientId: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      metaJson: m.meta ? JSON.stringify(m.meta) : undefined,
    })),
  });
}

export async function clearChatHistory(userId: string) {
  const client = getConvexClient();
  await client.mutation(api.chat.clearForUser, { userId });
}
