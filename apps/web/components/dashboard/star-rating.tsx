"use client";

/** 1–5 stars; `value` 0 means none selected yet. */
export function StarRating({
  value,
  onChange,
  disabled,
  label = "Priority",
}: {
  value: number;
  onChange: (stars: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      <div className="flex items-center gap-0.5" role="group" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            aria-pressed={value >= n}
            className={`rounded p-0.5 text-xl leading-none transition disabled:opacity-40 ${
              value >= n ? "text-amber-400" : "text-slate-300 dark:text-slate-600"
            } hover:text-amber-300`}
            onClick={() => onChange(n)}
          >
            ★
          </button>
        ))}
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {value > 0 ? `${value}/5` : "Required"}
        </span>
      </div>
    </div>
  );
}

export function priorityStarsLabel(priority?: number): string {
  if (typeof priority !== "number" || !Number.isFinite(priority) || priority < 1) return "";
  const n = Math.min(5, Math.max(1, Math.round(priority)));
  return ` ${"★".repeat(n)}`;
}
