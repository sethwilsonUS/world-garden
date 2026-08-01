import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  clerk,
  clerkSetup,
  setupClerkTestingToken,
} from "@clerk/testing/playwright";
import { expect, test as setup } from "@playwright/test";

setup.describe.configure({ mode: "serial" });

const authFile = path.join(process.cwd(), "playwright/.clerk/user.json");

setup("configure Clerk testing tokens", async () => {
  await clerkSetup({
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
    dotenv: false,
  });
});

setup("authenticate the development text-scale user", async ({ page }) => {
  const testUserEmail = process.env.E2E_CLERK_USER_EMAIL?.trim();
  if (!testUserEmail) {
    throw new Error(
      "E2E_CLERK_USER_EMAIL is required to authenticate the development text-scale user.",
    );
  }

  await mkdir(path.dirname(authFile), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(authFile), 0o700);
  await setupClerkTestingToken({ context: page.context() });
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setEmulatedOSTextScale", { scale: 2 });
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/sign-in");
  await clerk.loaded({ page });
  await expect(
    page.getByRole("heading", { name: "Welcome back to the garden." }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      ),
    )
    .toBe(32);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);

  await page.goto("/");
  await clerk.loaded({ page });
  await clerk.signIn({
    page,
    emailAddress: testUserEmail,
  });

  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: /welcome back/i }),
  ).toBeVisible();
  await page.context().storageState({ path: authFile });
  await chmod(authFile, 0o600);
});
