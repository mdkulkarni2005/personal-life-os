"use client";

import {
  type DueNotificationPrefs,
  saveDueNotificationPrefs,
} from "../../lib/reminder-notification-prefs";
import { playDueChime } from "../../lib/notification-sounds";

interface NotificationPrefsPanelProps {
  prefs: DueNotificationPrefs;
  onChange: (next: DueNotificationPrefs) => void;
  onRequestPermission: () => void;
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <div className="relative mt-0.5 flex-shrink-0">
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div
          className={`h-5 w-9 rounded-full transition-colors ${
            checked ? "bg-blue-500" : "bg-gray-300 dark:bg-gray-600"
          }`}
        />
        <div
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </div>
      <div>
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</p>
        {description && (
          <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
        )}
      </div>
    </label>
  );
}

const PRE_DUE_OPTIONS = [
  { label: "Off", value: 0 },
  { label: "5 min", value: 5 },
  { label: "15 min", value: 15 },
  { label: "30 min", value: 30 },
  { label: "1 hour", value: 60 },
];

export function NotificationPrefsPanel({
  prefs,
  onChange,
  onRequestPermission,
}: NotificationPrefsPanelProps) {
  const update = (patch: Partial<DueNotificationPrefs>) => {
    const next = { ...prefs, ...patch };
    onChange(next);
    saveDueNotificationPrefs(next);
  };

  const permissionGranted =
    typeof Notification !== "undefined" && Notification.permission === "granted";

  return (
    <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        🔔 Notification Settings
      </h3>

      {/* Permission prompt */}
      {!permissionGranted && (
        <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Browser notifications are not enabled. Enable them to receive due-time
            and push alerts even when this tab is in the background.
          </p>
          <button
            onClick={onRequestPermission}
            className="mt-2 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600"
          >
            Enable Notifications
          </button>
        </div>
      )}

      {/* In-app alerts */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">In-app</p>
        <Toggle
          label="Due-time alerts"
          description="Show a chat bubble when a reminder fires"
          checked={prefs.enabled}
          onChange={(v) => update({ enabled: v })}
        />
        <Toggle
          label="Foreground alerts"
          description="Show alerts even when you're actively using the app"
          checked={prefs.notifyWhenForeground}
          onChange={(v) => update({ notifyWhenForeground: v })}
        />
        <Toggle
          label="Sound chime"
          description="Play a gentle chime when a reminder fires"
          checked={prefs.soundEnabled}
          onChange={(v) => {
            update({ soundEnabled: v });
            if (v) playDueChime();
          }}
        />
      </div>

      {/* Push notifications */}
      <div className="space-y-3 border-t border-gray-100 pt-4 dark:border-gray-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Push (works when app is closed)</p>

        {/* Pre-due alert */}
        <div>
          <p className="mb-1.5 text-sm font-medium text-gray-800 dark:text-gray-200">
            Pre-due reminder alert
          </p>
          <div className="flex flex-wrap gap-2">
            {PRE_DUE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => update({ preDueMinutes: opt.value })}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  prefs.preDueMinutes === opt.value
                    ? "bg-blue-500 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Push notification sent this long before each reminder
          </p>
        </div>

        <Toggle
          label="Morning briefing"
          description="Daily push at 7:30 am with today's reminder count"
          checked={prefs.morningBriefingEnabled}
          onChange={(v) => update({ morningBriefingEnabled: v })}
        />

        <Toggle
          label="Overdue nudge"
          description="Hourly push when you have reminders past due"
          checked={prefs.overdueNudgeEnabled}
          onChange={(v) => update({ overdueNudgeEnabled: v })}
        />

        <Toggle
          label="Desktop push"
          description="Receive push notifications on desktop browsers"
          checked={prefs.desktopEnabled}
          onChange={(v) => update({ desktopEnabled: v })}
        />
      </div>
    </div>
  );
}
