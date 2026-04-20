import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const WALKTHROUGH_RELEASE_AT = Date.parse("2026-04-20T00:00:00.000Z");
const COMPLETED_KEY = "remindosWalkthroughCompleted";
const COMPLETED_AT_KEY = "remindosWalkthroughCompletedAt";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const createdAt = Number(user.createdAt ?? 0);
    const privateMetadata = isRecord(user.privateMetadata) ? user.privateMetadata : {};
    const completed = privateMetadata[COMPLETED_KEY] === true;
    const eligible = createdAt >= WALKTHROUGH_RELEASE_AT;

    return NextResponse.json({
      show: eligible && !completed,
      completed,
      eligible,
      createdAt,
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const privateMetadata = isRecord(user.privateMetadata) ? user.privateMetadata : {};

    await client.users.updateUserMetadata(userId, {
      privateMetadata: {
        ...privateMetadata,
        [COMPLETED_KEY]: true,
        [COMPLETED_AT_KEY]: Date.now(),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
