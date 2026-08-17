import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import { LibraryEntryCard } from "./LibraryEntryCard";

const entry = {
  savedAt: Date.UTC(2026, 7, 5, 12),
  slug: "The_Fellowship_of_the_Ring",
  title: "The Fellowship of the Ring and a deliberately long title",
};

async function renderCard(
  args: {
    blockedByRemoval?: boolean;
    busy?: boolean;
    onOpen?: jest.Mock;
    onRequestRemove?: jest.Mock;
  } = {},
) {
  const onOpen = args.onOpen ?? jest.fn();
  const onRequestRemove = args.onRequestRemove ?? jest.fn();
  await render(
    <GardenThemeProvider
      accessibilityPreferencesOverride={{}}
      colorSchemeOverride="light"
    >
      <LibraryEntryCard
        blockedByRemoval={args.blockedByRemoval}
        busy={args.busy}
        entry={entry}
        onOpen={onOpen}
        onRequestRemove={onRequestRemove}
      />
    </GardenThemeProvider>,
  );

  return {
    link: screen.getByRole("link"),
    onOpen,
    onRequestRemove,
    remove: screen.getByRole("button"),
  };
}

describe("LibraryEntryCard", () => {
  it("keeps the article link and Remove control as named sibling targets", async () => {
    const { link, remove } = await renderCard();

    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(link.props.accessibilityLabel).toContain(entry.title);
    expect(link).toHaveProp(
      "accessibilityHint",
      "Opens this saved article in Curio Garden.",
    );
    expect(remove).toHaveAccessibleName(
      `Remove ${entry.title} from your Library`,
    );
  });

  it("opens and requests removal only from their respective controls", async () => {
    const { link, onOpen, onRequestRemove, remove } = await renderCard();

    await fireEvent.press(link);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onRequestRemove).not.toHaveBeenCalled();

    await fireEvent.press(remove);
    expect(onRequestRemove).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("uses 48-point targets and never clamps long title, date, or control text", async () => {
    const { link, remove } = await renderCard();
    const title = screen.getByText(entry.title, {
      includeHiddenElements: true,
    });
    const savedDate = screen.getByText(/^Saved /, {
      includeHiddenElements: true,
    });
    const removeText = screen.getByText("Remove", {
      includeHiddenElements: true,
    });

    for (const control of [link, remove]) {
      expect(StyleSheet.flatten(control.props.style)).toMatchObject({
        minHeight: 48,
        minWidth: 48,
      });
    }
    for (const text of [title, savedDate, removeText]) {
      expect(text.props.numberOfLines).toBeUndefined();
      expect(text.props.adjustsFontSizeToFit).toBeUndefined();
    }
  });

  it("keeps the busy Remove target present, named, and unavailable", async () => {
    const { onRequestRemove, remove } = await renderCard({ busy: true });

    expect(remove).toHaveAccessibleName(
      `Remove — in progress: ${entry.title} from your Library`,
    );
    expect(remove).toHaveProp("accessibilityState", {
      busy: true,
      disabled: true,
    });
    expect(remove).toHaveProp("focusable", true);
    expect(screen.getByText("Remove — in progress")).toBeOnTheScreen();
    await fireEvent.press(remove);
    expect(onRequestRemove).not.toHaveBeenCalled();
  });

  it("keeps a sibling focusable but unavailable during another removal", async () => {
    const { onRequestRemove, remove } = await renderCard({
      blockedByRemoval: true,
    });

    expect(screen.getByText("Remove — wait")).toBeOnTheScreen();
    expect(remove).toHaveAccessibleName(
      `Remove — wait: ${entry.title}. Another Library removal is in progress.`,
    );
    expect(remove).toHaveProp("accessibilityState", {
      busy: false,
      disabled: true,
    });
    expect(remove).toHaveProp("focusable", true);
    await fireEvent.press(remove);
    expect(onRequestRemove).not.toHaveBeenCalled();
  });
});
