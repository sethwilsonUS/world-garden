import { Stack, ThemeProvider as NavigationThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { HostedAuthProvider } from "../src/auth/HostedAuthFlow";
import { getMobileRuntimeConfig } from "../src/config/runtime-config";
import { NativeDataAuthProvider } from "../src/providers/NativeDataAuthProvider";
import {
  GardenThemeProvider,
  useGardenTheme,
} from "../src/theme/GardenThemeProvider";

function NativeNavigationShell() {
  const {
    accessibilityPreferences: { reduceMotion },
    colors,
    isDark,
    navigationTheme,
  } = useGardenTheme();

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.surface).catch(() => {
      // The screen itself owns the same surface color, so a platform API
      // failure cannot strand startup or reduce text contrast.
    });
  }, [colors.surface]);

  return (
    <NavigationThemeProvider value={navigationTheme}>
      <Stack
        screenOptions={{
          animation: reduceMotion ? "none" : "default",
          contentStyle: { backgroundColor: colors.surface },
          headerShown: false,
        }}
      />
      <StatusBar style={isDark ? "light" : "dark"} />
    </NavigationThemeProvider>
  );
}

export default function RootLayout() {
  const { clerkPublishableKey, convexUrl, webOrigin } =
    getMobileRuntimeConfig();

  return (
    <SafeAreaProvider>
      <NativeDataAuthProvider
        clerkPublishableKey={clerkPublishableKey}
        convexUrl={convexUrl}
        webOrigin={webOrigin}
      >
        <GardenThemeProvider>
          <HostedAuthProvider>
            <NativeNavigationShell />
          </HostedAuthProvider>
        </GardenThemeProvider>
      </NativeDataAuthProvider>
    </SafeAreaProvider>
  );
}
