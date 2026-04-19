"use client";

export function DrawerTrigger() {
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(new CustomEvent("dashboard:open-drawer"))
      }
      className="inline-flex h-9 w-9 flex-col items-center justify-center gap-[5px] rounded-full border border-slate-300 bg-white shadow-sm transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800 sm:h-10 sm:w-10"
      aria-label="Open menu"
    >
      <span className="block h-[2px] w-[18px] rounded-full bg-slate-800 dark:bg-slate-200" />
      <span className="block h-[2px] w-[13px] rounded-full bg-slate-800 dark:bg-slate-200" />
      <span className="block h-[2px] w-[18px] rounded-full bg-slate-800 dark:bg-slate-200" />
    </button>
  );
}
