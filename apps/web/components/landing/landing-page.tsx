import Link from "next/link";

const features = [
  {
    title: "Chat-first planning",
    description:
      "Use a single workspace to ask what is due, create reminders, and reschedule tasks without switching contexts.",
  },
  {
    title: "Linked reminders and tasks",
    description:
      "Keep standalone reminders, project tasks, and follow-up reminders connected so the system reflects real work.",
  },
  {
    title: "Shared accountability",
    description:
      "Invite other people into reminders, accept shared batches, and stay aligned without leaving the app.",
  },
];

export function LandingPage() {
  return (
    <main className="relative isolate min-h-[calc(100svh-4rem)] overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[34rem] bg-[radial-gradient(circle_at_top_left,rgba(109,94,252,0.18),transparent_42%),radial-gradient(circle_at_top_right,rgba(105,210,181,0.18),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.9),rgba(248,248,246,0))]" />
      <div className="mx-auto flex w-full max-w-[88rem] flex-col gap-8 px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(20rem,32rem)] lg:items-center">
          <div className="rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-[0_35px_80px_-50px_rgba(15,23,42,0.35)] backdrop-blur sm:p-8 lg:p-10">
            <p className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.26em] text-violet-700">
              Personal Life OS
            </p>
            <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl lg:text-[4.5rem] lg:leading-[0.98]">
              The planning layer for your day, not another noisy task board.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
              RemindOS combines reminders, tasks, shared accountability, and a
              conversational daily briefing in one lighter workspace that stays
              usable even when your list gets long.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/sign-up"
                className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Create free account
              </Link>
              <Link
                href="/sign-in"
                className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Sign in
              </Link>
            </div>
          </div>

          <aside className="overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white/92 p-4 shadow-[0_35px_80px_-50px_rgba(15,23,42,0.45)] backdrop-blur sm:p-5">
            <div className="rounded-[1.6rem] border border-slate-200 bg-[#fbfbfa] p-4">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-400">
                    Today
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">
                    Morning briefing
                  </p>
                </div>
                <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                  7 items
                </div>
              </div>
              <div className="mt-4 space-y-3">
                <div className="rounded-[1.3rem] bg-white p-4 shadow-sm">
                  <p className="text-sm font-medium text-slate-500">
                    Assistant
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    Three reminders need attention today. One payment is
                    overdue, and your workout reminder is linked to a pending
                    health task.
                  </p>
                </div>
                <div className="ml-auto max-w-[85%] rounded-[1.3rem] bg-violet-50 p-4 text-sm leading-6 text-slate-700">
                  Move the payment reminder to tonight and show me everything
                  overdue.
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-[1.3rem] border border-slate-200 bg-white p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                      Overdue
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950">
                      01
                    </p>
                  </div>
                  <div className="rounded-[1.3rem] border border-slate-200 bg-white p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                      Today
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950">
                      04
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="rounded-[1.7rem] border border-slate-200/80 bg-white/90 p-6 shadow-[0_24px_60px_-48px_rgba(15,23,42,0.45)]"
            >
              <h2 className="text-xl font-semibold text-slate-950">
                {feature.title}
              </h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                {feature.description}
              </p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
