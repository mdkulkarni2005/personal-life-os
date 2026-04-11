import { Suspense } from "react";
import { DashboardWorkspace } from "./dashboard-workspace";

interface DashboardPageProps {
  userId: string;
}

export function DashboardPage({ userId }: DashboardPageProps) {
  return (
    <main className="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-6xl flex-1 flex-col px-0 py-0 sm:px-4 sm:py-2 lg:px-8">
      <Suspense
        fallback={<div className="flex flex-1 items-center justify-center p-8 text-slate-500">Loading…</div>}
      >
        <DashboardWorkspace userId={userId} />
      </Suspense>
    </main>
  );
}
