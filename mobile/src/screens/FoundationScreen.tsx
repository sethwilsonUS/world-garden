import { StyleSheet, View } from "react-native";

import { BrandHeading } from "../components/BrandHeading";
import { GardenCard } from "../components/GardenCard";
import { GardenScreen } from "../layout/GardenScreen";
import { GardenText } from "../theme/GardenText";

export function FoundationScreen() {
  return (
    <GardenScreen
      contentContainerStyle={styles.content}
      testID="foundation-screen"
    >
      <View style={styles.hero}>
        <BrandHeading />
        <GardenText color="foreground2" variant="intro">
          Explore any Wikipedia article as clear, section-by-section audio, then
          keep listening wherever curiosity takes you.
        </GardenText>
      </View>

      <GardenCard>
        <GardenText color="accent" variant="eyebrow">
          Native foundation
        </GardenText>
        <GardenText variant="cardTitle">
          Development client foundation ready.
        </GardenText>
        <GardenText color="foreground2">
          Expo Go is optional; signed native builds are the release gate.
        </GardenText>
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
});
