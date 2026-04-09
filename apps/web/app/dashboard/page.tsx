import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { DashboardPage } from "../../components/dashboard/dashboard-page";

export default async function Dashboard() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  return <DashboardPage userId={userId} />;
}
