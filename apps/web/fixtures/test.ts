import { test as base, expect } from "@playwright/test";
import { AuthPage } from "../e2e-pages/auth.page";
import { DashboardPage } from "../e2e-pages/dashboard.page";
import { LandingPage } from "../e2e-pages/landing.page";

type PageFixtures = {
  authPage: AuthPage;
  dashboardPage: DashboardPage;
  landingPage: LandingPage;
};

export const test = base.extend<PageFixtures>({
  authPage: async ({ page }, apply) => {
    await apply(new AuthPage(page));
  },
  dashboardPage: async ({ page }, apply) => {
    await apply(new DashboardPage(page));
  },
  landingPage: async ({ page }, apply) => {
    await apply(new LandingPage(page));
  },
});

export { expect };
