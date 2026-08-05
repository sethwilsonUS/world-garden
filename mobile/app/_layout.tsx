import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

const lightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: "#036b4a",
    background: "#f7f6f3",
    card: "#f7f6f3",
    text: "#1a1a1a",
    border: "#d4d1c7",
    notification: "#b91c1c",
  },
};

const darkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: "#34d399",
    background: "#171717",
    card: "#171717",
    text: "#f0ede6",
    border: "#2f2f2f",
    notification: "#f87171",
  },
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  return (
    <SafeAreaProvider>
      <ThemeProvider value={isDark ? darkTheme : lightTheme}>
        <Stack screenOptions={{ headerShown: false }} />
        <StatusBar style={isDark ? "light" : "dark"} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
