import { ConvexHttpClient } from "convex/browser";

function getConvexUrl() {
  return process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL || "";
}

export function getConvexClient() {
  const convexUrl = getConvexUrl();
  if (!convexUrl) {
    throw new Error("Missing NEXT_PUBLIC_CONVEX_URL (or CONVEX_URL) in web environment.");
  }
  return new ConvexHttpClient(convexUrl);
}
