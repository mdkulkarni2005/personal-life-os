import type { ReminderItem } from "@repo/reminder";
import { playUiCue } from "./ui-sound";

/**
 * Shows a system notification for a due reminder (requires active service worker + permission).
 * Action buttons work best on Chromium (Android/desktop); iOS PWAs have limited support.
 */
export async function showDueReminderSystemNotification(reminder: ReminderItem, tagKey: string) {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  void playUiCue("notification");
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate?.([120, 40, 120]);
  }
  const reg = await navigator.serviceWorker.ready;
  const when = new Date(reminder.dueAt).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const options: NotificationOptions & {
    actions?: Array<{ action: string; title: string }>;
  } = {
    body: when,
    tag: tagKey,
    icon: "/logo-remindos.svg",
    badge: "/logo-remindos.svg",
    data: { reminderId: reminder.id, title: reminder.title },
    actions: [
      { action: "done", title: "Done" },
      { action: "snooze", title: "Snooze 1h" },
      { action: "delete", title: "Delete" },
    ],
  };
  await reg.showNotification(`Due now: ${reminder.title}`, options);
}
