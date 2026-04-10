import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StoredChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface ChatStore {
  [userId: string]: StoredChatMessage[];
}

const DATA_DIR = path.join(process.cwd(), ".data");
const CHAT_FILE = path.join(DATA_DIR, "chat-history.json");
const RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

async function readStore(): Promise<ChatStore> {
  try {
    const raw = await readFile(CHAT_FILE, "utf-8");
    return JSON.parse(raw) as ChatStore;
  } catch {
    return {};
  }
}

async function writeStore(store: ChatStore) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CHAT_FILE, JSON.stringify(store, null, 2), "utf-8");
}

function prune(messages: StoredChatMessage[]) {
  const cutoff = Date.now() - RETENTION_MS;
  return messages.filter((message) => new Date(message.createdAt).getTime() >= cutoff);
}

function dedupeById(messages: StoredChatMessage[]) {
  const map = new Map<string, StoredChatMessage>();
  for (const message of messages) {
    if (!message?.id) continue;
    map.set(message.id, message);
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

export async function getChatHistory(userId: string): Promise<StoredChatMessage[]> {
  const store = await readStore();
  const normalized = dedupeById(prune(store[userId] ?? []));
  if ((store[userId] ?? []).length !== normalized.length) {
    store[userId] = normalized;
    await writeStore(store);
  }
  return normalized;
}

export async function appendChatMessages(userId: string, messages: StoredChatMessage[]) {
  const store = await readStore();
  const existing = prune(store[userId] ?? []);
  const next = dedupeById(prune([...existing, ...messages]));
  store[userId] = next;
  await writeStore(store);
}

export async function clearChatHistory(userId: string) {
  const store = await readStore();
  store[userId] = [];
  await writeStore(store);
}
