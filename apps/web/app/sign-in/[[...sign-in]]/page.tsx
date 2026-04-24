import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "../../../components/auth/auth-shell";
import { authClerkAppearance } from "../../../components/auth/clerk-appearance";

export default function SignInPage() {
  return (
    <div data-testid="sign-in-page">
      <AuthShell
        badge="Sign in"
        title="Pick up your reminders without losing context."
        description="Return to your workspace, review what is overdue, and continue the chat-first planning flow without digging through multiple screens."
        alternateHref="/sign-up"
        alternateLabel="Create account"
      >
        <SignIn
          forceRedirectUrl="/dashboard"
          signUpUrl="/sign-up"
          appearance={authClerkAppearance}
        />
      </AuthShell>
    </div>
  );
}
