import { auth, currentUser } from "@clerk/nextjs/server";
import { api } from "@repo/db/convex/api";
import { NextResponse } from "next/server";
import { appendSystemChatMessage } from "../../../../lib/server/chat-notify";
import { getConvexClient } from "../../../../lib/server/convex-client";

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function actorLabel(user: Awaited<ReturnType<typeof currentUser>>) {
  if (!user) return "Someone";
  return (
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim()
    || user.username
    || user.primaryEmailAddress?.emailAddress
    || "Someone"
  );
}

function parseReminderId(id: string) {
  // Convex validates the id format at runtime.
  return id as any;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const body = (await request.json()) as {
    title?: string;
    notes?: string;
    dueAt?: number;
    status?: "pending" | "done" | "archived";
    recurrence?: "none" | "daily" | "weekly" | "monthly";
    priority?: number;
    urgency?: number;
    tags?: string[];
  };

  let reminder: unknown;
  try {
    const client = getConvexClient();
    reminder = await client.mutation(api.reminders.update, {
      userId,
      reminderId: parseReminderId(id),
      ...body,
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }

  if (reminder && typeof reminder === "object" && "userId" in reminder) {
    const ownerId = (reminder as { userId: string }).userId;
    if (ownerId && ownerId !== userId) {
      const user = await currentUser();
      const actor = actorLabel(user);
      const title = String((reminder as { title?: string }).title ?? "Reminder");
      let line = `${actor} updated "${title}".`;
      if (body.status === "done") line = `${actor} marked "${title}" as done.`;
      else if (body.status === "pending") line = `${actor} put "${title}" back to pending.`;
      else if (body.status === "archived") line = `${actor} archived "${title}".`;
      else if (body.dueAt != null) line = `${actor} rescheduled "${title}".`;
      else if (body.title != null) line = `${actor} edited the reminder (now "${title}").`;
      await appendSystemChatMessage(ownerId, line);
    }
  }

  return NextResponse.json({ reminder });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  let result:
    | { ok: false }
    | { ok: true; title: string; ownerUserId: string; actorWasOwner: boolean };
  try {
    const client = getConvexClient();
    result = (await client.mutation(api.reminders.remove, {
      userId,
      reminderId: parseReminderId(id),
    })) as typeof result;
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }

  if (!result.ok) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  if (!result.actorWasOwner) {
    const user = await currentUser();
    const actor = actorLabel(user);
    await appendSystemChatMessage(
      result.ownerUserId,
      `${actor} deleted "${result.title}".`
    );
  }

  return NextResponse.json({ ok: true });
}
