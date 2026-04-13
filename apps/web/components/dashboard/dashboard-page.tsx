import { Suspense } from "react";
import { DashboardWorkspace } from "./dashboard-workspace";

interface DashboardPageProps {
  userId: string;
}

export function DashboardPage({ userId }: DashboardPageProps) {
  return (
    <main className="mx-auto flex h-[calc(100dvh-4rem)] min-h-0 w-full max-w-[88rem] flex-1 flex-col px-0 py-0 sm:px-4 sm:py-4 lg:px-10">
      <Suspense
        fallback={<div className="flex flex-1 items-center justify-center p-8 text-slate-500">Loading…</div>}
      >
        <DashboardWorkspace userId={userId} />
      </Suspense>
    </main>
  );
}
