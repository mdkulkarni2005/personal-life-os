import { auth } from "@clerk/nextjs/server";
import { api } from "@repo/db/convex/api";
import { NextResponse } from "next/server";
import { getConvexClient } from "../../../../../lib/server/convex-client";

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as { inboxId?: string };
  if (!body.inboxId?.trim()) {
    return NextResponse.json({ error: "inboxId required" }, { status: 400 });
  }

  try {
    const client = getConvexClient();
    await client.mutation(api.reminderSharing.dismissShareInboxRow, {
      userId,
      inboxId: body.inboxId.trim() as any,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
