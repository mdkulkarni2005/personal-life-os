"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AppNotification {
  _id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  reminderId?: string;
  read: boolean;
  createdAt: number;
}

// ── Icons (inline SVG to avoid extra deps) ────────────────────────────────────

function BellIcon({ hasBadge }: { hasBadge: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      {hasBadge ? (
        // Bell with dot
        <>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          <circle cx="18" cy="5" r="3" fill="#ef4444" stroke="none" />
        </>
      ) : (
        <>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </>
      )}
    </svg>
  );
}

function typeIcon(type: string) {
  if (type === "due_reminder") return "⏰";
  if (type === "pre_due_reminder") return "🔔";
  if (type === "overdue_nudge") return "⚠️";
  if (type === "morning_briefing") return "☀️";
  if (type === "share_invite" || type === "share_accepted") return "🤝";
  return "📌";
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface NotificationBellProps {
  /** Poll interval for fetching new notifications (ms). Default 30 000. */
  pollIntervalMs?: number;
}

export function NotificationBell({ pollIntervalMs = 30_000 }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Fetch ────────────────────────────────────────────────────────────────────
  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=30");
      if (!res.ok) return;
      const data = (await res.json()) as { notifications: AppNotification[]; unreadCount: number };
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      // network error — silently ignore
    }
  }, []);

  // Initial load + polling
  useEffect(() => {
    void fetchNotifications();
    const id = setInterval(() => void fetchNotifications(), pollIntervalMs);
    return () => clearInterval(id);
  }, [fetchNotifications, pollIntervalMs]);

  // Update tab title badge
  useEffect(() => {
    const base = "RemindOS";
    document.title = unreadCount > 0 ? `(${unreadCount}) ${base}` : base;
  }, [unreadCount]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // ── Actions ──────────────────────────────────────────────────────────────────
  const markAllRead = async () => {
    setLoading(true);
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAll: true }),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  };

  const markOneRead = async (id: string) => {
    setNotifications((prev) => prev.map((n) => n._id === id ? { ...n, read: true } : n));
    setUnreadCount((c) => Math.max(0, c - 1));
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  };

  const handleBellClick = () => {
    setOpen((o) => !o);
    if (!open) void fetchNotifications();
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        onClick={handleBellClick}
        className="relative flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
      >
        <BellIcon hasBadge={unreadCount > 0} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5 dark:border-gray-800">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Notifications
            </span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                disabled={loading}
                className="text-xs text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <ul className="max-h-96 divide-y divide-gray-50 overflow-y-auto dark:divide-gray-800">
            {notifications.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-gray-400">
                No notifications yet
              </li>
            )}
            {notifications.map((n) => (
              <li
                key={n._id}
                className={`flex cursor-default gap-3 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 ${
                  n.read ? "opacity-60" : "bg-blue-50/50 dark:bg-blue-900/10"
                }`}
                onClick={() => { if (!n.read) void markOneRead(n._id); }}
              >
                <span className="mt-0.5 text-base leading-none">{typeIcon(n.type)}</span>
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm ${n.read ? "font-normal text-gray-600 dark:text-gray-400" : "font-semibold text-gray-900 dark:text-gray-100"}`}>
                    {n.title}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-500">
                    {n.body}
                  </p>
                  <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-600">
                    {timeAgo(n.createdAt)}
                  </p>
                </div>
                {!n.read && (
                  <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
