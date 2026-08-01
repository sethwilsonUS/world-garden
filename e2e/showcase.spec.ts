import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const featuredRailImageUrl =
  "https://upload.wikimedia.org/featured-building.jpg";
const didYouKnowImageUrl =
  "https://upload.wikimedia.org/did-you-know-tortilla.jpg";
const trendingPortraitImageUrl = (index: number) =>
  `https://upload.wikimedia.org/trending-portrait-${index + 1}.jpg`;

const expectNoSeriousAxeViolations = async (page: Page) => {
  await page.addStyleTag({
    content:
      "*, *::before, *::after { animation: none !important; transition: none !important; }",
  });
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (violation) =>
      violation.impact === "critical" || violation.impact === "serious",
  );
  expect(serious).toEqual([]);
};

const expectVisibleFocusOutline = async (locator: Locator) => {
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0
        );
      }),
    )
    .toBe(true);
};

const todayFixture = {
  feedDate: "2026-07-10",
  // Wikimedia's featured feed uses this legacy date-only shape. Keep the
  // fixture exact so the browser test exercises our normalization path.
  trendingDate: "2026-07-12Z",
  tfa: {
    title: "Manufacturers Trust Company Building",
    extract:
      "The Manufacturers Trust Company Building is a commercial building in Midtown Manhattan. Its longer featured summary deliberately makes the image rail tall, matching the shape that exposed the letterboxing regression.",
    thumbnail: {
      source: featuredRailImageUrl,
      width: 960,
      height: 672,
      attribution: {
        creator: "Alfred Edward Chalon",
        licenseName: "Public domain",
        sourceTitle: "File:Ada Lovelace portrait.jpg",
        sourceUrl:
          "https://commons.wikimedia.org/wiki/File:Ada_Lovelace_portrait.jpg",
      },
    },
  },
  didYouKnow: Array.from({ length: 4 }, (_, index) => ({
    text: `... that accessible fact ${index + 1} invites another question?`,
    links:
      index === 0
        ? [
            {
              title: "Tortilla",
              slug: "Tortilla",
              thumbnail: {
                source: didYouKnowImageUrl,
                width: 960,
                height: 540,
              },
            },
          ]
        : [],
    segments: [
      {
        type: "text",
        text: `... that accessible fact ${index + 1} invites another question?`,
      },
    ],
  })),
  inTheNews: Array.from({ length: 3 }, (_, index) => ({
    story: `News story ${index + 1}`,
    links: [],
  })),
  onThisDay: [{ year: 1969, text: "A notable event happened.", pages: [] }],
  trending: Array.from({ length: 5 }, (_, index) => ({
    title: `Trending topic ${index + 1}`,
    extract: "A concise explanation of the topic.",
    views: 1000 - index,
    thumbnail: {
      source: trendingPortraitImageUrl(index),
      width: 330,
      height: 495,
    },
  })),
};

const mockHomeData = async (page: Page) => {
  await page.route("**/api/featured", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(todayFixture),
    }),
  );
  await page.route("**/api/trending/brief", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ brief: null }),
    }),
  );
  await page.route("https://upload.wikimedia.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: tinyPng }),
  );
};

const mockMediaPlayback = async (page: Page) => {
  await page.addInitScript(() => {
    const currentTimes = new WeakMap<HTMLMediaElement, number>();
    const pausedStates = new WeakMap<HTMLMediaElement, boolean>();

    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get() {
        return currentTimes.get(this) ?? 0;
      },
      set(value: number) {
        currentTimes.set(this, value);
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "paused", {
      configurable: true,
      get() {
        return pausedStates.get(this) ?? true;
      },
    });
    document.addEventListener(
      "ended",
      (event) => {
        if (event.target instanceof HTMLMediaElement) {
          pausedStates.set(event.target, true);
        }
      },
      true,
    );

    HTMLMediaElement.prototype.play = function () {
      pausedStates.set(this, false);
      this.dispatchEvent(new Event("play"));
      this.dispatchEvent(new Event("playing"));
      return Promise.resolve();
    };

    HTMLMediaElement.prototype.pause = function () {
      pausedStates.set(this, true);
      this.dispatchEvent(new Event("pause"));
    };
  });
};

const expectPhotoFirstFrame = async (
  page: Page,
  source: string,
  options: { portrait?: boolean } = {},
) => {
  const frame = page.locator("[data-adaptive-image-frame]").filter({
    has: page.locator(`img[src="${source}"]`),
  });

  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveAttribute("data-adaptive-image-mode", "cover");
  await expect(frame.locator("img")).toHaveCount(1);
  await expect(frame.locator("img")).toHaveCSS("object-fit", "cover");
  if (options.portrait) {
    await expect(frame.locator("img")).toHaveCSS("object-position", "50% 30%");
  }
};

const analyticalThumbnailUrl =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Analytical_Engine.jpg/330px-Analytical_Engine.jpg";
const analyticalLightboxUrl =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Analytical_Engine.jpg/1600px-Analytical_Engine.jpg";

