import webpush from "web-push";
import { api } from "@repo/db/convex/api";
import { getConvexClient } from "./convex-client";

let configured = false;

export function initWebPush(): boolean {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:reminders@localhost";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

export async function sendWebPushToUser(userId: string, payload: Record<string, unknown>): Promise<number> {
  if (!initWebPush()) return 0;
  const client = getConvexClient();
  const subs = await client.query(api.pushSubscriptions.listForUser, { userId });
  if (subs.length === 0) return 0;
  const body = JSON.stringify(payload);
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
        },
        body,
        { urgency: "high", TTL: 86_400 }
      );
      sent += 1;
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        try {
          await client.mutation(api.pushSubscriptions.removePushSubscription, {
            userId,
            endpoint: s.endpoint,
          });
        } catch {
          /* ignore */
        }
      }
    }
  }
  return sent;
}
