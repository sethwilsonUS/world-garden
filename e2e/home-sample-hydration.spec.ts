import { expect, test } from "@playwright/test";

test("the home listening sample plays on the first click while the app is loading", async ({
  page,
}) => {
  const scripts = Promise.withResolvers<void>();
  await page.route("**/_next/static/**/*.js*", async (route) => {
    await scripts.promise;
    await route.continue();
  });
  await page.addInitScript(() => {
    localStorage.setItem("curio-garden-playback-rate", "1.25");
  });

  try {
    await page.goto("/", { waitUntil: "commit" });
    const sample = page.getByRole("region", { name: "Hear it in 18 seconds" });
    const audio = sample.locator("audio");
    await expect(audio).toBeVisible();
    await expect(audio).toHaveAttribute("controls", "");
    await expect(sample.getByRole("button", { name: /^Play:/ })).toHaveCount(0);

    // Chromium exposes native media controls inside a closed shadow root.
    // Click its leading Play control, as a listener would before React is ready.
    await audio.focus();
    await audio.click({ position: { x: 26, y: 26 } });
    const currentTime = () =>
      audio.evaluate((media: HTMLAudioElement) => media.currentTime);
    await expect.poll(currentTime).toBeGreaterThan(0);
    await expect(audio).toBeFocused();
    const firstPosition = await currentTime();

    scripts.resolve();
    // Restoring the saved speed proves the player hydrated during playback.
    await expect
      .poll(() =>
        audio.evaluate((media: HTMLAudioElement) => media.playbackRate),
      )
      .toBe(1.25);
    await expect(audio).toBeFocused();
    await expect.poll(currentTime).toBeGreaterThan(firstPosition);

    await sample.getByText("Read transcript", { exact: true }).focus();
    const pause = sample.getByRole("button", {
      name: "Pause: Curio Garden listening sample",
    });
    await expect(pause).toBeVisible();
    await expect(audio).toBeHidden();
    await pause.click();
    await expect
      .poll(() => audio.evaluate((media: HTMLAudioElement) => media.paused))
      .toBe(true);
    expect(await currentTime()).toBeGreaterThan(firstPosition);
  } finally {
    scripts.resolve();
  }
});
