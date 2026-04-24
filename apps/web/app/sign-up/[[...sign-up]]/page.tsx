import { SignUp } from "@clerk/nextjs";
import { AuthShell } from "../../../components/auth/auth-shell";
import { authClerkAppearance } from "../../../components/auth/clerk-appearance";

export default function SignUpPage() {
  return (
    <div data-testid="sign-up-page">
      <AuthShell
        badge="Create account"
        title="Build a calmer system for tasks, reminders, and daily follow-through."
        description="Start with a workspace that keeps reminders, linked tasks, shared planning, and daily briefings in one place instead of scattering them across tools."
        alternateHref="/sign-in"
        alternateLabel="Sign in"
      >
        <SignUp
          forceRedirectUrl="/dashboard"
          signInUrl="/sign-in"
          appearance={authClerkAppearance}
        />
      </AuthShell>
    </div>
  );
}
