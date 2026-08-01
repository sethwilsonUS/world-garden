import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3101",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: [/text-scaling\.spec\.ts/, /auth[/\\]/],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "text-scale-chromium",
      testMatch: /(^|[/\\])text-scaling\.spec\.ts$/,
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "text-scale-webkit",
      testMatch: /(^|[/\\])text-scaling\.spec\.ts$/,
      use: { ...devices["iPhone 15 Pro"] },
    },
  ],
  webServer: {
    command: "npm run local -- --hostname 127.0.0.1 --port 3101",
    env: {
      CURIO_E2E_FEEDBACK_FORM_AVAILABLE: "true",
    },
    url: "http://127.0.0.1:3101",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
