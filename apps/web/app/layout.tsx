import type { Metadata } from "next";
import { ClerkProvider, Show } from "@clerk/nextjs";
import Link from "next/link";
import Image from "next/image";
import localFont from "next/font/local";
import { InstallAppBanner } from "../components/pwa/install-app-banner";
import { RegisterServiceWorker } from "../components/pwa/register-sw";
import { OpenRemindersButton } from "../components/dashboard/open-reminders-button";
import { SnapshotNavTrigger } from "../components/dashboard/snapshot-nav-trigger";
import { UserMenu } from "../components/auth/user-menu";
import { ThemeProvider } from "../components/theme/theme-provider";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Personal Life OS",
  description: "Manage tasks and reminders with Clerk authentication.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/logo-remindos.svg",
    apple: "/logo-remindos.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <ClerkProvider>
          <ThemeProvider>
            <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
              <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
                <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <Image src="/logo-remindos.svg" alt="RemindOS logo" width={24} height={24} />
                  Personal Life OS
                </Link>
                <div className="flex items-center gap-3">
                  <Show when="signed-out">
                    <Link
                      href="/sign-in"
                      className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
                    >
                      Sign in
                    </Link>
                    <Link
                      href="/sign-up"
                      className="rounded-full bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500"
                    >
                      Sign up
                    </Link>
                  </Show>
                  <Show when="signed-in">
                    <OpenRemindersButton />
                    <SnapshotNavTrigger />
                    <UserMenu />
                  </Show>
                </div>
              </div>
            </header>
            {children}
            <InstallAppBanner />
            <RegisterServiceWorker />
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