const mockArticleData = async (
  page: Page,
  options: {
    failAnalyticalLightbox?: boolean;
    failAnalyticalThumbnail?: boolean;
  } = {},
) => {
  const lightboxRequests: string[] = [];

  await page.route("**/api/tts", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "TTS is disabled in this browser fixture.",
      }),
    }),
  );

  await page.route("**/api/local-wikipedia", async (route) => {
    const request = route.request().postDataJSON() as {
      operation?: string;
    };

    if (request.operation === "article") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            wikiPageId: "974",
            revisionId: "123456789",
            title: "Ada Lovelace",
            language: "en",
            narrationVersion: 2,
            lastEdited: "2026-07-10T12:00:00Z",
            summary: "Ada Lovelace was an English mathematician and writer.",
            thumbnailUrl:
              "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Ada_portrait.jpg/800px-Ada_portrait.jpg",
            thumbnailWidth: 800,
            thumbnailHeight: 1067,
            thumbnailAttribution: {
              creator: "Alfred Edward Chalon",
              licenseName: "Public domain",
              sourceTitle: "File:Ada portrait.jpg",
              sourceUrl:
                "https://commons.wikimedia.org/wiki/File:Ada_portrait.jpg",
            },
            sections: [
              {
                wikiSectionIndex: "1",
                title: "Early life",
                level: 2,
                content:
                  "She developed an enduring interest in mathematics and machines.",
                narration: {
                  mode: "verbatim",
                  text: "Early life. She developed an enduring interest in mathematics and machines.",
                  sourceFormat: "prose",
                  adapted: false,
                  usedRawFallback: false,
                  sourceHash: "early-life-source-hash",
                },
              },
              {
                wikiSectionIndex: "2",
                title: "Recognition",
                level: 2,
                content: "Honours Year Award 1843 Published notes",
                narration: {
                  mode: "structured",
                  text: "Recognition. Table: Honours. Year: 1843; Award: Published notes.",
                  sourceFormat: "table",
                  adapted: true,
                  usedRawFallback: false,
                  sourceHash: "recognition-source-hash",
                },
              },
            ],
          },
        }),
      });
      return;
    }

    if (request.operation === "metadata") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            linkCounts: [],
            citations: [],
            sectionCitations: [],
            sectionIndexMap: [
              { title: "Early life", index: "1" },
              { title: "Recognition", index: "2" },
            ],
            images: [
              {
                src: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Ada_portrait.jpg/330px-Ada_portrait.jpg",
                originalSrc:
                  "https://upload.wikimedia.org/wikipedia/commons/a/ab/Ada_portrait.jpg",
                lightboxSrc:
                  "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Ada_portrait.jpg/1600px-Ada_portrait.jpg",
                lightboxWidth: 1600,
                lightboxHeight: 2133,
                alt: "Portrait of Ada Lovelace",
                caption: "Portrait of Ada Lovelace",
                width: 330,
                height: 440,
                attribution: {
                  creator: "Alfred Edward Chalon",
                  licenseName: "Public domain",
                  sourceTitle: "File:Ada portrait.jpg",
                  sourceUrl:
                    "https://commons.wikimedia.org/wiki/File:Ada_portrait.jpg",
                },
              },
              {
                src: analyticalThumbnailUrl,
                originalSrc:
                  "https://upload.wikimedia.org/wikipedia/commons/c/cf/Analytical_Engine.jpg",
                lightboxSrc: analyticalLightboxUrl,
                lightboxWidth: 1600,
                lightboxHeight: 1067,
                alt: "Analytical Engine mechanisms",
                caption: "Analytical Engine at the Science Museum",
                width: 330,
                height: 220,
                attribution: {
                  creator: "Science Museum",
                  licenseName: "Public domain",
                  sourceTitle: "File:Analytical Engine.jpg",
                  sourceUrl:
                    "https://commons.wikimedia.org/wiki/File:Analytical_Engine.jpg",
                },
              },
            ],
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.route("https://upload.wikimedia.org/**", (route) => {
    const requestUrl = route.request().url();
    if (requestUrl.includes("/1600px-")) lightboxRequests.push(requestUrl);
    if (
      (options.failAnalyticalLightbox &&
        requestUrl === analyticalLightboxUrl) ||
      (options.failAnalyticalThumbnail && requestUrl === analyticalThumbnailUrl)
    ) {
      return route.fulfill({
        status: 404,
        contentType: "text/plain",
        body: "Missing test rendition",
      });
    }
    return route.fulfill({ contentType: "image/png", body: tinyPng });
  });

  await page.route("https://commons.wikimedia.org/w/api.php**", (route) => {
    const url = new URL(route.request().url());
    const titles = (url.searchParams.get("titles") ?? "File:Ada portrait.jpg")
      .split("|")
      .filter(Boolean);
    const pages = Object.fromEntries(
      titles.map((title, index) => {
        const analytical = title.includes("Analytical Engine");
        const filename = analytical
          ? "Analytical_Engine.jpg"
          : "Ada_portrait.jpg";
        const directory = analytical ? "c/cf" : "a/ab";
        const creator = analytical ? "Science Museum" : "Alfred Edward Chalon";
        const originalWidth = 2400;
        const originalHeight = analytical ? 1600 : 3200;
        const thumbHeight = analytical ? 1067 : 2133;

        return [
          String(index + 1),
          {
            title,
            imagerepository: "shared",
            imageinfo: [
              {
                descriptionurl: `https://commons.wikimedia.org/wiki/File:${filename}`,
                url: `https://upload.wikimedia.org/wikipedia/commons/${directory}/${filename}`,
                width: originalWidth,
                height: originalHeight,
                thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/${directory}/${filename}/1600px-${filename}`,
                thumbwidth: 1600,
                thumbheight: thumbHeight,
                mime: "image/jpeg",
                extmetadata: {
                  Artist: { value: creator },
                  LicenseShortName: { value: "Public domain" },
                },
              },
            ],
          },
        ];
      }),
    );

    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ query: { pages } }),
    });
  });

  await page.route("https://en.wikipedia.org/w/api.php**", async (route) => {
    const url = new URL(route.request().url());
    const prop = url.searchParams.get("prop") ?? "";

    if (prop.includes("imageinfo")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          query: {
            pages: {
              "1": {
                title: "File:Ada portrait.jpg",
                imageinfo: [
                  {
                    descriptionurl:
                      "https://commons.wikimedia.org/wiki/File:Ada_portrait.jpg",
                    extmetadata: {
                      Artist: { value: "Alfred Edward Chalon" },
                      LicenseShortName: { value: "Public domain" },
                    },
                  },
                ],
              },
            },
          },
        }),
      });
      return;
    }

    if (
      url.searchParams.get("action") === "parse" &&
      url.searchParams.get("oldid") === "123456789"
    ) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          parse: {
            revid: 123456789,
            text: [
              "<h2>Early life</h2><p>She developed an enduring interest in mathematics and machines.</p>",
              "<h2>Recognition</h2><table><caption>Honours</caption><tr><th>Year</th><th>Award</th></tr><tr><td>1843</td><td>Published notes</td></tr></table>",
            ].join(""),
            sections: [
              { index: "1", line: "Early life", level: "2" },
              { index: "2", line: "Recognition", level: "2" },
            ],
          },
        }),
      });
      return;
    }

    if (url.searchParams.get("action") === "parse") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          parse: {
            text: {
              "*": [
                '<figure typeof="mw:File/Thumb"><a href="/wiki/File:Ada_portrait.jpg"><img src="//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Ada_portrait.jpg/330px-Ada_portrait.jpg" width="330" height="440" alt="Portrait of Ada Lovelace"></a><figcaption>Portrait of Ada Lovelace</figcaption></figure>',
                `<figure typeof="mw:File/Thumb"><a href="/wiki/File:Analytical_Engine.jpg"><img src="${analyticalThumbnailUrl}" width="330" height="220" alt="Analytical Engine mechanisms"></a><figcaption>Analytical Engine at the Science Museum</figcaption></figure>`,
              ].join(""),
            },
            sections: [],
          },
        }),
      });
      return;
    }

    if (url.searchParams.get("list") === "search") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ query: { search: [] } }),
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        query: {
          pages: {
            "974": {
              pageid: 974,
              title: "Ada Lovelace",
              extract:
                "Ada Lovelace was an English mathematician and writer.\n\n== Early life ==\n\nShe developed an enduring interest in mathematics and machines.\n\n== Recognition ==\n\nYear Award\n1843 Published notes",
              revisions: [
                { revid: 123456789, timestamp: "2026-07-10T12:00:00Z" },
              ],
              thumbnail: {
                source:
                  "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Ada_portrait.jpg/800px-Ada_portrait.jpg",
                width: 800,
                height: 1067,
              },
            },
          },
        },
      }),
    });
  });

  return { lightboxRequests };
};

test("home presents the product and expands the curated daily preview", async ({
  page,
}) => {
  await mockMediaPlayback(page);
  await mockHomeData(page);
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "Curio Garden" }),
  ).toBeVisible();
  const homeSearch = page.getByRole("searchbox", { name: "Search topic" });
  await expect(homeSearch).toBeVisible();
  await expect(homeSearch).not.toBeFocused();
  await expect(
    page.getByText(
      "Explore any Wikipedia article as clear, section-by-section audio, then keep listening wherever curiosity takes you.",
    ),
  ).toBeVisible();
  const listeningSample = page.getByRole("region", {
    name: "Start with a short listen",
  });
  await expect(listeningSample).toBeVisible();
  const searchWorkbench = page.locator("[data-home-search-workbench]");
  const searchPane = page.locator("[data-home-search-pane]");
  const homeContent = page.locator("[data-home-content]");
  const [workbenchBox, searchPaneBox, listeningSampleBox, homeContentBox] =
    await Promise.all([
      searchWorkbench.boundingBox(),
      searchPane.boundingBox(),
      listeningSample.boundingBox(),
      homeContent.boundingBox(),
    ]);
  expect(workbenchBox).not.toBeNull();
  expect(searchPaneBox).not.toBeNull();
  expect(listeningSampleBox).not.toBeNull();
  expect(homeContentBox).not.toBeNull();
  expect(searchPaneBox!.x).toBeLessThan(listeningSampleBox!.x);
  expect(
    Math.abs(searchPaneBox!.y - listeningSampleBox!.y),
  ).toBeLessThanOrEqual(1);
  expect(searchPaneBox!.width / listeningSampleBox!.width).toBeCloseTo(2, 1);
  expect(workbenchBox!.width).toBeGreaterThan(homeContentBox!.width);
  const [searchBackground, playerBackground] = await Promise.all([
    searchPane.evaluate((element) => getComputedStyle(element).backgroundColor),
    listeningSample.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  ]);
  expect(searchBackground).not.toBe(playerBackground);
  await expect(
    listeningSample.getByText(
      "Hear how a Wikipedia page becomes a clear listening path.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    listeningSample.getByText("No account or search needed", { exact: false }),
  ).toHaveCount(0);
  const sampleAudio = listeningSample.locator("audio");
  await expect(sampleAudio).toBeHidden();
  await expect(sampleAudio).toHaveAttribute("hidden", "");
  await expect(sampleAudio).toHaveAttribute("aria-hidden", "true");
  await expect(sampleAudio).toHaveAttribute(
    "src",
    "/audio/curio-garden-listening-sample-edge-v1.mp3",
  );
  await expect(sampleAudio).toHaveAttribute("preload", "metadata");
  expect(
    await sampleAudio.evaluate((audio) => audio.hasAttribute("controls")),
  ).toBe(false);

  const samplePlayer = listeningSample.getByRole("group", {
    name: "Audio player for Curio Garden listening sample",
  });
  const playButton = samplePlayer.getByRole("button", {
    name: "Play: Curio Garden listening sample",
    exact: true,
  });
  const speedButton = samplePlayer.getByRole("button", {
    name: /^Playback speed /,
  });
  const progressSlider = samplePlayer.getByRole("slider", {
    name: /^Playback position/,
  });
  await expect(playButton).toBeVisible();
  await expect(speedButton).toBeVisible();
  await expect(progressSlider).toBeVisible();
  await expect(progressSlider).toHaveClass(/article-audio-progress-range/);
  await expect(samplePlayer.getByText("Synthetic speech audio.")).toHaveCount(
    0,
  );
  await expect(
    samplePlayer.getByRole("link", {
      name: "Download audio for Curio Garden listening sample",
    }),
  ).toHaveCount(0);
  await expect(
    samplePlayer.getByText("Listen: Curio Garden in 18 seconds"),
  ).toHaveCount(0);

  const progressStyle = await progressSlider.evaluate((slider) => {
    const style = getComputedStyle(slider);
    const accentToken = getComputedStyle(
      document.documentElement,
    ).getPropertyValue("--color-accent");
    const accentProbe = document.createElement("span");
    accentProbe.style.color = "var(--color-accent)";
    document.body.append(accentProbe);
    const resolvedAccentColor = getComputedStyle(accentProbe).color;
    accentProbe.remove();

    return {
      appearance: style.appearance,
      backgroundImage: style.backgroundImage,
      height: style.height,
      accentToken: accentToken.trim(),
      playedColor: style.getPropertyValue("--played-color").trim(),
      resolvedAccentColor,
    };
  });
  expect(progressStyle.appearance).toBe("none");
  expect(progressStyle.backgroundImage).toContain("linear-gradient");
  expect(progressStyle.playedColor).toBe(progressStyle.accentToken);
  expect(progressStyle.backgroundImage).toContain(
    progressStyle.resolvedAccentColor,
  );
  expect(parseFloat(progressStyle.height)).toBeGreaterThanOrEqual(44);

  const playTarget = await playButton.boundingBox();
  expect(playTarget).not.toBeNull();
  expect(playTarget!.width).toBeGreaterThanOrEqual(44);
  expect(playTarget!.height).toBeGreaterThanOrEqual(44);
  const rangeTarget = await progressSlider.boundingBox();
  expect(rangeTarget).not.toBeNull();
  expect(rangeTarget!.height).toBeGreaterThanOrEqual(44);

  await progressSlider.focus();
  const positionBeforeSeek = Number(await progressSlider.inputValue());
  await progressSlider.press("ArrowRight");
  await expect
    .poll(async () => Number(await progressSlider.inputValue()))
    .toBeGreaterThan(positionBeforeSeek);

  const playAfterSeekButton = samplePlayer.getByRole("button", {
    name: "Resume: Curio Garden listening sample",
    exact: true,
  });
  await expect(playAfterSeekButton).toBeVisible();
  await playAfterSeekButton.click();
  const pauseButton = samplePlayer.getByRole("button", {
    name: "Pause: Curio Garden listening sample",
    exact: true,
  });
  await expect(pauseButton).toBeVisible();
  await pauseButton.click();
  const resumeButton = samplePlayer.getByRole("button", {
    name: "Resume: Curio Garden listening sample",
    exact: true,
  });
  await expect(resumeButton).toBeVisible();
  await resumeButton.click();
  await expect(pauseButton).toBeVisible();
  await expect
    .poll(async () => Number(await progressSlider.getAttribute("max")))
    .toBeGreaterThan(0);
  const sliderMax = Number(await progressSlider.getAttribute("max"));
  const sliderStep = Number(await progressSlider.getAttribute("step"));
  expect(sliderStep).toBeGreaterThan(0);
  await progressSlider.focus();
  await progressSlider.press("End");
  const completedPosition = Number(await progressSlider.inputValue());
  expect(completedPosition).toBeGreaterThanOrEqual(sliderMax - sliderStep);
  expect(completedPosition).toBeLessThanOrEqual(sliderMax);
  await sampleAudio.dispatchEvent("ended");
  const replayButton = samplePlayer.getByRole("button", {
    name: "Replay: Curio Garden listening sample",
    exact: true,
  });
  await expect(replayButton).toBeVisible();
  await progressSlider.press("ArrowLeft");
  const resumedPosition = Number(await progressSlider.inputValue());
  expect(resumedPosition).toBeGreaterThan(0);
  expect(resumedPosition).toBeLessThan(completedPosition);
  const resumeAfterSeek = samplePlayer.getByRole("button", {
    name: "Resume: Curio Garden listening sample",
    exact: true,
  });
  await expect(resumeAfterSeek).toBeVisible();
  await resumeAfterSeek.click();
  await expect(pauseButton).toBeVisible();
  await expect
    .poll(async () =>
      sampleAudio.evaluate((audio) => (audio as HTMLAudioElement).currentTime),
    )
    .toBeCloseTo(resumedPosition, 2);

  await listeningSample.getByText("Read transcript", { exact: true }).click();
  await expect(
    listeningSample.getByText(
      "Welcome to Curio Garden. A Wikipedia article becomes a listening path:",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(page.getByText("Audio-first Wikipedia")).toHaveCount(0);
  await expect(
    page.getByText("accessible fact 4", { exact: false }),
  ).toBeHidden();

  await page.getByRole("button", { name: "Show all 4 facts" }).click();
  await expect(
    page.getByText("accessible fact 4", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show fewer facts" }),
  ).toBeFocused();
  await expectNoSeriousAxeViolations(page);
});

test("home listening sample and search reflow at 320 pixels", async ({
  page,
  request,
}) => {
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.addInitScript(() => {
    window.localStorage.setItem("theme", "dark");
    window.localStorage.setItem("curio-garden-playback-rate", "1.5");
  });
  await mockHomeData(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");

  const assetResponse = await request.get(
    "/audio/curio-garden-listening-sample-edge-v1.mp3",
  );
  expect(assetResponse.status()).toBe(200);
  expect(assetResponse.headers()["content-type"]).toContain("audio/mpeg");

  await expect(page.locator("html")).toHaveClass(/dark/);
  const listeningSample = page.getByRole("region", {
    name: "Start with a short listen",
  });
  await expect(listeningSample).toBeVisible();
  const searchPane = page.locator("[data-home-search-pane]");
  const [searchPaneBox, listeningSampleBox] = await Promise.all([
    searchPane.boundingBox(),
    listeningSample.boundingBox(),
  ]);
  expect(searchPaneBox).not.toBeNull();
  expect(listeningSampleBox).not.toBeNull();
  expect(listeningSampleBox!.y).toBeGreaterThan(
    searchPaneBox!.y + searchPaneBox!.height,
  );
  const samplePlayer = listeningSample.getByRole("group", {
    name: "Audio player for Curio Garden listening sample",
  });
  const playerButtons = [
    samplePlayer.getByRole("button", { name: "Skip back 10 seconds" }),
    samplePlayer.getByRole("button", {
      name: "Play: Curio Garden listening sample",
      exact: true,
    }),
    samplePlayer.getByRole("button", { name: "Skip forward 10 seconds" }),
    samplePlayer.getByRole("button", { name: /^Playback speed / }),
  ];
  const progressSlider = samplePlayer.getByRole("slider", {
    name: /^Playback position/,
  });
  const playerControls = [...playerButtons, progressSlider];
  for (const control of playerControls) {
    await expect(control).toBeVisible();
    await control.focus();
    await expect(control).toBeFocused();
    await expectVisibleFocusOutline(control);
  }
  for (const button of playerButtons) {
    const target = await button.boundingBox();
    expect(target).not.toBeNull();
    expect(target!.width).toBeGreaterThanOrEqual(44);
    expect(target!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(playerButtons[3]).toHaveAccessibleName(
    "Playback speed 1.5x. Activate to change.",
  );
  expect(runtimeErrors).toEqual([]);

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(0);
  await expectNoSeriousAxeViolations(page);
});

test("default audio player controls stay inside a nested mobile surface", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("curio-garden-playback-rate", "1.75");
  });
  await mockHomeData(page);
  await page.unroute("**/api/trending/brief");
  await page.route("**/api/trending/brief", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        enabled: true,
        status: "ready",
        brief: {
          headline: "Why these topics are trending",
          summary: "A concise daily briefing.",
          model: "gpt-test",
          audioUrl: "/audio/curio-garden-listening-sample-edge-v1.mp3",
        },
      }),
    }),
  );
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/trending");

  const player = page.getByRole("group", {
    name: "Audio player for Why these topics are trending",
  });
  await expect(player).toBeVisible();
  const speedButton = player.getByRole("button", {
    name: "Playback speed 1.75x. Activate to change.",
  });
  await expect(speedButton).toBeVisible();

  const buttons = [
    player.getByRole("button", { name: "Skip back 10 seconds" }),
    player.getByRole("button", {
      name: "Play: Why these topics are trending",
      exact: true,
    }),
    player.getByRole("button", { name: "Skip forward 10 seconds" }),
    speedButton,
  ];
  const controls = [
    ...buttons,
    player.getByRole("slider", { name: "Playback position" }),
  ];
  const surface = player.locator("[data-audio-player-surface]");
  const surfaceBox = await surface.boundingBox();
  expect(surfaceBox).not.toBeNull();
  const layoutRoundingTolerance = 0.5;

  for (const button of buttons) {
    const target = await button.boundingBox();
    expect(target).not.toBeNull();
    expect(target!.width).toBeGreaterThanOrEqual(44);
    expect(target!.height).toBeGreaterThanOrEqual(44);
  }
  for (const control of controls) {
    const target = await control.boundingBox();
    expect(target).not.toBeNull();
    expect(target!.x).toBeGreaterThanOrEqual(
      surfaceBox!.x - layoutRoundingTolerance,
    );
    expect(target!.y).toBeGreaterThanOrEqual(
      surfaceBox!.y - layoutRoundingTolerance,
    );
    expect(target!.x + target!.width).toBeLessThanOrEqual(
      surfaceBox!.x + surfaceBox!.width + layoutRoundingTolerance,
    );
    expect(target!.y + target!.height).toBeLessThanOrEqual(
      surfaceBox!.y + surfaceBox!.height + layoutRoundingTolerance,
    );
  }
});

test("audio player labels and controls reflow inside a mobile surface with enlarged text", async ({
  page,
}) => {
  const longTitle =
    "Why extraordinarily long and wonderfully specific topics are trending around the world today";
  await mockHomeData(page);
  await page.unroute("**/api/trending/brief");
  await page.route("**/api/trending/brief", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        enabled: true,
        status: "ready",
        brief: {
          headline: longTitle,
          summary: "A concise daily briefing.",
          model: "gpt-test",
          audioUrl: "/audio/curio-garden-listening-sample-edge-v1.mp3",
        },
      }),
    }),
  );
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/trending");
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });

  const player = page.getByRole("group", {
    name: `Audio player for ${longTitle}`,
  });
  const visibleLabel = player.getByText(
    "Listen: AI-generated daily trending briefing",
    { exact: true },
  );
  await expect(visibleLabel).toBeVisible();
  await expect(visibleLabel).toHaveCSS("white-space", "normal");

  const surface = player.locator("[data-audio-player-surface]");
  const surfaceBox = await surface.boundingBox();
  expect(surfaceBox).not.toBeNull();
  const controls = [
    player.getByRole("button", { name: "Skip back 10 seconds" }),
    player.getByRole("button", { name: `Play: ${longTitle}` }),
    player.getByRole("button", { name: "Skip forward 10 seconds" }),
    player.getByRole("button", { name: /^Playback speed / }),
    player.getByRole("slider", { name: "Playback position" }),
  ];
  for (const control of controls) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(surfaceBox!.x - 0.5);
    expect(box!.x + box!.width).toBeLessThanOrEqual(
      surfaceBox!.x + surfaceBox!.width + 0.5,
    );
  }

  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
});

test("ordinary editorial photos fill their frames without blurred bars", async ({
  page,
}) => {
  await page.addInitScript(() => window.localStorage.setItem("theme", "dark"));
  await mockHomeData(page);
  await page.goto("/");

  // Clicking a client-side control ensures the assertions run after hydration.
  await page.getByRole("button", { name: "Show all 4 facts" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  const homepageImages = [
    { source: featuredRailImageUrl },
    { source: didYouKnowImageUrl },
    { source: trendingPortraitImageUrl(0), portrait: true },
  ];
  for (const image of homepageImages) {
    await expectPhotoFirstFrame(page, image.source, {
      portrait: image.portrait,
    });
  }

  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveClass(/light/);
  for (const image of homepageImages) {
    await expectPhotoFirstFrame(page, image.source, {
      portrait: image.portrait,
    });
  }

  await page.goto("/trending");
  await expect(
    page.getByRole("heading", { level: 1, name: "Trending today" }),
  ).toBeVisible();
  await expectPhotoFirstFrame(page, trendingPortraitImageUrl(0), {
    portrait: true,
  });
});

test.describe("date-only labels stay on the Wikimedia calendar date", () => {
  test.describe("west of UTC", () => {
    test.use({ timezoneId: "America/Chicago" });

    test("the Trending page does not roll a UTC-midnight date backward", async ({
      page,
    }) => {
      await mockHomeData(page);
      await page.goto("/trending");

      await expect(
        page.getByText("Most-read data from: Jul 12, 2026", { exact: true }),
      ).toBeVisible();
    });
  });

  test.describe("east of UTC", () => {
    test.use({ timezoneId: "Pacific/Kiritimati" });

    test("the home page does not roll a noon-UTC date forward", async ({
      page,
    }) => {
      await mockHomeData(page);
      await page.goto("/");

      await expect(
        page.getByText("Last updated: Jul 12, 2026", { exact: true }),
      ).toBeVisible();
    });
  });
});

test("article exposes revision and media provenance in an accessible lightbox", async ({
  page,
}) => {
  const { lightboxRequests } = await mockArticleData(page);
  await page.goto("/article/Ada_Lovelace");

  await expect(
    page.getByRole("heading", { level: 1, name: "Ada Lovelace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Revision 123456789/ }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Image by Alfred Edward Chalon", { exact: false }).first(),
  ).toBeVisible();

  const heroLightboxButton = page.getByRole("button", {
    name: "View full image for Ada Lovelace",
  });
  await heroLightboxButton.focus();
  await page.emulateMedia({ forcedColors: "active" });
  await expectVisibleFocusOutline(heroLightboxButton);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Image gallery" }),
  ).toBeVisible();
  await expect(page.getByText("Creator: Alfred Edward Chalon")).toBeVisible();
  const heroCloseButton = page.getByRole("button", { name: "Close lightbox" });
  await expect(heroCloseButton).toBeFocused();
  await expectVisibleFocusOutline(heroCloseButton);
  await page.emulateMedia({ forcedColors: "none" });
  await heroCloseButton.click();
  await expect(heroLightboxButton).toBeFocused();

  const additionalPhotoButton = page.getByRole("button", {
    name: "Open image 2 of 2: Analytical Engine at the Science Museum",
  });
  await expect(additionalPhotoButton).toBeVisible();
  await expect(additionalPhotoButton).toHaveAttribute(
    "aria-haspopup",
    "dialog",
  );
  expect(lightboxRequests).not.toContain(analyticalLightboxUrl);

  await additionalPhotoButton.focus();
  await page.emulateMedia({ forcedColors: "active" });
  await expectVisibleFocusOutline(additionalPhotoButton);
  await page.emulateMedia({ forcedColors: "none" });
  await expect
    .poll(() =>
      additionalPhotoButton.evaluate(
        (element) => getComputedStyle(element).boxShadow,
      ),
    )
    .not.toBe("none");
  await page.keyboard.press("Enter");
  const galleryDialog = page.getByRole("dialog", { name: "Image gallery" });
  await expect(galleryDialog).toBeVisible();
  await expect(
    galleryDialog.getByRole("button", { name: "Close lightbox" }),
  ).toBeFocused();
  await expect.poll(() => lightboxRequests).toContain(analyticalLightboxUrl);

  const stage = galleryDialog.locator("[data-lightbox-media-stage]");
  const stageBox = await stage.boundingBox();
  expect(stageBox?.width).toBeGreaterThan(330);
  expect(stageBox?.height).toBeGreaterThan(240);
  const displayedImage = galleryDialog.getByRole("img", {
    name: "Analytical Engine mechanisms",
  });
  const displayedImageBox = await displayedImage.boundingBox();
  expect(displayedImageBox?.width).toBeGreaterThan(330);

  const previousButton = galleryDialog.getByRole("button", {
    name: "Previous image",
  });
  const nextButton = galleryDialog.getByRole("button", {
    name: "Next image",
  });
  await previousButton.click();
  await expect(galleryDialog.getByRole("status")).toContainText(
    "Portrait of Ada Lovelace, image 1 of 2",
  );
  await nextButton.click();
  await expect(galleryDialog.getByRole("status")).toContainText(
    "Analytical Engine at the Science Museum, image 2 of 2",
  );

  await stage.evaluate((element) => {
    const touchStart = new Event("touchstart", { bubbles: true });
    Object.defineProperty(touchStart, "touches", {
      value: [{ clientX: 600, clientY: 300 }],
    });
    element.dispatchEvent(touchStart);

    const touchEnd = new Event("touchend", { bubbles: true });
    Object.defineProperty(touchEnd, "changedTouches", {
      value: [{ clientX: 450, clientY: 305 }],
    });
    element.dispatchEvent(touchEnd);
  });
  await expect(galleryDialog.getByRole("status")).toContainText(
    "Portrait of Ada Lovelace, image 1 of 2",
  );

  await page.keyboard.press("ArrowRight");
  await expect(galleryDialog.getByRole("status")).toContainText(
    "Analytical Engine at the Science Museum, image 2 of 2",
  );
  await page.keyboard.press("ArrowLeft");
  await expect(galleryDialog.getByRole("status")).toContainText(
    "Portrait of Ada Lovelace, image 1 of 2",
  );
  await page.keyboard.press("ArrowRight");
  await expect(galleryDialog.getByRole("status")).toContainText(
    "Analytical Engine at the Science Museum, image 2 of 2",
  );
  await expectNoSeriousAxeViolations(page);

  await page.keyboard.press("Escape");
  await expect(galleryDialog).toBeHidden();
  await expect(additionalPhotoButton).toBeFocused();
  await expectNoSeriousAxeViolations(page);
});

test("article summary and media attribution remain fully available at large text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await mockArticleData(page);
  await page.goto("/article/Ada_Lovelace");
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });

  await expect(
    page.getByText("Ada Lovelace was an English mathematician and writer.", {
      exact: true,
    }),
  ).toBeVisible();

  const sourceLink = page
    .getByRole("link", {
      name: /source\s*: File:Ada portrait\.jpg/,
    })
    .first();
  await expect(sourceLink).toBeVisible();
  const compactAttribution = sourceLink.locator("xpath=parent::p");
  expect(
    await compactAttribution.evaluate(
      (element) => getComputedStyle(element).webkitLineClamp,
    ),
  ).toBe("none");
});

test("trending cards collapse to one readable column on a narrow screen", async ({
  page,
}) => {
  await mockHomeData(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/trending");

  const firstCard = page
    .getByRole("link", { name: /Trending topic 1/ })
    .locator("xpath=ancestor::li[1]");
  const secondCard = page
    .getByRole("link", { name: /Trending topic 2/ })
    .locator("xpath=ancestor::li[1]");
  const [firstBox, secondBox] = await Promise.all([
    firstCard.boundingBox(),
    secondCard.boundingBox(),
  ]);
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect(secondBox!.y).toBeGreaterThanOrEqual(firstBox!.y + firstBox!.height);
});

test("article keeps structured source sections playable with an accessible adaptation disclosure", async ({
  page,
}) => {
  await mockArticleData(page);
  await page.goto("/article/Ada_Lovelace");

  await expect(
    page.getByRole("heading", { level: 2, name: "Explore this article" }),
  ).toBeVisible();
  await expect(
    page.getByText("Adapted for audio", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Listen to Recognition" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "How Recognition was adapted for audio",
    }),
  ).toBeVisible();
  await expect(page.getByText("Not suited for audio")).toHaveCount(0);
  await page.getByRole("button", { name: "Listen to Recognition" }).focus();
  await expectVisibleFocusOutline(
    page.getByRole("button", { name: "Listen to Recognition" }),
  );
  await expectNoSeriousAxeViolations(page);
});

test("article section controls and metadata reflow with enlarged text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await mockArticleData(page);
  await page.goto("/article/Ada_Lovelace");

  const tableOfContents = page
    .getByRole("heading", { level: 2, name: "Explore this article" })
    .locator("xpath=ancestor::*[contains(@class, 'toc-section')]");
  const adaptationInfo = tableOfContents.getByRole("button", {
    name: "How Recognition was adapted for audio",
  });
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  const infoTarget = await adaptationInfo.boundingBox();
  expect(infoTarget).not.toBeNull();
  expect(infoTarget!.width).toBeGreaterThanOrEqual(44);
  expect(infoTarget!.height).toBeGreaterThanOrEqual(44);

  expect(
    await tableOfContents.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);

  const listenButtons = tableOfContents.getByRole("button", {
    name: /^Listen to /,
  });
  await expect.poll(() => listenButtons.count()).toBeGreaterThan(0);
  for (const button of await listenButtons.all()) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  await adaptationInfo.click();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  const tooltipBox = await tooltip.boundingBox();
  expect(tooltipBox).not.toBeNull();
  expect(tooltipBox!.x).toBeGreaterThanOrEqual(0);
  expect(tooltipBox!.x + tooltipBox!.width).toBeLessThanOrEqual(320);
});

test("gallery lightbox reflows narrowly, at zoom-equivalent dimensions, and falls back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const { lightboxRequests } = await mockArticleData(page, {
    failAnalyticalLightbox: true,
  });
  await page.goto("/article/Ada_Lovelace");

  const opener = page.getByRole("button", {
    name: "Open image 2 of 2: Analytical Engine at the Science Museum",
  });
  await expect(opener).toBeVisible();
  expect(lightboxRequests).not.toContain(analyticalLightboxUrl);
  await opener.click();

  const dialog = page.getByRole("dialog", { name: "Image gallery" });
  await expect(dialog).toBeVisible();
  await expect.poll(() => lightboxRequests).toContain(analyticalLightboxUrl);
  await expect(
    dialog.getByText(
      "The larger image was unavailable, so the gallery thumbnail is shown.",
    ),
  ).toBeVisible();
  await expect(
    dialog.getByRole("img", { name: "Analytical Engine mechanisms" }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  await expectNoSeriousAxeViolations(page);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  // A 1280×720 viewport at 200% browser zoom has roughly this CSS viewport.
  await page.setViewportSize({ width: 640, height: 360 });
  const requestCount = lightboxRequests.length;
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Close lightbox" }),
  ).toBeFocused();
  await expect
    .poll(() => lightboxRequests.length)
    .toBeGreaterThan(requestCount);
  const details = dialog.getByLabel("Image details");
  await expect(details).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Previous image" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Next image" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(details).toBeFocused();
  expect(
    await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    640,
  );
  await expectNoSeriousAxeViolations(page);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("gallery lightbox reports a total image failure once", async ({
  page,
}) => {
  await mockArticleData(page, {
    failAnalyticalLightbox: true,
    failAnalyticalThumbnail: true,
  });
  await page.goto("/article/Ada_Lovelace");

  await page
    .getByRole("button", {
      name: "Open image 2 of 2: Analytical Engine at the Science Museum",
    })
    .click();

  const dialog = page.getByRole("dialog", { name: "Image gallery" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("This image could not be loaded.", { exact: true }),
  ).toHaveCount(1);
  await expect(
    dialog.getByRole("status").filter({
      hasText: "This image could not be loaded.",
    }),
  ).toHaveCount(0);
  await expect(
    dialog.getByText(
      "The larger image was unavailable, so the gallery thumbnail is shown.",
    ),
  ).toHaveCount(0);
});

test("mobile navigation, theme, reflow, and project story remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/about");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Free knowledge, made listenable.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Seth Wilson", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();

  const themeButton = page
    .getByRole("button", { name: /Switch to .* theme/ })
    .first();
  await themeButton.click();
  await expect(page.locator("html")).toHaveClass(/light|dark/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  await expectNoSeriousAxeViolations(page);
});

test("shared shell stays in flow and its mobile navigation remains reachable with enlarged text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/about");
  await page.addStyleTag({
    content: `
      html { font-size: 200% !important; }
      * {
        line-height: 1.5 !important;
        letter-spacing: 0.12em !important;
        word-spacing: 0.16em !important;
      }
    `,
  });

  const shellGeometry = await page.evaluate(() => {
    const header = document.querySelector(".navbar");
    const main = document.querySelector("#main-content");
    if (!(header instanceof HTMLElement) || !(main instanceof HTMLElement)) {
      return null;
    }
    const headerBox = header.getBoundingClientRect();
    const mainBox = main.getBoundingClientRect();
    return {
      headerBottom: headerBox.bottom,
      mainTop: mainBox.top,
      pageFits: document.documentElement.scrollWidth <= window.innerWidth,
    };
  });
  expect(shellGeometry).not.toBeNull();
  expect(shellGeometry!.mainTop).toBeGreaterThanOrEqual(
    shellGeometry!.headerBottom - 0.5,
  );
  expect(shellGeometry!.pageFits).toBe(true);

  const menuButton = page.getByRole("button", { name: "Open menu" });
  const menuButtonBox = await menuButton.boundingBox();
  expect(menuButtonBox).not.toBeNull();
  expect(menuButtonBox!.width).toBeGreaterThanOrEqual(44);
  expect(menuButtonBox!.height).toBeGreaterThanOrEqual(44);
  await menuButton.click();

  const mobileNavigation = page.getByRole("navigation", {
    name: "Mobile navigation",
  });
  await expect(mobileNavigation).toBeVisible();
  await expect(mobileNavigation).toHaveCSS("overflow-y", "auto");

  const lastLink = mobileNavigation.getByRole("link").last();
  await lastLink.scrollIntoViewIfNeeded();
  await expect(lastLink).toBeVisible();
  await lastLink.focus();
  await expect(lastLink).toBeFocused();

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
