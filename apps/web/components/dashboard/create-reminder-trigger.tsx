"use client";

import { usePathname, useRouter } from "next/navigation";

export function CreateReminderTrigger() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (pathname === "/dashboard") {
          window.dispatchEvent(new CustomEvent("dashboard:create-reminder"));
        } else {
          router.push("/dashboard?open=create");
        }
      }}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 hover:text-slate-950 sm:h-10 sm:w-10"
      aria-label="Create reminder"
      title="Create reminder"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    </button>
  );
}
