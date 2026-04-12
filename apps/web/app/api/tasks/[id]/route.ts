import { auth } from "@clerk/nextjs/server";
import { api } from "@repo/db/convex/api";
import { NextResponse } from "next/server";
import { getConvexClient } from "../../../../lib/server/convex-client";

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function parseTaskId(id: string) {
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
    dueAt?: number | null;
    status?: "pending" | "done";
    priority?: number;
    domain?: "health" | "finance" | "career" | "hobby" | "fun" | null;
  };

  const needsStarPriority = body.title !== undefined || body.notes !== undefined;
  if (
    needsStarPriority
    && (body.priority == null
      || !Number.isFinite(Number(body.priority))
      || Number(body.priority) < 1
      || Number(body.priority) > 5)
  ) {
    return NextResponse.json(
      { error: "priority (1–5 stars) is required when updating title or notes" },
      { status: 400 }
    );
  }

  const patch: {
    userId: string;
    taskId: ReturnType<typeof parseTaskId>;
    title?: string;
    notes?: string;
    dueAt?: number;
    status?: "pending" | "done";
    priority?: number;
    domain?: "health" | "finance" | "career" | "hobby" | "fun" | null;
  } = { userId, taskId: parseTaskId(id) };
  if (body.title !== undefined) patch.title = body.title;
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.status !== undefined) patch.status = body.status;
  if (body.priority !== undefined) patch.priority = body.priority;
  if (body.domain !== undefined) patch.domain = body.domain;
  if (body.dueAt === null) {
    /* keep dueAt unset — Convex optional clear not implemented */
  } else if (body.dueAt != null && Number.isFinite(Number(body.dueAt))) {
    patch.dueAt = Number(body.dueAt);
  }

  try {
    const client = getConvexClient();
    const task = await client.mutation(api.tasks.update, patch);
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ task });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  try {
    const client = getConvexClient();
    const result = await client.mutation(api.tasks.remove, {
      userId,
      taskId: parseTaskId(id),
    });
    if (!result.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
