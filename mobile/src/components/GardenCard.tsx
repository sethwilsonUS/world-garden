import type { ReactElement, ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet, View } from "react-native";

import { useGardenTheme } from "../theme/useGardenTheme";

export interface GardenCardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A visual grouping only. Its children retain their own reading order and
 * semantics instead of being collapsed into one oversized accessibility stop.
 */
export function GardenCard({
  children,
  style,
  testID,
}: GardenCardProps): ReactElement {
  const { colors, radii, spacing } = useGardenTheme();

  return (
    <View
      accessible={false}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface2,
          borderColor: colors.border,
          borderRadius: radii.xxl,
          gap: spacing.md,
          padding: spacing.xxl,
        },
        style,
      ]}
      testID={testID}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
  },
});
