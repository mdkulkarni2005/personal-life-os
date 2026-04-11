import { randomUUID } from "node:crypto";
import { appendChatMessages, type StoredChatMessage } from "./chat-history";

export async function appendSystemChatMessage(userId: string, content: string, meta?: StoredChatMessage["meta"]) {
  const message: StoredChatMessage = {
    id: randomUUID(),
    role: "system",
    content,
    createdAt: new Date().toISOString(),
    ...(meta ? { meta } : {}),
  };
  await appendChatMessages(userId, [message]);
}
