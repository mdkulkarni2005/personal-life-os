import Link from "next/link";

const heroHighlights = [
  "AI chat + manual input, both supported",
  "Overdue, today, tomorrow, and upcoming clarity",
  "Task-linked reminders with priority and domain",
  "Share reminders to stay accountable",
];

const trustStats = [
  { label: "Time to first reminder", value: "< 60 sec" },
  { label: "Planning views", value: "4 urgency buckets" },
  { label: "Core flows", value: "Chat + Task + Reminder" },
];

const featurePillars = [
  {
    title: "AI planning assistant",
    description:
      "Talk naturally: create, edit, reschedule, or complete reminders without hunting through menus.",
    icon: "Spark",
  },
  {
    title: "Urgency-first dashboard",
    description:
      "Know exactly what needs attention now with clear grouping across overdue, today, tomorrow, and later.",
    icon: "Focus",
  },
  {
    title: "Task + reminder linking",
    description:
      "Connect reminders to tasks so context stays attached and execution becomes easier.",
    icon: "Link",
  },
  {
    title: "Accountability sharing",
    description:
      "Share selected reminders with others and keep follow-through visible.",
    icon: "Share",
  },
];

const howItWorks = [
  {
    step: "01",
    title: "Capture",
    description:
      "Drop a thought in chat or open quick create. Add due time, notes, priority, and done.",
  },
  {
    step: "02",
    title: "Prioritize",
    description:
      "The app auto-organizes reminders so you immediately see what is urgent and what can wait.",
  },
  {
    step: "03",
    title: "Execute",
    description:
      "Mark done, snooze, reschedule, create linked tasks, and share — all from one workspace.",
  },
];

const userPersonas = [
  {
    title: "Busy professionals",
    detail: "Keep work and personal commitments synced without context switching.",
  },
  {
    title: "Students and learners",
    detail: "Track assignments, deadlines, and follow-ups with clear urgency signals.",
  },
  {
    title: "Founders and operators",
    detail: "Run fast with chat-driven planning and quick delegation via sharing.",
  },
];

