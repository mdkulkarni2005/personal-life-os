"use client";

import { useEffect, useMemo, useState } from "react";

export interface WalkthroughStep {
  id: string;
  line1: string;
  line2: string;
  targetSelectors: string[];
  nextLabel: string;
}

interface WalkthroughOverlayProps {
  open: boolean;
  step: WalkthroughStep;
  stepIndex: number;
  stepCount: number;
  onNext: () => void;
  onClose: () => void;
}

export function WalkthroughOverlay({
  open,
  step,
  stepIndex,
  stepCount,
  onNext,
  onClose,
}: WalkthroughOverlayProps) {
  if (!open) return null;

  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const resolveTarget = () => {
      let target: HTMLElement | null = null;
      for (const selector of step.targetSelectors) {
        const found = document.querySelector<HTMLElement>(selector);
        if (found) {
          target = found;
          break;
        }
      }
      setTargetRect(target ? target.getBoundingClientRect() : null);
    };

    resolveTarget();
    const raf = window.requestAnimationFrame(resolveTarget);
    window.addEventListener("resize", resolveTarget);
    window.addEventListener("scroll", resolveTarget, true);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", resolveTarget);
      window.removeEventListener("scroll", resolveTarget, true);
    };
  }, [step]);

  const isLastStep = stepIndex >= stepCount - 1;
  const cardWidth = 260;

  const layout = useMemo(() => {
    if (!targetRect) {
      return {
        cardLeft: "50%",
        cardTop: "50%",
        cardTransform: "translate(-50%, -50%)",
        arrowLeft: "50%",
        arrowTop: "100%",
        arrowRotate: "45deg",
      };
    }

    const viewportW = window.innerWidth;
    const desiredLeft = targetRect.left + targetRect.width / 2 - cardWidth / 2;
    const cardLeft = Math.max(10, Math.min(desiredLeft, viewportW - cardWidth - 10));
    const showAbove = targetRect.top > 120;

    return {
      cardLeft: `${cardLeft}px`,
      cardTop: showAbove ? `${targetRect.top - 12}px` : `${targetRect.bottom + 12}px`,
      cardTransform: showAbove ? "translateY(-100%)" : "none",
      arrowLeft: `${targetRect.left + targetRect.width / 2 - cardLeft}px`,
      arrowTop: showAbove ? "100%" : "-6px",
      arrowRotate: "45deg",
    };
  }, [targetRect]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]">
      {targetRect ? (
        <div
          className="fixed rounded-xl border-2 border-violet-400/90 shadow-[0_0_0_4px_rgba(139,92,246,0.22)]"
          style={{
            left: targetRect.left - 4,
            top: targetRect.top - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
          }}
        />
      ) : null}

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="walkthrough-tip"
        className="pointer-events-auto fixed w-[260px] rounded-xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        style={{
          left: layout.cardLeft,
          top: layout.cardTop,
          transform: layout.cardTransform,
        }}
      >
        <span
          aria-hidden
          className="absolute h-3 w-3 border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
          style={{
            left: layout.arrowLeft,
            top: layout.arrowTop,
            transform: `translateX(-50%) rotate(${layout.arrowRotate})`,
          }}
        />

        <button
          type="button"
          onClick={onClose}
          className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-sm leading-none text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          aria-label="Skip walkthrough"
        >
          ×
        </button>

        <div className="space-y-2 pr-7">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-600 dark:text-violet-300">
            Step {stepIndex + 1} / {stepCount}
          </p>
          <p id="walkthrough-tip" className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {step.line1}
          </p>
          <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">
            {step.line2}
          </p>
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              Quick guide
            </span>
            <button
              type="button"
              onClick={onNext}
              className="rounded-full bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-500"
            >
              {isLastStep ? "Done" : step.nextLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
