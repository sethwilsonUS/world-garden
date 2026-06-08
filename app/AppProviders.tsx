"use client";

import { ReactNode } from "react";
import dynamic from "next/dynamic";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ArticleAudioExportFallbackProvider } from "@/components/ArticleAudioExportProvider";
import { BadgeProgressToastFallbackProvider } from "@/components/BadgeProgressToastProvider";
import { LocalBookmarkProvider } from "@/hooks/useBookmarks";
import { PersonalPlaylistFallbackProvider } from "@/hooks/usePersonalPlaylist";

const isLocal = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
const localModeConvexClient = isLocal
  ? new ConvexReactClient("https://local-mode-placeholder.convex.cloud")
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
