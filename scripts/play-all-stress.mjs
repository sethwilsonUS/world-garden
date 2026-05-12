#!/usr/bin/env node

import { chromium } from "playwright";

const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_ARTICLES = ["Sparidentex_hasta", "Éric_Bernard_(actor)"];
const STRESS_ARTICLE = "Sparidentex_hasta";
const FAKE_AUDIO_MS = 90;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseArgs = (argv) => {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    articles: [...DEFAULT_ARTICLES],
    scenarios: null,
    headed: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url") {
      args.baseUrl = argv[++i] ?? args.baseUrl;
    } else if (arg === "--article") {
      args.articles = [argv[++i]].filter(Boolean);
    } else if (arg === "--scenario") {
      args.scenarios = (argv[++i] ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
    } else if (arg === "--headed") {
      args.headed = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
};

const printHelp = () => {
  console.log(`Usage: node scripts/play-all-stress.mjs [options]

Options:
  --base-url URL        Local app URL. Default: ${DEFAULT_BASE_URL}
  --article TITLE      Run DYK regression against one article title/slug.
  --scenario LIST      Comma-separated scenario names to run.
  --headed             Show the browser window.

Scenarios:
  success-fast, success-slow, hung-prefetch, failed-prefetch, hung-active,
  rapid-toggle, route-timeout, mobile-viewport-warm, play-all-section-sync,
  pause-resume-sync, dyk-regression
`);
};

const metadataHeaders = {
  "Content-Type": "audio/mpeg",
  "X-Curio-TTS-Provider": "openai",
  "X-Curio-TTS-Model": "gpt-4o-mini-tts",
  "X-Curio-TTS-Voice": "marin",
  "X-Curio-TTS-Prompt-Version": "curio-warm-narrator-v1",
  "X-Curio-TTS-Norm-Version": "ttsNorm:2",
  "X-Curio-TTS-Cache-Key":
    "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:2",
};

const timeoutJson = {
  error: "TTS upstream request timed out after 25ms",
};

const fakeAudioScript = ({ fakeAudioMs }) => {
  const state = new WeakMap();

  const getState = (audio) => {
    let current = state.get(audio);
    if (!current) {
      current = {
        currentTime: 0,
        duration: fakeAudioMs / 1000,
        playing: false,
        timer: null,
      };
      state.set(audio, current);
    }
    return current;
  };

  Object.defineProperty(HTMLMediaElement.prototype, "duration", {
    configurable: true,
    get() {
      return getState(this).duration;
    },
  });

  Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
    configurable: true,
    get() {
      return getState(this).currentTime;
    },
    set(value) {
      getState(this).currentTime = Number(value) || 0;
    },
  });

  Object.defineProperty(HTMLMediaElement.prototype, "paused", {
    configurable: true,
    get() {
      return !getState(this).playing;
    },
  });

  Object.defineProperty(HTMLMediaElement.prototype, "playbackRate", {
    configurable: true,
    get() {
      return getState(this).playbackRate ?? 1;
    },
    set(value) {
      getState(this).playbackRate = Number(value) || 1;
    },
  });

  HTMLMediaElement.prototype.play = function play() {
    const current = getState(this);
    if (current.timer) clearTimeout(current.timer);
    current.playing = true;
    this.dispatchEvent(new Event("loadedmetadata"));
    this.dispatchEvent(new Event("durationchange"));
    this.dispatchEvent(new Event("play"));

    current.timer = setTimeout(() => {
      current.currentTime = current.duration;
      current.playing = false;
      this.dispatchEvent(new Event("timeupdate"));
      this.dispatchEvent(new Event("ended"));
    }, fakeAudioMs);

    return Promise.resolve();
  };

  HTMLMediaElement.prototype.pause = function pause() {
    const current = getState(this);
    if (current.timer) clearTimeout(current.timer);
    current.timer = null;
    current.playing = false;
    this.dispatchEvent(new Event("pause"));
  };
};

const articleUrl = (baseUrl, article, params = {}) => {
  const url = new URL(`/article/${encodeURIComponent(article)}`, baseUrl);
  url.searchParams.set("ttsStress", "1");
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  return url.toString();
};

const waitForArticleUi = async (page) => {
  await page
    .getByRole("heading", { name: /Explore this article/i })
    .waitFor({ timeout: 45_000 });
};

