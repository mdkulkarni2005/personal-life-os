/**
 * Lightweight reminders-style alerts for sharing (invite accepted, etc.).
 * Requires Notification permission + service worker (same as due reminders).
 */
import { playUiCue } from "./ui-sound";

export async function showCollaborationNotification(
  title: string,
  body: string,
  tag: string
): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
    return;
  }
  try {
    void playUiCue("share");
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, {
      body,
      tag,
      icon: "/logo-remindos.svg",
      badge: "/logo-remindos.svg",
    });
  } catch {
    /* ignore */
  }
}

/** Only notify for recent server-written system lines (~10 min; avoids spamming on old history load). */
export function shouldNotifyForCollaboration(messageId: string, createdAtIso: string): boolean {
  const created = new Date(createdAtIso).getTime();
  if (!Number.isFinite(created)) return false;
  const age = Date.now() - created;
  if (age > 600_000 || age < -60_000) return false;
  if (typeof sessionStorage === "undefined") return true;
  const key = `remindos:collabNotified:${messageId}`;
  if (sessionStorage.getItem(key)) return false;
  sessionStorage.setItem(key, "1");
  return true;
}
