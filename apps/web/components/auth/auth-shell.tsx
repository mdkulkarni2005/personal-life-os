import type { ReactNode } from "react";
import Link from "next/link";

interface AuthShellProps {
  badge: string;
  title: string;
  description: string;
  alternateHref: string;
  alternateLabel: string;
  children: ReactNode;
}

const valuePoints = [
  "Chat-first planning for reminders, tasks, and shared follow-ups.",
  "A lighter workspace that keeps long lists scrollable instead of crowded.",
  "Fast access to daily briefing, overdue work, and linked task flows.",
];

export function AuthShell({
  badge,
  title,
  description,
  alternateHref,
  alternateLabel,
  children,
}: AuthShellProps) {
  return (
    <main className="relative isolate min-h-[calc(100svh-64px)] overflow-hidden px-4 py-[max(2rem,env(safe-area-inset-top))] sm:px-6 lg:px-10">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[28rem] bg-[radial-gradient(circle_at_top_left,rgba(109,94,252,0.18),transparent_44%),radial-gradient(circle_at_top_right,rgba(105,210,181,0.18),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.86),rgba(248,248,246,0))]" />
      <div className="mx-auto grid min-h-full w-full max-w-[88rem] gap-6 pb-[max(2rem,env(safe-area-inset-bottom))] lg:grid-cols-[minmax(0,1.05fr)_minmax(22rem,30rem)] lg:items-center">
        <section className="rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-[0_30px_80px_-45px_rgba(15,23,42,0.35)] backdrop-blur sm:p-8 lg:p-10">
          <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-violet-700">
            {badge}
          </span>
          <h1 className="mt-5 max-w-2xl text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl lg:text-[3.35rem] lg:leading-[1.02]">
            {title}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
            {description}
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {valuePoints.map((point, index) => (
              <article
                key={point}
                className="rounded-[1.5rem] border border-slate-200/80 bg-slate-50/90 p-4 shadow-sm"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                  0{index + 1}
                </p>
                <p className="mt-3 text-sm leading-6 text-slate-700">{point}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="relative overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white/92 p-4 shadow-[0_30px_80px_-45px_rgba(15,23,42,0.45)] backdrop-blur sm:p-6">
          <div className="absolute inset-x-6 top-0 h-28 rounded-b-[2rem] bg-[linear-gradient(180deg,rgba(109,94,252,0.12),rgba(255,255,255,0))]" />
          <div className="relative rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.4)]">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
                  Account access
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-950">
                  RemindOS workspace
                </p>
              </div>
              <Link
                href={alternateHref}
                className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                {alternateLabel}
              </Link>
            </div>
            <div className="[&_.cl-rootBox]:w-full [&_.cl-card]:shadow-none [&_.cl-footerAction]:justify-center [&_.cl-footerActionLink]:font-semibold [&_.cl-header]:hidden [&_.cl-socialButtonsBlockButton]:shadow-none">
              {children}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
