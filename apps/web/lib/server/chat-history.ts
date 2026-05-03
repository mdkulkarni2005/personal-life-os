import { api } from "@repo/db/convex/api";
import { getConvexClient } from "./convex-client";

export type ChatMessageMeta = {
  kind?: "due_reminder";
  reminderId?: string;
  dueAt?: number;
  title?: string;
  notes?: string;
  /** Quoted message when the user replied in-thread (WhatsApp-style). */
  replyTo?: { id: string; content: string; role: "user" | "assistant" | "system" };
  editedAt?: string;
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

// DEAD CODE — DO NOT CALL.
// M1 fix: saveMessageServerSide was made a no-op; the client (flushChatHistoryToServer)
// is the sole writer to Convex. Calling this from server routes would recreate the
// duplicate-message bug (two different clientIds → two Convex records → duplicates in UI).
// @deprecated
export async function appendChatMessages(_userId: string, _messages: StoredChatMessage[]): Promise<void> {
  // intentionally empty
}

export async function clearChatHistory(userId: string) {
  const client = getConvexClient();
  await client.mutation(api.chat.clearForUser, { userId });
}
