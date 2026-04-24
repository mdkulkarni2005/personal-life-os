"use client";

import { useUser, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function AppDrawer() {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();

  const open = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setMounted(true);
    // Small rAF delay so the mount triggers the CSS transition
    requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
  };

  const close = () => {
    setVisible(false);
    closeTimerRef.current = setTimeout(() => setMounted(false), 300);
  };

  useEffect(() => {
    window.addEventListener("dashboard:open-drawer", open);
    return () => window.removeEventListener("dashboard:open-drawer", open);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  if (!mounted) return null;

  const initial =
    user?.firstName?.[0]?.toUpperCase() ??
    user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() ??
    "U";
  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "User";
  const email = user?.emailAddresses?.[0]?.emailAddress ?? "";

  const navItems = [
    {
      icon: "💬",
      label: "Chat",
      action: () => router.push("/dashboard"),
    },
    {
      icon: "🔔",
      label: "Reminders",
      action: () =>
        window.dispatchEvent(new CustomEvent("dashboard:open-reminders")),
    },
    {
      icon: "✓",
      label: "Tasks",
      action: () =>
        window.dispatchEvent(new CustomEvent("dashboard:open-tasks")),
    },
    {
      icon: "✦",
      label: "Briefing",
      action: () =>
        window.dispatchEvent(new CustomEvent("dashboard:run-briefing")),
    },
  ];

  return (
    <div
      data-testid="app-drawer"
      className="fixed inset-0 z-50 flex"
      style={{ pointerEvents: visible ? "auto" : "none" }}
    >
      {/* Backdrop */}
      <div
        className="flex-1 bg-black/40 transition-opacity duration-300"
        style={{ opacity: visible ? 1 : 0 }}
        onClick={close}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        className="flex w-[min(18rem,88vw)] translate-x-0 flex-col bg-white shadow-2xl transition-transform duration-300 dark:bg-slate-900"
        style={{ transform: visible ? "translateX(0)" : "translateX(100%)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <span className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Menu
          </span>
          <button
            type="button"
            onClick={close}
            data-testid="drawer-close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        {/* User card */}
        <div className="mx-4 my-3 rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3 dark:border-violet-900/40 dark:bg-violet-950/30">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-600 text-sm font-bold text-white">
              {initial}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                {displayName}
              </p>
              {email ? (
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {email}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {/* Primary nav */}
        <nav className="flex flex-col">
          {navItems.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                close();
                // Small delay so the close animation can start first
                setTimeout(() => item.action(), 150);
              }}
              data-testid={`drawer-nav-${item.label.toLowerCase()}`}
              className="flex min-h-[3.25rem] items-center gap-3 border-b border-slate-100 px-5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <span className="text-lg leading-none">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="my-1 h-px bg-slate-100 dark:bg-slate-800" />

        {/* Sign out */}
        <button
          type="button"
          onClick={() => {
            close();
            setTimeout(() => void signOut(() => router.push("/")), 200);
          }}
          data-testid="drawer-sign-out"
          className="flex min-h-[3.25rem] items-center gap-3 px-5 text-left text-sm text-slate-500 hover:bg-slate-50 active:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <span className="text-lg leading-none">🚪</span>
          Sign out
        </button>
      </div>
    </div>
  );
}