const clickPlayAll = async (page) => {
  await page
    .getByRole("button", { name: /^(Play all|Play summary)/i })
    .first()
    .click({ timeout: 10_000 });
};

const waitForIdle = async (page, timeout = 25_000) => {
  await page
    .getByRole("button", { name: /^(Play all|Play summary)/i })
    .first()
    .waitFor({ timeout });
};

const waitForStopControl = async (page, timeout = 10_000) => {
  await page
    .getByRole("button", {
      name: /^(Stop playing all sections|Stop summary)$/i,
    })
    .first()
    .waitFor({ timeout });
};

const clickStop = async (page) => {
  await page
    .getByRole("button", {
      name: /^(Stop playing all sections|Stop summary)$/i,
    })
    .first()
    .click({ timeout: 5_000 });
};

const clickSkip = async (page) => {
  await page
    .getByRole("button", { name: /^Skip to next section$/i })
    .first()
    .click({ timeout: 5_000 });
};

const waitForTocStatus = async (page, status, timeout = 10_000) => {
  await page
    .locator("nav[aria-label='Article sections'] li.toc-item")
    .filter({ hasText: status })
    .first()
    .waitFor({ timeout });
};

const waitForProgressBar = async (page, timeout = 10_000) => {
  await page.locator(".toc-progress-range").first().waitFor({ timeout });
};

const createTtsResponder = ({
  delayMs = 25,
  failCalls = [],
  hangCalls = [],
  timeoutCalls = [],
} = {}) => {
  const metrics = {
    calls: [],
    hangs: [],
    failures: [],
    timeouts: [],
  };
  const failSet = new Set(failCalls);
  const hangSet = new Set(hangCalls);
  const timeoutSet = new Set(timeoutCalls);

  const route = async (requestRoute) => {
    const request = requestRoute.request();
    if (request.method() !== "POST") {
      await requestRoute.fallback();
      return;
    }

    const callNumber = metrics.calls.length + 1;
    let body = {};
    try {
      body = JSON.parse(request.postData() ?? "{}");
    } catch {
      body = {};
    }

    metrics.calls.push({
      callNumber,
      provider: body.provider ?? "default",
      words: String(body.text ?? "").split(/\s+/).filter(Boolean).length,
    });

    if (hangSet.has(callNumber)) {
      metrics.hangs.push(callNumber);
      await new Promise(() => {});
      return;
    }

    const callDelay =
      typeof delayMs === "function" ? delayMs(callNumber, body) : delayMs;
    if (callDelay > 0) await sleep(callDelay);

    if (timeoutSet.has(callNumber)) {
      metrics.timeouts.push(callNumber);
      await requestRoute.fulfill({
        status: 504,
        contentType: "application/json",
        body: JSON.stringify(timeoutJson),
      });
      return;
    }

    if (failSet.has(callNumber)) {
      metrics.failures.push(callNumber);
      await requestRoute.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Injected TTS failure" }),
      });
      return;
    }

    await requestRoute.fulfill({
      status: 200,
      headers: metadataHeaders,
      body: Buffer.from(`curio-stress-audio-${callNumber}`),
    });
  };

  return { metrics, route };
};

