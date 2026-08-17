import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import { LibraryActionButton } from "./LibraryActionButton";

async function renderButton(
  args: {
    busy?: boolean;
    onPress?: jest.Mock;
    saved?: boolean;
    testOnlyPressed?: boolean;
  } = {},
) {
  const onPress = args.onPress ?? jest.fn();
  await render(
    <GardenThemeProvider
      accessibilityPreferencesOverride={{}}
      colorSchemeOverride="light"
    >
      <LibraryActionButton
        articleTitle="The Fellowship of the Ring"
        busy={args.busy}
        onPress={onPress}
        saved={args.saved ?? false}
        testOnly_pressed={args.testOnlyPressed}
      />
    </GardenThemeProvider>,
  );

  return { button: screen.getByRole("button"), onPress };
}

describe("LibraryActionButton", () => {
  it("names and visibly labels an unsaved article without relying on color", async () => {
    const { button } = await renderButton();

    expect(screen.getByText("Save to Library")).toBeOnTheScreen();
    expect(button).toHaveAccessibleName(
      "Save to Library: The Fellowship of the Ring",
    );
    expect(button).toHaveProp("accessibilityState", {
      busy: false,
      disabled: false,
      selected: false,
    });
  });

  it("exposes the saved state in words and accessibility state", async () => {
    const { button } = await renderButton({ saved: true });

    expect(screen.getByText("Saved to Library")).toBeOnTheScreen();
    expect(button).toHaveAccessibleName(
      "Saved to Library: remove The Fellowship of the Ring",
    );
    expect(button).toHaveProp("accessibilityState", {
      busy: false,
      disabled: false,
      selected: true,
    });
  });

  it("keeps a 48-point unclamped target and exposes an in-progress state", async () => {
    const { button, onPress } = await renderButton({ busy: true });
    const label = screen.getByText("Save to Library — in progress");

    expect(StyleSheet.flatten(button.props.style)).toMatchObject({
      minHeight: 48,
      minWidth: 48,
    });
    expect(label.props.numberOfLines).toBeUndefined();
    expect(label.props.adjustsFontSizeToFit).toBeUndefined();
    expect(button).toHaveAccessibleName(
      "Save to Library — in progress: The Fellowship of the Ring",
    );
    expect(button).toHaveProp("accessibilityState", {
      busy: true,
      disabled: true,
      selected: false,
    });
    expect(button).toHaveProp("focusable", true);
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("keeps the saved state explicit while a removal is in progress", async () => {
    const { button, onPress } = await renderButton({ busy: true, saved: true });

    expect(
      screen.getByText("Saved to Library — in progress"),
    ).toBeOnTheScreen();
    expect(button).toHaveAccessibleName(
      "Saved to Library — in progress: remove The Fellowship of the Ring",
    );
    expect(button).toHaveProp("accessibilityState", {
      busy: true,
      disabled: true,
      selected: true,
    });
    expect(button).toHaveProp("focusable", true);
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("activates on release and adds a non-color pressed cue", async () => {
    const { button, onPress } = await renderButton({ testOnlyPressed: true });

    await fireEvent(button, "pressIn");
    await fireEvent(button, "pressOut");
    expect(onPress).not.toHaveBeenCalled();
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(StyleSheet.flatten(button.props.style)).toMatchObject({
      transform: [{ translateY: 1 }],
    });
  });
});
