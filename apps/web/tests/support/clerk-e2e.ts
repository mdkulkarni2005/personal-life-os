import { createRequire } from "node:module";
import { expect, type Page } from "@playwright/test";
import { resolveE2EEnv } from "../../utils/e2e-env";

const require = createRequire(import.meta.url);
const WALKTHROUGH_COMPLETED_KEY = "remindosWalkthroughCompleted";
const WALKTHROUGH_COMPLETED_AT_KEY = "remindosWalkthroughCompletedAt";

type BrowserClerkSignIn = {
  status?: string | null;
  createdSessionId?: string | null;
  ticket?: (params: { ticket: string }) => Promise<{ error?: unknown } | undefined>;
  create: (params: { strategy: "ticket"; ticket: string }) => Promise<{ error?: unknown } | undefined>;
  finalize?: (params: {
    navigate: (params: { decorateUrl: (target: string) => string }) => Promise<void>;
  }) => Promise<void>;
};

type BrowserClerk = {
  client?: {
    signIn?: BrowserClerkSignIn;
  };
  setActive?: (params: {
    session: string;
    navigate: (params: { decorateUrl: (target: string) => string }) => Promise<void>;
  }) => Promise<void>;
};

async function getClerkClient() {
  process.env.CLERK_SECRET_KEY ??= resolveE2EEnv("CLERK_SECRET_KEY") ?? "";
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error("CLERK_SECRET_KEY is required to provision the Playwright login user.");
  }

  const { clerkClient } = require("@clerk/nextjs/server") as typeof import("@clerk/nextjs/server");
  return clerkClient();
}

export async function ensureClerkUser(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}) {
  const client = await getClerkClient();
  const result = await client.users.getUserList({ emailAddress: [input.email], limit: 1 });
  const existingUser = result.data[0];

  if (!existingUser) {
    const createdUser = await client.users.createUser({
      emailAddress: [input.email],
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      skipPasswordChecks: true,
      skipPasswordRequirement: true,
    });
    await client.users.updateUserMetadata(createdUser.id, {
      privateMetadata: {
        [WALKTHROUGH_COMPLETED_KEY]: true,
        [WALKTHROUGH_COMPLETED_AT_KEY]: Date.now(),
      },
    });
    return createdUser.id;
  }

  await client.users.updateUser(existingUser.id, {
    password: input.password,
    firstName: input.firstName,
    lastName: input.lastName,
    skipPasswordChecks: true,
  });
  await client.users.updateUserMetadata(existingUser.id, {
    privateMetadata: {
      [WALKTHROUGH_COMPLETED_KEY]: true,
      [WALKTHROUGH_COMPLETED_AT_KEY]: Date.now(),
    },
  });
  return existingUser.id;
}

export async function signInWithClerkToken(page: Page, userId: string) {
  const client = await getClerkClient();
  const signInToken = await client.signInTokens.createSignInToken({
    userId,
    expiresInSeconds: 5 * 60,
  });
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await expect(page.getByTestId("sign-in-page")).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(
    () => Boolean((window as Window & { Clerk?: BrowserClerk }).Clerk?.client?.signIn),
    undefined,
    { timeout: 30_000 },
  );

  await page
    .evaluate(async ({ ticket }) => {
      const clerk = (window as Window & { Clerk?: BrowserClerk }).Clerk;
      const signIn = clerk?.client?.signIn;
      if (!clerk || !signIn) {
        throw new Error("Clerk sign-in client is not available on the localhost sign-in page.");
      }

      const ticketResult =
        typeof signIn.ticket === "function"
          ? await signIn.ticket({ ticket })
          : await signIn.create({ strategy: "ticket", ticket });

      if (ticketResult?.error) {
        throw new Error(JSON.stringify(ticketResult.error));
      }
      if (signIn.status !== "complete") {
        throw new Error(`Unexpected Clerk sign-in status: ${signIn.status ?? "unknown"}`);
      }

      const navigate = async ({
        decorateUrl,
      }: {
        decorateUrl: (target: string) => string;
      }) => {
        const redirectURL = decorateUrl("/dashboard");
        window.location.assign(redirectURL);
      };

      if (typeof signIn.finalize === "function") {
        await signIn.finalize({ navigate });
        return;
      }
      if (signIn.createdSessionId && typeof clerk.setActive === "function") {
        await clerk.setActive({ session: signIn.createdSessionId, navigate });
        return;
      }

      throw new Error("Clerk did not expose finalize() or setActive() for ticket sign-in.");
    }, { ticket: signInToken.token })
    .catch((error: Error) => {
      if (error.message.includes("Execution context was destroyed")) return null;
      throw error;
    });

  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 30_000 });
  await page.evaluate((id) => {
    window.localStorage.setItem(`remindos:walkthrough-completed:${id}`, "1");
  }, userId);
}

export async function provisionClerkSession(
  page: Page,
  input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  },
) {
  const userId = await ensureClerkUser(input);
  await signInWithClerkToken(page, userId);
  return userId;
}
