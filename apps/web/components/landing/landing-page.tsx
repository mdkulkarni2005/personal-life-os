import Link from "next/link";

const features = [
  {
    icon: "💬",
    title: "Chat-first planning",
    description:
      "Ask what's due, create reminders, and reschedule tasks through natural conversation — no form switching required.",
  },
  {
    icon: "🔗",
    title: "Linked tasks & reminders",
    description:
      "Attach reminders to bigger goals. Track health, finance, and career in one place with linked progress.",
  },
  {
    icon: "👥",
    title: "Shared accountability",
    description:
      "Send reminders to others, accept batches, and track follow-through without leaving the app.",
  },
];

export function LandingPage() {
  return (
    <main className="relative isolate min-h-[calc(100svh-4rem)] overflow-hidden">
      {/* Background gradient */}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[38rem] bg-[radial-gradient(circle_at_top_left,rgba(109,94,252,0.16),transparent_42%),radial-gradient(circle_at_top_right,rgba(105,210,181,0.16),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.95),rgba(248,248,246,0))]" />

      <div className="mx-auto flex w-full max-w-[88rem] flex-col gap-10 px-4 py-10 sm:px-6 lg:px-10 lg:py-14">

        {/* Hero */}
        <section className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,30rem)] lg:items-center">
          {/* Left — headline + CTAs */}
          <div className="flex flex-col gap-6">
            <span className="inline-flex w-fit rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.26em] text-violet-700">
              Personal Life OS · Chat-first
            </span>

            <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl lg:text-[3.75rem] lg:leading-[1.05]">
              Your AI-powered<br className="hidden sm:block" />
              personal command center.<br />
              <span className="text-violet-600">Talk to your day.</span>
            </h1>

            <p className="max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
              RemindOS combines reminders, tasks, shared accountability, and a
              conversational AI briefing — all in one focused workspace.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/sign-up"
                className="rounded-full bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-500"
              >
                Start free →
              </Link>
              <Link
                href="/sign-in"
                className="rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Sign in
              </Link>
            </div>

            {/* Feature pills */}
            <div className="flex flex-wrap items-center gap-4 pt-2">
              {[
                ["💬", "Chat-first"],
                ["🔔", "Smart reminders"],
                ["✓", "Linked tasks"],
                ["👥", "Share & collab"],
              ].map(([icon, label]) => (
                <div
                  key={label}
                  className="flex items-center gap-1.5 text-sm text-slate-500"
                >
                  <span className="text-base leading-none">{icon}</span>
                  {label}
                </div>
              ))}
            </div>
          </div>

          {/* Right — app mockup */}
          <aside className="overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white/92 p-4 shadow-[0_35px_80px_-50px_rgba(15,23,42,0.45)] backdrop-blur sm:p-5">
            <div className="rounded-[1.6rem] border border-slate-200 bg-[#fbfbfa] p-4">
              {/* Mockup header */}
              <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-600">
                    <span className="text-xs font-bold text-white">R</span>
                  </div>
                  <span className="text-sm font-semibold text-slate-900">
                    RemindOS
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-base">🔔</span>
                  <div className="flex flex-col gap-[3px]">
                    <span className="block h-[2px] w-[14px] rounded-full bg-slate-700" />
                    <span className="block h-[2px] w-[10px] rounded-full bg-slate-700" />
                    <span className="block h-[2px] w-[14px] rounded-full bg-slate-700" />
                  </div>
                </div>
              </div>

              {/* Urgency chips */}
              <div className="mb-3 flex gap-2">
                <span className="flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                  Overdue
                  <span className="rounded-full bg-rose-600 px-1 py-0.5 text-[9px] text-white">
                    2
                  </span>
                </span>
                <span className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Today
                  <span className="rounded-full bg-amber-600 px-1 py-0.5 text-[9px] text-white">
                    4
                  </span>
                </span>
              </div>

              {/* Chat bubbles */}
              <div className="flex flex-col gap-2">
                <div className="max-w-[85%] rounded-[1.2rem] rounded-bl-[4px] border border-slate-200 bg-[#f6f7fb] px-3 py-2 text-xs leading-5 text-slate-700">
                  2 overdue, 4 due today. Gym linked to Health task. Want the
                  briefing?
                </div>
                <div className="ml-auto max-w-[80%] rounded-[1.2rem] rounded-br-[4px] bg-violet-600 px-3 py-2 text-xs leading-5 text-white">
                  Reschedule gym to 7pm
                </div>
                <div className="max-w-[85%] rounded-[1.2rem] rounded-bl-[4px] border border-slate-200 bg-[#f6f7fb] px-3 py-2 text-xs leading-5 text-slate-700">
                  Done! Gym moved to 7:00 PM tonight. ✓
                </div>
              </div>

              {/* Quick actions */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {["Show overdue", "Create reminder", "What's next?"].map(
                  (q) => (
                    <span
                      key={q}
                      className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-violet-700"
                    >
                      {q}
                    </span>
                  ),
                )}
              </div>

              {/* Composer */}
              <div className="mt-3 flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2">
                <span className="flex-1 text-xs text-slate-400">
                  Ask or add a reminder...
                </span>
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-600">
                  <span className="text-xs font-bold text-white">↑</span>
                </div>
              </div>
            </div>
          </aside>
        </section>

        {/* Feature cards */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="rounded-[1.7rem] border border-slate-200/80 bg-white/90 p-6 shadow-[0_24px_60px_-48px_rgba(15,23,42,0.45)]"
            >
              <span className="mb-3 block text-2xl leading-none">
                {feature.icon}
              </span>
              <h2 className="text-base font-semibold text-slate-950">
                {feature.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {feature.description}
              </p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
