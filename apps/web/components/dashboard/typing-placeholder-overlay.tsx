"use client";

import { useEffect, useRef, useState } from "react";

const TYPE_MS = 38;
const DELETE_MS = 22;
const PAUSE_AFTER_TYPE_MS = 2000;
const GAP_BEFORE_NEXT_MS = 400;

type StepMode = "type" | "pauseAfterFull" | "delete" | "gapBeforeNext";

/**
 * Fake placeholder with typewriter + delete cycle; use when the real textarea value is empty.
 */
export function TypingPlaceholderOverlay({
  lines,
  show,
  className,
}: {
  lines: string[];
  show: boolean;
  className?: string;
}) {
  const [display, setDisplay] = useState("");
  const linesRef = useRef(lines);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  linesRef.current = lines;

  useEffect(() => {
    if (!show || lines.length === 0) {
      setDisplay("");
      return;
    }

    let cancelled = false;
    let lineIndex = 0;
    let charIndex = 0;
    let mode: StepMode = "type";

    const clearTimer = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    const schedule = (fn: () => void, ms: number) => {
      clearTimer();
      timeoutRef.current = setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
    };

    const step = () => {
      if (cancelled) return;
      const pool = linesRef.current;
      if (pool.length === 0) {
        setDisplay("");
        return;
      }

      const safeIdx = lineIndex % pool.length;
      const full = pool[safeIdx] ?? "";

      if (mode === "type") {
        if (full.length === 0) {
          lineIndex += 1;
          schedule(step, GAP_BEFORE_NEXT_MS);
          return;
        }
        if (charIndex < full.length) {
          charIndex += 1;
          setDisplay(full.slice(0, charIndex));
          schedule(step, TYPE_MS);
        } else {
          mode = "pauseAfterFull";
          schedule(() => {
            mode = "delete";
            step();
          }, PAUSE_AFTER_TYPE_MS);
        }
        return;
      }

      if (mode === "delete") {
        if (charIndex > 0) {
          charIndex -= 1;
          setDisplay(full.slice(0, charIndex));
          schedule(step, DELETE_MS);
        } else {
          mode = "gapBeforeNext";
          lineIndex += 1;
          schedule(() => {
            mode = "type";
            charIndex = 0;
            step();
          }, GAP_BEFORE_NEXT_MS);
        }
      }
    };

    charIndex = 0;
    lineIndex = 0;
    mode = "type";
    step();

    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [show, lines]);

  if (!show || lines.length === 0) return null;

  return (
    <span className={`inline-flex items-baseline gap-0.5 ${className ?? ""}`} aria-hidden>
      <span>{display}</span>
      <span className="inline-block min-h-[1em] w-px animate-pulse bg-slate-400 dark:bg-slate-500" />
    </span>
  );
}
