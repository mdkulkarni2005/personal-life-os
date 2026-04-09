"use client";

import { usePathname } from "next/navigation";

export function SnapshotNavTrigger() {
  const pathname = usePathname();
  if (pathname !== "/dashboard") return null;

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("dashboard:snapshot-open"))}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
      aria-label="Open today snapshot"
      title="Today snapshot"
    >
      ☰
    </button>
  );
}
