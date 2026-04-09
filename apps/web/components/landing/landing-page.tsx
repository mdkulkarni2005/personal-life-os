import Link from "next/link";

const features = [
  {
    title: "Task and reminder control",
    description:
      "Track important tasks, reminders, and deadlines from one clean workflow.",
  },
  {
    title: "Daily flow dashboard",
    description:
      "See what is due today, what is at risk, and what should be prioritized next.",
  },
  {
    title: "Personal productivity OS",
    description:
      "Build a reliable personal system to keep your life, work, and habits aligned.",
  },
];

export function LandingPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <p className="mb-3 inline-flex rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-violet-700">
          Personal Life OS
        </p>
        <h1 className="max-w-3xl text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-4xl">
          Plan your tasks, reminders, and goals in one dashboard.
        </h1>
        <p className="mt-4 max-w-2xl text-slate-600 dark:text-slate-300">
          Personal Life OS helps you organize your day and stay consistent with
          reminders so nothing important gets missed.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href="/sign-up"
            className="rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500"
          >
            Create free account
          </Link>
          <Link
            href="/sign-in"
            className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Sign in
          </Link>
        </div>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        {features.map((feature) => (
          <article
            key={feature.title}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{feature.title}</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{feature.description}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
