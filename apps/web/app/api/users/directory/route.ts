import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Lists application users (Clerk) for share picker. Excludes the signed-in user.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const client = await clerkClient();
    const res = await client.users.getUserList({ limit: 100 });
    const users = res.data.map((u) => ({
      id: u.id,
      email: u.primaryEmailAddress?.emailAddress ?? "",
      firstName: u.firstName ?? "",
      lastName: u.lastName ?? "",
      username: u.username ?? "",
      imageUrl: u.imageUrl,
    }));
    return NextResponse.json({ users: users.filter((u) => u.id !== userId) });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
