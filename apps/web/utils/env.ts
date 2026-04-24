import { resolveE2EEnv } from "./e2e-env";

export interface Credentials {
  email: string;
  password: string;
}

function withTaggedEmailAddress(email: string, tag: string) {
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) return null;

  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex);
  if (/\+clerk_test\b/i.test(local)) {
    return `${local.replace(/\+clerk_test\b/i, `+${tag}+clerk_test`)}${domain}`;
  }

  return `${local}+${tag}+clerk_test${domain}`;
}

function clerkTestTag() {
  return `e2e_${Date.now()}`;
}

function readCredentials(emailKey: string, passwordKey: string): Credentials | null {
  const email = resolveE2EEnv(emailKey);
  const password = resolveE2EEnv(passwordKey);

  if (!email || !password) return null;
  return { email, password };
}

export function getLoginCredentials(): Credentials | null {
  return readCredentials("E2E_USER_EMAIL", "E2E_USER_PASSWORD");
}

export function getSignupCredentials(): Credentials | null {
  const direct = readCredentials("E2E_SIGNUP_EMAIL", "E2E_SIGNUP_PASSWORD");
  if (direct) {
    const login = getLoginCredentials();
    if (login?.email === direct.email || /\+clerk_test\b/i.test(direct.email)) {
      const taggedEmail = withTaggedEmailAddress(direct.email, clerkTestTag());
      if (!taggedEmail) return null;

      return {
        email: taggedEmail,
        password: direct.password,
      };
    }

    return direct;
  }

  const prefix = resolveE2EEnv("E2E_SIGNUP_EMAIL_PREFIX");
  const domain = resolveE2EEnv("E2E_SIGNUP_EMAIL_DOMAIN");
  const password = resolveE2EEnv("E2E_SIGNUP_PASSWORD") ?? resolveE2EEnv("E2E_USER_PASSWORD");

  if (!prefix || !domain || !password) return null;

  const taggedEmail = withTaggedEmailAddress(`${prefix}@${domain}`, clerkTestTag());
  if (!taggedEmail) return null;

  return {
    email: taggedEmail,
    password,
  };
}

export function getSignupVerificationCode(): string | null {
  return resolveE2EEnv("E2E_SIGNUP_VERIFICATION_CODE") ?? null;
}

export function requireLoginCredentials(): Credentials {
  const credentials = getLoginCredentials();
  if (!credentials) {
    throw new Error("Set E2E_USER_EMAIL and E2E_USER_PASSWORD before running authenticated tests.");
  }
  return credentials;
}
