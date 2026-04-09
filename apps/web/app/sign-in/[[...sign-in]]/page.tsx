import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-[calc(100svh-64px)] w-full max-w-6xl items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
      <SignIn forceRedirectUrl="/dashboard" signUpUrl="/sign-up" />
    </main>
  );
}
