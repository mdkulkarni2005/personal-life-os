import { expect, type Locator, type Page } from "@playwright/test";
import { provisionClerkSession } from "../tests/support/clerk-e2e";
import type { Credentials } from "../utils/env";
import { getSignupVerificationCode } from "../utils/env";

export const MISSING_LOGIN_ACCOUNT_ERROR = "E2E_LOGIN_ACCOUNT_NOT_FOUND";

export class AuthPage {
  constructor(private readonly page: Page) {}

  private emailInput() {
    return this.page
      .locator('input[name="identifier"], input[name="emailAddress"], input[inputmode="email"]')
      .first();
  }

  private passwordInput() {
    return this.page.locator('input[name="password"]').first();
  }

  private confirmPasswordInput() {
    return this.page
      .locator('input[name="confirmPassword"], input[aria-label*="confirm password" i]')
      .first();
  }

  private firstNameInput() {
    return this.page.locator('input[name="firstName"]').first();
  }

  private lastNameInput() {
    return this.page.locator('input[name="lastName"]').first();
  }

  private primaryActionButton() {
    return this.page
      .locator("button")
      .filter({ hasText: /continue|sign in|create account|sign up|verify/i })
      .last();
  }

  private async verificationInputs() {
    const labelledInput = this.page.getByRole("textbox", {
      name: /verification code|enter code/i,
    });
    if ((await labelledInput.count()) > 0) {
      return labelledInput;
    }

    return this.page.locator(
      [
        'input[autocomplete="one-time-code"]',
        'input[name*="code"]',
        'input[aria-label*="verification code" i]',
        'input[aria-label*="enter code" i]',
        'input[placeholder*="verification code" i]',
        'input[placeholder*="enter code" i]',
      ].join(", "),
    );
  }

  private accountNotFoundAlert() {
    return this.page.getByText(/couldn't find your account/i).first();
  }

  private compromisedPasswordAlert() {
    return this.page.getByText(/password has been found as part of a breach/i).first();
  }

  private async fillIfVisible(locator: Locator, value: string) {
    if ((await locator.count()) === 0) return;
    await locator.fill(value);
  }

  private async fillRequired(locator: Locator, value: string) {
    await expect(locator).toBeVisible({ timeout: 30_000 });
    await locator.fill(value);
  }

  private async fillPasswordStep(password: string) {
    if ((await this.passwordInput().count()) === 0) return;
    await this.passwordInput().fill(password);
    await this.fillIfVisible(this.confirmPasswordInput(), password);
  }

  private async hasEditablePasswordInput() {
    if ((await this.passwordInput().count()) === 0) return false;
    return this.passwordInput().isEditable().catch(() => false);
  }

  private async clickPrimaryAction() {
    await expect(this.primaryActionButton()).toBeVisible({ timeout: 30_000 });
    await this.primaryActionButton().click();
  }

  private async completeVerificationIfPrompted(timeout = 10_000) {
    const verificationCode = getSignupVerificationCode();
    const inputs = await this.verificationInputs();
    const verificationVisible = await inputs
      .first()
      .waitFor({ state: "visible", timeout })
      .then(() => true)
      .catch(() => false);

    if (!verificationVisible) return;
    const count = await inputs.count();
    if (!verificationCode) {
      throw new Error(
        "Clerk requested verification. Set E2E_SIGNUP_VERIFICATION_CODE to continue the sign-up flow.",
      );
    }

    if (count === 1) {
      await inputs.first().click();
      await inputs.first().pressSequentially(verificationCode);
    } else {
      const digits = verificationCode.split("");
      for (let index = 0; index < count; index += 1) {
        await inputs.nth(index).fill(digits[index] ?? "");
      }
    }

    const reachedDashboard = await this.page
      .waitForURL(/\/dashboard(?:\?|$)/, { timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (reachedDashboard) return;

    const buttonBecameEnabled = await expect(this.primaryActionButton())
      .toBeEnabled({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!buttonBecameEnabled) return;

    await this.clickPrimaryAction();
  }

  async signIn(credentials: Credentials) {
    await expect(this.page.getByTestId("sign-in-page")).toBeVisible({ timeout: 30_000 });
    await this.fillRequired(this.emailInput(), credentials.email);
    await this.fillPasswordStep(credentials.password);
    await this.clickPrimaryAction();

    if (await this.hasEditablePasswordInput()) {
      await this.passwordInput().fill(credentials.password);
      await this.clickPrimaryAction();
    }

    await this.completeVerificationIfPrompted();
    if (await this.accountNotFoundAlert().isVisible().catch(() => false)) {
      throw new Error(MISSING_LOGIN_ACCOUNT_ERROR);
    }
    if (await this.compromisedPasswordAlert().isVisible().catch(() => false)) {
      throw new Error(
        "Clerk rejected the E2E password as compromised. Rotate E2E_USER_PASSWORD to a stronger value and retry.",
      );
    }
    await expect(this.page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 30_000 });
  }

  async signUp(credentials: Credentials) {
    await expect(this.page.getByTestId("sign-up-page")).toBeVisible({ timeout: 30_000 });
    await this.fillRequired(this.emailInput(), credentials.email);
    await this.fillIfVisible(this.firstNameInput(), "QA");
    await this.fillIfVisible(this.lastNameInput(), "Automation");
    await this.fillPasswordStep(credentials.password);
    await this.clickPrimaryAction();

    if (await this.hasEditablePasswordInput()) {
      await this.fillPasswordStep(credentials.password);
      await this.clickPrimaryAction();
    }

    await this.completeVerificationIfPrompted(3_000);
    const reachedDashboard = await this.page
      .waitForURL(/\/dashboard(?:\?|$)/, { timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (reachedDashboard) return;

    await provisionClerkSession(this.page, {
      email: credentials.email,
      password: credentials.password,
      firstName: "QA",
      lastName: "Automation",
    });
  }
}
