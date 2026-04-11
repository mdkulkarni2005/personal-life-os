"use client";

import { usePathname, useRouter } from "next/navigation";

export function OpenRemindersButton() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (pathname === "/dashboard") {
          window.dispatchEvent(new CustomEvent("dashboard:open-reminders"));
        } else {
          router.push("/dashboard?open=reminders");
        }
      }}
      className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
      aria-label="Open reminders"
      title="Reminders"
    >
      Reminders
    </button>
  );
}
