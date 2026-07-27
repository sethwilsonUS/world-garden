// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateFeedAccessControls } from "./PrivateFeedAccessControls";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const findButton = (container: HTMLElement, label: string) => {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(button).toBeInstanceOf(HTMLButtonElement);
  return button as HTMLButtonElement;
};

describe("PrivateFeedAccessControls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderControls = async ({
    feedStatus = "active",
    feedUrl = "https://curiogarden.org/api/podcast/personal.xml?token=private-token",
    isUpdating = false,
    onRotate = vi.fn().mockResolvedValue(undefined),
    onRevoke = vi.fn().mockResolvedValue(undefined),
  }: Partial<Parameters<typeof PrivateFeedAccessControls>[0]> = {}) => {
    await act(async () => {
      root.render(
        <PrivateFeedAccessControls
          feedStatus={feedStatus}
          feedUrl={feedUrl}
          isUpdating={isUpdating}
          onRotate={onRotate}
          onRevoke={onRevoke}
        />,
      );
    });
  };

  it("shows an active private URL with subscription and lifecycle actions", async () => {
    await renderControls();

    expect(container.textContent).toContain(
      "Anyone with this URL can listen to your playlist",
    );
    expect(container.textContent).toContain("private-token");
    const copyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy Personal Playlist feed URL"]',
    );
    expect(copyButton).toBeInstanceOf(HTMLButtonElement);
    expect(copyButton?.className).toContain("w-11");
    expect(copyButton?.className).toContain("h-11");
    expect(findButton(container, "Apple Podcasts")).toBeTruthy();
    expect(findButton(container, "Replace URL").className).toContain(
      "min-h-11",
    );
    expect(findButton(container, "Turn off feed").className).toContain(
      "min-h-11",
    );
    expect(container.querySelector("section")?.getAttribute("aria-busy")).toBe(
      "false",
    );
  });

  it.each([
    ["not_created", "Create your private feed"],
    ["revoked", "Your private feed is off"],
  ] as const)(
    "hides the raw URL in the %s state and offers creation",
    async (feedStatus, expectedTitle) => {
      await renderControls({ feedStatus });

      expect(container.textContent).toContain(expectedTitle);
      expect(container.textContent).not.toContain("private-token");
      expect(container.querySelector("code")).toBeNull();
      expect(
        findButton(container, "Create private feed URL").className,
      ).toContain("min-h-11");
    },
  );

  it("focuses the replace confirmation and returns focus on cancel", async () => {
    await renderControls();
    const opener = findButton(container, "Replace URL");

    await act(async () => opener.click());

    const confirm = findButton(container, "Yes, replace URL");
    expect(document.activeElement).toBe(confirm);
    expect(container.textContent).toContain(
      "The old subscription stops working when the URL is replaced",
    );
    expect(container.textContent).toContain("already downloaded or cached");

    await act(async () => findButton(container, "Keep current feed").click());

    expect(document.activeElement).toBe(opener);
    expect(container.textContent).not.toContain(
      "Replace this private feed URL?",
    );
  });

  it("marks replacement busy, disables actions, and restores focus after completion", async () => {
    let resolveRotation: (() => void) | undefined;
    const onRotate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRotation = resolve;
        }),
    );
    await renderControls({ onRotate });
    const opener = findButton(container, "Replace URL");

    await act(async () => opener.click());
    const confirm = findButton(container, "Yes, replace URL");
    await act(async () => {
      confirm.click();
      await Promise.resolve();
    });

    expect(onRotate).toHaveBeenCalledTimes(1);
    expect(container.querySelector("section")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(findButton(container, "Replacing URL…").disabled).toBe(true);
    expect(findButton(container, "Keep current feed").disabled).toBe(true);

    await act(async () => {
      resolveRotation?.();
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(opener);
    expect(container.textContent).not.toContain(
      "Replace this private feed URL?",
    );
  });

  it("explains revocation, invokes it, and restores focus on completion", async () => {
    const onRevoke = vi.fn().mockResolvedValue(undefined);
    await renderControls({ onRevoke });
    const opener = findButton(container, "Turn off feed");

    await act(async () => opener.click());

    const confirm = findButton(container, "Yes, turn off feed");
    expect(document.activeElement).toBe(confirm);
    expect(container.textContent).toContain(
      "downloaded, cached, or previously accessed copies cannot be recalled",
    );

    await act(async () => confirm.click());

    expect(onRevoke).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
  });

  it("creates a new feed directly and reports failures accessibly", async () => {
    const onRotate = vi.fn().mockRejectedValue(new Error("network details"));
    await renderControls({ feedStatus: "revoked", onRotate });

    await act(async () =>
      findButton(container, "Create private feed URL").click(),
    );

    expect(onRotate).toHaveBeenCalledTimes(1);
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe(
      "The private feed URL could not be created. Try again.",
    );
    expect(alert?.textContent).not.toContain("network details");
  });
});
