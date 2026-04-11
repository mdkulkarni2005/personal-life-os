import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { appendSystemChatMessage } from "../../../../../lib/server/chat-notify";
import { getConvexClient } from "../../../../../lib/server/convex-client";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  if (!token?.trim()) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const client = getConvexClient();
  const preview = await client.query("reminderSharing:getInviteByToken" as any, {
    token: decodeURIComponent(token),
  });
  if (!preview) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  return NextResponse.json({ preview });
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { token } = await context.params;
  if (!token?.trim()) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const user = await currentUser();
  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim()
    || user?.username
    || user?.primaryEmailAddress?.emailAddress
    || "Someone";

  const client = getConvexClient();
  const result = await client.mutation("reminderSharing:acceptInvite" as any, {
    token: decodeURIComponent(token),
    userId,
    displayName,
  });

  if (!result.ok) {
    if (result.reason === "owner_self") {
      return NextResponse.json(
        { error: "You cannot accept your own reminder invite.", title: result.title },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  const title = result.title as string;
  const ownerUserId = result.ownerUserId as string;
  const name = result.displayName as string;

  if (!result.already) {
    await appendSystemChatMessage(
      ownerUserId,
      `Your reminder "${title}" was accepted by ${name}.`
    );
    await appendSystemChatMessage(
      userId,
      `You joined the shared reminder "${title}". You can mark it done, edit, or delete from your reminders.`
    );
  }

  return NextResponse.json({
    ok: true,
    already: result.already,
    reminderId: result.reminderId,
    title,
    ownerUserId,
    displayName: name,
  });
}
