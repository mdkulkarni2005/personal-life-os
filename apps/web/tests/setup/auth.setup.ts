import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as setup } from "@playwright/test";
import { getLoginCredentials } from "../../utils/env";
import { ensureClerkUser, signInWithClerkToken } from "../support/clerk-e2e";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const authStatePath = path.resolve(currentDir, "../../.playwright/auth/user.json");
setup("cache authenticated browser state", async ({ page }) => {
  const credentials = getLoginCredentials();
  setup.skip(
    !credentials,
    "Authenticated specs require E2E_USER_EMAIL and E2E_USER_PASSWORD.",
  );

  await fs.mkdir(path.dirname(authStatePath), { recursive: true });
  const userId = await ensureClerkUser({
    email: credentials!.email,
    password: credentials!.password,
    firstName: "E2E",
    lastName: "User",
  });
  await signInWithClerkToken(page, userId);
  await page.context().storageState({ path: authStatePath });
});
