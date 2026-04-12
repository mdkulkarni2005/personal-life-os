import { auth, currentUser } from "@clerk/nextjs/server";
import { api } from "@repo/db/convex/api";
import { NextResponse } from "next/server";
import { formatNameWithInitial } from "../../../../../../lib/actor-display";
import { appendSystemChatMessage } from "../../../../../../lib/server/chat-notify";
import { getConvexClient } from "../../../../../../lib/server/convex-client";
import { sendWebPushToUser } from "../../../../../../lib/server/send-web-push";

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as { batchKey?: string };
  const batchKey = typeof body.batchKey === "string" ? body.batchKey.trim() : "";
  if (!batchKey) {
    return NextResponse.json({ error: "batchKey required" }, { status: 400 });
  }

  const user = await currentUser();
  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim()
    || user?.username
    || user?.primaryEmailAddress?.emailAddress
    || "Someone";
  const displayWithInitial = formatNameWithInitial(user);

  try {
    const client = getConvexClient();
    const result = await client.mutation(api.reminderSharing.acceptShareBatch, {
      userId,
      displayName,
      batchKey,
    });

    if (!result.ok) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const count = result.totalRows;
    const fromName = result.fromDisplayName;
    const ownerId = result.fromUserId;

    if (count > 0) {
      await appendSystemChatMessage(
        ownerId,
        `${displayWithInitial} accepted ${count} reminder${count === 1 ? "" : "s"} you shared.`
      );
      await appendSystemChatMessage(
        userId,
        `You joined ${count} shared reminder${count === 1 ? "" : "s"} from ${fromName}.`
      );
    }

    void sendWebPushToUser(ownerId, {
      type: "share_accepted",
      title: "Reminder share",
      body:
        count === 1
          ? `${displayWithInitial} accepted a reminder you shared.`
          : `${displayWithInitial} accepted ${count} reminders you shared.`,
      tag: `share-ack-${batchKey}`,
      batchKey,
      accepterName: displayWithInitial,
      count,
    });

    return NextResponse.json({
      ok: true,
      acceptedNew: result.acceptedNew,
      totalRows: result.totalRows,
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
