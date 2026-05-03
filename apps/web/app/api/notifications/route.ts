import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { api } from "@repo/db/convex/api";
import { getConvexClient } from "../../../lib/server/convex-client";

/** GET /api/notifications — list recent in-app notifications */
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const client = getConvexClient();
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 100);

  const rows = await client.query(api.notifications.listForUser, { userId, limit });
  const unread = await client.query(api.notifications.unreadCount, { userId });

  return NextResponse.json({ notifications: rows, unreadCount: unread });
}

/** PATCH /api/notifications — mark one or all as read */
export async function PATCH(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const client = getConvexClient();
  const body = (await request.json()) as { id?: string; markAll?: boolean };

  if (body.markAll) {
    await client.mutation(api.notifications.markAllRead, { userId });
    return NextResponse.json({ ok: true });
  }

  if (body.id) {
    const rows = await client.query(api.notifications.listForUser, { userId, limit: 1 });
    await client.mutation(api.notifications.markRead, { id: body.id as never });
    return NextResponse.json({ ok: true, rows });
  }

  return NextResponse.json({ error: "Provide id or markAll" }, { status: 400 });
}
