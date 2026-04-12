import { auth, currentUser } from "@clerk/nextjs/server";
import { api } from "@repo/db/convex/api";
import { NextResponse } from "next/server";
import { getConvexClient } from "../../../../../lib/server/convex-client";

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function parseReminderIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string" && id.length > 0);
}

function parseTargetIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string" && id.length > 0);
}

/**
 * Share one or more owned reminders to selected Clerk users (in-app inbox + invite token).
 */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    reminderIds?: unknown;
    targetUserIds?: unknown;
  };
  const reminderIds = parseReminderIds(body.reminderIds);
  const targetUserIds = parseTargetIds(body.targetUserIds);
  if (reminderIds.length === 0) {
    return NextResponse.json({ error: "reminderIds required" }, { status: 400 });
  }
  if (targetUserIds.length === 0) {
    return NextResponse.json({ error: "targetUserIds required" }, { status: 400 });
  }

  const user = await currentUser();
  const fromDisplayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim()
    || user?.username
    || user?.primaryEmailAddress?.emailAddress
    || "Someone";

  try {
    const client = getConvexClient();
    const result = await client.mutation(api.reminderSharing.shareRemindersToUsers, {
      userId,
      reminderIds: reminderIds as any,
      targetUserIds,
      fromDisplayName,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
