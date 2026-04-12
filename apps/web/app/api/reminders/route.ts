import { auth } from "@clerk/nextjs/server";
import { api } from "@repo/db/convex/api";
import { NextResponse } from "next/server";
import { getConvexClient } from "../../../lib/server/convex-client";

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const client = getConvexClient();
    const data = (await client.query(api.reminders.listForUser, { userId })) as {
      owned: Array<Record<string, unknown>>;
      shared: Array<Record<string, unknown>>;
    };
    const merged: Array<Record<string, unknown>> = [
      ...data.owned.map((r: Record<string, unknown>) => ({ ...r, _access: "owner" })),
      ...data.shared.map((r: Record<string, unknown>) => ({ ...r, _access: "shared" })),
    ];
    merged.sort((a, b) => Number(a.dueAt) - Number(b.dueAt));
    return NextResponse.json({ reminders: merged });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
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

  const rawPri = body.priority;
  const priority =
    rawPri != null && Number.isFinite(Number(rawPri)) && Number(rawPri) >= 1 && Number(rawPri) <= 5
      ? Math.round(Number(rawPri))
      : 3;

  try {
    const client = getConvexClient();
    const result = await client.mutation(api.reminders.create, {
      userId,
      title: body.title.trim(),
      notes,
      dueAt,
      recurrence: body.recurrence ?? "none",
      priority,
      urgency: body.urgency,
      tags: body.tags,
      status: body.status ?? "pending",
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
