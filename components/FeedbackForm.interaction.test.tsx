// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackForm } from "./FeedbackForm";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const deferred = <Value,>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const setControlValue = async (
  control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(control),
      "value",
    )?.set;
    setter?.call(control, value);
    control.dispatchEvent(
      new Event(control instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
    await Promise.resolve();
  });
};

const submit = async (form: HTMLFormElement) => {
  await act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
  });
};

describe("FeedbackForm", () => {
  let container: HTMLDivElement;
  let root: Root;
  let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    requestAnimationFrameSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    requestAnimationFrameSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uses native labels, constraints, consent, and persistent announcements", () => {
    const markup = renderToStaticMarkup(<FeedbackForm deliveryAvailable />);

    expect(markup).toContain('for="feedback-kind"');
    expect(markup).toContain('id="feedback-kind"');
    expect(markup).toContain('name="kind"');
    expect(markup).toContain('required=""');
    expect(markup).toContain('for="feedback-message"');
    expect(markup).toContain('for="feedback-environment"');
    expect(markup).toContain('for="feedback-email"');
    expect(markup).toContain('autoComplete="email"');
    expect(markup).toContain('for="feedback-research"');
    expect(markup).toContain("This is an invitation, not a commitment");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain("autofocus");
  });

  it("waits for client handlers before allowing feedback submission", async () => {
    const serverContainer = document.createElement("div");
    serverContainer.innerHTML = renderToStaticMarkup(
      <FeedbackForm deliveryAvailable />,
    );

    expect(
      serverContainer.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.disabled,
    ).toBe(true);

    await act(async () => {
      root.render(<FeedbackForm deliveryAvailable />);
      await Promise.resolve();
    });

    expect(
      container.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.disabled,
    ).toBe(false);
  });

  it("focuses the first invalid field without sending a request", async () => {
    await act(async () => {
      root.render(<FeedbackForm deliveryAvailable />);
      await Promise.resolve();
    });
    const form = container.querySelector("form");
    const kind = container.querySelector("#feedback-kind");
    expect(form).toBeInstanceOf(HTMLFormElement);
    expect(kind).toBeInstanceOf(HTMLSelectElement);

    await submit(form as HTMLFormElement);

    expect(fetch).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(kind);
    expect(kind?.getAttribute("aria-invalid")).toBe("true");
    expect(kind?.getAttribute("aria-describedby")).toContain(
      "feedback-kind-error",
    );
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it("requires an email for research and focuses it next", async () => {
    await act(async () => {
      root.render(<FeedbackForm deliveryAvailable />);
      await Promise.resolve();
    });
    const kind = container.querySelector("#feedback-kind") as HTMLSelectElement;
    const message = container.querySelector(
      "#feedback-message",
    ) as HTMLTextAreaElement;
    const research = container.querySelector(
      "#feedback-research",
    ) as HTMLInputElement;
    const email = container.querySelector(
      "#feedback-email",
    ) as HTMLInputElement;
    await setControlValue(kind, "accessibility");
    await setControlValue(message, "The player needs a clearer label.");
    await act(async () => research.click());

    await submit(container.querySelector("form") as HTMLFormElement);

    expect(fetch).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(email);
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(container.textContent).toContain(
      "Add an email address so a research invitation can reach you.",
    );

    await act(async () => research.click());
    expect(email.getAttribute("aria-invalid")).toBeNull();
  });

  it("checks UTF-8 byte limits that maxlength alone cannot catch", async () => {
    await act(async () => {
      root.render(<FeedbackForm deliveryAvailable />);
      await Promise.resolve();
    });
    await setControlValue(
      container.querySelector("#feedback-kind") as HTMLSelectElement,
      "product",
    );
    await setControlValue(
      container.querySelector("#feedback-message") as HTMLTextAreaElement,
      "🌱".repeat(1_500),
    );

    await submit(container.querySelector("form") as HTMLFormElement);

    expect(fetch).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Some characters use more space than others",
    );
    expect(document.activeElement).toBe(
      container.querySelector("#feedback-message"),
    );
  });

  it("checks the email UTF-8 byte limit before sending", async () => {
    await act(async () => {
      root.render(<FeedbackForm deliveryAvailable />);
      await Promise.resolve();
    });
    await setControlValue(
      container.querySelector("#feedback-kind") as HTMLSelectElement,
      "product",
    );
    await setControlValue(
      container.querySelector("#feedback-message") as HTMLTextAreaElement,
      "Please reply about the listening controls.",
    );
    const email = container.querySelector(
      "#feedback-email",
    ) as HTMLInputElement;
    await setControlValue(email, `${"é".repeat(122)}@example.com`);

    await submit(container.querySelector("form") as HTMLFormElement);

    expect(fetch).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Please shorten the email address",
    );
    expect(document.activeElement).toBe(email);
  });

  it("sends one trimmed request, omits blanks, and resets only after 202", async () => {
    const response = deferred<Response>();
    vi.mocked(fetch).mockReturnValue(response.promise);
    await act(async () => {
      root.render(<FeedbackForm deliveryAvailable />);
      await Promise.resolve();
    });
    const kind = container.querySelector("#feedback-kind") as HTMLSelectElement;
    const message = container.querySelector(
      "#feedback-message",
    ) as HTMLTextAreaElement;
    await setControlValue(kind, "product");
    await setControlValue(message, "  Make Library easier to find.  ");
    const form = container.querySelector("form") as HTMLFormElement;

    await submit(form);
    await submit(form);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(vi.mocked(fetch).mock.calls[0]?.[1]?.body as string),
    ).toEqual({
      kind: "product",
      message: "Make Library easier to find.",
      researchOptIn: false,
    });
    expect(
      container
        .querySelector('button[type="submit"]')
        ?.getAttribute("aria-disabled"),
    ).toBe("true");
    for (const control of container.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("input, textarea, select")) {
      expect(control.disabled).toBe(false);
      expect(control.getAttribute("aria-disabled")).toBe("true");
    }
    expect(message.readOnly).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Sending feedback.",
    );

    await act(async () => {
      response.resolve(
        new Response(JSON.stringify({ accepted: true }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await response.promise;
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain(
        "Thank you. Your feedback was sent.",
      );
    });
    expect(message.value).toBe("");
    expect(kind.value).toBe("");
    expect(kind.disabled).toBe(false);
    expect(kind.getAttribute("aria-disabled")).toBe("false");
  });

  it("shows and submits explicit article context", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ accepted: true }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await act(async () => {
      root.render(
        <FeedbackForm
          deliveryAvailable
          articleContext={{
            title: "The Two Towers",
            slug: "The_Two_Towers",
            revisionId: "987654",
          }}
        />,
      );
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Feedback on this article");
    expect(container.textContent).toContain("The Two Towers");
    await setControlValue(
      container.querySelector("#feedback-kind") as HTMLSelectElement,
      "technical",
    );
    await setControlValue(
      container.querySelector("#feedback-message") as HTMLTextAreaElement,
      "The second section would not play.",
    );

    await submit(container.querySelector("form") as HTMLFormElement);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    expect(
      JSON.parse(vi.mocked(fetch).mock.calls[0]?.[1]?.body as string),
    ).toMatchObject({
      articleTitle: "The Two Towers",
      articleSlug: "The_Two_Towers",
      articleRevisionId: "987654",
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector<HTMLAnchorElement>(
          'a[href="/article/The_Two_Towers"]',
        )?.textContent,
      ).toContain("Return to The Two Towers");
    });
  });

  it.each([
    [429, "Feedback is being sent too often. Please wait and try again later."],
    [
      503,
      "The feedback form is temporarily unavailable. Your words are still here, so you can try again later.",
    ],
  ])(
    "preserves entries and announces a %s response",
    async (status, expectedError) => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ error: "server detail" }), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await act(async () => {
        root.render(<FeedbackForm deliveryAvailable />);
        await Promise.resolve();
      });
      await setControlValue(
        container.querySelector("#feedback-kind") as HTMLSelectElement,
        "technical",
      );
      const message = container.querySelector(
        "#feedback-message",
      ) as HTMLTextAreaElement;
      await setControlValue(message, "Playback stopped unexpectedly.");

      await submit(container.querySelector("form") as HTMLFormElement);
      await vi.waitFor(() => {
        expect(container.querySelector('[role="alert"]')?.textContent).toBe(
          expectedError,
        );
      });

      expect(message.value).toBe("Playback stopped unexpectedly.");
      expect(container.querySelector('[role="status"]')?.textContent).toBe("");
    },
  );

  it("does not render a pretend form when delivery is unavailable", () => {
    const markup = renderToStaticMarkup(
      <FeedbackForm
        deliveryAvailable={false}
        articleContext={{
          title: "Lothlórien",
          slug: "Lothlórien",
          revisionId: "42",
        }}
      />,
    );

    expect(markup).not.toContain("<form");
    expect(markup).toContain("Nothing has been recorded");
    expect(markup).toContain("Discussions are public");
    expect(markup).toContain("Feedback on this article");
    expect(markup).toContain("Lothlórien");
    expect(markup).not.toContain('role="alert"');
  });
});
