import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { hasLoginCredentials, resolveE2EEnv } from "./utils/e2e-env";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.E2E_PORT ?? 3100);
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL ?? process.env.E2E_BASE_URL;
// Clerk session state is origin-scoped, so keep the auto-started test server on localhost.
const baseURL = externalBaseURL ?? `http://localhost:${PORT}`;
const webServerURL = new URL("/api/ping", baseURL).toString();
const authStatePath = path.resolve(currentDir, ".playwright/auth/user.json");
const includeAuthenticatedProjects = hasLoginCredentials(currentDir);

export default defineConfig({
  testDir: path.resolve(currentDir, "tests"),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: path.resolve(currentDir, "playwright-report") }],
    ["junit", { outputFile: path.resolve(currentDir, "test-results/junit.xml") }],
  ],
  outputDir: path.resolve(currentDir, "test-results/artifacts"),
  use: {
    baseURL,
    testIdAttribute: "data-testid",
    ignoreHTTPSErrors: true,
    timezoneId: resolveE2EEnv("E2E_TIMEZONE_ID", currentDir) ?? "Asia/Kolkata",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: externalBaseURL
    ? undefined
    : {
        command: `pnpm build && pnpm exec next start --port ${PORT}`,
        url: webServerURL,
        cwd: currentDir,
        reuseExistingServer: !process.env.CI,
        stdout: "pipe",
        stderr: "pipe",
        timeout: 300_000,
      },
  projects: [
    ...(includeAuthenticatedProjects
      ? [
          {
            name: "setup",
            testMatch: /tests\/setup\/auth\.setup\.ts/,
          },
          {
            name: "chromium",
            dependencies: ["setup"],
            testIgnore: ["tests/setup/**", "tests/auth/auth-ui.spec.ts"],
            use: {
              ...devices["Desktop Chrome"],
              storageState: authStatePath,
            },
          },
        ]
      : []),
    {
      name: "auth-ui",
      dependencies: includeAuthenticatedProjects ? ["setup"] : [],
      testMatch: /tests\/auth\/auth-ui\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});
