import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  appendChatMessages,
  clearChatHistory,
  getChatHistory,
  type StoredChatMessage,
} from "../../../../lib/server/chat-history";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const history = await getChatHistory(userId);
  return NextResponse.json({ messages: history });
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as { messages?: StoredChatMessage[] };
  const messages = (body.messages ?? []).filter(
    (item) =>
      item?.id
      && item?.content
      && (item?.role === "user" || item?.role === "assistant" || item?.role === "system")
  );
  if (messages.length === 0) {
    return NextResponse.json({ error: "Messages are required" }, { status: 400 });
  }

  await appendChatMessages(userId, messages);
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await clearChatHistory(userId);
  return NextResponse.json({ ok: true });
}
