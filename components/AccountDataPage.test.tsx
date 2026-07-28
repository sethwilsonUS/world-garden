// @vitest-environment jsdom

import { createElement, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountDataPage } from "./AccountDataPage";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let authState: "loading" | "signed-in" | "signed-out" = "signed-out";
const clerkMocks = vi.hoisted(() => ({ useAuth: vi.fn() }));

vi.mock("@clerk/nextjs", () => ({
  SignInButton: ({ children }: { children: ReactNode }) =>
    createElement("div", { "data-clerk-button": "sign-in" }, children),
  useAuth: clerkMocks.useAuth,
}));

const deferred = <Value,>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe("AccountDataPage", () => {
  const originalLocalMode = process.env.NEXT_PUBLIC_LOCAL_MODE;
  let container: HTMLDivElement;
  let root: Root;
  let rootIsMounted: boolean;
  let createObjectUrl: ReturnType<typeof vi.spyOn>;
  let revokeObjectUrl: ReturnType<typeof vi.spyOn>;
  let anchorClick: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    authState = "signed-out";
    clerkMocks.useAuth.mockImplementation(() => ({
      isLoaded: authState !== "loading",
      isSignedIn: authState === "signed-in",
    }));
    process.env.NEXT_PUBLIC_LOCAL_MODE = "false";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    rootIsMounted = true;
    vi.stubGlobal("fetch", vi.fn());
    createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:curio-account-export");
    revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    if (rootIsMounted) act(() => root.unmount());
    container.remove();
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
    anchorClick.mockRestore();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    if (originalLocalMode === undefined) {
      delete process.env.NEXT_PUBLIC_LOCAL_MODE;
    } else {
      process.env.NEXT_PUBLIC_LOCAL_MODE = originalLocalMode;
    }
  });

  it("explains that account export is unavailable in local mode without touching auth", () => {
    process.env.NEXT_PUBLIC_LOCAL_MODE = "true";
    authState = "signed-in";

    const markup = renderToStaticMarkup(createElement(AccountDataPage));

    expect(markup).toContain("Account data is unavailable in local mode");
    expect(markup).toContain('href="/"');
    expect(markup).not.toContain("Download account data");
    expect(clerkMocks.useAuth).not.toHaveBeenCalled();
  });

  it("shows a quiet loading state while the account session resolves", () => {
    authState = "loading";

    const markup = renderToStaticMarkup(createElement(AccountDataPage));

    expect(markup).toContain("Checking your account");
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain("Download account data");
  });

  it("invites signed-out visitors to sign in without implying data is ready", () => {
    authState = "signed-out";

    const markup = renderToStaticMarkup(createElement(AccountDataPage));

    expect(markup).toContain("Sign in to export your account data");
    expect(markup).toContain("Sign in");
    expect(markup).not.toContain("Download account data");
  });

  it("describes the signed-in export scope, exclusions, and sensitive feed credential", () => {
    authState = "signed-in";

    const markup = renderToStaticMarkup(createElement(AccountDataPage));

    expect(markup).toContain("Download account data");
    expect(markup).toContain(
      "Bookmarks, plus Personal Playlist order and episode status",
    );
    expect(markup).toContain("listening progress, including heard ranges");
    expect(markup).toContain("topic-badge credit");
    expect(markup).toContain("active private RSS feed token");
    expect(markup).toContain("Revoked feed tokens are not included");
    expect(markup.toLowerCase()).toContain(
      "treat the downloaded file as private",
    );
    expect(markup).toContain("metadata, not the generated audio files");
    expect(markup).toContain("Device-local history and preferences");
    expect(markup).toContain("feedback, shared caches, and aggregated analytics");
    expect(markup).toContain('href="/privacy"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-atomic="true"');
    expect(markup).toContain(
      'id="account-export-active-feed-warning"',
    );
    expect(markup).toContain(
      'aria-labelledby="account-export-active-feed-warning-heading"',
    );
    expect(markup).toContain(
      'id="account-export-active-feed-warning-heading"',
    );
    expect(markup).toContain(
      'aria-describedby="account-export-active-feed-warning"',
    );
    expect(markup).not.toContain("autofocus");
  });

  it("downloads the successful POST response as a Blob and preserves focus", async () => {
    vi.useFakeTimers();
    authState = "signed-in";
    const response = deferred<Response>();
    vi.mocked(fetch).mockReturnValue(response.promise);

    await act(async () => {
      root.render(<AccountDataPage />);
      await Promise.resolve();
    });
    const button = container.querySelector<HTMLButtonElement>(
      'button[type="button"]',
    );
    expect(button).toBeInstanceOf(HTMLButtonElement);
    button?.focus();

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/account/export",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(button?.disabled).toBe(false);
    expect(button?.getAttribute("aria-disabled")).toBe("true");
    expect(button?.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(button);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Preparing your account data export.",
    );

    await act(async () => {
      response.resolve(
        new Response('{"schemaVersion":1}', {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition":
              'attachment; filename="curio-garden-account-data-2026-07-27.json"',
          },
        }),
      );
      await response.promise;
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Your account data file is ready. Your browser should begin the download.",
    );

    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(createObjectUrl.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(anchorClick).toHaveBeenCalledOnce();
    const downloadLink = anchorClick.mock.instances[0] as HTMLAnchorElement;
    expect(downloadLink.download).toBe(
      "curio-garden-account-data-2026-07-27.json",
    );
    expect(downloadLink.href).toBe("blob:curio-account-export");
    expect(revokeObjectUrl).not.toHaveBeenCalled();

    await act(async () => vi.runOnlyPendingTimers());
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:curio-account-export");
    expect(button?.disabled).toBe(false);
    expect(button?.getAttribute("aria-disabled")).toBe("false");
    expect(document.activeElement).toBe(button);
    vi.useRealTimers();
  });

  it("announces a generic failure, does not create a download, and preserves focus", async () => {
    authState = "signed-in";
    vi.mocked(fetch).mockResolvedValue(
      new Response('{"error":"server detail"}', {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await act(async () => {
      root.render(<AccountDataPage />);
      await Promise.resolve();
    });
    const button = container.querySelector<HTMLButtonElement>(
      'button[type="button"]',
    );
    button?.focus();

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        "Your account data could not be prepared. Please try again.",
      );
    });

    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
    expect(button?.disabled).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(container.textContent).not.toContain("server detail");
  });

  it("rejects a successful HTML response instead of downloading it as private data", async () => {
    authState = "signed-in";
    vi.mocked(fetch).mockResolvedValue(
      new Response("<html><body>Sign in again</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    );

    await act(async () => {
      root.render(<AccountDataPage />);
      await Promise.resolve();
    });
    const button = container.querySelector<HTMLButtonElement>(
      'button[type="button"]',
    );
    button?.focus();

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        "Your account data could not be prepared. Please try again.",
      );
    });

    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
  });

  it("rejects a redirected JSON response instead of trusting another destination", async () => {
    authState = "signed-in";
    const redirectedResponse = new Response('{"format":"unexpected"}', {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
    Object.defineProperty(redirectedResponse, "redirected", {
      configurable: true,
      value: true,
    });
    vi.mocked(fetch).mockResolvedValue(redirectedResponse);

    await act(async () => {
      root.render(<AccountDataPage />);
      await Promise.resolve();
    });
    const button = container.querySelector<HTMLButtonElement>(
      'button[type="button"]',
    );
    button?.focus();

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        "Your account data could not be prepared. Please try again.",
      );
    });

    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
  });

  it("rejects an unexpected attachment filename and uses a dated safe fallback", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T02:03:04.000Z"));
    authState = "signed-in";
    vi.mocked(fetch).mockResolvedValue(
      new Response('{"schemaVersion":1}', {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": 'attachment; filename="../../private.json"',
        },
      }),
    );

    await act(async () => {
      root.render(<AccountDataPage />);
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[type="button"]')?.click();
      await Promise.resolve();
    });

    const downloadLink = anchorClick.mock.instances[0] as HTMLAnchorElement;
    expect(downloadLink.download).toBe(
      "curio-garden-account-data-2026-07-28.json",
    );
    expect(downloadLink.download).not.toContain("..");
  });

  it("aborts a pending export on unmount and ignores a late private response", async () => {
    authState = "signed-in";
    const response = deferred<Response>();
    const requestState: { signal?: AbortSignal } = {};
    vi.mocked(fetch).mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        requestState.signal = init?.signal ?? undefined;
        return response.promise;
      },
    );

    await act(async () => {
      root.render(<AccountDataPage />);
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[type="button"]')?.click();
      await Promise.resolve();
    });

    expect(requestState.signal).toBeInstanceOf(AbortSignal);
    expect(requestState.signal?.aborted).toBe(false);

    await act(async () => {
      root.unmount();
      rootIsMounted = false;
      await Promise.resolve();
    });
    expect(requestState.signal?.aborted).toBe(true);

    await act(async () => {
      response.resolve(
        new Response('{"format":"curio-garden-account-export"}', {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition":
              'attachment; filename="curio-garden-account-data-2026-07-27.json"',
          },
        }),
      );
      await response.promise;
      await Promise.resolve();
    });

    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
    expect(revokeObjectUrl).not.toHaveBeenCalled();
  });

  it("returns to idle when an in-flight export is aborted while the page stays mounted", async () => {
    authState = "signed-in";
    const nativeAbortController = globalThis.AbortController;

    class CapturingAbortController extends nativeAbortController {
      static active: CapturingAbortController | undefined;

      constructor() {
        super();
        CapturingAbortController.active = this;
      }
    }

    vi.stubGlobal("AbortController", CapturingAbortController);
    vi.mocked(fetch).mockReturnValue(new Promise<Response>(() => {}));

    await act(async () => {
      root.render(<AccountDataPage />);
      await Promise.resolve();
    });
    const button = container.querySelector<HTMLButtonElement>(
      'button[type="button"]',
    );
    const status = container.querySelector('[role="status"]');
    button?.focus();

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(CapturingAbortController.active).toBeInstanceOf(
      nativeAbortController,
    );
    expect(status?.textContent).toBe("Preparing your account data export.");

    await act(async () => {
      CapturingAbortController.active?.abort();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="status"]')).toBe(status);
    expect(status?.textContent).toBe("");
    expect(button?.textContent).toContain("Download account data");
    expect(button?.getAttribute("aria-disabled")).toBe("false");
    expect(button?.getAttribute("aria-busy")).toBe("false");
    expect(document.activeElement).toBe(button);
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it("times out a stalled export, preserves focus, and announces the failure", async () => {
    vi.useFakeTimers();
    authState = "signed-in";
    const requestState: { signal?: AbortSignal } = {};
    vi.mocked(fetch).mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        requestState.signal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      },
    );

    await act(async () => {
      root.render(<AccountDataPage />);
      await Promise.resolve();
    });
    const button = container.querySelector<HTMLButtonElement>(
      'button[type="button"]',
    );
    const status = container.querySelector('[role="status"]');
    button?.focus();
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(status?.textContent).toBe("Preparing your account data export.");
    expect(document.activeElement).toBe(button);

    await act(async () => vi.advanceTimersByTimeAsync(65_000));

    expect(requestState.signal?.aborted).toBe(true);
    expect(container.querySelector('[role="status"]')).toBe(status);
    expect(status?.textContent).toBe(
      "The account data export took too long. Please try again.",
    );
    expect(button?.getAttribute("aria-disabled")).toBe("false");
    expect(button?.getAttribute("aria-busy")).toBe("false");
    expect(document.activeElement).toBe(button);
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it("allows only one sensitive export when activation re-enters before render", async () => {
    authState = "signed-in";
    let button: HTMLButtonElement | null = null;
    let reentered = false;
    vi.mocked(fetch).mockImplementation(() => {
      if (!reentered) {
        reentered = true;
        button?.click();
      }
      return Promise.resolve(
        new Response('{"format":"curio-garden-account-export"}', {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition":
              'attachment; filename="curio-garden-account-data-2026-07-27.json"',
          },
        }),
      );
    });

    await act(async () => {
      root.render(<AccountDataPage />);
      await Promise.resolve();
    });
    button = container.querySelector<HTMLButtonElement>('button[type="button"]');
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });
});
