"use client";

const items = ["3 reminders pending", "2 high-priority tasks", "1 overdue item"];

export function TodaySnapshotCard() {
  const handleCreateReminder = () => {
    window.dispatchEvent(new CustomEvent("reminder:quick-create"));
  };

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Today snapshot</h2>
      <ul className="mt-4 grid gap-3">
        {items.map((item) => (
          <li
            key={item}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            {item}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={handleCreateReminder}
        className="mt-4 rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500"
      >
        Create reminder
      </button>
    </article>
  );
}
