import {
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const colors = {
  light: {
    surface: "#f7f6f3",
    surfaceRaised: "#efede8",
    foreground: "#1a1a1a",
    secondary: "#4b5441",
    accent: "#036b4a",
  },
  dark: {
    surface: "#171717",
    surfaceRaised: "#1e1e1e",
    foreground: "#f0ede6",
    secondary: "#a8b89e",
    accent: "#34d399",
  },
} as const;

export function FoundationScreen() {
  const colorScheme = useColorScheme();
  const palette = colors[colorScheme === "dark" ? "dark" : "light"];

  return (
    <SafeAreaView
      edges={["top", "right", "bottom", "left"]}
      style={[styles.safeArea, { backgroundColor: palette.surface }]}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={2.25}
          style={[styles.title, { color: palette.foreground }]}
        >
          Curio Garden
        </Text>
        <Text style={[styles.intro, { color: palette.secondary }]}>
          A quieter way to explore and listen to Wikipedia.
        </Text>

        <View style={[styles.card, { backgroundColor: palette.surfaceRaised }]}>
          <Text style={[styles.eyebrow, { color: palette.accent }]}>
            FOUNDATION
          </Text>
          <Text style={[styles.cardTitle, { color: palette.foreground }]}>
            Development client foundation ready.
          </Text>
          <Text style={[styles.body, { color: palette.secondary }]}>
            Expo Go is optional; signed native builds are the release gate.
          </Text>
        </View>
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
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  title: {
    fontSize: 40,
    fontWeight: "700",
    letterSpacing: -1,
    lineHeight: 46,
  },
  intro: {
    fontSize: 18,
    lineHeight: 30,
  },
  card: {
    gap: 12,
    marginTop: 16,
    padding: 24,
    borderRadius: 16,
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.6,
    lineHeight: 20,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 28,
  },
  body: {
    fontSize: 16,
    lineHeight: 27,
  },
});
