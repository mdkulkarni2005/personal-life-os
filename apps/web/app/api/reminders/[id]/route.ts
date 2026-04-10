import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getConvexClient } from "../../../../lib/server/convex-client";

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
    status?: "pending" | "done";
    recurrence?: "none" | "daily" | "weekly" | "monthly";
  };

  const client = getConvexClient();
  const reminder = await client.mutation("reminders:update" as any, {
    userId,
    reminderId: parseReminderId(id),
    ...body,
  });
  return NextResponse.json({ reminder });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const client = getConvexClient();
  const ok = await client.mutation("reminders:remove" as any, {
    userId,
    reminderId: parseReminderId(id),
  });
  return NextResponse.json({ ok });
}
