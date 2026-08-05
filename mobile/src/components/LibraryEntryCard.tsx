import { forwardRef, useState, type ReactElement } from "react";
import type { BookmarkEntry } from "@curio-garden/domain";
import type { PressableProps } from "react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { GardenText } from "../theme/GardenText";
import { useGardenTheme } from "../theme/useGardenTheme";
import { GardenCard } from "./GardenCard";

export interface LibraryEntryCardProps {
  readonly blockedByRemoval?: boolean;
  readonly busy?: boolean;
  readonly entry: BookmarkEntry;
  readonly onEntryBlur?: () => void;
  readonly onEntryFocus?: () => void;
  readonly onOpen: NonNullable<PressableProps["onPress"]>;
  readonly onRequestRemove: NonNullable<PressableProps["onPress"]>;
}

export function formatLibrarySavedDate(savedAt: number): string {
  const date = new Date(savedAt);
  if (!Number.isFinite(date.getTime())) return "Saved date unavailable";

  return `Saved ${new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date)}`;
}

/** A visual card with two sibling targets: open the article or remove it. */
export const LibraryEntryCard = forwardRef<View, LibraryEntryCardProps>(
  function LibraryEntryCard(
    {
      blockedByRemoval = false,
      busy = false,
      entry,
      onEntryBlur,
      onEntryFocus,
      onOpen,
      onRequestRemove,
    },
    articleRef,
  ): ReactElement {
    const { colors, fonts, radii, spacing } = useGardenTheme();
    const [articleFocused, setArticleFocused] = useState(false);
    const [removeFocused, setRemoveFocused] = useState(false);
    const savedDate = formatLibrarySavedDate(entry.savedAt);
    const removeLabel = `Remove ${entry.title} from your Library`;
    const visibleRemoveLabel = busy
      ? "Remove — in progress"
      : blockedByRemoval
        ? "Remove — wait"
        : "Remove";
    const accessibleRemoveLabel = busy
      ? `${visibleRemoveLabel}: ${entry.title} from your Library`
      : blockedByRemoval
        ? `${visibleRemoveLabel}: ${entry.title}. Another Library removal is in progress.`
        : removeLabel;

    return (
      <GardenCard style={styles.card} testID={`library-entry-${entry.slug}`}>
        <Pressable
          ref={articleRef}
          accessible
          accessibilityHint="Opens this saved article in Curio Garden."
          accessibilityLabel={`${entry.title}. ${savedDate}.`}
          accessibilityRole="link"
          focusable
          onBlur={() => {
            setArticleFocused(false);
            onEntryBlur?.();
          }}
          onFocus={() => {
            setArticleFocused(true);
            onEntryFocus?.();
          }}
          onPress={onOpen}
          style={({ pressed }) => [
            styles.articleLink,
            {
              backgroundColor: pressed ? colors.surface3 : colors.surface2,
              borderColor: articleFocused
                ? colors.accent
                : colors.controlBorder,
              borderRadius: radii.xl,
              gap: spacing.xs,
              padding: spacing.md,
            },
            pressed ? styles.pressed : undefined,
            articleFocused
              ? [styles.focused, { outlineColor: colors.accent }]
              : undefined,
          ]}
        >
          {({ pressed }) => (
            <View
              accessibilityElementsHidden
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              style={{ gap: spacing.xs }}
            >
              <GardenText
                accessible={false}
                style={[
                  { fontFamily: fonts.bodySemiBold },
                  (pressed || articleFocused) && styles.interactionLabel,
                ]}
              >
                {entry.title}
              </GardenText>
              <GardenText accessible={false} color="muted" variant="metadata">
                {savedDate}
              </GardenText>
            </View>
          )}
        </Pressable>

        <Pressable
          accessible
          accessibilityHint="Asks for confirmation before removing this saved article."
          accessibilityLabel={accessibleRemoveLabel}
          accessibilityRole="button"
          accessibilityState={{
            busy,
            disabled: busy || blockedByRemoval,
          }}
          focusable
          onBlur={() => {
            setRemoveFocused(false);
            onEntryBlur?.();
          }}
          onFocus={() => {
            setRemoveFocused(true);
            onEntryFocus?.();
          }}
          onPress={(event) => {
            if (!busy && !blockedByRemoval) onRequestRemove(event);
          }}
          style={({ pressed }) => [
            styles.removeButton,
            {
              backgroundColor: pressed ? colors.surface3 : colors.surface2,
              borderColor: removeFocused ? colors.accent : colors.controlBorder,
              borderRadius: radii.lg,
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.md,
            },
            pressed && !busy && !blockedByRemoval ? styles.pressed : undefined,
            removeFocused
              ? [styles.focused, { outlineColor: colors.accent }]
              : undefined,
          ]}
        >
          {({ pressed }) => (
            <GardenText
              accessible={false}
              color="muted"
              style={[
                styles.removeLabel,
                { fontFamily: fonts.bodySemiBold },
                (pressed || removeFocused) && !busy && !blockedByRemoval
                  ? styles.interactionLabel
                  : undefined,
              ]}
            >
              {visibleRemoveLabel}
            </GardenText>
          )}
        </Pressable>
      </GardenCard>
    );
  },
);

const styles = StyleSheet.create({
  articleLink: {
    alignSelf: "stretch",
    borderWidth: 2,
    minHeight: 48,
    minWidth: 48,
  },
  card: {
    padding: 12,
  },
  focused: {
    outlineOffset: 2,
    outlineStyle: "solid",
    outlineWidth: 3,
  },
  interactionLabel: {
    textDecorationLine: "underline",
  },
  pressed: {
    transform: [{ translateY: 1 }],
  },
  removeButton: {
    alignItems: "center",
    alignSelf: "flex-end",
    borderWidth: 2,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 48,
  },
  removeLabel: {
    textAlign: "center",
  },
});
