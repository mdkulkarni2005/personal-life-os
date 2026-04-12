import { NextResponse } from "next/server";

/** Public VAPID key for PushManager.subscribe (safe to expose). */
export async function GET() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  if (!publicKey) {
    return NextResponse.json({ publicKey: null, configured: false });
  }
  return NextResponse.json({ publicKey, configured: true });
}
