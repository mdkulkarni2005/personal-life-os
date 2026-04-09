"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export function InstallAppBanner() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const isDismissed = window.localStorage.getItem("pwa-install-dismissed") === "true";
    if (isDismissed) return;

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setIsVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
  }, []);

  if (!isVisible || !installEvent) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-[60] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-800 dark:bg-slate-900 sm:inset-x-auto sm:right-4 sm:w-96">
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        Install RemindOS app
      </p>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
        Use Personal Life OS from your home screen with app-like experience.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={async () => {
            await installEvent.prompt();
            await installEvent.userChoice;
            setIsVisible(false);
          }}
          className="rounded-full bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white"
        >
          Install
        </button>
        <button
          type="button"
          onClick={() => {
            window.localStorage.setItem("pwa-install-dismissed", "true");
            setIsVisible(false);
          }}
          className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold dark:border-slate-700"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
