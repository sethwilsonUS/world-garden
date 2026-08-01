import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig, devices } from "@playwright/test";

for (const envFile of [".env.local", ".env.e2e.local"]) {
  if (existsSync(envFile)) loadEnvFile(envFile);
}

process.env.CLERK_PUBLISHABLE_KEY ??=
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??=
  process.env.CLERK_PUBLISHABLE_KEY;

const requiredVariables = [
  "CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "E2E_CLERK_USER_EMAIL",
] as const;

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    throw new Error(
      `${variable} is required for authenticated Playwright coverage.`,
    );
  }
}

if (
  !process.env.CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_") ||
  !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_") ||
  !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")
) {
  throw new Error("Authenticated E2E tests only run against Clerk test keys.");
}

if (
  process.env.CLERK_PUBLISHABLE_KEY !==
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
) {
  throw new Error(
    "Authenticated E2E tests require matching server and browser Clerk publishable keys.",
  );
}

export default defineConfig({
  testDir: "./e2e/auth",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "clerk-setup",
      testMatch: /(^|[/\\])clerk\.setup\.ts$/,
    },
    {
      name: "authenticated-text-scale",
      testMatch: /(^|[/\\])authenticated-text-scaling\.spec\.ts$/,
      use: {
        ...devices["Pixel 7"],
        storageState: "playwright/.clerk/user.json",
      },
      dependencies: ["clerk-setup"],
    },
  ],
  webServer: {
    command: "npm run dev:frontend -- --hostname localhost --port 3100",
    // Clerk middleware can perform a development-instance handshake for HTML
    // documents. Probe a static asset so readiness does not depend on auth.
    url: "http://localhost:3100/icon.svg",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
