import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getConvexClient } from "../../../lib/server/convex-client";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const client = getConvexClient();
  const reminders = await client.query("reminders:list" as any, { userId });
  return NextResponse.json({ reminders });
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    title?: string;
    notes?: string;
    dueAt?: number;
    recurrence?: "none" | "daily" | "weekly" | "monthly";
  };
  if (!body.title || !body.dueAt) {
    return NextResponse.json({ error: "title and dueAt required" }, { status: 400 });
  }

  const client = getConvexClient();
  const result = await client.mutation("reminders:create" as any, {
    userId,
    title: body.title,
    notes: body.notes,
    dueAt: body.dueAt,
    recurrence: body.recurrence ?? "none",
  });
  return NextResponse.json(result);
}