const createPage = async (browser, baseUrl, ttsOptions = {}) => {
  const {
    fakeAudioMs = FAKE_AUDIO_MS,
    contextOptions = {},
    ...responderOptions
  } = ttsOptions;
  const context = await browser.newContext({
    reducedMotion: "reduce",
    ...contextOptions,
  });
  await context.addInitScript(fakeAudioScript, { fakeAudioMs });

  const page = await context.newPage();
  const consoleMessages = [];
  const pageErrors = [];
  const { metrics, route } = createTtsResponder(responderOptions);
  const allowsInjectedTtsHttpFailure =
    (ttsOptions?.failCalls?.length ?? 0) > 0 ||
    (ttsOptions?.timeoutCalls?.length ?? 0) > 0;

  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[audio-cache] Failed to cache section audio")) return;
    if (text.includes("Clerk has been loaded with development keys")) return;
    if (
      text.includes("badges:recordViewerArticleListenProgress") &&
      text.includes("Unauthorized")
    ) {
      return;
    }
    if (
      allowsInjectedTtsHttpFailure &&
      text.includes("Failed to load resource") &&
      (text.includes("500") || text.includes("504"))
    ) {
      return;
    }
    if (msg.type() === "error" || msg.type() === "warning") {
      consoleMessages.push(`[${msg.type()}] ${text}`);
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.route("**/api/tts", route);
  await page.route("**/api/storage/upload*", async (requestRoute) => {
    await requestRoute.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "stress runner blocks storage writes" }),
    });
  });

  return {
    context,
    page,
    metrics,
    consoleMessages,
    pageErrors,
    async close() {
      await context.close();
    },
    async gotoArticle(article, options = {}) {
      await page.goto(articleUrl(baseUrl, article, options.params), {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await waitForArticleUi(page);
      await page.waitForTimeout(500);
      if (!options.allowAutoWarm && metrics.calls.length > 0) {
        throw new Error(
          `TTS warmed before user intent (${metrics.calls.length} calls)`,
        );
      }
    },
    assertCleanLogs() {
      if (pageErrors.length > 0) {
        throw new Error(`Page errors:\n${pageErrors.join("\n")}`);
      }
      if (consoleMessages.length > 0) {
        throw new Error(`Console warnings/errors:\n${consoleMessages.join("\n")}`);
      }
    },
  };
};

const assertTtsCalls = (metrics, scenarioName) => {
  if (metrics.calls.length === 0) {
    throw new Error(`${scenarioName} did not exercise /api/tts`);
  }
};

const runBasicPlayback = async (browser, args, scenarioName, ttsOptions) => {
  const run = await createPage(browser, args.baseUrl, ttsOptions);
  try {
    await run.gotoArticle(STRESS_ARTICLE);
    await clickPlayAll(run.page);
    await waitForIdle(run.page, scenarioName === "success-slow" ? 60_000 : 25_000);
    assertTtsCalls(run.metrics, scenarioName);
    run.assertCleanLogs();
    return run.metrics;
  } finally {
    await run.close();
  }
};

const scenarios = {
  "success-fast": async (browser, args) =>
    runBasicPlayback(browser, args, "success-fast", { delayMs: 25 }),

  "success-slow": async (browser, args) =>
    runBasicPlayback(browser, args, "success-slow", { delayMs: 5_000 }),

  "hung-prefetch": async (browser, args) =>
    runBasicPlayback(browser, args, "hung-prefetch", {
      delayMs: 25,
      hangCalls: [2],
    }),

  "failed-prefetch": async (browser, args) =>
    runBasicPlayback(browser, args, "failed-prefetch", {
      delayMs: 25,
      failCalls: [2],
    }),

  "hung-active": async (browser, args) => {
    const stopRun = await createPage(browser, args.baseUrl, {
      delayMs: 25,
      hangCalls: [1],
    });
    try {
      await stopRun.gotoArticle(STRESS_ARTICLE);
      await clickPlayAll(stopRun.page);
      await waitForStopControl(stopRun.page);
      await clickStop(stopRun.page);
      await waitForIdle(stopRun.page, 10_000);
      assertTtsCalls(stopRun.metrics, "hung-active stop");
      stopRun.assertCleanLogs();
    } finally {
      await stopRun.close();
    }

    const skipRun = await createPage(browser, args.baseUrl, {
      delayMs: 25,
      hangCalls: [1],
    });
    try {
      await skipRun.gotoArticle(STRESS_ARTICLE);
      await clickPlayAll(skipRun.page);
      await waitForStopControl(skipRun.page);
      await clickSkip(skipRun.page);
      await waitForIdle(skipRun.page, 25_000);
      assertTtsCalls(skipRun.metrics, "hung-active skip");
      skipRun.assertCleanLogs();
      return {
        calls: [...stopRun.metrics.calls, ...skipRun.metrics.calls],
        hangs: [...stopRun.metrics.hangs, ...skipRun.metrics.hangs],
      };
    } finally {
      await skipRun.close();
    }
  },

  "rapid-toggle": async (browser, args) => {
    const run = await createPage(browser, args.baseUrl, {
      delayMs: (callNumber) => (callNumber === 1 ? 2_000 : 25),
    });
    try {
      await run.gotoArticle(STRESS_ARTICLE);
      await clickPlayAll(run.page);
      await waitForStopControl(run.page);
      await clickStop(run.page);
      await waitForIdle(run.page, 10_000);
      await clickPlayAll(run.page);
      await waitForIdle(run.page, 30_000);
      assertTtsCalls(run.metrics, "rapid-toggle");
      run.assertCleanLogs();
      return run.metrics;
    } finally {
      await run.close();
    }
  },

  "route-timeout": async (browser, args) =>
    runBasicPlayback(browser, args, "route-timeout", {
      delayMs: 25,
      timeoutCalls: [1],
    }),

  "mobile-viewport-warm": async (browser, args) => {
    const run = await createPage(browser, args.baseUrl, {
      delayMs: 25,
      contextOptions: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    });
    try {
      await run.gotoArticle(STRESS_ARTICLE, {
        allowAutoWarm: true,
        params: { ttsViewportWarm: "1" },
      });
      await run.page
        .getByRole("heading", { name: /Explore this article/i })
        .scrollIntoViewIfNeeded();
      await run.page.waitForTimeout(1_000);

      if (run.metrics.calls.length === 0) {
        throw new Error("mobile-viewport-warm did not trigger viewport TTS warming");
      }

      run.assertCleanLogs();
      return run.metrics;
    } finally {
      await run.close();
    }
  },

  "play-all-section-sync": async (browser, args) => {
    const run = await createPage(browser, args.baseUrl, {
      delayMs: 25,
      fakeAudioMs: 2_000,
    });
    try {
      await run.gotoArticle(STRESS_ARTICLE);
      await clickPlayAll(run.page);
      await waitForTocStatus(run.page, "Playing");
      await waitForProgressBar(run.page);
      await clickSkip(run.page);
      await waitForTocStatus(run.page, "Playing");
      await waitForProgressBar(run.page);
      assertTtsCalls(run.metrics, "play-all-section-sync");
      run.assertCleanLogs();
      return run.metrics;
    } finally {
      await run.close();
    }
  },

  "pause-resume-sync": async (browser, args) => {
    const run = await createPage(browser, args.baseUrl, {
      delayMs: 25,
      fakeAudioMs: 3_000,
    });
    try {
      await run.gotoArticle(STRESS_ARTICLE);
      await clickPlayAll(run.page);
      await waitForTocStatus(run.page, "Playing");
      await waitForProgressBar(run.page);
      await run.page
        .getByRole("button", { name: /^Pause playing all sections$/i })
        .click({ timeout: 10_000 });
      await run.page
        .getByRole("button", { name: /^Resume playing all sections$/i })
        .waitFor({ timeout: 10_000 });
      await waitForTocStatus(run.page, "Paused");
      await waitForProgressBar(run.page);
      await run.page
        .getByRole("button", { name: /^Resume playing all sections$/i })
        .click({ timeout: 10_000 });
      await run.page
        .getByRole("button", { name: /^Pause playing all sections$/i })
        .waitFor({ timeout: 10_000 });
      await waitForTocStatus(run.page, "Playing");
      assertTtsCalls(run.metrics, "pause-resume-sync");
      run.assertCleanLogs();
      return run.metrics;
    } finally {
      await run.close();
    }
  },

  "dyk-regression": async (browser, args) => {
    const aggregate = { calls: [] };
    for (const article of args.articles) {
      const run = await createPage(browser, args.baseUrl, { delayMs: 25 });
      try {
        await run.gotoArticle(article);
        await clickPlayAll(run.page);
        await waitForIdle(run.page, 30_000);
        run.assertCleanLogs();
        aggregate.calls.push(...run.metrics.calls);
      } finally {
        await run.close();
      }
    }
    return aggregate;
  },
};

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const scenarioNames = args.scenarios ?? Object.keys(scenarios);
  const unknown = scenarioNames.filter((name) => !scenarios[name]);
  if (unknown.length > 0) {
    throw new Error(`Unknown scenario(s): ${unknown.join(", ")}`);
  }

  const browser = await chromium.launch({ headless: !args.headed });
  const results = [];
  try {
    for (const name of scenarioNames) {
      const startedAt = Date.now();
      const metrics = await scenarios[name](browser, args);
      const durationMs = Date.now() - startedAt;
      results.push({ name, metrics, durationMs });
      console.log(
        `[pass] ${name}: ${metrics.calls.length} TTS calls in ${durationMs}ms`,
      );
    }
  } finally {
    await browser.close();
  }

  const totalCalls = results.reduce(
    (total, result) => total + result.metrics.calls.length,
    0,
  );
  console.log(`[done] ${results.length} scenario(s), ${totalCalls} TTS calls`);
};

run().catch((error) => {
  console.error(`[fail] ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