export function LandingPage() {
  return (
    <main className="relative isolate min-h-[calc(100svh-4rem)] overflow-hidden bg-[#f7f8ff] text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_12%_10%,rgba(124,58,237,0.26),transparent_34%),radial-gradient(circle_at_82%_16%,rgba(14,165,233,0.2),transparent_36%),radial-gradient(circle_at_50%_92%,rgba(16,185,129,0.16),transparent_34%)]" />
      <div className="mx-auto w-full max-w-[90rem] px-4 pb-16 pt-10 sm:px-6 lg:px-10 lg:pt-16">
        <section className="grid gap-8 xl:grid-cols-[minmax(0,1.06fr)_minmax(22rem,0.94fr)] xl:items-center">
          <div className="rounded-[2.1rem] border border-white/80 bg-white/80 p-6 shadow-[0_50px_100px_-55px_rgba(76,29,149,0.55)] backdrop-blur-sm dark:border-slate-700/70 dark:bg-slate-900/70 sm:p-8 lg:p-10">
            <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-700 dark:border-violet-600/40 dark:bg-violet-500/10 dark:text-violet-200">
              AI-first planning workspace
            </span>
            <h1 className="mt-5 text-[2.2rem] font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-[4rem]">
              RemindOS is the app that turns your scattered thoughts into a clear daily plan.
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-7 text-slate-600 dark:text-slate-300 sm:text-lg">
              If users ask “What does this app do?”, answer is simple: capture tasks and reminders quickly, let AI organize priorities, and execute everything from one intelligent dashboard.
            </p>

            <ul className="mt-6 grid gap-2 text-sm sm:grid-cols-2">
              {heroHighlights.map((point) => (
                <li
                  key={point}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200"
                >
                  {point}
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/sign-up"
                className="rounded-full bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_16px_28px_-18px_rgba(124,58,237,1)] transition hover:translate-y-[-1px] hover:bg-violet-500"
              >
                Start free
              </Link>
              <Link
                href="/sign-in"
                className="rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                I already have an account
              </Link>
            </div>

            <div className="mt-7 grid gap-2 sm:grid-cols-3">
              {trustStats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl border border-slate-200/90 bg-white/90 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/80"
                >
                  <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{stat.value}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          <aside className="relative overflow-hidden rounded-[2.1rem] border border-violet-200/50 bg-white/85 p-4 shadow-[0_55px_110px_-60px_rgba(124,58,237,0.75)] backdrop-blur-sm dark:border-violet-500/30 dark:bg-slate-900/75 sm:p-5">
            <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.2),transparent_40%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.2),transparent_44%)]" />
            <div className="rounded-[1.6rem] border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/80">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-700">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Live workspace preview</p>
                  <p className="mt-1 text-sm font-semibold">What users experience after sign in</p>
                </div>
                <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300">
                  Real-time clarity
                </span>
              </div>

              <div className="mt-3 grid gap-3">
                <div className="rounded-xl border border-rose-200 bg-rose-50/90 p-3 dark:border-rose-500/30 dark:bg-rose-500/10">
                  <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">Overdue (2)</p>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">Insurance payment · 8:00 AM</p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50/90 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">Today (4)</p>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">Team sync · 11:30 AM</p>
                </div>
                <div className="rounded-xl border border-violet-200 bg-white p-3 dark:border-violet-500/30 dark:bg-slate-900">
                  <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">Assistant</p>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">“I moved your gym reminder to 7:00 PM and linked it to Health goals.”</p>
                </div>
              </div>
            </div>
          </aside>
        </section>

        <section className="mt-10 grid gap-4 lg:grid-cols-3">
          {userPersonas.map((persona) => (
            <article
              key={persona.title}
              className="rounded-2xl border border-slate-200/90 bg-white/90 p-5 shadow-[0_22px_45px_-40px_rgba(15,23,42,0.9)] dark:border-slate-700 dark:bg-slate-900/75"
            >
              <h2 className="text-base font-semibold">{persona.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{persona.detail}</p>
            </article>
          ))}
        </section>

        <section className="mt-10 rounded-[2rem] border border-slate-200/80 bg-white/90 p-5 shadow-[0_30px_70px_-55px_rgba(15,23,42,0.8)] dark:border-slate-700 dark:bg-slate-900/80 sm:p-7">
          <div className="flex flex-col gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-violet-700 dark:text-violet-300">How RemindOS works</p>
            <h3 className="text-2xl font-semibold tracking-tight sm:text-3xl">From idea to execution in 3 steps</h3>
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {howItWorks.map((item) => (
              <article
                key={item.step}
                className="rounded-2xl border border-slate-200 bg-slate-50/85 p-4 dark:border-slate-700 dark:bg-slate-900/85"
              >
                <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300">
                  Step {item.step}
                </span>
                <h4 className="mt-2 text-base font-semibold">{item.title}</h4>
                <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{item.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {featurePillars.map((feature) => (
            <article
              key={feature.title}
              className="rounded-[1.5rem] border border-slate-200/90 bg-white p-5 shadow-[0_22px_45px_-40px_rgba(30,41,59,0.9)] dark:border-slate-700 dark:bg-slate-900"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-600 dark:text-violet-300">{feature.icon}</p>
              <h3 className="mt-2 text-base font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{feature.description}</p>
            </article>
          ))}
        </section>

        <section className="mt-10 rounded-[2rem] border border-violet-200/80 bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-7 text-white shadow-[0_35px_80px_-45px_rgba(79,70,229,0.8)] sm:px-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Stop managing reminders in scattered places.
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-violet-100 sm:text-base">
                Sign up, get an immediate walkthrough, and start planning with clarity from day one.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Link
                href="/sign-up"
                className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-violet-700 transition hover:bg-violet-50"
              >
                Create free account
              </Link>
              <Link
                href="/sign-in"
                className="rounded-full border border-white/60 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20"
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
