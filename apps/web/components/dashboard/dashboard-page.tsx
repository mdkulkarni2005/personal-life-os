import { DashboardWorkspace } from "./dashboard-workspace";

interface DashboardPageProps {
  userId: string;
}

export function DashboardPage({ userId }: DashboardPageProps) {
  return (
    <main className="mx-auto w-full max-w-6xl px-0 py-2 sm:px-4 sm:py-4 lg:px-8">
      <DashboardWorkspace userId={userId} />
    </main>
  );
}
