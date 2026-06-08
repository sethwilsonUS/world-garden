"use client";

import { ReactNode } from "react";
import dynamic from "next/dynamic";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ArticleAudioExportFallbackProvider } from "@/components/ArticleAudioExportProvider";
import { BadgeProgressToastFallbackProvider } from "@/components/BadgeProgressToastProvider";
import { LocalBookmarkProvider } from "@/hooks/useBookmarks";
import { PersonalPlaylistFallbackProvider } from "@/hooks/usePersonalPlaylist";

const isLocal = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
const LOCAL_MODE_CONVEX_FALLBACK_URL = "http://127.0.0.1:3210";
const LOCAL_CONVEX_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

const configuredConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
const localModeConvexUrl =
  configuredConvexUrl || LOCAL_MODE_CONVEX_FALLBACK_URL;
const shouldSkipConvexDeploymentUrlCheck = (url: string): boolean => {
  try {
    return LOCAL_CONVEX_HOSTNAMES.has(new URL(url).hostname);
  } catch {
    return false;
  }
};
const shouldSkipLocalModeConvexCheck =
  !configuredConvexUrl ||
  shouldSkipConvexDeploymentUrlCheck(localModeConvexUrl);

// Local mode skips live Convex calls, but Convex hooks still need a provider.
// Prefer the real dev URL when present; otherwise use a dormant local URL.
const localModeConvexClient = isLocal
  ? new ConvexReactClient(
      localModeConvexUrl,
      shouldSkipLocalModeConvexCheck
        ? { skipConvexDeploymentUrlCheck: true }
        : undefined,
    )
  : null;

const ConvexDataProvider = isLocal
  ? null
  : dynamic(
      () =>
        import("@/lib/convex-data-provider").then((m) => m.ConvexDataProvider),
      { ssr: true },
    );

const LocalDataProvider = isLocal
  ? dynamic(
      () =>
        import("@/lib/local-data-provider").then((m) => m.LocalDataProvider),
      { ssr: true },
    )
  : null;

const LocalModeBanner = isLocal
  ? dynamic(
      () =>
        import("@/components/LocalModeBanner").then((m) => m.LocalModeBanner),
      { ssr: true },
    )
  : null;

export const AppProviders = ({ children }: { children: ReactNode }) => {
  if (isLocal && LocalDataProvider) {
    return (
      <ConvexProvider client={localModeConvexClient!}>
        <PersonalPlaylistFallbackProvider>
          <ArticleAudioExportFallbackProvider>
            <BadgeProgressToastFallbackProvider>
              <LocalBookmarkProvider>
                <LocalDataProvider>
                  {LocalModeBanner && <LocalModeBanner />}
                  {children}
                </LocalDataProvider>
              </LocalBookmarkProvider>
            </BadgeProgressToastFallbackProvider>
          </ArticleAudioExportFallbackProvider>
        </PersonalPlaylistFallbackProvider>
      </ConvexProvider>
    );
  }

  if (ConvexDataProvider) {
    return <ConvexDataProvider>{children}</ConvexDataProvider>;
  }

  return <>{children}</>;
};
