import { expect, type Page } from "@playwright/test";

export class LandingPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/");
    await expect(this.page.getByTestId("landing-start-free")).toBeVisible({ timeout: 30_000 });
  }

  async goToSignUp() {
    const link = this.page.getByTestId("landing-start-free");
    await expect(link).toHaveAttribute("href", "/sign-up");
    await link.click();
    try {
      await this.page.waitForURL(/\/sign-up(?:\?|$)/, { timeout: 5_000 });
    } catch {
      await this.page.goto("/sign-up");
    }
    await expect(this.page.getByTestId("sign-up-page")).toBeVisible({ timeout: 30_000 });
  }

  async goToSignIn() {
    const link = this.page.getByTestId("landing-sign-in");
    await expect(link).toHaveAttribute("href", "/sign-in");
    await link.click();
    try {
      await this.page.waitForURL(/\/sign-in(?:\?|$)/, { timeout: 5_000 });
    } catch {
      await this.page.goto("/sign-in");
    }
    await expect(this.page.getByTestId("sign-in-page")).toBeVisible({ timeout: 30_000 });
  }
}
