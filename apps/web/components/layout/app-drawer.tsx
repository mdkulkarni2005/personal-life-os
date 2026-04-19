"use client";

import { useUser, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function AppDrawer() {
  const [open, setOpen] = useState(false);
  const { user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("dashboard:open-drawer", onOpen);
    return () => window.removeEventListener("dashboard:open-drawer", onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

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
  ];

  const secondaryItems = [
    {
      icon: "🚪",
      label: "Sign out",
      action: () => void signOut(() => router.push("/")),
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="flex-1 bg-black/40 backdrop-blur-[1px]"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div className="flex w-72 flex-col bg-white shadow-2xl dark:bg-slate-900">
        {/* Drawer header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <span className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Menu
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        {/* User card */}
        <div className="mx-4 my-3 rounded-xl border border-violet-100 bg-violet-50 px-4 py-3 dark:border-violet-900/50 dark:bg-violet-950/30">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-600 text-sm font-bold text-white">
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
                setOpen(false);
                item.action();
              }}
              className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <span className="text-lg leading-none">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="my-1 h-px bg-slate-100 dark:bg-slate-800" />

        {/* Secondary nav */}
        <div className="flex flex-col">
          {secondaryItems.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                setOpen(false);
                item.action();
              }}
              className="flex items-center gap-3 px-5 py-3 text-left text-sm text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <span className="text-lg leading-none">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
