// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountDeletionPanel } from "./AccountDeletionPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const clerkMocks = vi.hoisted(() => ({
  isReverificationCancelledError: vi.fn(),
  useReverification: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useReverification: clerkMocks.useReverification,
}));

vi.mock("@clerk/nextjs/errors", () => ({
  isReverificationCancelledError: clerkMocks.isReverificationCancelledError,
}));

const deferred = <Value,>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe("AccountDeletionPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  const buttonNamed = (name: string) =>
    [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === name,
    );

  const renderPanel = async (navigateToResult = vi.fn()) => {
    await act(async () => {
      root.render(<AccountDeletionPanel navigateToResult={navigateToResult} />);
      await Promise.resolve();
    });
    return navigateToResult;
  };

  const openConfirmation = async () => {
    const opener = buttonNamed("Delete account…");
    expect(opener).toBeInstanceOf(HTMLButtonElement);
    await act(async () => {
      opener?.click();
      await Promise.resolve();
    });
    return opener as HTMLButtonElement;
  };

  const acknowledgeConsequences = async () => {
    const checkbox = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(checkbox).toBeInstanceOf(HTMLInputElement);
    await act(async () => {
      checkbox?.click();
      await Promise.resolve();
    });
    return checkbox as HTMLInputElement;
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.stubGlobal("fetch", vi.fn());
    clerkMocks.useReverification.mockImplementation(
      (request: (...args: unknown[]) => unknown) => request,
    );
    clerkMocks.isReverificationCancelledError.mockReturnValue(false);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("reveals consequences, focuses their heading, and restores focus on cancel or Escape", async () => {
    await renderPanel();
    const opener = await openConfirmation();
    const heading = container.querySelector<HTMLHeadingElement>("h3");

    expect(opener.getAttribute("aria-expanded")).toBe("true");
    expect(heading?.textContent).toContain("Permanently delete your account?");
    expect(document.activeElement).toBe(heading);
    expect(container.textContent).toContain("This cannot be undone.");
    expect(container.textContent).toContain("Curio Garden will delete");
    expect(container.textContent).toContain("This will not remove");

    await act(async () => {
      buttonNamed("Keep my account")?.click();
      await Promise.resolve();
    });
    expect(opener.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(opener);

    await openConfirmation();
    const disclosure = container.querySelector<HTMLElement>(
      `[id="${opener.getAttribute("aria-controls")}"]`,
    );
    await act(async () => {
      disclosure?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
    });
    expect(opener.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(opener);
  });

  it("keeps the permanent action disabled until checked and defensively validates form submission", async () => {
    await renderPanel();
    await openConfirmation();
    const checkbox = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    const deleteButton = buttonNamed("Permanently delete account");
    const form = container.querySelector<HTMLFormElement>("form");

    expect(deleteButton?.disabled).toBe(true);
    expect(deleteButton?.getAttribute("aria-disabled")).toBe("true");

    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(checkbox);
    expect(checkbox?.getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Check the confirmation box",
    );
    expect(fetch).not.toHaveBeenCalled();

    await acknowledgeConsequences();
    expect(deleteButton?.disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("posts the exact confirmation once, preserves focus while busy, and opens the completed page", async () => {
    const response = deferred<Response>();
    vi.mocked(fetch).mockReturnValue(response.promise);
    const navigateToResult = await renderPanel();
    await openConfirmation();
    await acknowledgeConsequences();
    const deleteButton = buttonNamed("Permanently delete account");
    deleteButton?.focus();

    await act(async () => {
      deleteButton?.click();
      deleteButton?.click();
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: "DELETE" }),
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    });
    expect(buttonNamed("Deleting account…")).toBe(deleteButton);
    expect(deleteButton?.getAttribute("aria-busy")).toBe("true");
    expect(deleteButton?.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(deleteButton);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Verifying your identity",
    );

    await act(async () => {
      response.resolve(
        new Response('{"status":"deleted"}', {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await response.promise;
    });
    await vi.waitFor(() => {
      expect(navigateToResult).toHaveBeenCalledWith("/account/deleted");
    });
  });

  it("opens the pending page only for a durable 202 response", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{"status":"pending"}', {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const navigateToResult = await renderPanel();
    await openConfirmation();
    await acknowledgeConsequences();

    await act(async () => {
      buttonNamed("Permanently delete account")?.click();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(navigateToResult).toHaveBeenCalledWith(
        "/account/deletion-pending",
      );
    });
  });

  it("hands Clerk's raw 403 hint to reverification and accepts its retry", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            clerk_error: {
              type: "forbidden",
              reason: "reverification-error",
              metadata: { reverification: "strict" },
            },
          }),
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(
        new Response('{"status":"deleted"}', {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    clerkMocks.useReverification.mockImplementation(
      (request: () => Promise<unknown>) => async () => {
        const hint = await request();
        expect(hint).toBeInstanceOf(Response);
        expect((hint as Response).status).toBe(403);
        return await request();
      },
    );
    const navigateToResult = await renderPanel();
    await openConfirmation();
    await acknowledgeConsequences();

    await act(async () => {
      buttonNamed("Permanently delete account")?.click();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(navigateToResult).toHaveBeenCalledWith("/account/deleted");
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("announces reverification cancellation and keeps the confirmation available", async () => {
    const cancellation = new Error("verification closed");
    clerkMocks.useReverification.mockImplementation(() => async () => {
      throw cancellation;
    });
    clerkMocks.isReverificationCancelledError.mockImplementation(
      (error) => error === cancellation,
    );
    await renderPanel();
    await openConfirmation();
    await acknowledgeConsequences();

    await act(async () => {
      buttonNamed("Permanently delete account")?.click();
      await Promise.resolve();
    });

    const deleteButton = buttonNamed("Permanently delete account");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Verification was canceled. Your account was not deleted.",
    );
    expect(document.activeElement).toBe(deleteButton);
    expect(container.querySelector("form")).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not expose server details and describes a network failure as uncertain", async () => {
    vi.mocked(fetch).mockRejectedValue(
      new Error("private upstream account identifier user_123"),
    );
    await renderPanel();
    await openConfirmation();
    await acknowledgeConsequences();

    await act(async () => {
      buttonNamed("Permanently delete account")?.click();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(container.querySelector('[role="status"]')?.textContent).toContain(
        "We could not confirm whether the deletion request reached Curio Garden",
      );
    });
    expect(container.textContent).not.toContain("user_123");
  });

  it("describes a lost durable-initiation response as uncertain", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Account deletion is temporarily unavailable.",
          outcome: "uncertain",
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    await renderPanel();
    await openConfirmation();
    await acknowledgeConsequences();

    await act(async () => {
      buttonNamed("Permanently delete account")?.click();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(container.querySelector('[role="status"]')?.textContent).toContain(
        "We could not confirm whether the deletion request reached Curio Garden",
      );
    });
  });

  it("announces a safe retry after a pre-initiation server rejection", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{"error":"private upstream detail for user_456"}', {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await renderPanel();
    await openConfirmation();
    await acknowledgeConsequences();

    await act(async () => {
      buttonNamed("Permanently delete account")?.click();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        "Your account could not be deleted. Nothing was changed. Please try again.",
      );
    });
    expect(container.textContent).not.toContain("user_456");
  });
});
