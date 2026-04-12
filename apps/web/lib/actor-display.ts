/**
 * Display name plus first-letter badge, e.g. "Ankit Lohiya (A)" — used in shared reminder system messages.
 */
export function formatNameWithInitial(user: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  primaryEmailAddress?: { emailAddress?: string } | null;
} | null | undefined): string {
  if (!user) return "Someone";
  const first = user.firstName?.trim();
  const display =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim()
    || user.username?.trim()
    || user.primaryEmailAddress?.emailAddress
    || "Someone";
  const letter = (first && first.length > 0 ? first : display).charAt(0).toUpperCase();
  return `${display} (${letter})`;
}
