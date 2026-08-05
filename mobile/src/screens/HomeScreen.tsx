import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { BrandHeading } from "../components/BrandHeading";
import { GardenButton } from "../components/GardenButton";
import { GardenCard } from "../components/GardenCard";
import { WikipediaSearchForm } from "../components/WikipediaSearchForm";
import { GardenScreen } from "../layout/GardenScreen";
import { GardenText } from "../theme/GardenText";

export function HomeScreen() {
  const router = useRouter();

  return (
    <GardenScreen contentContainerStyle={styles.content} testID="home-screen">
      <View accessible={false} style={styles.hero}>
        <BrandHeading />
        <GardenText color="foreground2" variant="intro">
          Explore any Wikipedia article as clear, section-by-section audio, then
          keep listening wherever curiosity takes you.
        </GardenText>
      </View>

      <GardenCard style={styles.workbench}>
        <GardenText color="accent" variant="eyebrow">
          Your next curiosity
        </GardenText>
        <GardenText accessibilityRole="header" variant="sectionTitle">
          Find a topic. Follow the thread.
        </GardenText>
        <GardenText color="foreground2">
          Search any Wikipedia article, then choose the sections you want to
          hear.
        </GardenText>
        <WikipediaSearchForm
          onSubmit={(term) =>
            router.push({ pathname: "/search", params: { q: term } })
          }
        />
        <GardenText color="muted" variant="metadata">
          No account needed to begin.
        </GardenText>
        <GardenButton
          hint="Open sign-in and account settings."
          label="Account"
          onPress={() => router.push("/account")}
          variant="secondary"
        />
      </GardenCard>
    </GardenScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 32,
    justifyContent: "center",
  },
  hero: {
    gap: 16,
  },
  workbench: {
    alignSelf: "stretch",
  },
});
