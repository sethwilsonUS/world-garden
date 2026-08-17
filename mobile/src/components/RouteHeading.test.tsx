import { act, render, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import { RouteHeading } from "./RouteHeading";

function heading(
  title: string,
  focusKey = title,
  focusElement?: jest.Mock,
  active = true,
) {
  return (
    <GardenThemeProvider
      accessibilityPreferencesOverride={{}}
      colorSchemeOverride="light"
    >
      <RouteHeading
        active={active}
        focusElement={focusElement}
        focusKey={focusKey}
        title={title}
      />
    </GardenThemeProvider>
  );
}

describe("RouteHeading", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("exposes one heading and focuses once for each route context", async () => {
    jest
      .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
      .mockResolvedValue(true);
    const focus = jest.fn();
    const view = await render(heading("Results for Moria", "Moria", focus));

    expect(
      screen.getAllByRole("header", { name: "Results for Moria" }),
    ).toHaveLength(1);
    expect(screen.queryByText("Results for Moria")).not.toBeOnTheScreen();
    expect(
      screen.getByText("Results for Moria", { includeHiddenElements: true }),
    ).toHaveProp("accessible", false);
    await waitFor(() => expect(focus).toHaveBeenCalledTimes(1));

    await view.rerender(heading("Results for Moria", "Moria", focus));
    expect(focus).toHaveBeenCalledTimes(1);

    await view.rerender(heading("Results for the Shire", "The Shire", focus));
    await waitFor(() => expect(focus).toHaveBeenCalledTimes(2));
  });

  it("does not move accessibility focus when a screen reader is off", async () => {
    jest
      .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
      .mockResolvedValue(false);
    const focus = jest.fn();

    await render(heading("Ada Lovelace", "Ada Lovelace", focus));

    await waitFor(() =>
      expect(AccessibilityInfo.isScreenReaderEnabled).toHaveBeenCalled(),
    );
    expect(focus).not.toHaveBeenCalled();
  });

  it("uses the renderer-aware focus event for a native route heading", async () => {
    jest
      .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
      .mockResolvedValue(true);
    const sendAccessibilityEvent = jest.spyOn(
      AccessibilityInfo,
      "sendAccessibilityEvent",
    );

    await render(heading("Account & data", "account"));

    await waitFor(() =>
      expect(sendAccessibilityEvent).toHaveBeenCalledWith(
        expect.anything(),
        "focus",
      ),
    );
    expect(sendAccessibilityEvent).toHaveBeenCalledTimes(1);
  });

  it("cancels deferred focus when a retained route becomes inactive", async () => {
    let resolveScreenReaderEnabled!: (enabled: boolean) => void;
    const screenReaderEnabled = jest
      .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
      .mockReturnValue(
        new Promise((resolve) => {
          resolveScreenReaderEnabled = resolve;
        }),
      );
    screenReaderEnabled.mockClear();
    const focus = jest.fn();
    const view = await render(heading("Library", "library", focus));

    await view.rerender(heading("Library", "library", focus, false));
    await view.rerender(heading("Library", "library", focus, true));
    await act(async () => {
      resolveScreenReaderEnabled(true);
      await Promise.resolve();
    });

    expect(screenReaderEnabled).toHaveBeenCalledTimes(1);
    expect(focus).not.toHaveBeenCalled();
  });
});
