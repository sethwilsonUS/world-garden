"use client";

import { ReactNode } from "react";
import dynamic from "next/dynamic";
import { ArticleAudioExportFallbackProvider } from "@/components/ArticleAudioExportProvider";
import { LocalBookmarkProvider } from "@/hooks/useBookmarks";
import { PersonalPlaylistFallbackProvider } from "@/hooks/usePersonalPlaylist";

const isLocal = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

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
      <PersonalPlaylistFallbackProvider>
        <ArticleAudioExportFallbackProvider>
          <LocalBookmarkProvider>
            <LocalDataProvider>
              {LocalModeBanner && <LocalModeBanner />}
              {children}
            </LocalDataProvider>
          </LocalBookmarkProvider>
        </ArticleAudioExportFallbackProvider>
      </PersonalPlaylistFallbackProvider>
    );
  }

  if (ConvexDataProvider) {
    return <ConvexDataProvider>{children}</ConvexDataProvider>;
  }

  return <>{children}</>;
};
