import { render, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import { RouteHeading } from "./RouteHeading";

function heading(
  title: string,
  focusKey = title,
  focusElement?: jest.Mock,
) {
  return (
    <GardenThemeProvider
      accessibilityPreferencesOverride={{}}
      colorSchemeOverride="light"
    >
      <RouteHeading
        focusElement={focusElement}
        focusKey={focusKey}
        title={title}
      />
    </GardenThemeProvider>
  );
}

describe("RouteHeading", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("exposes one heading and focuses once for each route context", async () => {
    jest
      .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
      .mockResolvedValue(true);
    const focus = jest.fn();
    const view = render(heading("Results for Moria", "Moria", focus));

    expect(
      screen.getAllByRole("header", { name: "Results for Moria" }),
    ).toHaveLength(1);
    expect(screen.queryByText("Results for Moria")).not.toBeOnTheScreen();
    expect(
      screen.getByText("Results for Moria", { includeHiddenElements: true }),
    ).toHaveProp("accessible", false);
    await waitFor(() => expect(focus).toHaveBeenCalledTimes(1));

    view.rerender(heading("Results for Moria", "Moria", focus));
    expect(focus).toHaveBeenCalledTimes(1);

    view.rerender(heading("Results for the Shire", "The Shire", focus));
    await waitFor(() => expect(focus).toHaveBeenCalledTimes(2));
  });

  it("does not move accessibility focus when a screen reader is off", async () => {
    jest
      .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
      .mockResolvedValue(false);
    const focus = jest.fn();

    render(heading("Ada Lovelace", "Ada Lovelace", focus));

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

    render(heading("Account & data", "account"));

    await waitFor(() =>
      expect(sendAccessibilityEvent).toHaveBeenCalledWith(
        expect.anything(),
        "focus",
      ),
    );
    expect(sendAccessibilityEvent).toHaveBeenCalledTimes(1);
  });
});
