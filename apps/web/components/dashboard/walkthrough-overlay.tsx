"use client";

export type WalkthroughAccent = "violet" | "teal" | "amber" | "rose";

export interface WalkthroughStep {
  eyebrow: string;
  title: string;
  body: string[];
  nextLabel: string;
  accent: WalkthroughAccent;
}

interface WalkthroughOverlayProps {
  open: boolean;
  step: WalkthroughStep;
  stepIndex: number;
  stepCount: number;
  onNext: () => void;
  onClose: () => void;
}

const accentClasses: Record<WalkthroughAccent, string> = {
  violet:
    "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-200",
  teal:
    "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900/60 dark:bg-teal-950/30 dark:text-teal-200",
  amber:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200",
  rose:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200",
};

export function WalkthroughOverlay({
  open,
  step,
  stepIndex,
  stepCount,
  onNext,
  onClose,
}: WalkthroughOverlayProps) {
  if (!open) return null;

  const isLastStep = stepIndex >= stepCount - 1;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/65 px-4 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="walkthrough-title"
        className="relative w-full max-w-xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_30px_90px_-50px_rgba(15,23,42,0.6)] dark:border-slate-800 dark:bg-slate-950"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-lg leading-none text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          aria-label="Skip walkthrough"
          title="Skip walkthrough"
        >
          ×
        </button>

        <div className="p-5 sm:p-6">
          <div className="flex items-center gap-3 pr-10">
            <span
              className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${accentClasses[step.accent]}`}
            >
              Step {stepIndex + 1} of {stepCount}
            </span>
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
              New user walkthrough
            </span>
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                {step.eyebrow}
              </p>
              <h2
                id="walkthrough-title"
                className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-[2rem]"
              >
                {step.title}
              </h2>
            </div>

            <div className="space-y-2 text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-[0.98rem]">
              {step.body.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                Next:
              </span>{" "}
              {step.nextLabel}
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              You can skip anytime with the cross button.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={onNext}
                className={`rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition active:scale-[0.99] ${
                  isLastStep
                    ? "bg-emerald-600 hover:bg-emerald-500"
                    : "bg-violet-600 hover:bg-violet-500"
                }`}
              >
                {step.nextLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
