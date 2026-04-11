import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getConvexClient } from "../../../lib/server/convex-client";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const client = getConvexClient();
  const data = (await client.query("reminders:listForUser" as any, { userId })) as {
    owned: Array<Record<string, unknown>>;
    shared: Array<Record<string, unknown>>;
  };
  const merged: Array<Record<string, unknown>> = [
    ...data.owned.map((r) => ({ ...r, _access: "owner" })),
    ...data.shared.map((r) => ({ ...r, _access: "shared" })),
  ];
  merged.sort((a, b) => Number(a.dueAt) - Number(b.dueAt));
  return NextResponse.json({ reminders: merged });
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    title?: string;
    notes?: string;
    dueAt?: number;
    recurrence?: "none" | "daily" | "weekly" | "monthly";
    priority?: number;
    urgency?: number;
    tags?: string[];
    status?: "pending" | "done" | "archived";
  };
  if (!body.title?.trim() || body.dueAt == null) {
    return NextResponse.json({ error: "title and dueAt required" }, { status: 400 });
  }

  const dueAt = Number(body.dueAt);
  if (!Number.isFinite(dueAt)) {
    return NextResponse.json({ error: "dueAt must be a valid timestamp" }, { status: 400 });
  }

  const notes =
    typeof body.notes === "string" && body.notes.trim().length > 0 ? body.notes.trim() : undefined;

  const client = getConvexClient();
  const result = await client.mutation("reminders:create" as any, {
    userId,
    title: body.title.trim(),
    notes,
    dueAt,
    recurrence: body.recurrence ?? "none",
    priority: body.priority,
    urgency: body.urgency,
    tags: body.tags,
    status: body.status ?? "pending",
  });
  return NextResponse.json(result);
}
