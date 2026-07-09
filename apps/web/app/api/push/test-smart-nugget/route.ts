/**
 * /api/push/test-smart-nugget — send a test "smart nugget" push to the
 * currently logged-in user, using the curiosity-driven smart-nugget.ts
 * generator (separate from the moment-based smart nudges in ai-generate.ts).
 *
 * Bypasses ALL inactivity / quiet-hours / dedup checks so the new copy path
 * can be verified end-to-end at any time.
 *
 * POST — no body needed. Reads userId from Clerk session.
 * Returns: { ok, sent, title, body, reason, category, diagnostics }
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { api } from "@repo/db/convex/api";
import { getConvexClient } from "../../../../lib/server/convex-client";
import { sendWebPushToUser } from "../../../../lib/server/send-web-push";
import { generateSmartNugget } from "../../../../lib/server/notifications/smart-nugget";

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const vapidOk = !!(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
  );
  const nimOk = !!process.env.NVIDIA_NIM_API_KEY;

  const client = getConvexClient();
  const subs = await client.query(api.pushSubscriptions.listForUser, { userId });

  const diagnostics = {
    vapidOk,
    nimOk,
    subscriptionsFound: subs.length,
    userId,
    tip: !vapidOk
      ? "VAPID keys missing — add NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to Vercel env vars"
      : !nimOk
      ? "NVIDIA_NIM_API_KEY missing — smart nugget copy requires the AI generator"
      : subs.length === 0
      ? "No push subscriptions — open app settings and toggle Push Notifications off then on again"
      : "All good — notification should arrive shortly",
  };

  if (!vapidOk || !nimOk || subs.length === 0) {
    return NextResponse.json({ ok: false, sent: 0, diagnostics }, { status: 200 });
  }

  const now = Date.now();
  const localHour = new Date(now).getHours();
  let pendingCount = 0, overdueCount = 0, doneToday = 0, streakDays = 0;
  let topDomain: string | null = null, nextDueTitle: string | null = null;
  try {
    const stats = await client.query(api.reminders.getSmartNudgeStats, { userId });
    pendingCount = stats.pendingCount;
    overdueCount = stats.overdueCount;
    topDomain = stats.topDomain ?? null;
    nextDueTitle = stats.nextDueTitle ?? null;
  } catch { /* non-critical */ }

  const nugget = await generateSmartNugget({
    displayName: null,
    pendingCount,
    overdueCount,
    doneToday,
    streakDays,
    topDomain,
    nextDueTitle,
    localHour,
  });

  if (!nugget) {
    return NextResponse.json({
      ok: false,
      sent: 0,
      diagnostics: { ...diagnostics, tip: "AI generation failed or was filtered — check server logs" },
    });
  }

  const sent = await sendWebPushToUser(userId, {
    type: "smart_nugget",
    title: nugget.title,
    body: nugget.body,
    category: nugget.category,
    test: true,
  });

  if (sent > 0) {
    await client.mutation(api.notifications.create, {
      userId,
      type: "smart_nugget",
      title: `[TEST] ${nugget.title}`,
      body: nugget.body,
    });
  }

  console.log(`[push/test-smart-nugget] user=${userId} category=${nugget.category ?? "unknown"} reason="${nugget.reason}"`);

  return NextResponse.json({
    ok: true,
    sent,
    title: nugget.title,
    body: nugget.body,
    reason: nugget.reason,
    category: nugget.category,
    diagnostics,
  });
}
