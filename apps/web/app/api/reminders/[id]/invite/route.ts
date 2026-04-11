import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getConvexClient } from "../../../../../lib/server/convex-client";

function parseReminderId(id: string) {
  return id as any;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const client = getConvexClient();
  const result = await client.mutation("reminderSharing:createInvite" as any, {
    userId,
    reminderId: parseReminderId(id),
  });
  if (!result) {
    return NextResponse.json({ error: "Reminder not found or not owned by you" }, { status: 404 });
  }

  const origin =
    request.headers.get("origin")
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? new URL(request.url).origin;
  const url = `${origin.replace(/\/$/, "")}/dashboard?invite=${encodeURIComponent(result.token)}`;

  return NextResponse.json({ token: result.token, url });
}
