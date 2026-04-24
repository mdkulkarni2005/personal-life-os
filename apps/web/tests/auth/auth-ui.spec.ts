import { test } from "../../fixtures/test";
import { getLoginCredentials, getSignupCredentials } from "../../utils/env";

test.describe("Authentication flows", () => {
  test("existing user can sign in from the landing page", async ({
    authPage,
    dashboardPage,
    landingPage,
  }) => {
    const credentials = getLoginCredentials();
    test.skip(
      !credentials,
      "Set E2E_USER_EMAIL and E2E_USER_PASSWORD to run the sign-in flow.",
    );

    await landingPage.goto();
    await landingPage.goToSignIn();
    await authPage.signIn(credentials!);
    await dashboardPage.expectLoaded();
    await dashboardPage.signOut();
  });

  test("new user can register and sign back in", async ({
    authPage,
    dashboardPage,
    landingPage,
    page,
  }) => {
    test.slow();

    const credentials = getSignupCredentials();
    test.skip(
      !credentials,
      "Set E2E_SIGNUP_EMAIL and E2E_SIGNUP_PASSWORD (or prefix/domain envs) to run sign-up coverage.",
    );

    await landingPage.goto();
    await landingPage.goToSignUp();
    await authPage.signUp(credentials!);
    await dashboardPage.expectLoaded();
    await dashboardPage.signOut();

    await landingPage.goToSignIn();
    await authPage.signIn(credentials!);
    await dashboardPage.expectLoaded();
    await page.reload();
    await dashboardPage.expectLoaded();
  });
});
