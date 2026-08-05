import type { ReactElement, ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useGardenTheme } from "../theme/useGardenTheme";

export interface GardenScreenProps {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export function getScreenHorizontalPadding(width: number): 16 | 24 {
  return width < 360 ? 16 : 24;
}

/**
 * Shared vertical screen frame. Content remains scrollable when Dynamic Type
 * expands it, while all four safe-area edges and generous bottom clearance are
 * retained.
 */
export function GardenScreen({
  children,
  contentContainerStyle,
  testID = "garden-screen",
}: GardenScreenProps): ReactElement {
  const { colors, spacing } = useGardenTheme();
  const { width } = useWindowDimensions();
  const horizontalPadding = getScreenHorizontalPadding(width);

  return (
    <SafeAreaView
      edges={["top", "right", "bottom", "left"]}
      style={[styles.safeArea, { backgroundColor: colors.surface }]}
      testID={testID}
    >
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[
          contentContainerStyle,
          styles.content,
          {
            paddingBottom: spacing.giant,
            paddingHorizontal: horizontalPadding,
            paddingTop: spacing.xxl,
          },
        ]}
        contentInsetAdjustmentBehavior="automatic"
        horizontal={false}
        keyboardShouldPersistTaps="handled"
        testID={`${testID}-scroll`}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
});
